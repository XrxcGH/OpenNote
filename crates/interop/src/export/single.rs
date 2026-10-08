//! Exporting to one self-contained HTML file: the text, with the pictures inside it.
//!
//! A page becomes one `.html` file. A section or a notebook becomes one file with a list of contents at the top,
//! and links between its pages jump within the file. Pictures are embedded as `data:` addresses, so the file
//! opens in any browser, offline, and moves as a single file. Attachments cannot be embedded safely, so their
//! names stay in the text and the report says so.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use opennote_core::model::{Asset, Page};
use opennote_core::PageId;

use super::convert::{page_to_blocks, Resolver};
use super::files::Exported;
use super::names::sanitize_name;
use super::plan::{self, Scope};
use crate::error::{InteropError, Result};
use crate::html::{self, Meta, SinglePage};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;

/// The largest picture that is embedded.
const MAX_IMAGE_BYTES: usize = 25 << 20;
/// The largest file that this export writes.
const MAX_FILE_BYTES: usize = 512 << 20;

/// Exports to `out_dir/<title>.html`, or `out_dir/<title> (2).html` and so on, so nothing is overwritten.
pub fn export_html_single(
    source: &dyn NoteSource,
    scope: Scope,
    out_dir: &Path,
    control: &Control,
) -> Result<Exported> {
    let plan = plan::build(source, scope, "html")?;
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    let mut resolver = Embed {
        source,
        anchors: plan.pages.iter().map(|p| (p.id, anchor(p.id))).collect(),
        embedded: 0,
        attachments: 0,
        too_big: Vec::new(),
        total: 0,
    };
    let mut report = Report::new(ReportKind::Export, format!("{} as one web page", plan.title));
    let mut singles = Vec::new();
    let mut first_meta: Option<(Page, Vec<String>)> = None;
    for planned in &plan.pages {
        control.checkpoint()?;
        match source.page(planned.id) {
            Ok(page) => {
                let mut page_report = PageReport {
                    title: page.title.clone(),
                    ..PageReport::default()
                };
                let blocks = page_to_blocks(&page, &mut resolver, &mut page_report);
                report.add_page(page_report);
                singles.push(SinglePage {
                    anchor: anchor(page.id),
                    title: page.title.clone(),
                    level: planned.level,
                    body: html::blocks_to_html(&blocks),
                });
                if first_meta.is_none() {
                    first_meta = Some((page.clone(), page.tags.clone()));
                }
            }
            Err(error) => report
                .general
                .skipped(format!("page {:?}", planned.title), error.to_string()),
        }
        control.step(Phase::Writing, 1, &planned.title);
    }
    resolver.describe(&mut report);
    let document = match (scope, singles.as_slice(), &first_meta) {
        (Scope::Page(_), [only], Some((page, tags))) => {
            let meta = Meta {
                created: Some(page.created),
                modified: Some(page.modified),
                tags,
                index: false,
            };
            html::page_document(&only.title, &meta, &only.body)
        }
        _ => html::bundle_document(&plan.title, &singles),
    };
    if document.len() > MAX_FILE_BYTES {
        return Err(InteropError::TooBig("the web page".to_owned()));
    }
    fs::create_dir_all(out_dir).map_err(|e| InteropError::io(out_dir, e))?;
    let path = unique_file(out_dir, &plan.title)?;
    fs::write(&path, document).map_err(|e| InteropError::io(&path, e))?;
    Ok(Exported {
        root: out_dir.to_path_buf(),
        files: vec![path],
        report,
    })
}

fn anchor(id: PageId) -> String {
    format!("page-{id}")
}

fn unique_file(out_dir: &Path, title: &str) -> Result<std::path::PathBuf> {
    let name = sanitize_name(title, "OpenNote export");
    let mut path = out_dir.join(format!("{name}.html"));
    let mut n = 2;
    while path.exists() {
        path = out_dir.join(format!("{name} ({n}).html"));
        n += 1;
    }
    Ok(path)
}

/// Embeds pictures and points links at the sections of the file.
struct Embed<'a> {
    source: &'a dyn NoteSource,
    anchors: HashMap<PageId, String>,
    embedded: usize,
    attachments: usize,
    too_big: Vec<String>,
    total: usize,
}

impl Embed<'_> {
    fn describe(&self, report: &mut Report) {
        for name in &self.too_big {
            report
                .general
                .skipped(format!("the image {name}"), "It is too big to embed in one file.");
        }
        if self.attachments > 0 {
            let what = crate::report::counted(self.attachments, "attachment", "attachments");
            report.general.simplified(
                what,
                "One web page file holds the names of attachments, not the files. Export a web page folder to keep them.",
            );
        }
    }
}

impl Resolver for Embed<'_> {
    fn asset(&mut self, page: &Page, asset: &Asset) -> Option<String> {
        let kind = match asset.mime.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpeg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            "image/svg+xml" => "svg+xml",
            _ => {
                self.attachments += 1;
                return Some(format!("attachment:{}", asset.name));
            }
        };
        if usize::try_from(asset.bytes).map_or(true, |n| n > MAX_IMAGE_BYTES) || self.total > MAX_FILE_BYTES {
            self.too_big.push(asset.name.clone());
            return None;
        }
        let bytes = self.source.asset_bytes(page, asset).ok()?;
        self.total += bytes.len();
        self.embedded += 1;
        Some(format!("data:image/{kind};base64,{}", STANDARD.encode(bytes)))
    }

    fn page(&mut self, _from: PageId, to: PageId) -> Option<String> {
        self.anchors.get(&to).map(|anchor| format!("#{anchor}"))
    }

    fn ink(&mut self, _page: &Page, svg: Vec<u8>) -> Option<String> {
        if svg.len() > MAX_IMAGE_BYTES || self.total > MAX_FILE_BYTES {
            self.too_big.push("handwriting".to_owned());
            return None;
        }
        self.total += svg.len();
        self.embedded += 1;
        Some(format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg)))
    }
}
