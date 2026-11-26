//! Run and paragraph properties of a Word file, read from `w:rPr` and `w:pPr`, and layered in the order of
//! ECMA-376 Part 1, 17.7.2: document defaults, table style, paragraph style, character style, then direct
//! formatting. Toggle properties follow 17.7.3.

use super::styles::{child, children, val};
use crate::import::xmltree::Element;

/// A font slot: a font name, or a theme font such as `minorHAnsi`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum FontRef {
    Name(String),
    Theme(String),
}

/// The four font slots of `w:rFonts`. Each slot layers on its own.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Fonts {
    pub ascii: Option<FontRef>,
    pub h_ansi: Option<FontRef>,
    pub east_asia: Option<FontRef>,
    pub cs: Option<FontRef>,
}

/// A color as written: `auto`, an RGB value, or a theme color with a tint or shade.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ColorRef {
    /// Six hex digits, or `None` for `auto`.
    pub rgb: Option<String>,
    /// A theme color name such as `accent1`.
    pub theme: Option<String>,
    /// `w:themeTint`, 0 to 255.
    pub tint: Option<u8>,
    /// `w:themeShade`, 0 to 255.
    pub shade: Option<u8>,
}

/// The toggle properties of 17.7.3, by index into [`RunProps::toggles`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Toggle {
    Bold = 0,
    Italic,
    Caps,
    SmallCaps,
    Strike,
    DStrike,
    Vanish,
    Emboss,
    Imprint,
    Outline,
    Shadow,
}

/// The element names of the toggles, in [`Toggle`] order.
const TOGGLE_NAMES: [&str; 11] = [
    "w:b",
    "w:i",
    "w:caps",
    "w:smallcaps",
    "w:strike",
    "w:dstrike",
    "w:vanish",
    "w:emboss",
    "w:imprint",
    "w:outline",
    "w:shadow",
];

/// Effects that OpenNote cannot show: glow, reflection, 3-D, and gradient or picture fills of text.
pub(super) const EFFECT_GLOW: u8 = 1;
pub(super) const EFFECT_REFLECTION: u8 = 2;
pub(super) const EFFECT_3D: u8 = 4;
pub(super) const EFFECT_FILL: u8 = 8;

/// The run properties of one layer. `None` means the layer does not set the property.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct RunProps {
    pub toggles: [Option<bool>; 11],
    /// The underline style (`single`, `double`, ..., or `none`) and its color.
    pub underline: Option<(String, Option<ColorRef>)>,
    pub color: Option<ColorRef>,
    /// An `ST_HighlightColor` name, or `none`.
    pub highlight: Option<String>,
    /// The shading fill: six hex digits, or empty for none.
    pub shade: Option<String>,
    pub fonts: Fonts,
    /// Half-points.
    pub size: Option<u32>,
    /// Twentieths of a point.
    pub tracking: Option<i32>,
    /// Percent.
    pub scale: Option<u32>,
    /// Half-points.
    pub shift: Option<i32>,
    /// Half-points.
    pub kern: Option<u32>,
    /// `superscript`, `subscript`, or `baseline`.
    pub script: Option<String>,
    pub lang: Option<String>,
    pub no_proof: Option<bool>,
    pub rtl: Option<bool>,
    /// The box around the text: its style (or `none`) and color.
    pub border: Option<(String, Option<ColorRef>)>,
    pub ligatures: Option<String>,
    pub num_form: Option<String>,
    pub num_spacing: Option<String>,
    pub style_sets: Option<Vec<u32>>,
    /// The character style (`w:rStyle`).
    pub style: Option<String>,
    /// Effects that were dropped: the `EFFECT_*` bits.
    pub effects: u8,
}

/// Whether an on-off property is on. Its `w:val` can switch it off.
pub(super) fn on_off(e: &Element) -> bool {
    !matches!(e.attr("w:val"), Some("0" | "false" | "off" | "none"))
}

fn flag(props: &Element, name: &str) -> Option<bool> {
    child(props, name).map(on_off)
}

fn number<T: std::str::FromStr>(props: &Element, name: &str) -> Option<T> {
    val(props, name).and_then(|v| v.trim().parse().ok())
}

/// A `w:color`-like value of an element: `w:val` or `w:color`, with the theme attributes.
pub(super) fn color_of(e: &Element, attr: &str) -> Option<ColorRef> {
    let rgb = e.attr(attr);
    let theme = e.attr("w:themecolor");
    if rgb.is_none() && theme.is_none() {
        return None;
    }
    let byte = |name: &str| e.attr(name).and_then(|v| u8::from_str_radix(v.trim(), 16).ok());
    Some(ColorRef {
        rgb: rgb
            .filter(|c| c.len() == 6 && c.bytes().all(|b| b.is_ascii_hexdigit()))
            .map(str::to_ascii_lowercase),
        theme: theme.filter(|t| *t != "none").map(str::to_owned),
        tint: byte("w:themetint"),
        shade: byte("w:themeshade"),
    })
}

fn font_slot(fonts: &Element, name: &str, theme: &str) -> Option<FontRef> {
    if let Some(theme) = fonts.attr(theme) {
        return Some(FontRef::Theme(theme.to_owned()));
    }
    fonts
        .attr(name)
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| FontRef::Name(n.to_owned()))
}

impl RunProps {
    /// Reads a `w:rPr` element.
    pub fn read(rpr: &Element) -> RunProps {
        let mut props = RunProps::default();
        for (slot, name) in props.toggles.iter_mut().zip(TOGGLE_NAMES) {
            *slot = flag(rpr, name);
        }
        props.underline = child(rpr, "w:u").map(|u| {
            let style = u.attr("w:val").unwrap_or("single").to_owned();
            (style, color_of(u, "w:color"))
        });
        props.color = child(rpr, "w:color").and_then(|c| color_of(c, "w:val"));
        props.highlight = val(rpr, "w:highlight").map(str::to_owned);
        props.shade = child(rpr, "w:shd").map(|shd| {
            let fill = shd.attr("w:fill").unwrap_or("auto");
            if fill.len() == 6 && fill.bytes().all(|b| b.is_ascii_hexdigit()) {
                fill.to_ascii_lowercase()
            } else {
                String::new()
            }
        });
        if let Some(f) = child(rpr, "w:rfonts") {
            props.fonts = Fonts {
                ascii: font_slot(f, "w:ascii", "w:asciitheme"),
                h_ansi: font_slot(f, "w:hansi", "w:hansitheme"),
                east_asia: font_slot(f, "w:eastasia", "w:eastasiatheme"),
                cs: font_slot(f, "w:cs", "w:cstheme"),
            };
        }
        props.size = number(rpr, "w:sz");
        props.tracking = number(rpr, "w:spacing");
        props.scale = number(rpr, "w:w");
        props.shift = number(rpr, "w:position");
        props.kern = number(rpr, "w:kern");
        props.script = val(rpr, "w:vertalign").map(str::to_owned);
        props.lang = val(rpr, "w:lang").map(str::to_owned);
        props.no_proof = flag(rpr, "w:noproof");
        props.rtl = flag(rpr, "w:rtl");
        props.border = child(rpr, "w:bdr").map(|b| {
            let style = b.attr("w:val").unwrap_or("single").to_owned();
            (style, color_of(b, "w:color"))
        });
        props.ligatures = child(rpr, "w14:ligatures")
            .and_then(|e| e.attr("w14:val"))
            .map(str::to_owned);
        props.num_form = child(rpr, "w14:numform")
            .and_then(|e| e.attr("w14:val"))
            .map(str::to_owned);
        props.num_spacing = child(rpr, "w14:numspacing")
            .and_then(|e| e.attr("w14:val"))
            .map(str::to_owned);
        props.style_sets = child(rpr, "w14:stylisticsets").map(|sets| {
            children(sets, "w14:styleset")
                .filter_map(|s| s.attr("w14:id").and_then(|v| v.parse().ok()))
                .collect()
        });
        props.style = val(rpr, "w:rstyle").map(str::to_owned);
        for (name, bit) in [
            ("w14:glow", EFFECT_GLOW),
            ("w14:reflection", EFFECT_REFLECTION),
            ("w14:props3d", EFFECT_3D),
            ("w14:scene3d", EFFECT_3D),
        ] {
            if child(rpr, name).is_some() {
                props.effects |= bit;
            }
        }
        if child(rpr, "w14:textfill").is_some_and(|f| child(f, "w14:solidfill").is_none()) {
            props.effects |= EFFECT_FILL;
        }
        props
    }

    /// The value of a toggle, off when no layer sets it.
    pub fn toggle(&self, t: Toggle) -> bool {
        self.toggles[t as usize].unwrap_or(false)
    }

    /// Lays `top` over these properties: every property `top` sets wins, toggles too. This is how a style
    /// inherits from the style it is based on, and how direct formatting applies.
    pub fn set_over(&mut self, top: &RunProps) {
        for (slot, value) in self.toggles.iter_mut().zip(top.toggles) {
            if value.is_some() {
                *slot = value;
            }
        }
        self.over_values(top);
    }

    /// Lays a style's properties over these, as 17.7.3 says for styles: a toggle that the style turns on
    /// flips the value so far, and one it turns off leaves it. Other properties win as in [`RunProps::set_over`].
    pub fn toggle_over(&mut self, style: &RunProps) {
        for (slot, value) in self.toggles.iter_mut().zip(style.toggles) {
            if value == Some(true) {
                *slot = Some(!slot.unwrap_or(false));
            }
        }
        self.over_values(style);
    }

    fn over_values(&mut self, top: &RunProps) {
        fn set<T: Clone>(slot: &mut Option<T>, value: &Option<T>) {
            if value.is_some() {
                slot.clone_from(value);
            }
        }
        set(&mut self.underline, &top.underline);
        set(&mut self.color, &top.color);
        set(&mut self.highlight, &top.highlight);
        set(&mut self.shade, &top.shade);
        set(&mut self.fonts.ascii, &top.fonts.ascii);
        set(&mut self.fonts.h_ansi, &top.fonts.h_ansi);
        set(&mut self.fonts.east_asia, &top.fonts.east_asia);
        set(&mut self.fonts.cs, &top.fonts.cs);
        set(&mut self.size, &top.size);
        set(&mut self.tracking, &top.tracking);
        set(&mut self.scale, &top.scale);
        set(&mut self.shift, &top.shift);
        set(&mut self.kern, &top.kern);
        set(&mut self.script, &top.script);
        set(&mut self.lang, &top.lang);
        set(&mut self.no_proof, &top.no_proof);
        set(&mut self.rtl, &top.rtl);
        set(&mut self.border, &top.border);
        set(&mut self.ligatures, &top.ligatures);
        set(&mut self.num_form, &top.num_form);
        set(&mut self.num_spacing, &top.num_spacing);
        set(&mut self.style_sets, &top.style_sets);
        set(&mut self.style, &top.style);
        self.effects |= top.effects;
    }
}

/// Resolves a run's properties in 17.7.2 order. `styles` are the resolved chains of the table style, the
/// paragraph style, and the character style, in that order: each toggles (17.7.3). `direct` sets values.
pub(super) fn resolve(defaults: &RunProps, styles: &[&RunProps], direct: Option<&RunProps>) -> RunProps {
    let mut out = defaults.clone();
    for style in styles {
        out.toggle_over(style);
    }
    if let Some(direct) = direct {
        out.set_over(direct);
    }
    out
}

/// One tab stop as written: position in twips, alignment, and leader.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Tab {
    pub pos: i32,
    pub align: String,
    pub leader: Option<String>,
}

/// One border line of `w:pBdr`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Border {
    pub style: String,
    /// Eighths of a point.
    pub size: Option<u32>,
    /// Points.
    pub space: Option<u32>,
    pub color: Option<ColorRef>,
}

/// Paragraph shading.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Shd {
    pub pattern: String,
    pub fill: Option<String>,
    pub color: Option<ColorRef>,
}

/// The paragraph properties of one layer. `None` means the layer does not set the property.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ParaProps {
    pub jc: Option<String>,
    /// Twips: left (start), right (end), first line, and hanging. Each layers on its own.
    pub ind: [Option<i32>; 4],
    /// Twips: before and after, and whether each is automatic.
    pub before: Option<i32>,
    pub after: Option<i32>,
    pub before_auto: Option<bool>,
    pub after_auto: Option<bool>,
    /// `w:line` and `w:lineRule`.
    pub line: Option<(i32, String)>,
    pub contextual: Option<bool>,
    pub keep_next: Option<bool>,
    pub keep_lines: Option<bool>,
    pub break_before: Option<bool>,
    pub widows: Option<bool>,
    pub tabs: Option<Vec<Tab>>,
    /// Top, bottom, left (start), right (end), and between.
    pub borders: [Option<Border>; 5],
    pub shade: Option<Shd>,
    pub bidi: Option<bool>,
    /// 0-based, as written.
    pub outline: Option<u8>,
    /// Mode, lines, and distance in twips.
    pub drop_cap: Option<(String, Option<u8>, Option<i32>)>,
    pub suppress_hyphens: Option<bool>,
    /// The language of the paragraph mark.
    pub lang: Option<String>,
}

const IND: [(&str, &str); 4] = [
    ("w:left", "w:start"),
    ("w:right", "w:end"),
    ("w:firstline", "w:firstline"),
    ("w:hanging", "w:hanging"),
];

const BORDER_SIDES: [(&str, &str); 5] = [
    ("w:top", "w:top"),
    ("w:bottom", "w:bottom"),
    ("w:left", "w:start"),
    ("w:right", "w:end"),
    ("w:between", "w:between"),
];

impl ParaProps {
    /// Reads a `w:pPr` element.
    pub fn read(ppr: &Element) -> ParaProps {
        let mut props = ParaProps {
            jc: val(ppr, "w:jc").map(str::to_owned),
            ..ParaProps::default()
        };
        if let Some(ind) = child(ppr, "w:ind") {
            for (slot, (a, b)) in props.ind.iter_mut().zip(IND) {
                *slot = ind.attr(a).or_else(|| ind.attr(b)).and_then(|v| v.trim().parse().ok());
            }
        }
        if let Some(sp) = child(ppr, "w:spacing") {
            let twips = |name: &str| sp.attr(name).and_then(|v| v.trim().parse().ok());
            let auto = |name: &str| sp.attr(name).map(|v| !matches!(v, "0" | "false" | "off"));
            props.before = twips("w:before");
            props.after = twips("w:after");
            props.before_auto = auto("w:beforeautospacing");
            props.after_auto = auto("w:afterautospacing");
            props.line = twips("w:line").map(|l| (l, sp.attr("w:linerule").unwrap_or("auto").to_owned()));
        }
        props.contextual = flag(ppr, "w:contextualspacing");
        props.keep_next = flag(ppr, "w:keepnext");
        props.keep_lines = flag(ppr, "w:keeplines");
        props.break_before = flag(ppr, "w:pagebreakbefore");
        props.widows = flag(ppr, "w:widowcontrol");
        props.tabs = child(ppr, "w:tabs").map(|tabs| {
            children(tabs, "w:tab")
                .filter_map(|t| {
                    Some(Tab {
                        pos: t.attr("w:pos")?.trim().parse().ok()?,
                        align: t.attr("w:val").unwrap_or("left").to_owned(),
                        leader: t.attr("w:leader").map(str::to_owned),
                    })
                })
                .collect()
        });
        if let Some(bdr) = child(ppr, "w:pbdr") {
            for (slot, (a, b)) in props.borders.iter_mut().zip(BORDER_SIDES) {
                *slot = child(bdr, a).or_else(|| child(bdr, b)).map(|e| Border {
                    style: e.attr("w:val").unwrap_or("single").to_owned(),
                    size: e.attr("w:sz").and_then(|v| v.trim().parse().ok()),
                    space: e.attr("w:space").and_then(|v| v.trim().parse().ok()),
                    color: color_of(e, "w:color"),
                });
            }
        }
        props.shade = child(ppr, "w:shd").map(|s| Shd {
            pattern: s.attr("w:val").unwrap_or("clear").to_owned(),
            fill: s
                .attr("w:fill")
                .filter(|f| f.len() == 6 && f.bytes().all(|b| b.is_ascii_hexdigit()))
                .map(str::to_ascii_lowercase),
            color: color_of(s, "w:color").filter(|c| c.rgb.is_some() || c.theme.is_some()),
        });
        props.bidi = flag(ppr, "w:bidi");
        props.outline = number(ppr, "w:outlinelvl");
        props.drop_cap = child(ppr, "w:framepr").and_then(|f| {
            let mode = f.attr("w:dropcap")?.to_owned();
            let lines = f.attr("w:lines").and_then(|v| v.parse().ok());
            let distance = f.attr("w:hspace").and_then(|v| v.parse().ok());
            Some((mode, lines, distance))
        });
        props.suppress_hyphens = flag(ppr, "w:suppressautohyphens");
        // The paragraph mark's `w:noProof` is "do not check spelling", which OpenNote says as language `zxx`.
        let mark = child(ppr, "w:rpr");
        props.lang = if mark.and_then(|r| flag(r, "w:noproof")) == Some(true) {
            Some("zxx".to_owned())
        } else {
            mark.and_then(|r| val(r, "w:lang")).map(str::to_owned)
        };
        props
    }

    /// Lays `top` over these properties: what `top` sets wins. Tab stops add up, and a `clear` stop removes the
    /// stop below it at the same place.
    pub fn set_over(&mut self, top: &ParaProps) {
        fn set<T: Clone>(slot: &mut Option<T>, value: &Option<T>) {
            if value.is_some() {
                slot.clone_from(value);
            }
        }
        set(&mut self.jc, &top.jc);
        for (slot, value) in self.ind.iter_mut().zip(&top.ind) {
            set(slot, value);
        }
        set(&mut self.before, &top.before);
        set(&mut self.after, &top.after);
        set(&mut self.before_auto, &top.before_auto);
        set(&mut self.after_auto, &top.after_auto);
        set(&mut self.line, &top.line);
        set(&mut self.contextual, &top.contextual);
        set(&mut self.keep_next, &top.keep_next);
        set(&mut self.keep_lines, &top.keep_lines);
        set(&mut self.break_before, &top.break_before);
        set(&mut self.widows, &top.widows);
        if let Some(stops) = &top.tabs {
            let mut merged = self.tabs.take().unwrap_or_default();
            for stop in stops {
                merged.retain(|t| t.pos != stop.pos);
                if stop.align != "clear" {
                    merged.push(stop.clone());
                }
            }
            merged.sort_by_key(|t| t.pos);
            self.tabs = Some(merged);
        }
        for (slot, value) in self.borders.iter_mut().zip(&top.borders) {
            set(slot, value);
        }
        set(&mut self.shade, &top.shade);
        set(&mut self.bidi, &top.bidi);
        set(&mut self.outline, &top.outline);
        set(&mut self.drop_cap, &top.drop_cap);
        set(&mut self.suppress_hyphens, &top.suppress_hyphens);
        set(&mut self.lang, &top.lang);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    fn run(xml: &str) -> RunProps {
        RunProps::read(&parse(xml))
    }

    #[test]
    fn toggles_flip_in_styles_and_set_in_direct_formatting() {
        let bold = run(r#"<w:rPr><w:b/></w:rPr>"#);
        let none = RunProps::default();
        let defaults = RunProps::default();
        // ECMA-376 Part 1, 17.7.3: bold in the paragraph style and in the character style is not bold.
        assert!(!resolve(&defaults, &[&none, &bold, &bold], None).toggle(Toggle::Bold));
        assert!(resolve(&defaults, &[&none, &bold, &none], None).toggle(Toggle::Bold));
        // Direct formatting sets the value, whatever the styles say.
        assert!(resolve(&defaults, &[&none, &bold, &bold], Some(&bold)).toggle(Toggle::Bold));
        let off = run(r#"<w:rPr><w:b w:val="0"/></w:rPr>"#);
        assert!(!resolve(&defaults, &[&none, &bold, &none], Some(&off)).toggle(Toggle::Bold));
        // A style that turns a toggle off leaves it as it was.
        assert!(resolve(&defaults, &[&none, &bold, &off], None).toggle(Toggle::Bold));
    }

    #[test]
    fn tab_stops_add_up_and_clear_removes_one() {
        let mut base = ParaProps::read(&parse(
            r#"<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="center" w:pos="4680"/></w:tabs></w:pPr>"#,
        ));
        let top = ParaProps::read(&parse(
            r#"<w:pPr><w:tabs><w:tab w:val="clear" w:pos="720"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>"#,
        ));
        base.set_over(&top);
        let positions: Vec<i32> = base.tabs.unwrap_or_default().iter().map(|t| t.pos).collect();
        assert_eq!(positions, [4680, 9360]);
    }
}
