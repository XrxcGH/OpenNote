//! Session benchmarks: opening the notebook, the page list, and the storage path of a page open (plan 13.9).
//! Owned by WP5.
//!
//! They run on the test core (`session::kit`). It keeps its files in memory and uses the registry codec, so
//! they time the session layer alone: the tree, the locks, the caches, and the envelope. The same code will
//! run against the real file system and codecs once the integrator swaps them in, and the numbers then
//! include the disk. A report from this stage names the machine it ran on, and never counts as a pass on the
//! reference laptop.

use std::path::{Path, PathBuf};

use opennote_core::error::CoreError;
use opennote_core::id::{PageId, SectionId};
use opennote_core::model::Rect;
use opennote_core::session::kit::{client, CoreKit};
use opennote_core::session::notebook::{NodePlacement, NotebookHandle, ParentRef};

use crate::harness::{time, BenchCtx, Samples};

/// Timings for the warm open, which reuses the cache of the same core.
const WARM_RUNS: usize = 20;
/// Timings for the cold open, where each run starts a new core.
const COLD_RUNS: usize = 8;
/// A heavy page, as the plan's budget page: 5,000 strokes.
pub const BUDGET_STROKES: u64 = 5_000;
/// How many pages one section holds in the default layout.
const PAGES_PER_SECTION: usize = 50;
/// How many section groups the default layout has.
const GROUPS: usize = 3;

/// A sample notebook on the test core.
pub struct Sample {
    /// The core and what it runs on.
    pub kit: CoreKit,
    /// The open notebook.
    pub notebook: NotebookHandle,
    /// The notebook folder.
    pub root: PathBuf,
    /// Every section, in creation order.
    pub sections: Vec<SectionId>,
    /// Every page, in creation order.
    pub pages: Vec<PageId>,
}

/// Builds a notebook with `pages` pages: 50 pages to a section and three section groups, or every page in one
/// section. Every fifth page is a subpage of the page before it.
pub fn build(pages: usize, one_section: bool) -> Result<Sample, String> {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Benchmark").map_err(text)?;
    let sections = create_sections(&notebook, pages, one_section)?;
    let per = pages.div_ceil(sections.len().max(1)).max(1);
    let mut made: Vec<PageId> = Vec::with_capacity(pages);
    for section in &sections {
        for i in 0..per {
            if made.len() >= pages {
                break;
            }
            let parent = match made.last() {
                Some(last) if i % 5 == 4 => ParentRef::Page(*last),
                _ => ParentRef::Section(*section),
            };
            let at = NodePlacement { parent, before: None };
            let title = format!("Page {}", made.len());
            made.push(notebook.create_page_titled(*section, at, &title).map_err(text)?);
        }
    }
    Ok(Sample {
        root: notebook.path().to_path_buf(),
        kit,
        notebook,
        sections,
        pages: made,
    })
}

fn create_sections(notebook: &NotebookHandle, pages: usize, one_section: bool) -> Result<Vec<SectionId>, String> {
    let top = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    if one_section {
        return Ok(vec![notebook.create_section("All pages", top).map_err(text)?]);
    }
    let mut groups = Vec::new();
    for i in 0..GROUPS {
        groups.push(notebook.create_group(&format!("Group {i}"), top).map_err(text)?);
    }
    let count = pages.div_ceil(PAGES_PER_SECTION).max(1);
    let mut sections = Vec::with_capacity(count);
    for i in 0..count {
        let parent = groups
            .get(i % GROUPS)
            .map_or(ParentRef::Notebook, |g| ParentRef::Group(*g));
        let at = NodePlacement { parent, before: None };
        sections.push(notebook.create_section(&format!("Section {i}"), at).map_err(text)?);
    }
    Ok(sections)
}

/// An error as text.
pub fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// The budget for a measure, doubled for the quick set that pull requests run on shared runners.
pub fn gate(ctx: &BenchCtx, plain: f64) -> f64 {
    if ctx.quick {
        plain * 2.0
    } else {
        plain
    }
}

/// A duration in milliseconds.
pub fn ms(d: std::time::Duration) -> f64 {
    d.as_secs_f64() * 1_000.0
}

/// Runs the `session` suite and adds its measurements to the report.
pub fn run(ctx: &mut BenchCtx) -> Result<(), String> {
    let sample = build(ctx.pages, false)?;
    open_notebook(ctx, sample)?;
    page_list(ctx)?;
    page_open(ctx)
}

/// Closes the notebook at `root` if the core has it open.
pub fn close_open(kit: &CoreKit, root: &Path) -> Result<(), String> {
    match kit.core.find_open(root) {
        Some(open) => open.close().map_err(text),
        None => Ok(()),
    }
}

/// Opening the notebook until its tree is ready, warm (the same core closes and opens it again) and cold (a
/// new core opens it).
fn open_notebook(ctx: &mut BenchCtx, sample: Sample) -> Result<(), String> {
    let Sample { kit, root, .. } = sample;
    let mut warm = Samples::default();
    for _ in 0..WARM_RUNS {
        close_open(&kit, &root)?;
        let (opened, took) = time(|| kit.core.open_notebook(&root).map(|n| n.tree()));
        opened.map_err(text)?;
        warm.push(took);
    }
    close_open(&kit, &root)?;
    let mut cold = Samples::default();
    for _ in 0..COLD_RUNS {
        let second = kit.beside();
        let (opened, took) = time(|| second.core.open_notebook(&root).map(|n| n.tree()));
        opened.map_err(text)?;
        cold.push(took);
        close_open(&second, &root)?;
    }
    let (warm_gate, cold_gate) = (gate(ctx, 50.0), gate(ctx, 250.0));
    ctx.report.add(
        "open.notebook.warm.p95",
        "ms",
        ms(warm.percentile(95.0)),
        Some(warm_gate),
    );
    ctx.report.add(
        "open.notebook.cold.p95",
        "ms",
        ms(cold.percentile(95.0)),
        Some(cold_gate),
    );
    Ok(())
}

/// The page list of a section that holds every page, which the navigation tree asks for at start-up.
fn page_list(ctx: &mut BenchCtx) -> Result<(), String> {
    let sample = build(ctx.pages, true)?;
    let section = *sample.sections.first().ok_or("the sample has no section")?;
    let mut samples = Samples::default();
    for _ in 0..WARM_RUNS {
        let (listed, took) = time(|| {
            let flat = sample.notebook.flat_pages(section)?;
            Ok::<_, CoreError>((flat, sample.notebook.tree()))
        });
        std::hint::black_box(listed.map_err(text)?);
        samples.push(took);
    }
    let limit = gate(ctx, 50.0);
    ctx.report.add(
        "page_list.one_section.p95",
        "ms",
        ms(samples.percentile(95.0)),
        Some(limit),
    );
    Ok(())
}

/// The core's share of opening a budget page: the session, then the envelope with the first viewport's strokes.
fn page_open(ctx: &mut BenchCtx) -> Result<(), String> {
    let sample = build(ctx.pages.min(PAGES_PER_SECTION), false)?;
    let section = *sample.sections.first().ok_or("the sample has no section")?;
    let (page, _) = sample
        .kit
        .inked_page_with(&sample.notebook, section, BUDGET_STROKES)
        .map_err(text)?;
    let viewport = Rect {
        x: 0.0,
        y: 0.0,
        w: 800.0,
        h: 1_000.0,
    };
    let who = client("main-1");
    let mut samples = Samples::default();
    for _ in 0..WARM_RUNS {
        let (opened, took) = time(|| {
            let handle = sample.notebook.open_page(page, who.clone())?;
            let envelope = handle.envelope(Some(viewport))?;
            Ok::<_, CoreError>((handle, envelope))
        });
        let (handle, envelope) = opened.map_err(text)?;
        std::hint::black_box(&envelope);
        handle.close(&who).map_err(text)?;
        samples.push(took);
    }
    let limit = gate(ctx, 25.0);
    ctx.report.add(
        "open.budget_page.core.warm.p95",
        "ms",
        ms(samples.percentile(95.0)),
        Some(limit),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(pages: usize) -> BenchCtx {
        BenchCtx {
            pages,
            quick: true,
            dir: PathBuf::new(),
            report: crate::harness::Report::default(),
        }
    }

    #[test]
    fn builds_the_default_layout() {
        let sample = build(120, false).unwrap();
        assert_eq!(sample.pages.len(), 120);
        assert_eq!(sample.sections.len(), 3);
        assert_eq!(sample.notebook.tree().groups.len(), GROUPS);
        let flat = sample.notebook.flat_pages(sample.sections[0]).unwrap();
        assert!(flat.iter().any(|f| f.level == 1), "every fifth page is a subpage");
    }

    #[test]
    fn the_suite_reports_each_measure_under_its_quick_budget() {
        let mut ctx = context(60);
        run(&mut ctx).unwrap();
        let names: Vec<&str> = ctx.report.results.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "open.notebook.warm.p95",
                "open.notebook.cold.p95",
                "page_list.one_section.p95",
                "open.budget_page.core.warm.p95"
            ]
        );
        assert_eq!(ctx.report.results[0].gate, Some(100.0));
    }
}
