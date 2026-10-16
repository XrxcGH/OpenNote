//! Exporting to a Word file: one `.docx` for a page, a section, or a notebook.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use opennote_core::model::{Asset, Page};
use opennote_core::{PageId, Timestamp};

use super::convert::{page_to_blocks, Resolver};
use super::files::Exported;
use super::names::sanitize_name;
use super::plan::{self, PlannedPage, Scope};
use crate::assets::image_size;
use crate::doc::Block as DocBlock;
use crate::docx::{self, Media, Part, WordInput};
use crate::error::{InteropError, Result};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;

/// Exports to `out_dir/<title>.docx`, or `out_dir/<title> (2).docx` and so on, so nothing is overwritten.
pub fn export_docx(source: &dyn NoteSource, scope: Scope, out_dir: &Path) -> Result<Exported> {
    export_docx_with(source, scope, out_dir, &Control::none())
}

/// Exports to a Word file. It reports progress, and it stops when the control is canceled. Nothing is written
/// until every page has been read, so a canceled export leaves no file.
pub fn export_docx_with(source: &dyn NoteSource, scope: Scope, out_dir: &Path, control: &Control) -> Result<Exported> {
    let plan = plan::build(source, scope, "docx")?;
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    let mut resolver = WordResolver {
        source,
        pages: plan.pages.iter().map(|p| p.id).collect(),
        media: HashMap::new(),
        unsupported: Vec::new(),
        attachments: 0,
    };
    let mut report = Report::new(ReportKind::Export, format!("{} as Word", plan.title));
    let mut body = Body::default();
    for planned in &plan.pages {
        control.checkpoint()?;
        control.step(Phase::Writing, 1, &planned.title);
        match source.page(planned.id) {
            Ok(page) => {
                let mut page_report = PageReport {
                    title: page.title.clone(),
                    ..PageReport::default()
                };
                let blocks = page_to_blocks(&page, &mut resolver, &mut page_report);
                report.add_page(page_report);
                body.add(planned, &page, blocks, scope == Scope::Notebook);
            }
            Err(error) => {
                report
                    .general
                    .skipped(format!("page {:?}", planned.title), error.to_string());
            }
        }
    }
    resolver.describe(&mut report);
    let input = WordInput {
        title: plan.title.clone(),
        created: body.created.unwrap_or(Timestamp::EPOCH),
        modified: body.modified.unwrap_or(Timestamp::EPOCH),
        parts: body.parts,
        media: resolver.media,
    };
    let bytes = docx::build(&input)?;
    let path = unique_file(out_dir, &plan.title)?;
    fs::write(&path, bytes).map_err(|e| InteropError::io(&path, e))?;
    Ok(Exported {
        root: out_dir.to_path_buf(),
        files: vec![path],
        report,
    })
}

/// The body of the document so far, and the dates it covers.
#[derive(Default)]
struct Body {
    parts: Vec<Part>,
    created: Option<Timestamp>,
    modified: Option<Timestamp>,
    last_section: Option<String>,
}

impl Body {
    /// Adds a page after a page break, with its section's name when that changes.
    fn add(&mut self, planned: &PlannedPage, page: &Page, blocks: Vec<DocBlock>, show_section: bool) {
        if !self.parts.is_empty() {
            self.parts.push(Part::PageBreak);
        }
        if show_section && self.last_section.as_deref() != Some(planned.section.as_str()) {
            self.parts.push(Part::Subtitle(planned.section.clone()));
            self.last_section = Some(planned.section.clone());
        }
        self.parts.push(Part::Title {
            text: page.title.clone(),
            bookmark: Some(bookmark(page.id)),
        });
        self.parts.push(Part::Blocks(blocks));
        self.created = Some(self.created.map_or(page.created, |t| t.min(page.created)));
        self.modified = Some(self.modified.map_or(page.modified, |t| t.max(page.modified)));
    }
}

fn bookmark(id: PageId) -> String {
    format!("page_{id}")
}

fn unique_file(out_dir: &Path, title: &str) -> Result<std::path::PathBuf> {
    fs::create_dir_all(out_dir).map_err(|e| InteropError::io(out_dir, e))?;
    let name = sanitize_name(title, "OpenNote export");
    let mut path = out_dir.join(format!("{name}.docx"));
    let mut n = 2;
    while path.exists() {
        path = out_dir.join(format!("{name} ({n}).docx"));
        n += 1;
    }
    Ok(path)
}

/// Collects the pictures of the document, and points links at the bookmarks of pages.
struct WordResolver<'a> {
    source: &'a dyn NoteSource,
    pages: HashSet<PageId>,
    media: HashMap<String, Media>,
    unsupported: Vec<String>,
    attachments: usize,
}

impl WordResolver<'_> {
    fn describe(&self, report: &mut Report) {
        for name in &self.unsupported {
            report
                .general
                .skipped(format!("the image {name}"), "Word cannot show this image type.");
        }
        if self.attachments > 0 {
            let what = crate::report::counted(self.attachments, "attachment", "attachments");
            report
                .general
                .simplified(what, "Word files hold the names of attachments, not the files.");
        }
    }
}

impl Resolver for WordResolver<'_> {
    fn asset(&mut self, page: &Page, asset: &Asset) -> Option<String> {
        let dest = format!("media:{}", asset.id);
        if self.media.contains_key(&dest) {
            return Some(dest);
        }
        if !asset.mime.starts_with("image/") {
            self.attachments += 1;
            return Some(format!("attachment:{}", asset.name));
        }
        let ext = match asset.mime.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpeg",
            "image/gif" => "gif",
            "image/bmp" => "bmp",
            _ => {
                if !self.unsupported.contains(&asset.name) {
                    self.unsupported.push(asset.name.clone());
                }
                return None;
            }
        };
        let bytes = self.source.asset_bytes(page, asset).ok()?;
        let (width, height) = match (asset.width, asset.height) {
            (Some(w), Some(h)) => (w, h),
            _ => image_size(&bytes).unwrap_or((480, 320)),
        };
        self.media.insert(
            dest.clone(),
            Media {
                bytes,
                ext: ext.to_owned(),
                width,
                height,
            },
        );
        Some(dest)
    }

    fn page(&mut self, _from: PageId, to: PageId) -> Option<String> {
        self.pages.contains(&to).then(|| format!("#{}", bookmark(to)))
    }
}
