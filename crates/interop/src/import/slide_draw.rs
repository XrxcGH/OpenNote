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
use crate::assets::mime_from_extension;

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
    /// Pictures in formats screens cannot show, such as EMF, or missing or too large.
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
}

/// A color with its opacity.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rgba {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

impl Rgba {
    const BLACK: Rgba = Rgba::rgb(0, 0, 0);
    const WHITE: Rgba = Rgba::rgb(255, 255, 255);

    const fn rgb(r: u8, g: u8, b: u8) -> Rgba {
        Rgba {
            r: r as f64,
            g: g as f64,
            b: b as f64,
            a: 1.0,
        }
    }

    fn hex(text: &str) -> Option<Rgba> {
        let t = text.trim();
        if t.len() != 6 || !t.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&t[i..i + 2], 16).ok();
        Some(Rgba::rgb(byte(0)?, byte(2)?, byte(4)?))
    }

    fn css(self) -> String {
        let c = |v: f64| v.round().clamp(0.0, 255.0) as u8;
        format!("#{:02x}{:02x}{:02x}", c(self.r), c(self.g), c(self.b))
    }

    /// The `-opacity` attribute's value, or `None` when the color is opaque.
    fn opacity(self) -> Option<String> {
        (self.a < 0.999).then(|| num(self.a.clamp(0.0, 1.0)))
    }

    fn to_hsl(self) -> (f64, f64, f64) {
        let (r, g, b) = (self.r / 255.0, self.g / 255.0, self.b / 255.0);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        if (max - min).abs() < f64::EPSILON {
            return (0.0, 0.0, l);
        }
        let d = max - min;
        let s = if l > 0.5 {
            d / (2.0 - max - min)
        } else {
            d / (max + min)
        };
        let h = if (max - r).abs() < f64::EPSILON {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if (max - g).abs() < f64::EPSILON {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        (h / 6.0, s, l)
    }

    fn from_hsl(h: f64, s: f64, l: f64, a: f64) -> Rgba {
        let l = l.clamp(0.0, 1.0);
        if s <= 0.0 {
            return Rgba {
                r: l * 255.0,
                g: l * 255.0,
                b: l * 255.0,
                a,
            };
        }
        let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
        let p = 2.0 * l - q;
        let hue = |mut t: f64| {
            if t < 0.0 {
                t += 1.0;
            }
            if t > 1.0 {
                t -= 1.0;
            }
            if t < 1.0 / 6.0 {
                p + (q - p) * 6.0 * t
            } else if t < 0.5 {
                q
            } else if t < 2.0 / 3.0 {
                p + (q - p) * (2.0 / 3.0 - t) * 6.0
            } else {
                p
            }
        };
        Rgba {
            r: hue(h + 1.0 / 3.0) * 255.0,
            g: hue(h) * 255.0,
            b: hue(h - 1.0 / 3.0) * 255.0,
            a,
        }
    }
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

/// Applies color changes such as `lumMod`, `tint`, and `alpha` in the order the file lists them.
fn modify(mut color: Rgba, c: &Element) -> Rgba {
    for m in c.kids() {
        let Some(v) = emu(m.attr("val")).map(|v| v / 100_000.0) else {
            continue;
        };
        match m.name.as_str() {
            "a:lummod" | "a:lumoff" => {
                let (h, s, l) = color.to_hsl();
                let l = if m.name == "a:lummod" { l * v } else { l + v };
                color = Rgba::from_hsl(h, s, l, color.a);
            }
            "a:tint" => {
                let mix = |x: f64| x + (255.0 - x) * (1.0 - v);
                color = Rgba {
                    r: mix(color.r),
                    g: mix(color.g),
                    b: mix(color.b),
                    a: color.a,
                };
            }
            "a:shade" => {
                color = Rgba {
                    r: color.r * v,
                    g: color.g * v,
                    b: color.b * v,
                    a: color.a,
                };
            }
            "a:alpha" => color.a = v.clamp(0.0, 1.0),
            _ => {}
        }
    }
    color
}

fn preset_color(name: &str) -> Option<Rgba> {
    Some(match name.to_ascii_lowercase().as_str() {
        "black" => Rgba::BLACK,
        "white" => Rgba::WHITE,
        "red" => Rgba::rgb(255, 0, 0),
        "green" => Rgba::rgb(0, 128, 0),
        "blue" => Rgba::rgb(0, 0, 255),
        "yellow" => Rgba::rgb(255, 255, 0),
        "gray" | "grey" => Rgba::rgb(128, 128, 128),
        "orange" => Rgba::rgb(255, 165, 0),
        "purple" => Rgba::rgb(128, 0, 128),
        "darkblue" => Rgba::rgb(0, 0, 139),
        "darkred" => Rgba::rgb(139, 0, 0),
        "lightgray" | "lightgrey" => Rgba::rgb(211, 211, 211),
        _ => return None,
    })
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
        let Painter { body, defs, missed, .. } = painter;
        let height = (PICTURE_WIDTH * self.height / self.width * 100.0).round() / 100.0;
        let mut svg = String::new();
        let _ = write!(
            svg,
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
        Drawn { svg, height, missed }
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
}

impl<'c, R: Read + Seek> Painter<'c, '_, R> {
    fn background(&mut self, slide: &Element, slide_rels: &Rels, slide_dir: &str) {
        let ctx: &'c Context<'c> = self.ctx;
        let chain = [
            Some((slide, slide_rels, slide_dir)),
            ctx.layout.map(|l| (&l.root, &l.rels, l.dir.as_str())),
            ctx.master.map(|m| (&m.root, &m.rels, m.dir.as_str())),
        ];
        for (root, rels, dir) in chain.into_iter().flatten() {
            let Some(bg) = root.first("p:csld").and_then(|c| c.first("p:bg")) else {
                continue;
            };
            let fill = if let Some(pr) = bg.first("p:bgpr") {
                self.fill_of(pr, Some(rels), dir)
            } else if let Some(r) = bg.first("p:bgref") {
                let color = self.ctx.color_of(r, None);
                let idx = emu(r.attr("idx")).unwrap_or(0.0) as usize;
                // Theme background styles start at 1001. The first is a solid fill of the placeholder color.
                let style = idx.checked_sub(1001).and_then(|i| self.ctx.theme.fills.get(i)).cloned();
                match style {
                    Some(style) => {
                        let mut holder = Element::default();
                        holder.children.push(super::xmltree::Node::Element(style));
                        self.fill_with(&holder, None, "", color)
                    }
                    None => color.map_or(Fill::None, Fill::Solid),
                }
            } else {
                Fill::None
            };
            let rect = Rect {
                x: 0.0,
                y: 0.0,
                w: self.size.0,
                h: self.size.1,
            };
            let paint = self.paint(&fill, rect);
            if let Some(paint) = paint {
                let _ = write!(self.body, r#"<rect width="100%" height="100%"{paint}/>"#);
            }
            return;
        }
        let white = self.ctx.scheme("bg1").unwrap_or(Rgba::WHITE);
        let _ = write!(
            self.body,
            r#"<rect width="100%" height="100%" fill="{}"/>"#,
            white.css()
        );
    }

    /// The shapes of a master or layout that are not placeholders: bars, logos, and lines on every slide.
    fn template_shapes(&mut self, template: &Template) {
        let Some(tree) = template.root.first("p:csld").and_then(|c| c.first("p:sptree")) else {
            return;
        };
        let (rels, dir) = (template.rels.clone(), template.dir.clone());
        self.tree(tree, &rels, &dir, false, 0);
    }

    /// Draws a shape tree. Placeholders are drawn only on the slide itself.
    fn tree(&mut self, tree: &Element, rels: &Rels, dir: &str, placeholders: bool, depth: usize) {
        if depth > MAX_DEPTH {
            self.missed.limits += 1;
            return;
        }
        for shape in tree.kids() {
            if self.shapes >= MAX_SHAPES || self.body.len() > MAX_SVG_BYTES {
                self.missed.limits += 1;
                continue;
            }
            let hidden = shape
                .kids()
                .find(|k| k.name.starts_with("p:nv"))
                .and_then(|nv| nv.first("p:cnvpr"))
                .and_then(|c| c.attr("hidden"))
                .is_some_and(truthy);
            if hidden {
                continue;
            }
            let ph = placeholder_of(shape);
            if ph.is_some() && !placeholders {
                continue;
            }
            match shape.name.as_str() {
                "p:sp" | "p:cxnsp" => {
                    self.shapes += 1;
                    self.shape(shape, ph.as_ref(), rels, dir);
                }
                "p:pic" => {
                    self.shapes += 1;
                    self.picture(shape, ph.as_ref(), rels, dir);
                }
                "p:graphicframe" => {
                    self.shapes += 1;
                    self.frame(shape, rels, dir);
                }
                "p:grpsp" => self.group(shape, rels, dir, placeholders, depth),
                "mc:alternatecontent" => {
                    if let Some(fallback) = shape.first("mc:fallback") {
                        self.tree(fallback, rels, dir, placeholders, depth + 1);
                    }
                }
                "p:contentpart" => self.missed.charts += 1,
                _ => {}
            }
        }
    }

    fn group(&mut self, group: &Element, rels: &Rels, dir: &str, placeholders: bool, depth: usize) {
        let xfrm = group.first("p:grpsppr").and_then(|p| p.first("a:xfrm"));
        let mut transform = String::new();
        if let Some(x) = xfrm {
            if let Some(outer) = read_xfrm(x) {
                let child_off = x.first("a:choff");
                let child_ext = x.first("a:chext");
                let cx = child_off.and_then(|o| pt(o.attr("x"))).unwrap_or(outer.rect.x);
                let cy = child_off.and_then(|o| pt(o.attr("y"))).unwrap_or(outer.rect.y);
                let cw = child_ext
                    .and_then(|e| pt(e.attr("cx")))
                    .filter(|w| *w > 0.0)
                    .unwrap_or(outer.rect.w);
                let ch = child_ext
                    .and_then(|e| pt(e.attr("cy")))
                    .filter(|h| *h > 0.0)
                    .unwrap_or(outer.rect.h);
                let sx = if cw > 0.0 { outer.rect.w / cw } else { 1.0 };
                let sy = if ch > 0.0 { outer.rect.h / ch } else { 1.0 };
                let r = outer.rect;
                transform = format!(
                    "{}translate({} {}) scale({} {}) translate({} {})",
                    rotation(&outer),
                    num(r.x),
                    num(r.y),
                    num(sx),
                    num(sy),
                    num(-cx),
                    num(-cy)
                );
            }
        }
        let _ = write!(self.body, r#"<g transform="{transform}">"#);
        self.tree(group, rels, dir, placeholders, depth + 1);
        self.body.push_str("</g>");
    }

    /// The fill of a shape's properties.
    fn fill_of(&mut self, props: &Element, rels: Option<&Rels>, dir: &str) -> Fill {
        self.fill_with(props, rels, dir, None)
    }

    fn fill_with(&mut self, props: &Element, rels: Option<&Rels>, dir: &str, placeholder: Option<Rgba>) -> Fill {
        for f in props.kids() {
            match f.name.as_str() {
                "a:nofill" => return Fill::None,
                "a:solidfill" => {
                    return self.ctx.color_of(f, placeholder).map_or(Fill::None, Fill::Solid);
                }
                "a:gradfill" => {
                    let mut stops: Vec<(f64, Rgba)> = f
                        .first("a:gslst")
                        .map(|list| {
                            list.elements("a:gs")
                                .filter_map(|gs| {
                                    let pos = emu(gs.attr("pos")).unwrap_or(0.0) / 100_000.0;
                                    Some((pos.clamp(0.0, 1.0), self.ctx.color_of(gs, placeholder)?))
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
                    stops.truncate(16);
                    let angle = f
                        .first("a:lin")
                        .and_then(|l| emu(l.attr("ang")))
                        .map_or(90.0, |a| a / 60_000.0);
                    let round = f.first("a:path").is_some();
                    return match stops.len() {
                        0 => Fill::None,
                        1 => Fill::Solid(stops[0].1),
                        _ => Fill::Gradient(stops, angle, round),
                    };
                }
                "a:blipfill" => {
                    let target = f
                        .first("a:blip")
                        .and_then(|b| b.attr("r:embed"))
                        .and_then(|id| rels?.get(id))
                        .filter(|(_, external)| !external)
                        .map(|(t, _)| resolve(dir, t));
                    return target.map_or(Fill::None, Fill::Picture);
                }
                "a:pattfill" => {
                    let color = f.first("a:fgclr").and_then(|c| self.ctx.color_of(c, placeholder));
                    return color.map_or(Fill::None, Fill::Solid);
                }
                "a:grpfill" => return Fill::None,
                _ => {}
            }
        }
        placeholder.map_or(Fill::None, Fill::Solid)
    }

    /// The SVG attributes that paint a fill over `rect`, or `None` for no fill.
    fn paint(&mut self, fill: &Fill, rect: Rect) -> Option<String> {
        match fill {
            Fill::None => None,
            Fill::Solid(color) => Some(match color.opacity() {
                Some(o) => format!(r#" fill="{}" fill-opacity="{o}""#, color.css()),
                None => format!(r#" fill="{}""#, color.css()),
            }),
            Fill::Gradient(stops, angle, round) => {
                let id = self.defs.id("g");
                let mut stops_svg = String::new();
                for (offset, color) in stops {
                    let _ = write!(
                        stops_svg,
                        r#"<stop offset="{}" stop-color="{}"{}/>"#,
                        num(*offset),
                        color.css(),
                        color
                            .opacity()
                            .map(|o| format!(r#" stop-opacity="{o}""#))
                            .unwrap_or_default()
                    );
                }
                if *round {
                    let _ = write!(
                        self.defs.other,
                        r#"<radialGradient id="{id}">{stops_svg}</radialGradient>"#
                    );
                } else {
                    let (s, c) = angle.to_radians().sin_cos();
                    let _ = write!(
                        self.defs.other,
                        r#"<linearGradient id="{id}" x1="{}" y1="{}" x2="{}" y2="{}">{stops_svg}</linearGradient>"#,
                        num(0.5 - c / 2.0),
                        num(0.5 - s / 2.0),
                        num(0.5 + c / 2.0),
                        num(0.5 + s / 2.0)
                    );
                }
                Some(format!(r#" fill="url(#{id})""#))
            }
            Fill::Picture(part) => {
                let image = self.image(part)?;
                let id = self.defs.id("p");
                let _ = write!(
                    self.defs.other,
                    r##"<pattern id="{id}" patternUnits="userSpaceOnUse" x="{}" y="{}" width="{}" height="{}"><use href="#{image}" transform="scale({} {})"/></pattern>"##,
                    num(rect.x),
                    num(rect.y),
                    num(rect.w),
                    num(rect.h),
                    num(rect.w),
                    num(rect.h)
                );
                Some(format!(r#" fill="url(#{id})""#))
            }
        }
    }

    /// Adds a picture part to the drawing once. Returns its ID, or `None` when it can't be shown.
    fn image(&mut self, part: &str) -> Option<String> {
        if let Some(found) = self.defs.by_part.get(part) {
            return found.map(|i| self.defs.images[i].0.clone());
        }
        let ext = part.rsplit_once('.').map_or("", |(_, e)| e).to_ascii_lowercase();
        let mime = mime_from_extension(&ext);
        let shown = matches!(
            mime,
            "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
        );
        let budget = MAX_SVG_BYTES.saturating_sub(self.body.len() + self.defs.other.len());
        let bytes = if shown { self.parts.bytes(part) } else { None };
        let url = bytes
            .filter(|b| b.len() / 3 * 4 < budget.saturating_sub(self.defs.images.iter().map(|i| i.1.len()).sum()))
            .map(|b| format!("data:{mime};base64,{}", STANDARD.encode(b)));
        let Some(url) = url else {
            self.defs.by_part.insert(part.to_owned(), None);
            self.missed.pictures += 1;
            return None;
        };
        let id = format!("i{}", self.defs.images.len() + 1);
        self.defs.images.push((id.clone(), url));
        self.defs
            .by_part
            .insert(part.to_owned(), Some(self.defs.images.len() - 1));
        Some(id)
    }

    /// The shape on the layout, or else the master, that a placeholder takes its place and look from.
    fn inherited(&self, ph: &Placeholder) -> Vec<&'c Element> {
        let ctx: &'c Context<'c> = self.ctx;
        let mut out = Vec::new();
        for template in [ctx.layout, ctx.master].into_iter().flatten() {
            let Some(tree) = template.root.first("p:csld").and_then(|c| c.first("p:sptree")) else {
                continue;
            };
            let mut all = Vec::new();
            flatten(tree, &mut all, 0);
            let by_idx = ph.idx.as_ref().and_then(|idx| {
                all.iter()
                    .copied()
                    .find(|s| placeholder_of(s).is_some_and(|p| p.idx.as_ref() == Some(idx) && p.kind == ph.kind))
            });
            let by_type = || {
                all.iter()
                    .copied()
                    .find(|s| placeholder_of(s).is_some_and(|p| p.kind == ph.kind || same_family(&p.kind, &ph.kind)))
            };
            if let Some(found) = by_idx.or_else(by_type) {
                out.push(found);
            }
        }
        out
    }

    fn shape(&mut self, shape: &Element, ph: Option<&Placeholder>, rels: &Rels, dir: &str) {
        let props = shape.first("p:sppr");
        let inherited = ph.map(|p| self.inherited(p)).unwrap_or_default();
        let xfrm = props.and_then(|p| p.first("a:xfrm")).and_then(read_xfrm).or_else(|| {
            inherited
                .iter()
                .find_map(|s| s.first("p:sppr").and_then(|p| p.first("a:xfrm")).and_then(read_xfrm))
        });
        let Some(xfrm) = xfrm else {
            return;
        };
        let style = shape.first("p:style");
        let ctx: &'c Context<'c> = self.ctx;
        let style_color = |name: &str| style.and_then(|s| s.first(name)).map(|r| (r, ctx.color_of(r, None)));
        let fill = match props {
            Some(p) if has_fill(p) => self.fill_of(p, Some(rels), dir),
            _ => match style_color("a:fillref") {
                Some((r, color)) if emu(r.attr("idx")).unwrap_or(0.0) > 0.0 => color.map_or(Fill::None, Fill::Solid),
                _ => inherited
                    .iter()
                    .find_map(|s| s.first("p:sppr").filter(|p| has_fill(p)))
                    .map_or(Fill::None, |p| self.fill_of(p, None, "")),
            },
        };
        let line = self.line(props, style, shape.name == "p:cxnsp");
        if props.is_some_and(|p| p.first("a:effectlst").is_some_and(|e| e.kids().next().is_some()))
            || props.is_some_and(|p| p.first("a:scene3d").is_some() || p.first("a:sp3d").is_some())
        {
            self.missed.effects += 1;
        }
        let geometry = props.and_then(|p| p.first("a:prstgeom").or_else(|| p.first("a:custgeom")));
        let (path, known) = geometry_path(geometry, xfrm.rect);
        if !known {
            self.missed.geometry += 1;
        }
        let paint = self.paint(&fill, xfrm.rect);
        let has_line = line.is_some();
        if paint.is_some() || has_line {
            let stroke = line.as_ref().map(stroke_attrs).unwrap_or_default();
            let _ = write!(
                self.body,
                r#"<path d="{path}"{}{stroke}{}/>"#,
                paint.unwrap_or_else(|| r#" fill="none""#.to_owned()),
                shape_transform(&xfrm)
            );
            if let Some(line) = line.filter(|l| l.head || l.tail) {
                self.arrows(&xfrm, &line);
            }
        }
        if let Some(text) = shape.first("p:txbody") {
            let defaults = self.text_defaults(ph, &inherited);
            let font_color = style_color("a:fontref").and_then(|(_, c)| c);
            self.text(text, &xfrm, &defaults, font_color);
        }
    }

    fn line(&self, props: Option<&Element>, style: Option<&Element>, connector: bool) -> Option<Line> {
        let ln = props.and_then(|p| p.first("a:ln"));
        let style_ref = style.and_then(|s| s.first("a:lnref"));
        let style_idx = style_ref.and_then(|r| emu(r.attr("idx"))).unwrap_or(0.0) as usize;
        if ln.is_some_and(|l| l.first("a:nofill").is_some()) {
            return None;
        }
        let color = ln
            .and_then(|l| l.first("a:solidfill"))
            .and_then(|f| self.ctx.color_of(f, None))
            .or_else(|| {
                (style_idx > 0)
                    .then(|| style_ref.and_then(|r| self.ctx.color_of(r, None)))
                    .flatten()
            })
            .or_else(|| connector.then_some(Rgba::BLACK))?;
        let width = ln
            .and_then(|l| pt(l.attr("w")))
            .or_else(|| {
                style_idx
                    .checked_sub(1)
                    .and_then(|i| self.ctx.theme.lines.get(i).copied())
            })
            .unwrap_or(0.75)
            .clamp(0.0, 200.0);
        let dash = ln
            .and_then(|l| l.first("a:prstdash"))
            .and_then(|d| d.attr("val"))
            .and_then(|v| match v {
                "solid" => None,
                "dot" | "sysDot" => Some("1 2"),
                "dash" | "sysDash" => Some("4 3"),
                "lgDash" => Some("8 3"),
                "dashDot" | "sysDashDot" => Some("4 3 1 3"),
                _ => Some("4 3"),
            });
        let arrow = |name: &str| {
            ln.and_then(|l| l.first(name))
                .and_then(|e| e.attr("type"))
                .is_some_and(|t| t != "none")
        };
        Some(Line {
            color,
            width,
            dash,
            head: arrow("a:headend"),
            tail: arrow("a:tailend"),
        })
    }

    /// Arrowheads of a straight line, drawn as triangles at its ends.
    fn arrows(&mut self, xfrm: &Xfrm, line: &Line) {
        let r = xfrm.rect;
        let (mut x1, mut y1, mut x2, mut y2) = (r.x, r.y, r.x + r.w, r.y + r.h);
        if xfrm.flip_h {
            std::mem::swap(&mut x1, &mut x2);
        }
        if xfrm.flip_v {
            std::mem::swap(&mut y1, &mut y2);
        }
        let size = (line.width * 3.0).max(4.0);
        let mut head = |tip: (f64, f64), from: (f64, f64)| {
            let (dx, dy) = (tip.0 - from.0, tip.1 - from.1);
            let len = (dx * dx + dy * dy).sqrt();
            if len < 0.01 {
                return;
            }
            let (ux, uy) = (dx / len, dy / len);
            let base = (tip.0 - ux * size, tip.1 - uy * size);
            let (px, py) = (-uy * size / 2.0, ux * size / 2.0);
            let _ = write!(
                self.body,
                r#"<path d="M{} {}L{} {}L{} {}Z" fill="{}"{}/>"#,
                num(tip.0),
                num(tip.1),
                num(base.0 + px),
                num(base.1 + py),
                num(base.0 - px),
                num(base.1 - py),
                line.color.css(),
                rotation(xfrm)
                    .is_empty()
                    .then(String::new)
                    .unwrap_or_else(|| format!(r#" transform="{}""#, rotation(xfrm).trim_end()))
            );
        };
        if line.tail {
            head((x2, y2), (x1, y1));
        }
        if line.head {
            head((x1, y1), (x2, y2));
        }
    }

    fn picture(&mut self, pic: &Element, ph: Option<&Placeholder>, rels: &Rels, dir: &str) {
        let props = pic.first("p:sppr");
        let inherited = ph.map(|p| self.inherited(p)).unwrap_or_default();
        let xfrm = props.and_then(|p| p.first("a:xfrm")).and_then(read_xfrm).or_else(|| {
            inherited
                .iter()
                .find_map(|s| s.first("p:sppr").and_then(|p| p.first("a:xfrm")).and_then(read_xfrm))
        });
        let Some(xfrm) = xfrm else { return };
        let is_media = pic.first("p:nvpicpr").and_then(|n| n.first("p:nvpr")).is_some_and(|n| {
            n.kids()
                .any(|k| matches!(k.name.as_str(), "a:videofile" | "a:audiofile" | "p:extlst"))
        });
        if is_media {
            self.missed.media += 1;
        }
        let fill = pic.first("p:blipfill");
        let target = fill
            .and_then(|f| f.first("a:blip"))
            .and_then(|b| b.attr("r:embed"))
            .and_then(|id| rels.get(id))
            .filter(|(_, external)| !external)
            .map(|(t, _)| resolve(dir, t));
        let unlinked = target.is_none();
        let Some(image) = target.and_then(|t| self.image(&t)) else {
            // A part that was found but can't be drawn is already counted by `image`.
            if unlinked && target_missing(fill) {
                self.missed.pictures += 1;
            }
            return;
        };
        let r = xfrm.rect;
        // A crop keeps the middle of the picture: the edges it cuts are in thousandths of a percent.
        let crop = fill.and_then(|f| f.first("a:srcrect"));
        let side = |k: &str| crop.and_then(|c| emu(c.attr(k))).unwrap_or(0.0) / 100_000.0;
        let (l, t, rr, b) = (side("l"), side("t"), side("r"), side("b"));
        let vw = (1.0 - l - rr).max(0.001);
        let vh = (1.0 - t - b).max(0.001);
        let clip = self.defs.id("c");
        let geometry = props.and_then(|p| p.first("a:prstgeom"));
        let (path, _) = geometry_path(geometry, r);
        let _ = write!(
            self.defs.other,
            r#"<clipPath id="{clip}"><path d="{path}"/></clipPath>"#
        );
        let _ = write!(
            self.body,
            r##"<g clip-path="url(#{clip})"{}><use href="#{image}" transform="translate({} {}) scale({} {})"/></g>"##,
            shape_transform(&xfrm),
            num(r.x - l / vw * r.w),
            num(r.y - t / vh * r.h),
            num(r.w / vw),
            num(r.h / vh),
        );
        if let Some(line) = self.line(props, pic.first("p:style"), false) {
            let _ = write!(
                self.body,
                r#"<path d="{path}" fill="none"{}{}/>"#,
                stroke_attrs(&line),
                shape_transform(&xfrm)
            );
        }
    }

    fn frame(&mut self, frame: &Element, rels: &Rels, dir: &str) {
        let _ = (rels, dir);
        let Some(xfrm) = frame.first("p:xfrm").and_then(read_xfrm) else {
            return;
        };
        let data = frame.first("a:graphic").and_then(|g| g.first("a:graphicdata"));
        match data.and_then(|d| d.first("a:tbl")) {
            Some(table) => self.table(table, xfrm.rect),
            None => self.missed.charts += 1,
        }
    }

    fn table(&mut self, table: &Element, at: Rect) {
        let columns: Vec<f64> = table
            .first("a:tblgrid")
            .map(|g| {
                g.elements("a:gridcol")
                    .map(|c| pt(c.attr("w")).unwrap_or(0.0))
                    .collect()
            })
            .unwrap_or_default();
        let props = table.first("a:tblpr");
        let flag = |k: &str| props.and_then(|p| p.attr(k)).is_some_and(truthy);
        let (first_row, banded) = (flag("firstrow"), flag("bandrow"));
        let accent = self.ctx.scheme("accent1").unwrap_or(Rgba::rgb(68, 114, 196));
        let mut y = at.y;
        for (row_index, row) in table.elements("a:tr").enumerate().take(500) {
            let height = pt(row.attr("h")).unwrap_or(20.0);
            let mut x = at.x;
            let mut column = 0;
            for cell in row.elements("a:tc") {
                let span = emu(cell.attr("gridspan")).unwrap_or(1.0).clamp(1.0, 64.0) as usize;
                let width: f64 = columns.iter().skip(column).take(span).sum();
                column += span;
                let merged = cell.attr("hmerge").is_some_and(truthy) || cell.attr("vmerge").is_some_and(truthy);
                let rect = Rect {
                    x,
                    y,
                    w: width,
                    h: height,
                };
                x += width;
                if merged {
                    continue;
                }
                let cell_props = cell.first("a:tcpr");
                let header = first_row && row_index == 0;
                let fill = match cell_props {
                    Some(p) if has_fill(p) => self.fill_of(p, None, ""),
                    _ if header => Fill::Solid(accent),
                    _ if banded && row_index % 2 == usize::from(first_row) => Fill::Solid(tinted(accent, 0.4)),
                    _ => Fill::Solid(tinted(accent, 0.2)),
                };
                let paint = self.paint(&fill, rect).unwrap_or_else(|| r#" fill="none""#.to_owned());
                let _ = write!(
                    self.body,
                    r##"<rect x="{}" y="{}" width="{}" height="{}"{paint} stroke="#ffffff" stroke-width="1"/>"##,
                    num(rect.x),
                    num(rect.y),
                    num(rect.w),
                    num(rect.h)
                );
                if let Some(text) = cell.first("a:txbody") {
                    let defaults = TextDefaults {
                        size: Some(18.0),
                        color: Some(if header { Rgba::WHITE } else { Rgba::BLACK }),
                        bold: header.then_some(true),
                        insets: [Some(7.2), Some(3.6), Some(7.2), Some(3.6)],
                        anchor: cell_props.and_then(|p| p.attr("anchor")).map(str::to_owned),
                        ..TextDefaults::default()
                    };
                    let xfrm = Xfrm {
                        rect,
                        ..Xfrm::default()
                    };
                    self.text(text, &xfrm, &defaults, None);
                }
            }
            y += height;
        }
    }

    /// What a shape's text takes from the shapes it inherits from and from the master's text styles.
    fn text_defaults(&self, ph: Option<&Placeholder>, inherited: &[&Element]) -> TextDefaults {
        let mut defaults = TextDefaults::default();
        let style_name = match ph.map(|p| p.kind.as_str()) {
            Some("title" | "ctrTitle") => "p:titlestyle",
            Some("body" | "obj" | "subTitle") => "p:bodystyle",
            _ => "p:otherstyle",
        };
        defaults.bullets = style_name == "p:bodystyle" && ph.is_some_and(|p| p.kind != "subTitle");
        let mut sources: Vec<&Element> = Vec::new();
        for shape in inherited {
            if let Some(list) = shape.first("p:txbody").and_then(|t| t.first("a:lststyle")) {
                sources.push(list);
            }
        }
        if let Some(styles) = self
            .ctx
            .master
            .and_then(|m| m.root.first("p:txstyles"))
            .and_then(|s| s.first(style_name))
        {
            sources.push(styles);
        }
        defaults.levels = (1..=9)
            .map(|level| {
                let name = format!("a:lvl{level}ppr");
                let mut style = LevelStyle::default();
                for source in &sources {
                    let Some(p) = source.first(&name) else { continue };
                    style.align = style.align.or_else(|| p.attr("algn").map(str::to_owned));
                    style.margin = style.margin.or_else(|| pt(p.attr("marl")));
                    style.indent = style.indent.or_else(|| pt(p.attr("indent")));
                    if style.bullet.is_none() {
                        if p.first("a:bunone").is_some() {
                            style.bullet = Some(None);
                        } else if let Some(c) = p.first("a:buchar").and_then(|b| b.attr("char")) {
                            style.bullet = Some(Some(c.chars().take(1).collect()));
                        }
                    }
                    if let Some(run) = p.first("a:defrpr") {
                        style.size = style.size.or_else(|| emu(run.attr("sz")).map(|s| s / 100.0));
                        style.bold = style.bold.or_else(|| run.attr("b").map(truthy));
                        style.color = style
                            .color
                            .or_else(|| run.first("a:solidfill").and_then(|f| self.ctx.color_of(f, None)));
                        style.font = style.font.clone().or_else(|| {
                            run.first("a:latin")
                                .and_then(|l| l.attr("typeface"))
                                .and_then(|t| self.typeface(t))
                        });
                    }
                }
                style
            })
            .collect();
        for shape in inherited {
            let Some(body) = shape.first("p:txbody").and_then(|t| t.first("a:bodypr")) else {
                continue;
            };
            defaults.anchor = defaults
                .anchor
                .clone()
                .or_else(|| body.attr("anchor").map(str::to_owned));
            for (slot, key) in defaults.insets.iter_mut().zip(["lins", "tins", "rins", "bins"]) {
                *slot = slot.or_else(|| pt(body.attr(key)));
            }
        }
        if style_name == "p:titlestyle" {
            defaults.font = self.ctx.theme.major.clone();
        }
        defaults
    }

    /// A font name, with the theme's `+mj-lt` and `+mn-lt` read as its two fonts.
    fn typeface(&self, name: &str) -> Option<String> {
        match name {
            "+mj-lt" => self.ctx.theme.major.clone(),
            "+mn-lt" => self.ctx.theme.minor.clone(),
            other if other.starts_with('+') => None,
            other => font_name(other),
        }
    }

    fn text(&mut self, body: &Element, xfrm: &Xfrm, defaults: &TextDefaults, font_color: Option<Rgba>) {
        let props = body.first("a:bodypr");
        let inset = |i: usize, key: &str, fallback: f64| {
            props
                .and_then(|p| pt(p.attr(key)))
                .or(defaults.insets[i])
                .unwrap_or(fallback)
        };
        let (left, top, right, bottom) = (
            inset(0, "lins", 7.2),
            inset(1, "tins", 3.6),
            inset(2, "rins", 7.2),
            inset(3, "bins", 3.6),
        );
        let anchor = props
            .and_then(|p| p.attr("anchor"))
            .map(str::to_owned)
            .or_else(|| defaults.anchor.clone())
            .unwrap_or_else(|| "t".to_owned());
        let wrap = props.and_then(|p| p.attr("wrap")) != Some("none");
        let scale = props
            .and_then(|p| p.first("a:normautofit"))
            .and_then(|a| emu(a.attr("fontscale")))
            .map_or(1.0, |s| (s / 100_000.0).clamp(0.1, 1.0));
        let r = xfrm.rect;
        let width = (r.w - left - right).max(1.0);
        let mut lines: Vec<TextLine> = Vec::new();
        let mut auto_numbers = [0usize; 9];
        for p in body.elements("a:p") {
            let pp = p.first("a:ppr");
            let level = pp
                .and_then(|p| p.attr("lvl"))
                .and_then(|l| l.parse::<usize>().ok())
                .unwrap_or(0)
                .min(8);
            let style = defaults.levels.get(level).cloned().unwrap_or_default();
            let align = pp
                .and_then(|p| p.attr("algn"))
                .map(str::to_owned)
                .or_else(|| style.align.clone())
                .or_else(|| defaults.align.clone())
                .unwrap_or_else(|| "l".to_owned());
            let base_size = style.size.or(defaults.size).unwrap_or(18.0) * scale;
            let base = RunStyle {
                size: base_size,
                color: style
                    .color
                    .or(font_color)
                    .or(defaults.color)
                    .or_else(|| self.ctx.scheme("tx1"))
                    .unwrap_or(Rgba::BLACK),
                font: style
                    .font
                    .clone()
                    .or_else(|| defaults.font.clone())
                    .or_else(|| self.ctx.theme.minor.clone()),
                bold: style.bold.or(defaults.bold).unwrap_or(false),
                italic: false,
                underline: false,
                strike: false,
            };
            let mut runs: Vec<(String, RunStyle)> = Vec::new();
            for run in p.kids() {
                match run.name.as_str() {
                    "a:r" | "a:fld" => {
                        let Some(t) = run.first("a:t") else { continue };
                        runs.push((t.all_text(), self.run_style(run.first("a:rpr"), &base, scale)));
                    }
                    "a:br" => runs.push(("\n".to_owned(), base.clone())),
                    _ => {}
                }
            }
            let empty_size = p
                .first("a:endpararpr")
                .and_then(|e| emu(e.attr("sz")))
                .map_or(base_size, |s| s / 100.0 * scale);
            let bullet = if pp.is_some_and(|p| p.first("a:bunone").is_some()) {
                None
            } else if let Some(c) = pp.and_then(|p| p.first("a:buchar")).and_then(|b| b.attr("char")) {
                Some(c.chars().take(1).collect::<String>())
            } else if pp.and_then(|p| p.first("a:buautonum")).is_some() {
                auto_numbers[level] += 1;
                Some(format!("{}.", auto_numbers[level]))
            } else {
                match &style.bullet {
                    Some(b) => b.clone(),
                    None => defaults.bullets.then(|| "\u{2022}".to_owned()),
                }
            };
            let has_text = runs.iter().any(|(t, _)| !t.trim().is_empty());
            let margin = pp
                .and_then(|p| pt(p.attr("marl")))
                .or(style.margin)
                .unwrap_or(if bullet.is_some() {
                    27.0 + 27.0 * level as f64
                } else {
                    0.0
                });
            let indent = pp
                .and_then(|p| pt(p.attr("indent")))
                .or(style.indent)
                .unwrap_or(if bullet.is_some() { -27.0 } else { 0.0 });
            let space_before = pp
                .and_then(|p| p.first("a:spcbef"))
                .and_then(|s| s.first("a:spcpts"))
                .and_then(|s| emu(s.attr("val")))
                .map_or(0.0, |v| v / 100.0);
            let mut paragraph = layout_paragraph(&runs, width - margin.max(0.0), wrap, empty_size);
            if let (Some(first), Some(bullet)) = (paragraph.first_mut(), bullet.filter(|_| has_text)) {
                first.bullet = Some((bullet, (margin + indent).max(0.0), base.clone()));
            }
            if let Some(first) = paragraph.first_mut() {
                first.space_before = space_before;
            }
            for line in &mut paragraph {
                line.align.clone_from(&align);
                line.margin = margin.max(0.0);
            }
            lines.extend(paragraph);
            if lines.len() > MAX_LINES {
                lines.truncate(MAX_LINES);
                break;
            }
        }
        if lines.iter().all(|l| l.runs.iter().all(|(t, _)| t.trim().is_empty())) {
            return;
        }
        let total: f64 = lines.iter().map(|l| l.height + l.space_before).sum();
        let mut y = match anchor.as_str() {
            "ctr" => r.y + top + ((r.h - top - bottom) - total) / 2.0,
            "b" => r.y + r.h - bottom - total,
            _ => r.y + top,
        };
        let rot = rotation(xfrm);
        let _ = write!(
            self.body,
            "<g{}>",
            if rot.is_empty() {
                String::new()
            } else {
                format!(r#" transform="{}""#, rot.trim_end())
            }
        );
        for line in &lines {
            y += line.space_before;
            let baseline = y + line.height * 0.8;
            if let Some((bullet, at, style)) = &line.bullet {
                let _ = write!(
                    self.body,
                    r#"<text x="{}" y="{}"{}>{}</text>"#,
                    num(r.x + left + at),
                    num(baseline),
                    style.attrs(),
                    esc(bullet)
                );
            }
            let (x, anchor_attr) = match line.align.as_str() {
                "ctr" => (
                    r.x + left + line.margin + (width - line.margin) / 2.0,
                    r#" text-anchor="middle""#,
                ),
                "r" => (r.x + r.w - right, r#" text-anchor="end""#),
                _ => (r.x + left + line.margin, ""),
            };
            if line.runs.iter().any(|(t, _)| !t.is_empty()) {
                let _ = write!(
                    self.body,
                    r#"<text x="{}" y="{}"{anchor_attr} xml:space="preserve">"#,
                    num(x),
                    num(baseline)
                );
                for (text, style) in &line.runs {
                    let _ = write!(self.body, "<tspan{}>{}</tspan>", style.attrs(), esc(text));
                }
                self.body.push_str("</text>");
            }
            y += line.height;
        }
        self.body.push_str("</g>");
    }

    fn run_style(&self, props: Option<&Element>, base: &RunStyle, scale: f64) -> RunStyle {
        let mut style = base.clone();
        let Some(p) = props else { return style };
        if let Some(size) = emu(p.attr("sz")) {
            style.size = (size / 100.0 * scale).clamp(1.0, 400.0);
        }
        if let Some(b) = p.attr("b") {
            style.bold = truthy(b);
        }
        style.italic = p.attr("i").is_some_and(truthy);
        style.underline = p.attr("u").is_some_and(|u| u != "none");
        style.strike = p.attr("strike").is_some_and(|s| s != "noStrike");
        if let Some(color) = p.first("a:solidfill").and_then(|f| self.ctx.color_of(f, None)) {
            style.color = color;
        }
        if let Some(font) = p
            .first("a:latin")
            .and_then(|l| l.attr("typeface"))
            .and_then(|t| self.typeface(t))
        {
            style.font = Some(font);
        }
        style
    }
}

fn tinted(color: Rgba, amount: f64) -> Rgba {
    let mix = |x: f64| x * amount + 255.0 * (1.0 - amount);
    Rgba {
        r: mix(color.r),
        g: mix(color.g),
        b: mix(color.b),
        a: 1.0,
    }
}

fn target_missing(fill: Option<&Element>) -> bool {
    fill.and_then(|f| f.first("a:blip")).is_some()
}

fn has_fill(props: &Element) -> bool {
    props.kids().any(|k| {
        matches!(
            k.name.as_str(),
            "a:nofill" | "a:solidfill" | "a:gradfill" | "a:blipfill" | "a:pattfill" | "a:grpfill"
        )
    })
}

fn stroke_attrs(line: &Line) -> String {
    let mut out = format!(r#" stroke="{}" stroke-width="{}""#, line.color.css(), num(line.width));
    if let Some(o) = line.color.opacity() {
        let _ = write!(out, r#" stroke-opacity="{o}""#);
    }
    if let Some(dash) = line.dash {
        let scaled: Vec<String> = dash
            .split(' ')
            .filter_map(|d| d.parse::<f64>().ok())
            .map(|d| num(d * line.width.max(0.75)))
            .collect();
        let _ = write!(out, r#" stroke-dasharray="{}""#, scaled.join(" "));
    }
    out
}

/// The rotation of a shape about its middle, as an SVG transform with a trailing space, or nothing.
fn rotation(xfrm: &Xfrm) -> String {
    if xfrm.rot.abs() < 0.001 {
        return String::new();
    }
    let r = xfrm.rect;
    format!(
        "rotate({} {} {}) ",
        num(xfrm.rot),
        num(r.x + r.w / 2.0),
        num(r.y + r.h / 2.0)
    )
}

/// The ` transform="…"` attribute of a shape's outline: its rotation and flips, or nothing.
fn shape_transform(xfrm: &Xfrm) -> String {
    let mut t = rotation(xfrm);
    if xfrm.flip_h || xfrm.flip_v {
        let r = xfrm.rect;
        let (cx, cy) = (r.x + r.w / 2.0, r.y + r.h / 2.0);
        let _ = write!(
            t,
            "translate({} {}) scale({} {}) translate({} {})",
            num(cx),
            num(cy),
            if xfrm.flip_h { -1 } else { 1 },
            if xfrm.flip_v { -1 } else { 1 },
            num(-cx),
            num(-cy)
        );
    }
    let t = t.trim_end();
    if t.is_empty() {
        String::new()
    } else {
        format!(r#" transform="{t}""#)
    }
}

/// The SVG path of a shape's outline in `r`, and whether it is the shape's own outline (or a rectangle for one
/// OpenNote does not draw).
fn geometry_path(geometry: Option<&Element>, r: Rect) -> (String, bool) {
    let Some(g) = geometry else {
        return (rect_path(r), true);
    };
    if g.name == "a:custgeom" {
        return custom_path(g, r).map_or_else(|| (rect_path(r), false), |p| (p, true));
    }
    let adj = |name: &str, default: f64| {
        g.first("a:avlst")
            .and_then(|l| l.elements("a:gd").find(|gd| gd.attr("name") == Some(name)))
            .and_then(|gd| gd.attr("fmla"))
            .and_then(|f| f.strip_prefix("val "))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map_or(default, |v| v / 100_000.0)
    };
    let (x, y, w, h) = (r.x, r.y, r.w, r.h);
    let ss = w.min(h);
    let poly = |points: &[(f64, f64)]| {
        let mut d = String::new();
        for (i, (px, py)) in points.iter().enumerate() {
            let _ = write!(
                d,
                "{}{} {}",
                if i == 0 { "M" } else { "L" },
                num(x + px * w),
                num(y + py * h)
            );
        }
        d.push('Z');
        d
    };
    let prst = g.attr("prst").unwrap_or("rect");
    let path = match prst {
        "rect" | "flowChartProcess" | "snip1Rect" => rect_path(r),
        "roundRect" | "flowChartAlternateProcess" => {
            let rad = (adj("adj", 0.16667) * ss).min(w / 2.0).min(h / 2.0);
            format!(
                "M{} {}H{}A{r} {r} 0 0 1 {} {}V{}A{r} {r} 0 0 1 {} {}H{}A{r} {r} 0 0 1 {} {}V{}A{r} {r} 0 0 1 {} {}Z",
                num(x + rad),
                num(y),
                num(x + w - rad),
                num(x + w),
                num(y + rad),
                num(y + h - rad),
                num(x + w - rad),
                num(y + h),
                num(x + rad),
                num(x),
                num(y + h - rad),
                num(y + rad),
                num(x + rad),
                num(y),
                r = num(rad)
            )
        }
        "ellipse" | "flowChartConnector" => format!(
            "M{} {}A{} {} 0 1 0 {} {}A{} {} 0 1 0 {} {}Z",
            num(x),
            num(y + h / 2.0),
            num(w / 2.0),
            num(h / 2.0),
            num(x + w),
            num(y + h / 2.0),
            num(w / 2.0),
            num(h / 2.0),
            num(x),
            num(y + h / 2.0)
        ),
        "triangle" | "flowChartExtract" => {
            let apex = adj("adj", 0.5);
            poly(&[(apex, 0.0), (1.0, 1.0), (0.0, 1.0)])
        }
        "rtTriangle" => poly(&[(0.0, 0.0), (1.0, 1.0), (0.0, 1.0)]),
        "diamond" | "flowChartDecision" => poly(&[(0.5, 0.0), (1.0, 0.5), (0.5, 1.0), (0.0, 0.5)]),
        "parallelogram" | "flowChartInputOutput" => {
            let a = (adj("adj", 0.25) * ss / w).min(1.0);
            poly(&[(a, 0.0), (1.0, 0.0), (1.0 - a, 1.0), (0.0, 1.0)])
        }
        "trapezoid" => {
            let a = (adj("adj", 0.25) * ss / w).min(0.5);
            poly(&[(a, 0.0), (1.0 - a, 0.0), (1.0, 1.0), (0.0, 1.0)])
        }
        "homePlate" => {
            let a = (adj("adj", 0.5) * ss / w).min(1.0);
            poly(&[(0.0, 0.0), (1.0 - a, 0.0), (1.0, 0.5), (1.0 - a, 1.0), (0.0, 1.0)])
        }
        "pentagon" => poly(&[(0.5, 0.0), (1.0, 0.38), (0.81, 1.0), (0.19, 1.0), (0.0, 0.38)]),
        "hexagon" => {
            let a = (adj("adj", 0.25) * ss / w).min(0.5);
            poly(&[
                (a, 0.0),
                (1.0 - a, 0.0),
                (1.0, 0.5),
                (1.0 - a, 1.0),
                (a, 1.0),
                (0.0, 0.5),
            ])
        }
        "octagon" => {
            let a = adj("adj", 0.29289) * ss;
            let (ax, ay) = (a / w, a / h);
            poly(&[
                (ax, 0.0),
                (1.0 - ax, 0.0),
                (1.0, ay),
                (1.0, 1.0 - ay),
                (1.0 - ax, 1.0),
                (ax, 1.0),
                (0.0, 1.0 - ay),
                (0.0, ay),
            ])
        }
        "chevron" => {
            let a = (adj("adj", 0.5) * ss / w).min(1.0);
            poly(&[
                (0.0, 0.0),
                (1.0 - a, 0.0),
                (1.0, 0.5),
                (1.0 - a, 1.0),
                (0.0, 1.0),
                (a, 0.5),
            ])
        }
        "rightArrow" | "leftArrow" => {
            let shaft = adj("adj1", 0.5);
            let head = (adj("adj2", 0.5) * ss / w).min(1.0);
            let (t, b) = (0.5 - shaft / 2.0, 0.5 + shaft / 2.0);
            let pts = [
                (0.0, t),
                (1.0 - head, t),
                (1.0 - head, 0.0),
                (1.0, 0.5),
                (1.0 - head, 1.0),
                (1.0 - head, b),
                (0.0, b),
            ];
            if prst == "leftArrow" {
                poly(&pts.map(|(px, py)| (1.0 - px, py)))
            } else {
                poly(&pts)
            }
        }
        "upArrow" | "downArrow" => {
            let shaft = adj("adj1", 0.5);
            let head = (adj("adj2", 0.5) * ss / h).min(1.0);
            let (l, rr) = (0.5 - shaft / 2.0, 0.5 + shaft / 2.0);
            let pts = [
                (l, 1.0),
                (l, head),
                (0.0, head),
                (0.5, 0.0),
                (1.0, head),
                (rr, head),
                (rr, 1.0),
            ];
            if prst == "downArrow" {
                poly(&pts.map(|(px, py)| (px, 1.0 - py)))
            } else {
                poly(&pts)
            }
        }
        "plus" | "mathPlus" => {
            let a = (adj("adj", 0.25) * ss).min(w / 2.0).min(h / 2.0);
            let (ax, ay) = (a / w, a / h);
            poly(&[
                (ax, 0.0),
                (1.0 - ax, 0.0),
                (1.0 - ax, ay),
                (1.0, ay),
                (1.0, 1.0 - ay),
                (1.0 - ax, 1.0 - ay),
                (1.0 - ax, 1.0),
                (ax, 1.0),
                (ax, 1.0 - ay),
                (0.0, 1.0 - ay),
                (0.0, ay),
                (ax, ay),
            ])
        }
        "star5" => {
            let mut pts = Vec::new();
            for i in 0..10 {
                let angle = std::f64::consts::PI * (i as f64) / 5.0 - std::f64::consts::FRAC_PI_2;
                let radius = if i % 2 == 0 { 0.5 } else { 0.19 };
                pts.push((0.5 + radius * angle.cos(), 0.5 + radius * angle.sin()));
            }
            poly(&pts)
        }
        "line" | "straightConnector1" | "bentConnector2" | "bentConnector3" | "curvedConnector3" => {
            format!("M{} {}L{} {}", num(x), num(y), num(x + w), num(y + h))
        }
        _ => return (rect_path(r), false),
    };
    (path, true)
}

fn rect_path(r: Rect) -> String {
    format!(
        "M{} {}H{}V{}H{}Z",
        num(r.x),
        num(r.y),
        num(r.x + r.w),
        num(r.y + r.h),
        num(r.x)
    )
}

/// A custom outline's paths, scaled from each path's own size into `r`. Arcs are drawn as straight lines.
fn custom_path(g: &Element, r: Rect) -> Option<String> {
    let list = g.first("a:pathlst")?;
    let mut d = String::new();
    for path in list.elements("a:path").take(64) {
        let pw = emu(path.attr("w")).filter(|v| *v > 0.0).unwrap_or(r.w * EMU_PER_PT);
        let ph = emu(path.attr("h")).filter(|v| *v > 0.0).unwrap_or(r.h * EMU_PER_PT);
        let point = |p: &Element| -> Option<(f64, f64)> {
            Some((r.x + emu(p.attr("x"))? / pw * r.w, r.y + emu(p.attr("y"))? / ph * r.h))
        };
        for cmd in path.kids().take(4_000) {
            let pts: Vec<(f64, f64)> = cmd.elements("a:pt").filter_map(point).collect();
            match (cmd.name.as_str(), pts.as_slice()) {
                ("a:moveto", [p, ..]) => {
                    let _ = write!(d, "M{} {}", num(p.0), num(p.1));
                }
                ("a:lnto", [p, ..]) => {
                    let _ = write!(d, "L{} {}", num(p.0), num(p.1));
                }
                ("a:cubicbezto", [a, b, c, ..]) => {
                    let _ = write!(
                        d,
                        "C{} {} {} {} {} {}",
                        num(a.0),
                        num(a.1),
                        num(b.0),
                        num(b.1),
                        num(c.0),
                        num(c.1)
                    );
                }
                ("a:quadbezto", [a, b, ..]) => {
                    let _ = write!(d, "Q{} {} {} {}", num(a.0), num(a.1), num(b.0), num(b.1));
                }
                ("a:close", _) => d.push('Z'),
                _ => {}
            }
        }
    }
    (!d.is_empty() && d.starts_with('M')).then_some(d)
}

/// A placeholder's type, such as `title` or `body`, and its index.
#[derive(Clone, Debug, PartialEq)]
struct Placeholder {
    kind: String,
    idx: Option<String>,
}

fn placeholder_of(shape: &Element) -> Option<Placeholder> {
    let nv = shape.kids().find(|k| k.name.starts_with("p:nv"))?;
    let ph = nv.first("p:nvpr")?.first("p:ph")?;
    Some(Placeholder {
        kind: ph.attr("type").unwrap_or("body").to_owned(),
        idx: ph.attr("idx").map(str::to_owned),
    })
}

/// Placeholder types that stand in for each other: a centered title takes a title's place.
fn same_family(a: &str, b: &str) -> bool {
    fn family(k: &str) -> &str {
        match k {
            "title" | "ctrTitle" => "title",
            "body" | "obj" | "subTitle" => "body",
            other => other,
        }
    }
    family(a) == family(b)
}

fn flatten<'a>(tree: &'a Element, out: &mut Vec<&'a Element>, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }
    for child in tree.kids() {
        match child.name.as_str() {
            "p:grpsp" => flatten(child, out, depth + 1),
            "p:sp" | "p:pic" => out.push(child),
            _ => {}
        }
    }
}

/// The look of a run of text.
#[derive(Clone, Debug)]
struct RunStyle {
    size: f64,
    color: Rgba,
    font: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
}

impl RunStyle {
    fn attrs(&self) -> String {
        let family = match &self.font {
            Some(font) => format!("{font}, Segoe UI, Arial, sans-serif"),
            None => "Segoe UI, Arial, sans-serif".to_owned(),
        };
        let mut out = format!(
            r#" font-family="{}" font-size="{}" fill="{}""#,
            esc(&family),
            num(self.size),
            self.color.css()
        );
        if let Some(o) = self.color.opacity() {
            let _ = write!(out, r#" fill-opacity="{o}""#);
        }
        if self.bold {
            out.push_str(r#" font-weight="bold""#);
        }
        if self.italic {
            out.push_str(r#" font-style="italic""#);
        }
        match (self.underline, self.strike) {
            (true, true) => out.push_str(r#" text-decoration="underline line-through""#),
            (true, false) => out.push_str(r#" text-decoration="underline""#),
            (false, true) => out.push_str(r#" text-decoration="line-through""#),
            (false, false) => {}
        }
        out
    }

    /// The width of a character, guessed from the font size: wide for CJK, narrow for spaces.
    fn advance(&self, c: char) -> f64 {
        let ratio = if c == ' ' {
            0.28
        } else if is_wide(c) {
            1.0
        } else if c.is_uppercase() {
            0.62
        } else if matches!(
            c,
            'i' | 'l' | 'j' | 't' | 'f' | 'r' | '.' | ',' | ';' | ':' | '\'' | '!' | '|'
        ) {
            0.3
        } else if matches!(c, 'm' | 'w') {
            0.78
        } else {
            0.5
        };
        self.size * ratio * if self.bold { 1.06 } else { 1.0 }
    }
}

fn is_wide(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x115F | 0x2E80..=0xA4CF | 0xAC00..=0xD7A3 | 0xF900..=0xFAFF | 0xFF00..=0xFF60 | 0xFFE0..=0xFFE6)
}

/// One line of laid-out text.
#[derive(Clone, Debug, Default)]
struct TextLine {
    runs: Vec<(String, RunStyle)>,
    height: f64,
    align: String,
    margin: f64,
    space_before: f64,
    bullet: Option<(String, f64, RunStyle)>,
}

/// Breaks a paragraph's runs into lines no wider than `width`, between words where it can.
fn layout_paragraph(runs: &[(String, RunStyle)], width: f64, wrap: bool, empty_size: f64) -> Vec<TextLine> {
    let mut lines = Vec::new();
    let mut line = TextLine::default();
    let mut used = 0.0;
    let mut tallest: f64 = 0.0;
    let finish = |line: &mut TextLine, tallest: &mut f64, lines: &mut Vec<TextLine>| {
        let size = if *tallest > 0.0 { *tallest } else { empty_size };
        line.height = size * 1.2;
        lines.push(std::mem::take(line));
        *tallest = 0.0;
    };
    for (text, style) in runs {
        if text == "\n" {
            finish(&mut line, &mut tallest, &mut lines);
            used = 0.0;
            continue;
        }
        // Words keep the space after them, so a line can break after any of them.
        let mut words: Vec<String> = Vec::new();
        let mut current = String::new();
        for c in text.chars() {
            current.push(c);
            if c == ' ' || is_wide(c) {
                words.push(std::mem::take(&mut current));
            }
        }
        if !current.is_empty() {
            words.push(current);
        }
        for word in words {
            let w: f64 = word.chars().map(|c| style.advance(c)).sum();
            let ink = word.trim_end();
            let ink_w: f64 = ink.chars().map(|c| style.advance(c)).sum();
            if wrap && used > 0.0 && used + ink_w > width {
                finish(&mut line, &mut tallest, &mut lines);
                used = 0.0;
                if lines.len() >= MAX_LINES {
                    return lines;
                }
            }
            tallest = tallest.max(style.size);
            used += w;
            match line.runs.last_mut() {
                Some((t, s)) if same_style(s, style) => t.push_str(&word),
                _ => line.runs.push((word, style.clone())),
            }
        }
    }
    finish(&mut line, &mut tallest, &mut lines);
    for line in &mut lines {
        if let Some((t, _)) = line.runs.last_mut() {
            let trimmed = t.trim_end().len();
            t.truncate(trimmed);
        }
    }
    lines
}

fn same_style(a: &RunStyle, b: &RunStyle) -> bool {
    (a.size - b.size).abs() < f64::EPSILON
        && a.color == b.color
        && a.font == b.font
        && a.bold == b.bold
        && a.italic == b.italic
        && a.underline == b.underline
        && a.strike == b.strike
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
        "They are missing, too large, or in a format screens can't show, such as EMF.",
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

#[cfg(test)]
mod tests {
    //! Golden-image tests: three fixture decks are drawn and compared with the SVG files in
    //! `tests/data/slides`. Set `OPENNOTE_UPDATE_GOLDEN=1` to write the files again after a deliberate change, and
    //! look at them in a browser before committing.

    use std::io::Cursor;
    use std::path::PathBuf;

    use super::*;
    use crate::testing::{assert_well_formed_xml, png_bytes, zip_bytes};

    const NS: &str = r#"xmlns:a="a" xmlns:p="p" xmlns:r="r""#;

    fn theme() -> String {
        r#"<a:theme xmlns:a="a"><a:themeElements>
          <a:clrScheme name="Fixture">
            <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
            <a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
            <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
            <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
            <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
          </a:clrScheme>
          <a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
            <a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
          <a:fmtScheme name="Fixture"><a:fillStyleLst/>
            <a:lnStyleLst><a:ln w="6350"/><a:ln w="12700"/><a:ln w="19050"/></a:lnStyleLst>
            <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
        </a:themeElements></a:theme>"#
            .to_owned()
    }

    fn master() -> String {
        format!(
            r#"<p:sldMaster {NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
              <p:sp><p:nvSpPr><p:cNvPr id="2" name="Bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="228600"/></a:xfrm><a:prstGeom prst="rect"/>
                <a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>
              <p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
                <p:txBody><a:bodyPr anchor="b"/><a:p><a:r><a:t>Master title</a:t></a:r></a:p></p:txBody></p:sp>
              <p:sp><p:nvSpPr><p:cNvPr id="4" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr>
                <p:txBody><a:bodyPr/><a:p><a:r><a:t>Master text</a:t></a:r></a:p></p:txBody></p:sp>
            </p:spTree></p:cSld>
            <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
            <p:txStyles>
              <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
              <p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buChar char="&#8226;"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
                <a:lvl2pPr marL="685800" indent="-228600"><a:buChar char="&#8211;"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle>
              <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
            </p:txStyles></p:sldMaster>"#
        )
    }

    fn layout() -> String {
        format!(
            r#"<p:sldLayout {NS}><p:cSld><p:spTree>
              <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
                <p:txBody><a:bodyPr/><a:p><a:r><a:t>Layout title</a:t></a:r></a:p></p:txBody></p:sp>
              <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
            </p:spTree></p:cSld></p:sldLayout>"#
        )
    }

    const SHAPES: &str = r#"<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
        <p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Shapes &amp; lines</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="Oval"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="1828800" cy="1371600"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
        <a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="4" name="Card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm rot="900000"><a:off x="3657600" y="2286000"/><a:ext cx="2286000" cy="1371600"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>
        <a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent5"><a:alpha val="50000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:spPr>
        <p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>Turned card</a:t></a:r></a:p></p:txBody></p:sp>
      <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Arrow"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
        <p:spPr><a:xfrm flipV="1"><a:off x="6400800" y="2286000"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="straightConnector1"/>
        <a:ln w="19050"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm><a:off x="914400" y="4572000"/><a:ext cx="3657600" cy="1371600"/><a:chOff x="0" y="0"/><a:chExt cx="7315200" cy="2743200"/></a:xfrm></p:grpSpPr>
        <p:sp><p:nvSpPr><p:cNvPr id="7" name="Tri"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="2743200"/></a:xfrm><a:prstGeom prst="triangle"/></p:spPr>
          <p:style><a:lnRef idx="2"><a:schemeClr val="accent6"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent6"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent6"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="8" name="Free"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm flipH="1"><a:off x="3657600" y="0"/><a:ext cx="3657600" cy="2743200"/></a:xfrm>
          <a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="40" y="0"/></a:lnTo>
            <a:cubicBezTo><a:pt x="60" y="0"/><a:pt x="100" y="40"/><a:pt x="100" y="100"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>
          <a:solidFill><a:srgbClr val="FFC000"/></a:solidFill></p:spPr></p:sp>
      </p:grpSp>
      <p:sp><p:nvSpPr><p:cNvPr id="9" name="Cloud"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="6400800" y="4114800"/><a:ext cx="2286000" cy="1600200"/></a:xfrm><a:prstGeom prst="cloud"/>
        <a:solidFill><a:srgbClr val="A5A5A5"/></a:solidFill><a:effectLst><a:outerShdw blurRad="40000"/></a:effectLst></p:spPr></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="10" name="Hidden" hidden="1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sld>"#;

    const TEXT: &str = r#"<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
        <p:txBody><a:bodyPr/><a:p><a:r><a:t>Reading the cell</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="5181600" cy="4351338"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr><a:normAutofit fontScale="92500"/></a:bodyPr>
          <a:p><a:r><a:t>The membrane lets some things through and keeps others out, which is why it is called selectively permeable.</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:rPr b="1"/><a:t>Bold</a:t></a:r><a:r><a:t>, </a:t></a:r><a:r><a:rPr i="1"/><a:t>italic</a:t></a:r><a:r><a:t>, and </a:t></a:r><a:r><a:rPr u="sng"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:rPr><a:t>red underline</a:t></a:r></a:p>
          <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1400" strike="sngStrike"/><a:t>No bullet, struck</a:t></a:r><a:br/><a:r><a:rPr sz="1400"/><a:t>after a break</a:t></a:r></a:p>
          <a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>First</a:t></a:r></a:p>
          <a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Second</a:t></a:r></a:p>
        </p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="4" name="Note"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="6400800" y="5943600"/><a:ext cx="4572000" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr wrap="none" anchor="b"/><a:p><a:pPr algn="r"/><a:r><a:rPr sz="1200"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="Georgia&quot; onload=&quot;x"/></a:rPr><a:t>Source: lab notes &lt;2024&gt;</a:t></a:r></a:p></p:txBody></p:sp>
      <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="6400800" y="1825625"/><a:ext cx="4572000" cy="1828800"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>
          <a:tblGrid><a:gridCol w="2286000"/><a:gridCol w="2286000"/></a:tblGrid>
          <a:tr h="609600"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Part</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Job</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
          <a:tr h="609600"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Nucleus</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Keeps DNA</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
          <a:tr h="609600"><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>Both columns</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="FFF2CC"/></a:solidFill></a:tcPr></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p><a:endParaRPr/></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
        </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    </p:spTree></p:cSld></p:sld>"#;

    const PICTURES: &str = r#"<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r" xmlns:mc="mc" showMasterSp="0"><p:cSld>
      <p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="DEEBF7"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:bgPr></p:bg>
      <p:spTree>
      <p:pic><p:nvPicPr><p:cNvPr id="2" name="Leaf" descr="A leaf"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdPng"/><a:srcRect l="10000" t="10000" r="10000" b="10000"/><a:stretch/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="2743200" cy="2743200"/></a:xfrm><a:prstGeom prst="ellipse"/>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="70AD47"/></a:solidFill></a:ln></p:spPr></p:pic>
      <p:pic><p:nvPicPr><p:cNvPr id="3" name="Again"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdPng"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="4114800" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>
      <p:pic><p:nvPicPr><p:cNvPr id="4" name="Metafile"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdEmf"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="5486400" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>
      <p:pic><p:nvPicPr><p:cNvPr id="5" name="Video"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rIdVideo"/></p:nvPr></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdPng"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="6858000" y="914400"/><a:ext cx="1828800" cy="1371600"/></a:xfrm></p:spPr></p:pic>
      <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="914400" y="4114800"/><a:ext cx="3657600" cy="2286000"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="c" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>
      <mc:AlternateContent><mc:Choice Requires="p14"><p:sp><p:nvSpPr><p:cNvPr id="7" name="New"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr></p:sp></mc:Choice>
        <mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="8" name="Old"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="5486400" y="4114800"/><a:ext cx="2743200" cy="1371600"/></a:xfrm><a:prstGeom prst="rightArrow"/><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill></p:spPr></p:sp></mc:Fallback></mc:AlternateContent>
    </p:spTree></p:cSld></p:sld>"#;

    const PICTURE_RELS: &str = r#"<Relationships>
      <Relationship Id="rIdLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rIdPng" Target="../media/leaf.png"/>
      <Relationship Id="rIdEmf" Target="../media/logo.emf"/>
      <Relationship Id="rIdVideo" Target="https://example.invalid/clip.mp4" TargetMode="External"/>
      <Relationship Id="rIdChart" Target="../charts/chart1.xml"/></Relationships>"#;

    const LAYOUT_ONLY: &str =
        r#"<Relationships><Relationship Id="rIdLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#;

    fn deck(slide: &str, slide_rels: &str) -> Parts<Cursor<Vec<u8>>> {
        let presentation = format!(
            r#"<p:presentation {NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>"#
        );
        let master_rels = r#"<Relationships><Relationship Id="rId1" Target="../theme/theme1.xml"/></Relationships>"#;
        let layout_rels =
            r#"<Relationships><Relationship Id="rId1" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#;
        let (master, layout, theme) = (master(), layout(), theme());
        let png = png_bytes();
        let bytes = zip_bytes(&[
            ("ppt/presentation.xml", presentation.as_bytes()),
            ("ppt/slides/slide1.xml", slide.as_bytes()),
            ("ppt/slides/_rels/slide1.xml.rels", slide_rels.as_bytes()),
            ("ppt/slideLayouts/slideLayout1.xml", layout.as_bytes()),
            ("ppt/slideLayouts/_rels/slideLayout1.xml.rels", layout_rels.as_bytes()),
            ("ppt/slideMasters/slideMaster1.xml", master.as_bytes()),
            ("ppt/slideMasters/_rels/slideMaster1.xml.rels", master_rels.as_bytes()),
            ("ppt/theme/theme1.xml", theme.as_bytes()),
            ("ppt/media/leaf.png", &png),
            ("ppt/media/logo.emf", b"\x01\x00\x00\x00 not drawn"),
        ]);
        Parts::from_reader(Cursor::new(bytes)).expect("opens")
    }

    fn draw(slide: &str, rels: &str) -> Drawn {
        let mut parts = deck(slide, rels);
        let presentation = parts.xml("ppt/presentation.xml").expect("reads").expect("there");
        let slide = parts.xml("ppt/slides/slide1.xml").expect("reads").expect("there");
        let rels = parts
            .xml("ppt/slides/_rels/slide1.xml.rels")
            .expect("reads")
            .map(|r| read_rels(&r))
            .unwrap_or_default();
        SlideDrawer::new(&presentation).draw(&mut parts, &slide, &rels, "ppt/slides")
    }

    /// Compares a drawing with its golden file, or writes the file when asked to.
    fn golden(name: &str, drawn: &Drawn) {
        assert_well_formed_xml(&drawn.svg);
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("tests/data/slides/{name}.svg"));
        // The golden file is the drawing with one element to a line, so a change reads well in a diff.
        let pretty = drawn.svg.replace("><", ">\n<") + "\n";
        if std::env::var_os("OPENNOTE_UPDATE_GOLDEN").is_some() {
            std::fs::create_dir_all(path.parent().expect("a folder")).expect("makes the folder");
            std::fs::write(&path, &pretty).expect("writes the golden file");
            return;
        }
        let expected = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("{} is missing; run with OPENNOTE_UPDATE_GOLDEN=1", path.display()))
            .replace("\r\n", "\n");
        assert!(expected == pretty, "{name} no longer matches {}", path.display());
    }

    #[test]
    fn a_slide_of_shapes_matches_its_golden_image() {
        let drawn = draw(SHAPES, LAYOUT_ONLY);
        golden("shapes", &drawn);
        assert!((drawn.height - 405.0).abs() < 0.01);
        assert!(drawn.svg.contains(r##"fill="#4472c4""##), "the master's bar");
        assert!(drawn.svg.contains("Shapes &amp; lines"));
        assert!(!drawn.svg.contains("#ff0000"), "a hidden shape is not drawn");
        assert_eq!(
            drawn.missed,
            Missed {
                geometry: 1,
                effects: 1,
                ..Missed::default()
            }
        );
    }

    #[test]
    fn a_slide_of_text_and_a_table_matches_its_golden_image() {
        let drawn = draw(TEXT, LAYOUT_ONLY);
        golden("text", &drawn);
        assert!(drawn.svg.contains(">1.<"), "numbered paragraphs");
        assert!(drawn.svg.contains('\u{2022}'), "the master's bullet");
        assert!(drawn.svg.contains("Source: lab notes &lt;2024&gt;"));
        assert!(!drawn.svg.contains("onload="), "a font name can't add an attribute");
        assert_eq!(drawn.missed, Missed::default());
    }

    #[test]
    fn a_slide_of_pictures_matches_its_golden_image_and_lists_what_it_left_out() {
        let drawn = draw(PICTURES, PICTURE_RELS);
        golden("pictures", &drawn);
        assert_eq!(
            drawn.svg.matches("data:image/png;base64,").count(),
            1,
            "a picture is kept once"
        );
        assert!(
            !drawn.svg.contains("example.invalid"),
            "nothing outside the file is linked"
        );
        assert!(
            !drawn.svg.contains(r##"fill="#4472c4""##),
            "the master's shapes are hidden on this slide"
        );
        assert_eq!(
            drawn.missed,
            Missed {
                charts: 1,
                media: 1,
                pictures: 1,
                ..Missed::default()
            }
        );
    }

    #[test]
    fn hostile_slides_stay_within_their_limits() {
        let mut deep = String::new();
        for _ in 0..100 {
            deep.push_str("<p:grpSp><p:grpSpPr/>");
        }
        for _ in 0..100 {
            deep.push_str("</p:grpSp>");
        }
        let mut many = String::new();
        for i in 0..6_000 {
            let _ = write!(
                many,
                r#"<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="s"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9" cy="9"/></a:xfrm><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:spPr></p:sp>"#
            );
        }
        let slide = format!(r#"<p:sld {NS}><p:cSld><p:spTree>{deep}{many}</p:spTree></p:cSld></p:sld>"#);
        let drawn = draw(&slide, LAYOUT_ONLY);
        assert_well_formed_xml(&drawn.svg);
        assert!(drawn.missed.limits > 0);
        assert!(drawn.svg.matches("#00ff00").count() <= MAX_SHAPES);
    }

    #[test]
    fn colors_and_names_are_read_as_powerpoint_reads_them() {
        let blue = Rgba::hex("4472C4").expect("a color");
        let (h, s, l) = blue.to_hsl();
        assert_eq!(Rgba::from_hsl(h, s, l * 0.75, 1.0).css(), "#2f5597");
        assert_eq!(Rgba::hex("zz0000"), None);
        assert_eq!(num(1.004), "1");
        assert_eq!(num(-0.001), "0");
        assert_eq!(font_name("Georgia\" onload=\"x"), Some("Georgia onloadx".to_owned()));
    }
}
