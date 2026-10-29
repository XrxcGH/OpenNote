// checks-disable-file modifiability, length: OOXML part templates, one element to a line as the spec writes them
//! Exporting to a PowerPoint file: slides cut from pages the way "Present as slides" cuts them.
//!
//! A heading of level 1 or 2 starts a slide and is its title, and a divider line ends one. A page with no
//! headings is one slide titled with the page. A notebook or section also gets a title slide for each section. A
//! slide that would hold more than about a screen of text, or a table together with pictures, continues on another
//! slide with the same title. Text, lists, tables, and pictures are written. Ink, speaker notes, and the page's
//! look are not.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use opennote_core::model::{Asset, Page};
use opennote_core::PageId;

use super::convert::{page_to_blocks, Resolver};
use super::files::Exported;
use super::names::sanitize_name;
use super::plan::{self, Scope};
use super::pptx_parts::{self as parts, HEADER, NS_A, NS_P, NS_R};
use crate::assets::image_size;
use crate::doc::{plain_text, Block, Inline, Item, Script};
use crate::docx::zip::ZipWriter;
use crate::docx::Media;
use crate::error::{InteropError, Result};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;

const EMU: f64 = 914_400.0;
/// The slide: 13.333 by 7.5 inches.
const SLIDE_W: f64 = 13.333;
const MARGIN: f64 = 0.6;
const TOP: f64 = 1.5;
const BOTTOM: f64 = 7.1;
/// How many lines of 20-point text fit under the title.
const MAX_LINES: usize = 13;
/// How many characters a line holds across the whole slide, and across the text column beside pictures.
const WIDE_CHARS: usize = 100;
const NARROW_CHARS: usize = 52;

/// Exports to `out_dir/<title>.pptx`, or `out_dir/<title> (2).pptx` and so on, so nothing is overwritten.
pub fn export_pptx(source: &dyn NoteSource, scope: Scope, out_dir: &Path, control: &Control) -> Result<Exported> {
    let plan = plan::build(source, scope, "pptx")?;
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    let mut resolver = Pictures {
        source,
        pages: plan.pages.iter().map(|p| p.id).collect(),
        media: HashMap::new(),
        unsupported: Vec::new(),
    };
    let mut report = Report::new(ReportKind::Export, format!("{} as PowerPoint", plan.title));
    let mut slides: Vec<Slide> = Vec::new();
    let mut last_section: Option<String> = None;
    for planned in &plan.pages {
        control.checkpoint()?;
        control.step(Phase::Writing, 1, &planned.title);
        let page = match source.page(planned.id) {
            Ok(page) => page,
            Err(error) => {
                report
                    .general
                    .skipped(format!("page {:?}", planned.title), error.to_string());
                continue;
            }
        };
        if scope != Scope::Page(planned.id) && last_section.as_deref() != Some(planned.section.as_str()) {
            slides.push(Slide::title_only(&planned.section));
            last_section = Some(planned.section.clone());
        }
        let mut page_report = PageReport {
            title: page.title.clone(),
            ..PageReport::default()
        };
        let blocks = page_to_blocks(&page, &mut resolver, &mut page_report);
        let cut = split_page(&page.title, blocks);
        page_report.came_over_count(cut.len(), "slide", "slides");
        slides.extend(cut);
        report.add_page(page_report);
    }
    for name in &resolver.unsupported {
        report
            .general
            .skipped(format!("the image {name}"), "PowerPoint cannot show this image type.");
    }
    let slides: Vec<Slide> = slides.into_iter().flat_map(fit).collect();
    if slides.is_empty() {
        return Err(InteropError::Missing(format!("page to export in {}", plan.title)));
    }
    let bytes = build(&plan.title, &slides, &resolver.media)?;
    fs::create_dir_all(out_dir).map_err(|e| InteropError::io(out_dir, e))?;
    let name = sanitize_name(&plan.title, "OpenNote export");
    let mut path = out_dir.join(format!("{name}.pptx"));
    let mut n = 2;
    while path.exists() {
        path = out_dir.join(format!("{name} ({n}).pptx"));
        n += 1;
    }
    fs::write(&path, bytes).map_err(|e| InteropError::io(&path, e))?;
    Ok(Exported {
        root: out_dir.to_path_buf(),
        files: vec![path],
        report,
    })
}

// Cutting pages into slides.

/// A slide's content before layout.
#[derive(Clone, Debug)]
struct Slide {
    title: String,
    /// True for a slide that only names a section.
    divider: bool,
    items: Vec<Piece>,
}

impl Slide {
    fn title_only(title: &str) -> Slide {
        Slide {
            title: title.to_owned(),
            divider: true,
            items: Vec::new(),
        }
    }
}

/// One piece of a slide's body.
#[derive(Clone, Debug)]
enum Piece {
    Para(Para),
    Picture { dest: String, alt: String },
    Table { header: bool, rows: Vec<Vec<Vec<Inline>>> },
}

#[derive(Clone, Debug)]
struct Para {
    level: usize,
    bullet: Option<bool>,
    inlines: Vec<Inline>,
    bold: bool,
    italic: bool,
    mono: bool,
}

fn split_page(page_title: &str, blocks: Vec<Block>) -> Vec<Slide> {
    let mut slides: Vec<Slide> = Vec::new();
    let mut current = Slide {
        title: page_title.to_owned(),
        divider: false,
        items: Vec::new(),
    };
    let mut titled = false;
    for block in blocks {
        match block {
            Block::Heading { level, content } if level <= 2 => {
                if !current.items.is_empty() || titled {
                    slides.push(current);
                }
                current = Slide {
                    title: plain_text(&content),
                    divider: false,
                    items: Vec::new(),
                };
                titled = true;
            }
            Block::Break => {
                if !current.items.is_empty() {
                    let title = current.title.clone();
                    slides.push(current);
                    current = Slide {
                        title,
                        divider: false,
                        items: Vec::new(),
                    };
                }
            }
            other => flatten(&other, 0, &mut current.items),
        }
    }
    if !current.items.is_empty() || slides.is_empty() {
        slides.push(current);
    }
    slides
}

/// Turns a block into pieces: paragraphs for text, lists, quotes, code, and callouts.
fn flatten(block: &Block, level: usize, out: &mut Vec<Piece>) {
    let para = |inlines: Vec<Inline>| Para {
        level,
        bullet: None,
        inlines,
        bold: false,
        italic: false,
        mono: false,
    };
    match block {
        Block::Paragraph(inlines) => paragraph(inlines, para(Vec::new()), out),
        Block::Heading { content, .. } => {
            let mut p = para(content.clone());
            p.bold = true;
            paragraph(content, p, out);
        }
        Block::List { ordered, items, .. } => {
            for Item { task, blocks } in items {
                let mut first = true;
                for inner in blocks {
                    if let Block::List { .. } = inner {
                        flatten(inner, level + 1, out);
                        continue;
                    }
                    let mut pieces = Vec::new();
                    flatten(inner, level, &mut pieces);
                    for piece in &mut pieces {
                        if let Piece::Para(p) = piece {
                            if first {
                                p.bullet = Some(*ordered);
                                if let Some(done) = task {
                                    let mark = if *done { "\u{2611} " } else { "\u{2610} " };
                                    p.inlines.insert(0, Inline::text(mark));
                                }
                                first = false;
                            } else {
                                p.level = level;
                            }
                        }
                    }
                    out.extend(pieces);
                }
            }
        }
        Block::Quote(blocks) => {
            for inner in blocks {
                let mut pieces = Vec::new();
                flatten(inner, level, &mut pieces);
                for piece in &mut pieces {
                    if let Piece::Para(p) = piece {
                        p.italic = true;
                    }
                }
                out.extend(pieces);
            }
        }
        Block::Callout {
            title, blocks, kind, ..
        } => {
            let label = if title.is_empty() {
                vec![Inline::text(kind.clone())]
            } else {
                title.clone()
            };
            let mut head = para(label.clone());
            head.bold = true;
            paragraph(&label, head, out);
            for inner in blocks {
                flatten(inner, level, out);
            }
        }
        Block::Code { text, .. } => {
            for line in text.lines() {
                let mut p = para(vec![Inline::text(line)]);
                p.mono = true;
                out.push(Piece::Para(p));
            }
        }
        Block::Table { header, rows } => out.push(Piece::Table {
            header: *header,
            rows: rows.clone(),
        }),
        Block::Break => {}
    }
}

/// A paragraph, with its pictures taken out as pieces of their own after the text.
fn paragraph(inlines: &[Inline], mut para: Para, out: &mut Vec<Piece>) {
    let mut pictures = Vec::new();
    para.inlines = inlines
        .iter()
        .filter(|i| {
            if let Inline::Image { dest, alt } = i {
                pictures.push(Piece::Picture {
                    dest: dest.clone(),
                    alt: alt.clone(),
                });
                false
            } else {
                true
            }
        })
        .cloned()
        .collect();
    if !plain_text(&para.inlines).trim().is_empty() {
        out.push(Piece::Para(para));
    }
    out.extend(pictures);
}

/// Cuts a slide that holds too much into slides that each fit.
fn fit(slide: Slide) -> Vec<Slide> {
    if slide.divider {
        return vec![slide];
    }
    let mut out: Vec<Slide> = Vec::new();
    let blank = Slide {
        items: Vec::new(),
        ..slide.clone()
    };
    let mut current = blank.clone();
    let (mut lines, mut pictures, mut tables) = (0usize, 0usize, 0usize);
    for piece in slide.items {
        let (more_lines, more_pictures, more_tables) = match &piece {
            Piece::Para(p) => (
                para_lines(p, if pictures > 0 { NARROW_CHARS } else { WIDE_CHARS }),
                0,
                0,
            ),
            Piece::Picture { .. } => (0, 1, 0),
            Piece::Table { rows, .. } => (rows.len().min(8) * 2, 0, 1),
        };
        let too_many_lines = lines + more_lines > MAX_LINES;
        let mixes = (tables + more_tables > 0 && pictures + more_pictures > 0)
            || tables + more_tables > 1
            || pictures + more_pictures > 2;
        if !current.items.is_empty() && (too_many_lines || mixes) {
            out.push(std::mem::replace(&mut current, blank.clone()));
            (lines, pictures, tables) = (0, 0, 0);
        }
        lines += more_lines;
        pictures += more_pictures;
        tables += more_tables;
        current.items.push(piece);
    }
    out.push(current);
    out
}

fn para_lines(p: &Para, width: usize) -> usize {
    plain_text(&p.inlines)
        .split('\n')
        .map(|line| line.chars().count().div_ceil(width).max(1))
        .sum()
}

// Pictures.

struct Pictures<'a> {
    source: &'a dyn NoteSource,
    pages: HashSet<PageId>,
    media: HashMap<String, Media>,
    unsupported: Vec<String>,
}

impl Resolver for Pictures<'_> {
    fn asset(&mut self, page: &Page, asset: &Asset) -> Option<String> {
        let dest = format!("media:{}", asset.id);
        if self.media.contains_key(&dest) {
            return Some(dest);
        }
        let ext = match asset.mime.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpeg",
            "image/gif" => "gif",
            "image/bmp" => "bmp",
            _ => {
                if asset.mime.starts_with("image/") && !self.unsupported.contains(&asset.name) {
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

    fn page(&mut self, _from: PageId, _to: PageId) -> Option<String> {
        // Links between slides would need slide numbers; the link text stays.
        let _ = &self.pages;
        None
    }
}

// Writing the file.

fn build(title: &str, slides: &[Slide], media: &HashMap<String, Media>) -> Result<Vec<u8>> {
    let mut zip = ZipWriter::new();
    let mut extensions: Vec<&str> = media.values().map(|m| m.ext.as_str()).collect();
    extensions.sort_unstable();
    extensions.dedup();
    let defaults: String = extensions
        .iter()
        .map(|e| format!("<Default Extension=\"{e}\" ContentType=\"image/{e}\"/>"))
        .collect();
    let overrides: String = (1..=slides.len())
        .map(|n| format!("<Override PartName=\"/ppt/slides/slide{n}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"))
        .collect();
    zip.add(
        "[Content_Types].xml",
        format!("{HEADER}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
            <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
            <Default Extension=\"xml\" ContentType=\"application/xml\"/>{defaults}\
            <Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>\
            <Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>\
            <Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>\
            <Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>\
            <Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\
            {overrides}</Types>").as_bytes(),
    )?;
    zip.add(
        "_rels/.rels",
        format!("{HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
            <Relationship Id=\"rId1\" Type=\"{NS_R}/officeDocument\" Target=\"ppt/presentation.xml\"/>\
            <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
            </Relationships>").as_bytes(),
    )?;
    zip.add(
        "docProps/core.xml",
        format!("{HEADER}<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" \
            xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>{}</dc:title><dc:creator>OpenNote</dc:creator></cp:coreProperties>",
            escape(title)).as_bytes(),
    )?;
    let ids: String = (0..slides.len())
        .map(|n| format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 256 + n, n + 3))
        .collect();
    zip.add(
        "ppt/presentation.xml",
        format!("{HEADER}<p:presentation xmlns:a=\"{NS_A}\" xmlns:r=\"{NS_R}\" xmlns:p=\"{NS_P}\">\
            <p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>\
            <p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx=\"12192000\" cy=\"6858000\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/>\
            </p:presentation>").as_bytes(),
    )?;
    let mut rels = format!(
        "<Relationship Id=\"rId1\" Type=\"{NS_R}/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>\
         <Relationship Id=\"rId2\" Type=\"{NS_R}/theme\" Target=\"theme/theme1.xml\"/>"
    );
    for n in 1..=slides.len() {
        rels.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"{NS_R}/slide\" Target=\"slides/slide{n}.xml\"/>",
            n + 2
        ));
    }
    zip.add(
        "ppt/_rels/presentation.xml.rels",
        format!("{HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{rels}</Relationships>").as_bytes(),
    )?;
    zip.add("ppt/theme/theme1.xml", parts::theme().as_bytes())?;
    zip.add("ppt/slideMasters/slideMaster1.xml", parts::master().as_bytes())?;
    zip.add(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        format!(
            "{HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
            <Relationship Id=\"rId1\" Type=\"{NS_R}/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>\
            <Relationship Id=\"rId2\" Type=\"{NS_R}/theme\" Target=\"../theme/theme1.xml\"/></Relationships>"
        )
        .as_bytes(),
    )?;
    zip.add("ppt/slideLayouts/slideLayout1.xml", parts::layout().as_bytes())?;
    zip.add(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        format!("{HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
            <Relationship Id=\"rId1\" Type=\"{NS_R}/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/></Relationships>").as_bytes(),
    )?;
    let mut written: HashMap<String, String> = HashMap::new();
    for (n, slide) in slides.iter().enumerate() {
        let mut writer = SlideWriter {
            media,
            rels: String::new(),
            next_rel: 2,
            next_id: 3,
            used: Vec::new(),
        };
        let xml = writer.slide(slide);
        for (name, bytes) in std::mem::take(&mut writer.used) {
            if written.insert(name.clone(), String::new()).is_none() {
                zip.add(&format!("ppt/media/{name}"), &bytes)?;
            }
        }
        zip.add(&format!("ppt/slides/slide{}.xml", n + 1), xml.as_bytes())?;
        zip.add(
            &format!("ppt/slides/_rels/slide{}.xml.rels", n + 1),
            format!("{HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
                <Relationship Id=\"rId1\" Type=\"{NS_R}/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>{}</Relationships>",
                writer.rels).as_bytes(),
        )?;
    }
    zip.finish()
}

struct SlideWriter<'a> {
    media: &'a HashMap<String, Media>,
    rels: String,
    next_rel: usize,
    next_id: usize,
    /// Media files this slide uses: file name and bytes.
    used: Vec<(String, Vec<u8>)>,
}

fn emu(inches: f64) -> i64 {
    (inches * EMU).round() as i64
}

impl SlideWriter<'_> {
    fn slide(&mut self, slide: &Slide) -> String {
        let mut shapes = String::new();
        if slide.divider {
            shapes.push_str(&self.title(&slide.title, 2.6, 2.3, 44));
        } else {
            shapes.push_str(&self.title(&slide.title, 0.4, 1.0, 32));
            shapes.push_str(&self.body(&slide.items));
        }
        format!(
            "{HEADER}<p:sld xmlns:a=\"{NS_A}\" xmlns:r=\"{NS_R}\" xmlns:p=\"{NS_P}\"><p:cSld><p:spTree>{}{shapes}</p:spTree></p:cSld>\
             <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>",
            parts::group()
        )
    }

    fn id(&mut self) -> usize {
        self.next_id += 1;
        self.next_id
    }

    fn title(&mut self, text: &str, top: f64, height: f64, size: u32) -> String {
        format!(
            "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title 1\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr>\
             <p:spPr><a:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm></p:spPr>\
             <p:txBody><a:bodyPr anchor=\"ctr\"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang=\"en-US\" sz=\"{}\" b=\"1\" dirty=\"0\"/><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp>",
            emu(MARGIN),
            emu(top),
            emu(SLIDE_W - 2.0 * MARGIN),
            emu(height),
            size * 100,
            escape(text)
        )
    }

    fn body(&mut self, pieces: &[Piece]) -> String {
        let paras: Vec<&Para> = pieces
            .iter()
            .filter_map(|p| if let Piece::Para(p) = p { Some(p) } else { None })
            .collect();
        let pictures: Vec<(&String, &String)> = pieces
            .iter()
            .filter_map(|p| {
                if let Piece::Picture { dest, alt } = p {
                    Some((dest, alt))
                } else {
                    None
                }
            })
            .collect();
        let tables: Vec<(&bool, &Vec<Vec<Vec<Inline>>>)> = pieces
            .iter()
            .filter_map(|p| {
                if let Piece::Table { header, rows } = p {
                    Some((header, rows))
                } else {
                    None
                }
            })
            .collect();
        let beside = !pictures.is_empty() && !paras.is_empty();
        let text_width = if beside { 6.9 } else { SLIDE_W - 2.0 * MARGIN };
        let mut out = String::new();
        let mut y = TOP;
        if !paras.is_empty() {
            let chars = if beside { NARROW_CHARS } else { WIDE_CHARS };
            let lines: usize = paras.iter().map(|p| para_lines(p, chars)).sum();
            let height = (lines as f64 * 0.37 + 0.2).min(BOTTOM - TOP);
            let id = self.id();
            let body: String = paras.iter().map(|p| self.paragraph(p)).collect();
            out.push_str(&format!(
                "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Content {id}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr>\
                 <p:spPr><a:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>\
                 <p:txBody><a:bodyPr wrap=\"square\" rtlCol=\"0\"><a:normAutofit/></a:bodyPr><a:lstStyle/>{body}</p:txBody></p:sp>",
                emu(MARGIN),
                emu(y),
                emu(text_width),
                emu(height)
            ));
            y += height + 0.2;
        }
        for (header, rows) in tables {
            out.push_str(&self.table(*header, rows, y));
            y += rows.len() as f64 * 0.4 + 0.2;
        }
        if !pictures.is_empty() {
            let (left, width) = if beside {
                (MARGIN + text_width + 0.4, SLIDE_W - 2.0 * MARGIN - text_width - 0.4)
            } else {
                (MARGIN, SLIDE_W - 2.0 * MARGIN)
            };
            let area = (BOTTOM - TOP) / pictures.len() as f64 - 0.15;
            let mut top = TOP;
            for (dest, alt) in pictures {
                if let Some(shape) = self.picture(dest, alt, left, top, width, area) {
                    out.push_str(&shape.0);
                    top += shape.1 + 0.15;
                }
            }
        }
        out
    }

    fn paragraph(&mut self, p: &Para) -> String {
        let props = match p.bullet {
            Some(ordered) => {
                let left = 342_900 * (p.level + 1);
                let bullet = if ordered {
                    "<a:buAutoNum type=\"arabicPeriod\"/>".to_owned()
                } else {
                    "<a:buFont typeface=\"Arial\"/><a:buChar char=\"&#8226;\"/>".to_owned()
                };
                format!(
                    "<a:pPr marL=\"{left}\" indent=\"-342900\" lvl=\"{}\">{bullet}</a:pPr>",
                    p.level.min(8)
                )
            }
            None => format!("<a:pPr marL=\"{}\" indent=\"0\"><a:buNone/></a:pPr>", 342_900 * p.level),
        };
        let mut runs = String::new();
        for inline in &p.inlines {
            match inline {
                Inline::Text { text, marks } => {
                    let mut attrs = String::from(" lang=\"en-US\" sz=\"2000\" dirty=\"0\"");
                    if marks.strong || p.bold {
                        attrs.push_str(" b=\"1\"");
                    }
                    if marks.emphasis || p.italic {
                        attrs.push_str(" i=\"1\"");
                    }
                    if marks.underline {
                        attrs.push_str(" u=\"sng\"");
                    }
                    if marks.strike {
                        attrs.push_str(" strike=\"sngStrike\"");
                    }
                    match marks.script {
                        Some(Script::Sup) => attrs.push_str(" baseline=\"30000\""),
                        Some(Script::Sub) => attrs.push_str(" baseline=\"-25000\""),
                        None => {}
                    }
                    let mut children = String::new();
                    if p.mono || marks.code {
                        children.push_str("<a:latin typeface=\"Consolas\"/>");
                    }
                    if let Some(link) = &marks.link {
                        if link.starts_with("http") || link.starts_with("mailto:") {
                            let id = format!("rId{}", self.next_rel);
                            self.next_rel += 1;
                            self.rels.push_str(&format!(
                                "<Relationship Id=\"{id}\" Type=\"{NS_R}/hyperlink\" Target=\"{}\" TargetMode=\"External\"/>",
                                escape(link)
                            ));
                            children.push_str(&format!("<a:hlinkClick r:id=\"{id}\"/>"));
                        }
                    }
                    runs.push_str(&format!(
                        "<a:r><a:rPr{attrs}>{children}</a:rPr><a:t>{}</a:t></a:r>",
                        escape(text)
                    ));
                }
                Inline::HardBreak | Inline::SoftBreak => {
                    runs.push_str("<a:br><a:rPr lang=\"en-US\" sz=\"2000\"/></a:br>")
                }
                Inline::Image { .. } => {}
            }
        }
        format!("<a:p>{props}{runs}<a:endParaRPr lang=\"en-US\" sz=\"2000\" dirty=\"0\"/></a:p>")
    }

    fn table(&mut self, header: bool, rows: &[Vec<Vec<Inline>>], top: f64) -> String {
        let width = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let total = SLIDE_W - 2.0 * MARGIN;
        let column = emu(total / width as f64);
        let id = self.id();
        let border = |side: &str| {
            format!("<a:{side} w=\"6350\"><a:solidFill><a:srgbClr val=\"BFBFBF\"/></a:solidFill></a:{side}>")
        };
        let borders = format!("{}{}{}{}", border("lnL"), border("lnR"), border("lnT"), border("lnB"));
        let grid: String = (0..width).map(|_| format!("<a:gridCol w=\"{column}\"/>")).collect();
        let mut body = String::new();
        for (r, row) in rows.iter().enumerate() {
            body.push_str("<a:tr h=\"365760\">");
            for c in 0..width {
                let inlines = row.get(c).cloned().unwrap_or_default();
                let mut p = Para {
                    level: 0,
                    bullet: None,
                    inlines,
                    bold: header && r == 0,
                    italic: false,
                    mono: false,
                };
                p.level = 0;
                let text = self.paragraph(&p).replace("sz=\"2000\"", "sz=\"1400\"");
                body.push_str(&format!(
                    "<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{text}</a:txBody><a:tcPr>{borders}</a:tcPr></a:tc>"
                ));
            }
            body.push_str("</a:tr>");
        }
        format!(
            "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"{id}\" name=\"Table {id}\"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp=\"1\"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>\
             <p:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\">\
             <a:tbl><a:tblPr firstRow=\"{}\"/><a:tblGrid>{grid}</a:tblGrid>{body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>",
            emu(MARGIN),
            emu(top),
            column * width as i64,
            365_760 * rows.len() as i64,
            u8::from(header)
        )
    }

    /// A picture scaled to fit the box. Returns the shape and the height it takes, in inches.
    fn picture(&mut self, dest: &str, alt: &str, left: f64, top: f64, max_w: f64, max_h: f64) -> Option<(String, f64)> {
        let media = self.media.get(dest)?;
        let (w, h) = (f64::from(media.width.max(1)), f64::from(media.height.max(1)));
        let scale = (max_w / w).min(max_h / h);
        let (width, height) = (w * scale, h * scale);
        let name = format!("image-{}.{}", dest.trim_start_matches("media:"), media.ext);
        self.used.push((name.clone(), media.bytes.clone()));
        let rel = format!("rId{}", self.next_rel);
        self.next_rel += 1;
        self.rels.push_str(&format!(
            "<Relationship Id=\"{rel}\" Type=\"{NS_R}/image\" Target=\"../media/{name}\"/>"
        ));
        let id = self.id();
        let shape = format!(
            "<p:pic><p:nvPicPr><p:cNvPr id=\"{id}\" name=\"Picture {id}\" descr=\"{}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>\
             <p:blipFill><a:blip r:embed=\"{rel}\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>\
             <p:spPr><a:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>",
            escape(alt),
            emu(left),
            emu(top),
            emu(width),
            emu(height)
        );
        Some((shape, height))
    }
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{assert_well_formed_xml, sample_notebook, unzip, TestEnv};

    #[test]
    fn pages_become_slides_with_well_formed_parts() {
        let world = TestEnv::new();
        let env = world.env();
        let sample = sample_notebook(&env);
        let dir = tempfile::tempdir().expect("a folder");
        let done = export_pptx(&sample.source, Scope::Notebook, dir.path(), &Control::none()).expect("exports");
        let bytes = fs::read(&done.files[0]).expect("reads");
        let files = unzip(&bytes);
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert!(
            names.contains(&"ppt/presentation.xml") && names.contains(&"ppt/slides/slide1.xml"),
            "{names:?}"
        );
        for (name, data) in &files {
            if name.ends_with(".xml") || name.ends_with(".rels") {
                assert_well_formed_xml(&String::from_utf8_lossy(data));
            }
        }
        let slides = names.iter().filter(|n| n.starts_with("ppt/slides/slide")).count();
        assert!(slides >= 3, "{slides} slides");
    }

    #[test]
    fn headings_and_dividers_cut_slides_and_long_text_continues() {
        let blocks = vec![
            Block::Paragraph(vec![Inline::text("Intro")]),
            Block::Heading {
                level: 2,
                content: vec![Inline::text("Part")],
            },
            Block::Paragraph(vec![Inline::text("a")]),
            Block::Break,
            Block::Paragraph(vec![Inline::text("b")]),
        ];
        let cut = split_page("Page", blocks);
        let titles: Vec<&str> = cut.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, ["Page", "Part", "Part"]);
        let long = Slide {
            title: "Long".to_owned(),
            divider: false,
            items: (0..30)
                .map(|n| {
                    Piece::Para(Para {
                        level: 0,
                        bullet: None,
                        inlines: vec![Inline::text(format!("line {n}"))],
                        bold: false,
                        italic: false,
                        mono: false,
                    })
                })
                .collect(),
        };
        assert_eq!(fit(long).len(), 3);
    }
}
