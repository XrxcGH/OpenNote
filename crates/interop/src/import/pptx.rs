//! Importing PowerPoint files (`.pptx`, `.pptm`): one page for each slide.
//!
//! A presentation is a ZIP archive of XML parts. A slide page holds the slide's title as the page title, then its
//! text, bulleted and numbered lists, tables, and pictures in the order the slide lists them. Speaker notes follow
//! under a "Speaker notes" heading. Above all of that, a picture of the slide, drawn from its XML by
//! [`super::slide_draw`], sits locked at the top of the page so handwriting can go on it. The report lists what the
//! picture leaves out.

use std::collections::HashMap;
use std::io::{Read, Seek};
use std::path::Path;

use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use super::pictures;
use super::slide_draw::{self, SlideDrawer, PICTURE_WIDTH};
use super::xmltree::Element;
use super::zipxml::{dir_of, first_text, read_rels, rels_name, resolve, ElementExt, Parts};
use crate::dates::parse_date;
use crate::dest::{self, ImportLink};
use crate::doc::{push_text, Block, Inline, Item, Marks, Script};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};
use opennote_core::Timestamp;

/// Imports a PowerPoint file, or a folder of them, into a new notebook. Each file becomes a section.
pub fn import_pptx(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_files(path, &SlideConverter, env, sink)
}

struct SlideConverter;

impl FileConverter for SlideConverter {
    fn label(&self) -> &'static str {
        "PowerPoint presentations"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["pptx", "pptm"]
    }

    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
        let mut parts = Parts::open(path)?;
        let stem = path
            .file_stem()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        convert_parts(&mut parts, &stem, env)
    }
}

/// What the slides held that the page cannot.
#[derive(Default)]
struct Stats {
    shapes: usize,
    charts: usize,
}

type Rels = HashMap<String, (String, bool)>;

fn convert_parts<R: Read + Seek>(parts: &mut Parts<R>, name: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let presentation = parts.xml("ppt/presentation.xml")?.ok_or_else(|| {
        InteropError::format(
            name,
            "it is not a PowerPoint file: the file has no ppt/presentation.xml",
        )
    })?;
    let rels = parts
        .xml("ppt/_rels/presentation.xml.rels")?
        .map(|r| read_rels(&r))
        .unwrap_or_default();
    let (created, modified) = deck_dates(parts, env)?;

    let slide_parts: Vec<String> = presentation
        .first("p:sldidlst")
        .map(|list| {
            list.elements("p:sldid")
                .filter_map(|s| rels.get(s.attr("r:id")?))
                .map(|(target, _)| resolve("ppt", target))
                .collect()
        })
        .unwrap_or_default();
    if slide_parts.is_empty() {
        return Err(InteropError::format(name, "the presentation has no slides"));
    }
    let mut converted = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    let mut general = PageReport::default();
    let mut drawer = SlideDrawer::new(&presentation);
    for (n, part) in slide_parts.iter().enumerate() {
        env.control.checkpoint()?;
        let slide = match parts.xml(part) {
            Ok(Some(slide)) => slide,
            Ok(None) => {
                general.skipped(format!("slide {}", n + 1), "Its part is missing from the file.");
                continue;
            }
            Err(InteropError::TooBig(what)) => {
                general.skipped(format!("slide {}", n + 1), format!("It is too large to read ({what})."));
                continue;
            }
            Err(error) => return Err(error),
        };
        let sheet = SlideRef {
            n,
            part,
            name,
            created,
            modified,
        };
        converted
            .pages
            .push(slide_page(parts, &mut drawer, env, &sheet, &slide)?);
    }
    general.simplified(
        "text on slide pictures",
        "Text is drawn with the slide's fonts when this computer has them, so a line may wrap a little differently than in PowerPoint.",
    );
    converted.general = general.entries;
    Ok(converted)
}

/// Which slide a page is made from, and the dates every page of the deck gets.
struct SlideRef<'a> {
    n: usize,
    part: &'a str,
    name: &'a str,
    created: Timestamp,
    modified: Timestamp,
}

/// The deck's creation and modification dates, or now for a deck that holds none.
fn deck_dates<R: Read + Seek>(parts: &mut Parts<R>, env: &ImportEnv<'_>) -> Result<(Timestamp, Timestamp)> {
    let (created, modified) = match parts.xml("docProps/core.xml")? {
        Some(core) => (
            first_text(&core, "dcterms:created").and_then(|d| parse_date(&d)),
            first_text(&core, "dcterms:modified").and_then(|d| parse_date(&d)),
        ),
        None => (None, None),
    };
    let created = created.unwrap_or_else(|| env.clock.now());
    Ok((created, modified.unwrap_or(created).max(created)))
}

/// One slide as a page: its picture, its text, its notes, and what came over.
fn slide_page<R: Read + Seek>(
    parts: &mut Parts<R>,
    drawer: &mut SlideDrawer,
    env: &ImportEnv<'_>,
    sheet: &SlideRef<'_>,
    slide: &Element,
) -> Result<ConvertedPage> {
    let SlideRef {
        n,
        part,
        name,
        created,
        modified,
    } = *sheet;
    let slide_rels = parts.xml(&rels_name(part))?.map(|r| read_rels(&r)).unwrap_or_default();
    let dir = dir_of(part).to_owned();
    let mut stats = Stats::default();
    let (title, mut blocks) = read_slide(slide, &slide_rels, &dir, &mut stats);
    let drawn = drawer.draw(parts, slide, &slide_rels, &dir);
    let notes = notes_blocks(parts, &slide_rels, &dir)?;
    let has_notes = !notes.is_empty();
    if has_notes {
        blocks.push(Block::Heading {
            level: 2,
            content: vec![Inline::text("Speaker notes")],
        });
        blocks.extend(notes);
    }
    let title = title.unwrap_or_else(|| format!("Slide {}", n + 1));
    let mut report = PageReport {
        title: title.clone(),
        source: name.to_owned(),
        entries: Vec::new(),
    };
    let mut builder = PageBuilder::new(env, &title, created, modified);
    let picture = builder.add_asset(
        &format!("slide-{}.svg", n + 1),
        Some("image/svg+xml"),
        drawn.svg.into_bytes(),
    );
    builder.push_locked_image(
        picture,
        format!("Slide {}: {title}", n + 1),
        PICTURE_WIDTH,
        drawn.height,
    );
    let (placed, lost) = pictures::place(&mut blocks, &mut builder, "pptx:", &mut |path| parts.bytes(path));
    let tables = blocks.iter().filter(|b| matches!(b, Block::Table { .. })).count();
    builder.push_blocks(blocks);
    report.came_over("slide text");
    report.came_over_count(tables, "table", "tables");
    report.came_over_count(placed, "picture", "pictures");
    if has_notes {
        report.came_over("speaker notes");
    }
    report.skipped_count(
        lost,
        ("picture that could not be read", "pictures that could not be read"),
        "Its data is missing, damaged, past the size limit, or in a format that screens cannot show, such as EMF.",
    );
    slide_draw::report(drawn.missed, 1, &mut report);
    Ok(ConvertedPage {
        section: None,
        page: builder.finish()?,
        report,
    })
}

/// The blocks of the speaker notes, or none.
fn notes_blocks<R: Read + Seek>(parts: &mut Parts<R>, slide_rels: &Rels, dir: &str) -> Result<Vec<Block>> {
    let Some(target) = slide_rels
        .values()
        .find(|(t, _)| t.contains("notesSlide"))
        .map(|(t, _)| t.clone())
    else {
        return Ok(Vec::new());
    };
    let part = resolve(dir, &target);
    let Some(notes) = parts.xml(&part)? else {
        return Ok(Vec::new());
    };
    let rels = Rels::new();
    let mut paragraphs = Vec::new();
    let mut tree = Vec::new();
    if let Some(shapes) = notes.first("p:csld").and_then(|c| c.first("p:sptree")) {
        collect(shapes, &mut tree);
    }
    for shape in tree {
        if shape.name != "p:sp" {
            continue;
        }
        let kind = placeholder(shape);
        if kind.as_deref() == Some("body") {
            if let Some(text) = shape.first("p:txbody") {
                paragraphs.extend(paragraphs_of(text, false, &rels, ""));
            }
        }
    }
    Ok(blocks_from(paragraphs))
}

/// The slide's title and the blocks of the rest, in the order the slide lists them.
fn read_slide(slide: &Element, rels: &Rels, dir: &str, stats: &mut Stats) -> (Option<String>, Vec<Block>) {
    let mut shapes = Vec::new();
    if let Some(tree) = slide.first("p:csld").and_then(|c| c.first("p:sptree")) {
        collect(tree, &mut shapes);
    }
    let mut title = None;
    let mut blocks = Vec::new();
    for shape in shapes {
        match shape.name.as_str() {
            "p:sp" => {
                let kind = placeholder(shape);
                let Some(text) = shape.first("p:txbody") else {
                    stats.shapes += 1;
                    continue;
                };
                match kind.as_deref() {
                    Some("title" | "ctrtitle") => {
                        let line: Vec<String> = paragraphs_of(text, false, rels, dir)
                            .iter()
                            .map(|p| crate::doc::plain_text(&p.inlines))
                            .filter(|t| !t.trim().is_empty())
                            .collect();
                        if title.is_none() && !line.is_empty() {
                            title = Some(line.join(" "));
                        }
                    }
                    Some("dt" | "ftr" | "sldnum" | "hdr") => {}
                    other => {
                        let bulleted = matches!(other, Some("body" | "obj"));
                        let paragraphs = paragraphs_of(text, bulleted, rels, dir);
                        if paragraphs.is_empty() {
                            stats.shapes += 1;
                        }
                        blocks.extend(blocks_from(paragraphs));
                    }
                }
            }
            "p:pic" => {
                let embed = shape
                    .first("p:blipfill")
                    .and_then(|f| f.first("a:blip"))
                    .and_then(|b| b.attr("r:embed"));
                let alt = shape
                    .first("p:nvpicpr")
                    .and_then(|n| n.first("p:cnvpr"))
                    .and_then(|c| c.attr("descr"))
                    .unwrap_or("")
                    .to_owned();
                match embed.and_then(|id| rels.get(id)) {
                    Some((target, false)) => blocks.push(Block::Paragraph(vec![Inline::Image {
                        dest: format!("pptx:{}", resolve(dir, target)),
                        alt,
                    }])),
                    _ => stats.shapes += 1,
                }
            }
            "p:graphicframe" => {
                if let Some(table) = shape
                    .first("a:graphic")
                    .and_then(|g| g.first("a:graphicdata"))
                    .and_then(|d| d.first("a:tbl"))
                {
                    blocks.push(table_block(table, rels, dir));
                } else {
                    stats.charts += 1;
                }
            }
            "p:cxnsp" => {}
            _ => stats.shapes += 1,
        }
    }
    (title, blocks)
}

/// The shapes of a shape tree, with the shapes inside groups taken out in order.
fn collect<'a>(tree: &'a Element, out: &mut Vec<&'a Element>) {
    for child in tree.kids() {
        match child.name.as_str() {
            "p:grpsp" => collect(child, out),
            "p:sp" | "p:pic" | "p:graphicframe" | "p:cxnsp" => out.push(child),
            _ => {}
        }
    }
}

/// The placeholder type of a shape, in lowercase, or `Some("body")` for a placeholder with no type.
fn placeholder(shape: &Element) -> Option<String> {
    let ph = shape.first("p:nvsppr")?.first("p:nvpr")?.first("p:ph")?;
    Some(ph.attr("type").map_or_else(|| "body".to_owned(), str::to_lowercase))
}

/// A paragraph of a shape.
struct Para {
    level: usize,
    bullet: Option<bool>,
    inlines: Vec<Inline>,
}

fn paragraphs_of(text_body: &Element, bulleted: bool, rels: &Rels, dir: &str) -> Vec<Para> {
    let _ = dir;
    let mut out = Vec::new();
    for p in text_body.elements("a:p") {
        let props = p.first("a:ppr");
        let level = props
            .and_then(|p| p.attr("lvl"))
            .and_then(|l| l.parse::<usize>().ok())
            .unwrap_or(0)
            .min(8);
        let bullet = match props {
            Some(pr) if pr.first("a:bunone").is_some() => None,
            Some(pr) if pr.first("a:buautonum").is_some() => Some(true),
            Some(pr) if pr.first("a:buchar").is_some() => Some(false),
            _ => bulleted.then_some(false),
        };
        let mut inlines = Vec::new();
        for run in p.kids() {
            match run.name.as_str() {
                "a:r" | "a:fld" => {
                    if run
                        .attr("type")
                        .is_some_and(|t| t.starts_with("slidenum") || t.starts_with("datetime"))
                    {
                        continue;
                    }
                    let Some(t) = run.first("a:t") else { continue };
                    push_text(&mut inlines, &t.all_text(), &marks_of(run.first("a:rpr"), rels));
                }
                "a:br" => inlines.push(Inline::HardBreak),
                _ => {}
            }
        }
        while matches!(inlines.last(), Some(Inline::HardBreak)) {
            inlines.pop();
        }
        if inlines.is_empty() || crate::doc::plain_text(&inlines).trim().is_empty() {
            continue;
        }
        out.push(Para { level, bullet, inlines });
    }
    out
}

fn marks_of(props: Option<&Element>, rels: &Rels) -> Marks {
    let mut marks = Marks::none();
    let Some(props) = props else { return marks };
    marks.strong = props.attr("b").is_some_and(|v| v == "1" || v == "true");
    marks.emphasis = props.attr("i").is_some_and(|v| v == "1" || v == "true");
    marks.underline = props.attr("u").is_some_and(|v| v != "none");
    marks.strike = props.attr("strike").is_some_and(|v| v != "noStrike");
    if let Some(baseline) = props.attr("baseline").and_then(|b| b.parse::<i32>().ok()) {
        marks.script = match baseline {
            1.. => Some(Script::Sup),
            ..=-1 => Some(Script::Sub),
            0 => None,
        };
    }
    if let Some((target, true)) = props
        .first("a:hlinkclick")
        .and_then(|h| h.attr("r:id"))
        .and_then(|id| rels.get(id))
    {
        if let ImportLink::Keep(link) = dest::for_import(target) {
            marks.link = Some(link);
        }
    }
    marks
}

/// Paragraphs as blocks: lines of text, and lists for runs of bulleted paragraphs.
fn blocks_from(paragraphs: Vec<Para>) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut at = 0;
    while at < paragraphs.len() {
        if paragraphs[at].bullet.is_none() {
            blocks.push(Block::Paragraph(paragraphs[at].inlines.clone()));
            at += 1;
            continue;
        }
        let end = paragraphs[at..]
            .iter()
            .position(|p| p.bullet.is_none())
            .map_or(paragraphs.len(), |n| at + n);
        let mut index = 0;
        let run = &paragraphs[at..end];
        blocks.push(list_from(run, &mut index, run[0].level));
        at = end;
    }
    blocks
}

fn list_from(paragraphs: &[Para], index: &mut usize, level: usize) -> Block {
    let ordered = paragraphs[*index].bullet == Some(true);
    let mut items: Vec<Item> = Vec::new();
    while *index < paragraphs.len() {
        let p = &paragraphs[*index];
        if p.level < level {
            break;
        }
        if p.level > level && !items.is_empty() {
            let nested = list_from(paragraphs, index, p.level);
            if let Some(last) = items.last_mut() {
                last.blocks.push(nested);
            }
            continue;
        }
        items.push(Item {
            task: None,
            blocks: vec![Block::Paragraph(p.inlines.clone())],
        });
        *index += 1;
    }
    Block::List {
        ordered,
        start: 1,
        items,
    }
}

fn table_block(table: &Element, rels: &Rels, dir: &str) -> Block {
    let header = table
        .first("a:tblpr")
        .and_then(|p| p.attr("firstrow"))
        .is_some_and(|v| v == "1" || v == "true");
    let rows = table
        .elements("a:tr")
        .map(|row| {
            row.elements("a:tc")
                .map(|cell| {
                    let mut inlines = Vec::new();
                    if let Some(body) = cell.first("a:txbody") {
                        for para in paragraphs_of(body, false, rels, dir) {
                            if !inlines.is_empty() {
                                inlines.push(Inline::HardBreak);
                            }
                            inlines.extend(para.inlines);
                        }
                    }
                    inlines
                })
                .collect()
        })
        .collect();
    Block::Table { header, rows }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::testing::{png_bytes, zip_bytes, TestEnv};

    const PRESENTATION: &str =
        r#"<p:presentation xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>"#;
    const RELS: &str = r#"<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>"#;
    const SLIDE: &str = r#"<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="1" name="T"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:p><a:r><a:t>Quarter plan</a:t></a:r></a:p></p:txBody></p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:p><a:r><a:t>Goals</a:t></a:r></a:p>
            <a:p><a:pPr lvl="1"/><a:r><a:rPr b="1"/><a:t>Ship it</a:t></a:r></a:p></p:txBody></p:sp>
        <p:pic><p:nvPicPr><p:cNvPr id="3" name="P" descr="A leaf"/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId5"/></p:blipFill></p:pic>
        <p:sp><p:nvSpPr><p:cNvPr id="4" name="Box"/><p:nvPr/></p:nvSpPr></p:sp>
        </p:spTree></p:cSld></p:sld>"#;
    const SLIDE_RELS: &str = r#"<Relationships><Relationship Id="rId5" Target="../media/leaf.png"/>
        <Relationship Id="rId6" Target="../notesSlides/notesSlide1.xml"/></Relationships>"#;
    const NOTES: &str = r#"<p:notes><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="1" name="N"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:p><a:r><a:t>Say the date out loud.</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree></p:cSld></p:notes>"#;

    #[test]
    fn a_slide_becomes_a_page_with_its_notes() {
        let bytes = zip_bytes(&[
            ("ppt/presentation.xml", PRESENTATION.as_bytes()),
            ("ppt/_rels/presentation.xml.rels", RELS.as_bytes()),
            ("ppt/slides/slide1.xml", SLIDE.as_bytes()),
            ("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS.as_bytes()),
            ("ppt/notesSlides/notesSlide1.xml", NOTES.as_bytes()),
            ("ppt/media/leaf.png", &png_bytes()),
        ]);
        let mut parts = Parts::from_reader(Cursor::new(bytes)).expect("opens");
        let world = TestEnv::new();
        let env = world.env();
        let done = convert_parts(&mut parts, "deck", &env).expect("converts");
        assert_eq!(done.pages.len(), 1);
        let page = &done.pages[0].page.page;
        assert_eq!(page.title, "Quarter plan");
        let text: String = page
            .blocks
            .iter()
            .filter_map(|b| match &b.data {
                opennote_core::model::BlockData::Text(t) => Some(t.markdown.to_string()),
                _ => None,
            })
            .collect();
        assert!(text.contains("Goals") && text.contains("**Ship it**"), "{text}");
        assert!(
            text.contains("Speaker notes") && text.contains("Say the date out loud."),
            "{text}"
        );
        assert!(page
            .blocks
            .iter()
            .any(|b| matches!(b.data, opennote_core::model::BlockData::Image(_))));
        let first = page.blocks.iter().next().expect("a first block");
        assert!(first.lock.is_some(), "the slide picture is locked");
        assert!(matches!(first.data, opennote_core::model::BlockData::Image(_)));
        assert!(done.pages[0]
            .report
            .entries
            .iter()
            .any(|e| e.what.contains("picture of a slide")));
    }

    #[test]
    fn a_file_without_slides_is_refused() {
        let bytes = zip_bytes(&[("ppt/presentation.xml", b"<p:presentation/>")]);
        let mut parts = Parts::from_reader(Cursor::new(bytes)).expect("opens");
        let world = TestEnv::new();
        let env = world.env();
        assert!(convert_parts(&mut parts, "deck", &env).is_err());
    }
}
