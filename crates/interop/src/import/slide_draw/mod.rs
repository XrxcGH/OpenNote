//! Drawing a PowerPoint slide as a picture to write on (A1-13).
//!
//! Each slide becomes an SVG picture drawn from its XML: the background, the shapes of its master and layout, and
//! its own shapes, pictures, tables, and text with their fonts and colors. The picture goes at the top of the slide's
//! page, locked in place, so handwriting stays where it was written. SVG keeps the drawing sharp at any zoom, and
//! the picture says it is twice the size it takes on the page, so it prints sharp too.
//!
//! The drawing is faithful where it is cheap to be and plain where it is not. Text is laid out by measuring
//! characters with a fixed ratio of the font size, so a line may wrap a word earlier or later than PowerPoint
//! does. What is not drawn at all, such as charts, diagrams, videos, and EMF pictures, is counted in [`Missed`],
//! and the import report lists it.
//!
//! Only parts inside the file are read. Pictures go into the SVG as `data:` URLs, so the drawing never loads
//! anything from elsewhere, and fonts are named, never fetched. Font names and colors are checked before they are
//! written, and the drawing has limits on nesting, shapes, and size, so a hostile file can't make it explode.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::{Read, Seek};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

use super::xmltree::Element;
use super::zipxml::{dir_of, read_rels, rels_name, resolve, ElementExt, Parts};
use crate::assets::{is_metafile_extension, metafile_to_svg, mime_from_extension};

type Rels = HashMap<String, (String, bool)>;

/// EMUs (English Metric Units) in a point. The drawing's units are points.
const EMU_PER_PT: f64 = 12_700.0;
/// The width of the slide picture on its page, in page units. Its height follows the slide's shape.
pub(super) const PICTURE_WIDTH: f64 = 720.0;
/// How many times larger than its place on the page the picture says it is.
const SCALE: f64 = 2.0;
/// The deepest groups go before their shapes are left out.
const MAX_DEPTH: usize = 32;
/// The most shapes drawn on one slide, master and layout included.
const MAX_SHAPES: usize = 5_000;
/// The largest drawing of one slide. Past it, pictures are left out.
const MAX_SVG_BYTES: usize = 48 << 20;
/// The most lines of text one shape draws.
const MAX_LINES: usize = 400;

/// What a slide had that the drawing left out or drew more simply, counted for the report.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Missed {
    /// Charts, diagrams (SmartArt), and embedded objects.
    pub charts: usize,
    /// Videos and sounds. A video's poster picture is drawn.
    pub media: usize,
    /// Pictures in formats screens cannot show (and no metafile reader draws), or missing or too large.
    pub pictures: usize,
    /// Shapes whose outline is not one OpenNote draws, drawn as rectangles.
    pub geometry: usize,
    /// Shadows, glows, reflections, and 3-D effects, which are left out.
    pub effects: usize,
    /// Shapes past the limits of one slide.
    pub limits: usize,
}

/// A drawn slide: the SVG file, its height on the page, and what it left out.
pub(super) struct Drawn {
    pub svg: String,
    pub height: f64,
    pub missed: Missed,
    /// The boxes of the pictures on the slide, as fractions of the slide: x, y, width, height. The Evening theme
    /// keeps these in their own colors when it dims or inverts the slide.
    pub pictures: Vec<[f64; 4]>,
}

/// The most picture boxes kept for one slide.
const MAX_PICTURE_BOXES: usize = 200;

/// A color with its opacity.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rgba {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

/// A number as SVG writes it: at most two decimals, without trailing zeros.
fn num(v: f64) -> String {
    let v = if v.is_finite() { v } else { 0.0 };
    let text = format!("{v:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" || text.is_empty() {
        "0".to_owned()
    } else {
        text.to_owned()
    }
}

/// Text made safe inside XML.
fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if (c as u32) < 0x20 && c != '\t' => {}
            c => out.push(c),
        }
    }
    out
}

/// A font name as the drawing writes it: letters, digits, spaces, and `-` and `_` only, so a name can't reach out
/// of the attribute or into CSS.
fn font_name(name: &str) -> Option<String> {
    let clean: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'))
        .take(64)
        .collect();
    let clean = clean.trim().to_owned();
    (!clean.is_empty()).then_some(clean)
}

fn emu(v: Option<&str>) -> Option<f64> {
    v.and_then(|t| t.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && v.abs() < 1e12)
}

fn pt(v: Option<&str>) -> Option<f64> {
    emu(v).map(|v| v / EMU_PER_PT)
}

/// A box in points.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// The position, size, rotation, and flips of a shape.
#[derive(Clone, Copy, Debug, Default)]
struct Xfrm {
    rect: Rect,
    rot: f64,
    flip_h: bool,
    flip_v: bool,
}

fn read_xfrm(x: &Element) -> Option<Xfrm> {
    let off = x.first("a:off")?;
    let ext = x.first("a:ext")?;
    Some(Xfrm {
        rect: Rect {
            x: pt(off.attr("x"))?,
            y: pt(off.attr("y"))?,
            w: pt(ext.attr("cx"))?.max(0.0),
            h: pt(ext.attr("cy"))?.max(0.0),
        },
        rot: emu(x.attr("rot")).unwrap_or(0.0) / 60_000.0,
        flip_h: x.attr("fliph").is_some_and(truthy),
        flip_v: x.attr("flipv").is_some_and(truthy),
    })
}

fn truthy(v: &str) -> bool {
    v == "1" || v.eq_ignore_ascii_case("true")
}

/// The theme of a master: its colors, its two fonts, and its line widths.
#[derive(Clone, Debug, Default)]
struct Theme {
    colors: HashMap<String, Rgba>,
    major: Option<String>,
    minor: Option<String>,
    lines: Vec<f64>,
    fills: Vec<Element>,
}

fn read_theme(root: &Element) -> Theme {
    let mut theme = Theme::default();
    let Some(elements) = root.first("a:themeelements") else {
        return theme;
    };
    if let Some(scheme) = elements.first("a:clrscheme") {
        for slot in scheme.kids() {
            let name = slot.name.trim_start_matches("a:").to_owned();
            let color = slot.kids().find_map(|c| match c.name.as_str() {
                "a:srgbclr" => c.attr("val").and_then(Rgba::hex),
                "a:sysclr" => c.attr("lastclr").and_then(Rgba::hex),
                _ => None,
            });
            if let Some(color) = color {
                theme.colors.insert(name, color);
            }
        }
    }
    if let Some(fonts) = elements.first("a:fontscheme") {
        let typeface = |which: &str| {
            fonts
                .first(which)
                .and_then(|f| f.first("a:latin"))
                .and_then(|l| l.attr("typeface"))
                .and_then(font_name)
        };
        theme.major = typeface("a:majorfont");
        theme.minor = typeface("a:minorfont");
    }
    if let Some(format) = elements.first("a:fmtscheme") {
        if let Some(lines) = format.first("a:lnstylelst") {
            theme.lines = lines
                .elements("a:ln")
                .map(|l| pt(l.attr("w")).unwrap_or(0.75))
                .collect();
        }
        if let Some(fills) = format.first("a:bgfillstylelst") {
            theme.fills = fills.kids().cloned().collect();
        }
    }
    theme
}

/// A master or layout: its shapes, its placeholders, its background, and for a master its text styles.
struct Template {
    root: Element,
    dir: String,
    rels: Rels,
}

/// The slide's master, layout, and theme, with how the master maps color names.
struct Context<'t> {
    theme: &'t Theme,
    map: HashMap<String, String>,
    layout: Option<&'t Template>,
    master: Option<&'t Template>,
}

impl Context<'_> {
    /// A scheme color by its name in the XML, such as `tx1` or `accent2`.
    fn scheme(&self, name: &str) -> Option<Rgba> {
        let slot = self.map.get(name).map_or(name, String::as_str);
        let fallback = match slot {
            "dk1" => Some(Rgba::BLACK),
            "lt1" => Some(Rgba::WHITE),
            _ => None,
        };
        self.theme.colors.get(slot).copied().or(fallback)
    }

    /// The color of an element that holds one color element, such as `a:solidFill`. `placeholder` is the color
    /// that `phClr` stands for.
    fn color_of(&self, holder: &Element, placeholder: Option<Rgba>) -> Option<Rgba> {
        holder.kids().find_map(|c| self.color(c, placeholder))
    }

    fn color(&self, c: &Element, placeholder: Option<Rgba>) -> Option<Rgba> {
        let base = match c.name.as_str() {
            "a:srgbclr" => c.attr("val").and_then(Rgba::hex),
            "a:sysclr" => c.attr("lastclr").and_then(Rgba::hex).or(Some(Rgba::BLACK)),
            "a:schemeclr" => match c.attr("val")? {
                "phClr" => placeholder,
                name => self.scheme(name),
            },
            "a:prstclr" => preset_color(c.attr("val")?),
            "a:scrgbclr" => {
                let part = |k: &str| emu(c.attr(k)).map(|v| (v / 100_000.0).clamp(0.0, 1.0) * 255.0);
                Some(Rgba {
                    r: part("r")?,
                    g: part("g")?,
                    b: part("b")?,
                    a: 1.0,
                })
            }
            "a:hslclr" => {
                let h = emu(c.attr("hue"))? / 21_600_000.0;
                let s = emu(c.attr("sat"))? / 100_000.0;
                let l = emu(c.attr("lum"))? / 100_000.0;
                Some(Rgba::from_hsl(h, s, l, 1.0))
            }
            _ => None,
        }?;
        Some(modify(base, c))
    }
}

/// How a shape is filled.
#[derive(Clone, Debug)]
enum Fill {
    None,
    Solid(Rgba),
    /// Stops as (offset 0..1, color), the angle in degrees, and whether it is round.
    Gradient(Vec<(f64, Rgba)>, f64, bool),
    /// A picture by its part name.
    Picture(String),
}

/// How a shape's outline is drawn.
#[derive(Clone, Debug)]
struct Line {
    color: Rgba,
    width: f64,
    dash: Option<&'static str>,
    head: bool,
    tail: bool,
}

/// The picture parts already in the drawing, by part name, and the drawing's other definitions.
struct Defs {
    images: Vec<(String, String)>,
    by_part: HashMap<String, Option<usize>>,
    other: String,
    next: usize,
}

impl Defs {
    fn id(&mut self, prefix: &str) -> String {
        self.next += 1;
        format!("{prefix}{}", self.next)
    }
}

/// Draws slides of one presentation, keeping its masters, layouts, and themes once read.
pub(super) struct SlideDrawer {
    width: f64,
    height: f64,
    templates: HashMap<String, Option<Template>>,
    themes: HashMap<String, Theme>,
}

impl SlideDrawer {
    /// A drawer for the presentation's slide size, in EMUs from `p:sldSz`. A missing size is 4:3.
    pub(super) fn new(presentation: &Element) -> SlideDrawer {
        let size = presentation.first("p:sldsz");
        let w = size
            .and_then(|s| pt(s.attr("cx")))
            .filter(|w| *w >= 1.0)
            .unwrap_or(720.0);
        let h = size
            .and_then(|s| pt(s.attr("cy")))
            .filter(|h| *h >= 1.0)
            .unwrap_or(540.0);
        SlideDrawer {
            width: w.min(4_000.0),
            height: h.min(4_000.0),
            templates: HashMap::new(),
            themes: HashMap::new(),
        }
    }

    fn template<R: Read + Seek>(&mut self, parts: &mut Parts<R>, part: &str) {
        if self.templates.contains_key(part) {
            return;
        }
        let loaded = parts.xml(part).ok().flatten().map(|root| Template {
            rels: parts
                .xml(&rels_name(part))
                .ok()
                .flatten()
                .map(|r| read_rels(&r))
                .unwrap_or_default(),
            dir: dir_of(part).to_owned(),
            root,
        });
        self.templates.insert(part.to_owned(), loaded);
    }

    /// Draws one slide. `rels` are the slide's relationships and `dir` the folder of its part.
    pub(super) fn draw<R: Read + Seek>(
        &mut self,
        parts: &mut Parts<R>,
        slide: &Element,
        rels: &Rels,
        dir: &str,
        // checks-disable-next-line modifiability: one pass over the slide in drawing order, read top to bottom
    ) -> Drawn {
        let layout_part = target_of(rels, dir, "slideLayout");
        if let Some(part) = &layout_part {
            self.template(parts, part);
        }
        let master_part = layout_part
            .as_ref()
            .and_then(|p| self.templates.get(p).and_then(Option::as_ref))
            .and_then(|t| target_of(&t.rels, &t.dir, "slideMaster"));
        if let Some(part) = &master_part {
            self.template(parts, part);
        }
        let theme_part = master_part
            .as_ref()
            .and_then(|p| self.templates.get(p).and_then(Option::as_ref))
            .and_then(|t| target_of(&t.rels, &t.dir, "theme"));
        if let Some(part) = &theme_part {
            if !self.themes.contains_key(part) {
                let theme = parts
                    .xml(part)
                    .ok()
                    .flatten()
                    .map(|t| read_theme(&t))
                    .unwrap_or_default();
                self.themes.insert(part.clone(), theme);
            }
        }
        let empty = Theme::default();
        let theme = theme_part.as_ref().and_then(|p| self.themes.get(p)).unwrap_or(&empty);
        let layout = layout_part
            .as_ref()
            .and_then(|p| self.templates.get(p).and_then(Option::as_ref));
        let master = master_part
            .as_ref()
            .and_then(|p| self.templates.get(p).and_then(Option::as_ref));
        let mut map: HashMap<String, String> = [("bg1", "lt1"), ("tx1", "dk1"), ("bg2", "lt2"), ("tx2", "dk2")]
            .into_iter()
            .map(|(a, b)| (a.to_owned(), b.to_owned()))
            .collect();
        if let Some(clr) = master.and_then(|m| m.root.first("p:clrmap")) {
            for (key, value) in &clr.attrs {
                map.insert(key.clone(), value.clone());
            }
        }
        if let Some(over) = slide.first("p:clrmapovr").and_then(|o| o.first("a:overrideclrmapping")) {
            for (key, value) in &over.attrs {
                map.insert(key.clone(), value.clone());
            }
        }
        let ctx = Context {
            theme,
            map,
            layout,
            master,
        };
        let mut painter = Painter {
            ctx: &ctx,
            parts,
            body: String::new(),
            defs: Defs {
                images: Vec::new(),
                by_part: HashMap::new(),
                other: String::new(),
                next: 0,
            },
            missed: Missed::default(),
            shapes: 0,
            size: (self.width, self.height),
            pictures: Vec::new(),
        };
        painter.background(slide, rels, dir);
        let show = |e: &Element| e.attr("showmastersp").is_none_or(|v| !matches!(v, "0" | "false"));
        if show(slide) {
            if let Some(master) = master.filter(|_| layout.is_none_or(|l| show(&l.root))) {
                painter.template_shapes(master);
            }
            if let Some(layout) = layout {
                painter.template_shapes(layout);
            }
        }
        if let Some(tree) = slide.first("p:csld").and_then(|c| c.first("p:sptree")) {
            painter.tree(tree, rels, dir, true, 0);
        }
        let Painter {
            body,
            defs,
            missed,
            pictures,
            ..
        } = painter;
        let height = (PICTURE_WIDTH * self.height / self.width * 100.0).round() / 100.0;
        let mut svg = String::new();
        let _ = write!(
            svg,
            // checks-disable-next-line length: the SVG root element, kept whole so it reads as the markup it writes
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{}" height="{}" viewBox="0 0 {} {}">"#,
            num(PICTURE_WIDTH * SCALE),
            num(height * SCALE),
            num(self.width),
            num(self.height),
        );
        svg.push_str("<defs>");
        svg.push_str(&format!(
            r#"<clipPath id="slide"><rect width="{}" height="{}"/></clipPath>"#,
            num(self.width),
            num(self.height)
        ));
        for (id, url) in &defs.images {
            let _ = write!(
                svg,
                r#"<image id="{id}" width="1" height="1" preserveAspectRatio="none" href="{url}"/>"#
            );
        }
        svg.push_str(&defs.other);
        svg.push_str("</defs><g clip-path=\"url(#slide)\">");
        svg.push_str(&body);
        svg.push_str("</g></svg>");
        Drawn {
            svg,
            height,
            missed,
            pictures,
        }
    }
}

/// The part a relationship of a given kind points to, found by the kind's name in its target.
fn target_of(rels: &Rels, dir: &str, kind: &str) -> Option<String> {
    let mut found: Vec<&String> = rels
        .values()
        .filter(|(target, external)| !external && target.contains(kind) && target.ends_with(".xml"))
        .map(|(target, _)| target)
        .collect();
    found.sort();
    found.first().map(|t| resolve(dir, t))
}

/// Text defaults a shape takes from its placeholders and its master's text styles.
#[derive(Clone, Debug, Default)]
struct TextDefaults {
    size: Option<f64>,
    color: Option<Rgba>,
    font: Option<String>,
    bold: Option<bool>,
    align: Option<String>,
    anchor: Option<String>,
    insets: [Option<f64>; 4],
    bullets: bool,
    /// Per level (0 to 8): size, color, alignment, and the left margin and indent.
    levels: Vec<LevelStyle>,
}

#[derive(Clone, Debug, Default)]
struct LevelStyle {
    size: Option<f64>,
    color: Option<Rgba>,
    font: Option<String>,
    bold: Option<bool>,
    align: Option<String>,
    margin: Option<f64>,
    indent: Option<f64>,
    bullet: Option<Option<String>>,
}

struct Painter<'c, 'p, R: Read + Seek> {
    ctx: &'c Context<'c>,
    parts: &'p mut Parts<R>,
    body: String,
    defs: Defs,
    missed: Missed,
    shapes: usize,
    /// The slide's size in points.
    size: (f64, f64),
    /// The boxes of the pictures drawn, as fractions of the slide.
    pictures: Vec<[f64; 4]>,
}

/// What the report says about the drawing of the slides of one file.
pub(super) fn report(missed: Missed, drawn: usize, report: &mut crate::report::PageReport) {
    report.came_over_count(
        drawn,
        "picture of a slide to write on",
        "pictures of slides to write on",
    );
    report.skipped_count(
        missed.charts,
        (
            "chart, diagram, or embedded object on a slide picture",
            "charts, diagrams, and embedded objects on slide pictures",
        ),
        "They are left blank on the slide's picture. Their text, if any, is on the page below it.",
    );
    report.skipped_count(
        missed.media,
        ("video or sound", "videos and sounds"),
        "A video shows its first picture. Videos and sounds don't play on the page.",
    );
    report.skipped_count(
        missed.pictures,
        ("picture on a slide picture", "pictures on slide pictures"),
        "They are missing, too large, damaged, or in a format screens can't show.",
    );
    report.simplified_count(
        missed.geometry,
        (
            "shape with an outline OpenNote doesn't draw",
            "shapes with outlines OpenNote doesn't draw",
        ),
        "They are drawn as rectangles.",
    );
    report.simplified_count(
        missed.effects,
        ("shadow, glow, or 3-D effect", "shadows, glows, and 3-D effects"),
        "Shapes are drawn without them.",
    );
    report.skipped_count(
        missed.limits,
        ("shape past a slide's limits", "shapes past a slide's limits"),
        "A slide picture draws at most 5,000 shapes, nested at most 32 groups deep.",
    );
}

mod color;
mod geometry;
mod paint;
mod paint_text;
#[cfg(test)]
mod tests;

use color::*;
use geometry::*;
use paint_text::*;
