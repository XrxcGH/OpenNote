//! Exporting to LaTeX: a `.tex` file for a page, a section, or a notebook, with its pictures and its BibTeX file.
//!
//! A page becomes the whole document, or a section of it when a section or notebook is exported. The export
//! writes one `.tex` file when that is all there is, and a `.zip` file with the `.tex` file, an `images/` folder, and
//! `references.bib` when there is more than one file. See ADR 0054 for the choices behind the output.

mod blocks;
mod escape;
mod inkpdf;
mod inline;
mod math;
mod page;
mod preamble;
mod table;
mod writer;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::format::readable::ink_lines;
use opennote_core::model::{Asset, Page};
use opennote_core::{AssetId, PageId};
use serde::Deserialize;

use super::convert::{convert_page, Resolver};
use super::files::Exported;
use super::names::sanitize_name;
use super::plan::{self, Scope};
use crate::doc::Inline;
use crate::docx::zip::ZipWriter;
use crate::error::{InteropError, Result};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;
use writer::{Library, Stats, Writer};

/// The largest `.tex` file this export writes.
const MAX_TEX_BYTES: usize = 256 << 20;
/// The most bytes of pictures in one export.
const MAX_PICTURE_BYTES: usize = 1 << 30;
/// How many pages the preview converts.
const PREVIEW_PAGES: usize = 3;

/// Which characters the file may hold.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Engine {
    /// Any Unicode text, for XeLaTeX and LuaLaTeX. pdfLaTeX still reads the Latin letters.
    #[default]
    Unicode,
    /// Only what pdfLaTeX can show. Greek letters and math signs become commands; other characters, question marks.
    Pdflatex,
}

/// The paper size.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Paper {
    /// 8.5 by 11 inches.
    #[default]
    Letter,
    /// 210 by 297 millimeters.
    A4,
}

/// The margins.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Margin {
    /// Three quarters of an inch.
    Narrow,
    /// One inch.
    #[default]
    Normal,
    /// One and a quarter inches.
    Wide,
}

/// The date under the title.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DateChoice {
    /// No date.
    None,
    /// The day the document is compiled (`\today`).
    #[default]
    Today,
    /// The day of the latest edit of the exported pages.
    Edited,
}

/// A source of the citation library, with its BibTeX entry.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Citation {
    /// The notebook whose list holds the source.
    pub notebook: String,
    /// The source's ID, which a citation block names.
    pub id: String,
    /// The BibTeX key.
    pub key: String,
    /// The whole BibTeX entry, such as `@book{Smith2020, ...}`.
    pub entry: String,
}

/// What the person chose in the options.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LatexOptions {
    /// Which characters the file may hold.
    pub engine: Engine,
    /// The paper size.
    pub paper: Paper,
    /// The margins.
    pub margin: Margin,
    /// Whether to write a table of contents.
    pub toc: bool,
    /// Whether to write the title, author, and date.
    pub title_block: bool,
    /// The author under the title.
    pub author: String,
    /// The date under the title.
    pub date: DateChoice,
    /// The citation library, for citations and bibliographies.
    pub citations: Vec<Citation>,
}

impl Default for LatexOptions {
    fn default() -> LatexOptions {
        LatexOptions {
            engine: Engine::default(),
            paper: Paper::default(),
            margin: Margin::default(),
            toc: false,
            title_block: true,
            author: String::new(),
            date: DateChoice::default(),
            citations: Vec::new(),
        }
    }
}

/// The text of the file and the files that go with it.
struct Built {
    title: String,
    tex: String,
    /// The pictures: path inside the folder, and bytes.
    files: Vec<(String, Vec<u8>)>,
    bib: Option<String>,
    report: Report,
}

/// Exports to `out_dir/<title>.tex`, or to `out_dir/<title>.zip` when there are pictures or a bibliography. A name
/// that is taken gets a number, so nothing is overwritten.
pub fn export_latex(source: &dyn NoteSource, scope: Scope, options: &LatexOptions, out_dir: &Path) -> Result<Exported> {
    export_latex_with(source, scope, options, out_dir, &Control::none())
}

/// Exports like [`export_latex`], reporting progress and stopping when the control is canceled. Nothing is written
/// until every page has been read, so a canceled export leaves no file.
pub fn export_latex_with(
    source: &dyn NoteSource,
    scope: Scope,
    options: &LatexOptions,
    out_dir: &Path,
    control: &Control,
) -> Result<Exported> {
    let built = build(source, scope, options, control, false)?;
    fs::create_dir_all(out_dir).map_err(|e| InteropError::io(out_dir, e))?;
    let stem = file_stem(&built.title);
    let path = if built.files.is_empty() && built.bib.is_none() {
        let path = unique(out_dir, &stem, "tex");
        fs::write(&path, built.tex.as_bytes()).map_err(|e| InteropError::io(&path, e))?;
        path
    } else {
        let mut zip = ZipWriter::new();
        zip.add(&format!("{stem}/{stem}.tex"), built.tex.as_bytes())?;
        for (name, bytes) in &built.files {
            zip.add(&format!("{stem}/{name}"), bytes)?;
        }
        if let Some(bib) = &built.bib {
            zip.add(&format!("{stem}/references.bib"), bib.as_bytes())?;
        }
        let path = unique(out_dir, &stem, "zip");
        fs::write(&path, zip.finish()?).map_err(|e| InteropError::io(&path, e))?;
        path
    };
    Ok(Exported {
        root: out_dir.to_path_buf(),
        files: vec![path],
        report: built.report,
    })
}

/// The start of the `.tex` text, for the options dialog: the first pages, cut at `max_chars`. It reads no picture
/// files and writes nothing.
pub fn latex_preview(
    source: &dyn NoteSource,
    scope: Scope,
    options: &LatexOptions,
    max_chars: usize,
) -> Result<String> {
    let built = build(source, scope, options, &Control::none(), true)?;
    if built.tex.chars().count() <= max_chars {
        return Ok(built.tex);
    }
    let cut: String = built.tex.chars().take(max_chars).collect();
    let end = cut.rfind('\n').unwrap_or(cut.len());
    Ok(format!(
        "{}\n% ... The rest of the file is not shown in this preview.\n",
        &cut[..end]
    ))
}

/// The file name without its extension: safe on every system, and with no spaces for the TeX commands.
fn file_stem(title: &str) -> String {
    let name = sanitize_name(title, "OpenNote export");
    name.split_whitespace().collect::<Vec<_>>().join("-")
}

fn unique(out_dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let mut path = out_dir.join(format!("{stem}.{extension}"));
    let mut n = 2;
    while path.exists() {
        path = out_dir.join(format!("{stem} ({n}).{extension}"));
        n += 1;
    }
    path
}

/// The library sources whose key and entry are safe to write.
fn usable(citations: &[Citation]) -> Vec<Citation> {
    let key_ok = |key: &str| {
        !key.is_empty()
            && key.len() <= 80
            && key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'_' | b'.' | b'-'))
    };
    let mut seen = HashSet::new();
    citations
        .iter()
        .filter(|c| {
            key_ok(&c.key) && !c.id.is_empty() && c.entry.trim_start().starts_with('@') && math::bib_safe(&c.entry)
        })
        .filter(|c| seen.insert(c.key.clone()))
        .cloned()
        .collect()
}

fn build(
    source: &dyn NoteSource,
    scope: Scope,
    options: &LatexOptions,
    control: &Control,
    preview: bool,
) -> Result<Built> {
    let mut plan = plan::build(source, scope, "tex")?;
    if preview {
        plan.pages.truncate(PREVIEW_PAGES);
    }
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    let library = Library::new(usable(&options.citations));
    let mut writer = Writer::new(options.engine, &library, plan.pages.len());
    let mut resolver = TexResolver::new(source, &plan, !preview);
    let mut report = Report::new(ReportKind::Export, format!("{} as LaTeX", plan.title));
    let mut body: Vec<String> = Vec::new();
    let mut section: Option<Vec<String>> = None;
    let mut edited: Option<i64> = None;
    let depth = match scope {
        Scope::Page(_) => 0,
        Scope::Section(_) => 1,
        Scope::Notebook => 2,
    };
    for (index, planned) in plan.pages.iter().enumerate() {
        control.checkpoint()?;
        control.step(Phase::Writing, 1, &planned.title);
        let number = index + 1;
        let page = match source.page(planned.id) {
            Ok(page) => page,
            Err(error) => {
                report
                    .general
                    .skipped(format!("page {:?}", planned.title), error.to_string());
                continue;
            }
        };
        let mut page_report = PageReport {
            title: page.title.clone(),
            ..PageReport::default()
        };
        let converted = convert_page(&page, &mut resolver, &mut page_report, Some(&format!("p{number}")));
        if scope == Scope::Notebook && section.as_ref() != Some(&planned.dir) {
            writer.base = 0;
            body.push(writer.heading(1, &[Inline::text(planned.section.clone())]));
            section = Some(planned.dir.clone());
        }
        writer.base = if matches!(scope, Scope::Page(_)) {
            0
        } else {
            depth + usize::from(planned.level)
        };
        body.push(page_heading(&mut writer, scope, options, &page, number));
        body.push(writer.page_body(&page, &converted));
        writer.stats.describe(&writer.missing, &mut page_report);
        writer.stats = Stats::default();
        writer.missing = escape::Missing::default();
        report.add_page(page_report);
        edited = edited.max(Some(page.modified.unix_ms()));
    }
    resolver.describe(&mut report);
    let mut text = body
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if !writer.bibliography && !(writer.cited.is_empty() && writer.listed.is_empty()) {
        text.push_str("\n\n");
        text.push_str(&page::bibliography_commands(&[]));
    }
    let bib = bib_file(&library, &writer);
    if let Some(too_big) = resolver.too_big {
        return Err(InteropError::TooBig(too_big));
    }
    let top = preamble::top(
        &preamble::Top {
            options,
            title: &plan.title,
            stem: &file_stem(&plan.title),
            edited,
            with_bibliography: bib.is_some(),
        },
        &mut writer.missing,
    );
    let tex = format!("{top}{text}{}", preamble::bottom());
    if tex.len() > MAX_TEX_BYTES {
        return Err(InteropError::TooBig("the LaTeX file".to_owned()));
    }
    Ok(Built {
        title: plan.title,
        tex,
        files: resolver.files,
        bib,
        report,
    })
}

/// The heading of a page, its label, and the reset of the equation count, which each page numbers from 1.
fn page_heading(writer: &mut Writer<'_>, scope: Scope, options: &LatexOptions, page: &Page, number: usize) -> String {
    let reset = "\\setcounter{equation}{0}";
    if matches!(scope, Scope::Page(_)) {
        if options.title_block {
            return format!("\\label{{page:{number}}}\n{reset}");
        }
        let title = writer.esc(&page.title);
        return format!("\\section*{{{title}}}\\label{{page:{number}}}\n{reset}");
    }
    let heading = writer.heading(writer.base, &[Inline::text(page.title.clone())]);
    format!("{heading}\\label{{page:{number}}}\n{reset}")
}

/// `references.bib`: the entries that were cited or listed, in the order of the library.
fn bib_file(library: &Library, writer: &Writer<'_>) -> Option<String> {
    let used: HashSet<&String> = writer.cited.iter().chain(&writer.listed).collect();
    let entries: Vec<&str> = library
        .entries
        .iter()
        .filter(|c| used.contains(&c.key))
        .map(|c| c.entry.trim())
        .collect();
    if entries.is_empty() {
        return None;
    }
    Some(format!(
        "% Made by OpenNote from the citation library.\n\n{}\n",
        entries.join("\n\n")
    ))
}

/// Collects the pictures of the document and points links at the pages.
struct TexResolver<'a> {
    source: &'a dyn NoteSource,
    pages: HashMap<PageId, usize>,
    used: HashSet<String>,
    asset_names: HashMap<AssetId, String>,
    files: Vec<(String, Vec<u8>)>,
    bytes: usize,
    too_big: Option<String>,
    /// Pictures that cannot be written, with the reason.
    skipped: Vec<(String, String)>,
    attachments: usize,
    handwriting: usize,
    /// Whether to read the picture files, which a preview does not.
    read: bool,
}

impl<'a> TexResolver<'a> {
    fn new(source: &'a dyn NoteSource, plan: &plan::Plan, read: bool) -> TexResolver<'a> {
        TexResolver {
            source,
            pages: plan.pages.iter().enumerate().map(|(i, p)| (p.id, i + 1)).collect(),
            used: HashSet::new(),
            asset_names: HashMap::new(),
            files: Vec::new(),
            bytes: 0,
            too_big: None,
            skipped: Vec::new(),
            attachments: 0,
            handwriting: 0,
            read,
        }
    }

    fn describe(&self, report: &mut Report) {
        for (name, why) in &self.skipped {
            report.general.skipped(format!("the image {name}"), why.clone());
        }
        if self.attachments > 0 {
            let what = crate::report::counted(self.attachments, "attachment", "attachments");
            report
                .general
                .simplified(what, "A LaTeX file holds the names of attachments, not the files.");
        }
    }

    /// A name made of letters, digits, hyphens, and underscores, unique among the pictures.
    fn name(&mut self, original: &str, extension: &str) -> String {
        let stem = original.rsplit_once('.').map_or(original, |(stem, _)| stem);
        let mut clean: String = stem
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '-' })
            .collect();
        clean = clean
            .split('-')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        clean.truncate(40);
        let clean = if clean.is_empty() { "image".to_owned() } else { clean };
        let mut candidate = format!("{clean}.{extension}");
        let mut n = 2;
        while !self.used.insert(candidate.to_lowercase()) {
            candidate = format!("{clean}-{n}.{extension}");
            n += 1;
        }
        format!("images/{candidate}")
    }

    fn add(&mut self, path: &str, bytes: Vec<u8>) {
        self.bytes += bytes.len();
        if self.bytes > MAX_PICTURE_BYTES {
            self.too_big = Some("the pictures".to_owned());
        }
        self.files.push((path.to_owned(), bytes));
    }
}

impl Resolver for TexResolver<'_> {
    fn asset(&mut self, page: &Page, asset: &Asset) -> Option<String> {
        if let Some(path) = self.asset_names.get(&asset.id) {
            return Some(path.clone());
        }
        let shown = if asset.name.is_empty() {
            &asset.file
        } else {
            &asset.name
        };
        if !asset.mime.starts_with("image/") {
            self.attachments += 1;
            return Some(format!("attachment:{shown}"));
        }
        let (extension, signature): (&str, &[u8]) = match asset.mime.as_str() {
            "image/png" => ("png", b"\x89PNG"),
            "image/jpeg" | "image/jpg" => ("jpg", b"\xFF\xD8\xFF"),
            _ => {
                self.skipped.push((
                    shown.clone(),
                    "LaTeX shows PNG and JPEG pictures. Export to PDF to keep this one.".to_owned(),
                ));
                return None;
            }
        };
        let bytes = if self.read {
            match self.source.asset_bytes(page, asset) {
                Ok(bytes) if bytes.starts_with(signature) => bytes,
                Ok(_) => {
                    self.skipped.push((
                        shown.clone(),
                        format!("It is not a whole {} file.", extension.to_uppercase()),
                    ));
                    return None;
                }
                Err(error) => {
                    self.skipped.push((shown.clone(), error.to_string()));
                    return None;
                }
            }
        } else {
            Vec::new()
        };
        let path = self.name(shown, extension);
        if self.read {
            self.add(&path, bytes);
        }
        self.asset_names.insert(asset.id, path.clone());
        Some(path)
    }

    fn page(&mut self, _from: PageId, to: PageId) -> Option<String> {
        self.pages.get(&to).map(|number| format!("#page-{number}"))
    }

    fn ink(&mut self, page: &Page, _svg: Vec<u8>) -> Option<String> {
        self.handwriting += 1;
        let path = self.name(&format!("handwriting-{}", self.handwriting), "pdf");
        if self.read {
            let pdf = inkpdf::ink_pdf(&ink_lines(page))?;
            self.add(&path, pdf);
        }
        Some(path)
    }
}
