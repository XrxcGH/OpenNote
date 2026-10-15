//! Writes a [`Picture`] as an SVG document, so a web view can show a metafile in an `<img>`.
//!
//! Paths, clips, bitmaps (as PNG data URIs) and pattern fills map directly. Text stays text: the font
//! the file names goes in `font-family` with a generic fallback, so the web view picks the glyphs.
//! The output is capped, so hostile input cannot produce an unbounded document.
//!
//! This file is not part of the upstream DeckCraft crate.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::Arc;

use crate::text::{HAlign, VAlign};
use crate::{Item, Picture, Seg, Text, Tile};

/// Largest SVG written (bytes). Past it the conversion gives up and returns `None`.
pub const MAX_SVG_BYTES: usize = 48 * 1024 * 1024;
/// CSS pixels per picture unit (the picture is in points).
const PX_PER_UNIT: f32 = 96.0 / 72.0;

/// The picture as an SVG document, or `None` when it is empty, has no usable size, or would write more
/// than [`MAX_SVG_BYTES`].
pub fn to_svg(picture: &Picture) -> Option<String> {
    let (w, h) = (picture.width, picture.height);
    if !(w.is_finite() && h.is_finite()) || w <= 0.0 || h <= 0.0 || picture.items.is_empty() {
        return None;
    }
    let mut out = String::new();
    let _ = write!(
        out,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\">",
        num(w * PX_PER_UNIT),
        num(h * PX_PER_UNIT),
        num(w),
        num(h)
    );
    let mut defs = String::new();
    let mut body = String::new();
    let mut tiles: HashMap<*const Tile, String> = HashMap::new();
    let mut ids = 0usize;
    for item in &picture.items {
        if out.len() + defs.len() + body.len() > MAX_SVG_BYTES {
            return None;
        }
        match item {
            Item::Path { segs, fill, stroke, even_odd, region } => {
                let (open, close) = open_clip(&mut defs, &mut ids, region.as_deref());
                body.push_str(&open);
                let _ = write!(body, "<path d=\"{}\"", path_data(segs));
                match fill {
                    Some(c) => {
                        let _ = write!(body, " fill=\"{}\"{}", rgb(*c), opacity("fill-opacity", c[3]));
                    }
                    None => body.push_str(" fill=\"none\""),
                }
                if *even_odd {
                    body.push_str(" fill-rule=\"evenodd\"");
                }
                if let Some((c, width)) = stroke {
                    let _ = write!(
                        body,
                        " stroke=\"{}\"{} stroke-width=\"{}\" stroke-linejoin=\"round\"",
                        rgb(*c),
                        opacity("stroke-opacity", c[3]),
                        num(*width)
                    );
                }
                body.push_str("/>");
                body.push_str(close);
            }
            Item::Bitmap { rect, width, height, rgba, region } => {
                let Some(png) = png_data_uri(*width, *height, rgba) else { continue };
                let (open, close) = open_clip(&mut defs, &mut ids, region.as_deref());
                body.push_str(&open);
                let _ = write!(
                    body,
                    "<image x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" preserveAspectRatio=\"none\" xlink:href=\"{}\"/>",
                    num(rect[0]),
                    num(rect[1]),
                    num(rect[2]),
                    num(rect[3]),
                    png
                );
                body.push_str(close);
            }
            Item::Pattern { segs, even_odd, tile, region } => {
                let key = Arc::as_ptr(tile);
                let id = match tiles.get(&key) {
                    Some(id) => id.clone(),
                    None => {
                        let Some(png) = png_data_uri(tile.width, tile.height, &tile.rgba) else { continue };
                        ids += 1;
                        let id = format!("p{ids}");
                        let (tw, th) = (tile.width as f32 * tile.cell[0], tile.height as f32 * tile.cell[1]);
                        let _ = write!(
                            defs,
                            "<pattern id=\"{id}\" patternUnits=\"userSpaceOnUse\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"><image width=\"{}\" height=\"{}\" preserveAspectRatio=\"none\" style=\"image-rendering:pixelated\" xlink:href=\"{png}\"/></pattern>",
                            num(tile.origin[0]),
                            num(tile.origin[1]),
                            num(tw),
                            num(th),
                            num(tw),
                            num(th)
                        );
                        tiles.insert(key, id.clone());
                        id
                    }
                };
                let (open, close) = open_clip(&mut defs, &mut ids, region.as_deref());
                body.push_str(&open);
                let _ = write!(
                    body,
                    "<path d=\"{}\" fill=\"url(#{id})\"{}/>",
                    path_data(segs),
                    if *even_odd { " fill-rule=\"evenodd\"" } else { "" }
                );
                body.push_str(close);
            }
            Item::Text(text) => write_text(&mut body, &mut defs, &mut ids, text),
        }
    }
    if !defs.is_empty() {
        out.push_str("<defs>");
        out.push_str(&defs);
        out.push_str("</defs>");
    }
    out.push_str(&body);
    out.push_str("</svg>");
    (out.len() <= MAX_SVG_BYTES).then_some(out)
}

/// Opens a group clipped to the union of `region`'s rectangles. Returns the opening markup and the closing
/// markup (both empty without a region).
fn open_clip(defs: &mut String, ids: &mut usize, region: Option<&[[f32; 4]]>) -> (String, &'static str) {
    let Some(rects) = region else { return (String::new(), "") };
    *ids += 1;
    let id = format!("c{ids}");
    let _ = write!(defs, "<clipPath id=\"{id}\">");
    for [x0, y0, x1, y1] in rects {
        let _ = write!(
            defs,
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/>",
            num(*x0),
            num(*y0),
            num((x1 - x0).max(0.0)),
            num((y1 - y0).max(0.0))
        );
    }
    defs.push_str("</clipPath>");
    (format!("<g clip-path=\"url(#{id})\">"), "</g>")
}

fn write_text(body: &mut String, defs: &mut String, ids: &mut usize, t: &Text) {
    let text: String = t.text.chars().filter(|c| is_xml_char(*c)).collect();
    if text.trim().is_empty() {
        return;
    }
    let (open_a, close_a) = open_clip(defs, ids, t.region.as_deref());
    let rect_region = t.clip.map(|r| vec![r]);
    let (open_b, close_b) = open_clip(defs, ids, rect_region.as_deref());
    body.push_str(&open_a);
    body.push_str(&open_b);
    let [a, b, c, d, e, f] = t.transform;
    let matrix = format!(
        "matrix({} {} {} {} {} {})",
        num64(a),
        num64(b),
        num64(c),
        num64(d),
        num64(e),
        num64(f)
    );
    let em = em_size(t);
    if let (Some(bg), true) = (t.background, !t.dx.is_empty()) {
        let width: f32 = t.dx.iter().sum();
        let x = match t.h_align {
            HAlign::Left => 0.0,
            HAlign::Center => -width / 2.0,
            HAlign::Right => -width,
        };
        let y = match t.v_align {
            VAlign::Top => 0.0,
            VAlign::Baseline => -em * 0.8,
            VAlign::Bottom => -em,
        };
        let _ = write!(
            body,
            "<rect transform=\"{matrix}\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"{}/>",
            num(x),
            num(y),
            num(width.max(0.0)),
            num(em),
            rgb(bg),
            opacity("fill-opacity", bg[3])
        );
    }
    let _ = write!(
        body,
        "<text transform=\"{matrix}\" font-size=\"{}\" fill=\"{}\"{} font-family=\"{}\" xml:space=\"preserve\"",
        num(em),
        rgb(t.color),
        opacity("fill-opacity", t.color[3]),
        family(&t.font.family)
    );
    if t.font.weight >= 600 {
        body.push_str(" font-weight=\"bold\"");
    }
    if t.font.italic {
        body.push_str(" font-style=\"italic\"");
    }
    match (t.font.underline, t.font.strike) {
        (true, true) => body.push_str(" text-decoration=\"underline line-through\""),
        (true, false) => body.push_str(" text-decoration=\"underline\""),
        (false, true) => body.push_str(" text-decoration=\"line-through\""),
        (false, false) => {}
    }
    match t.h_align {
        HAlign::Left => {}
        HAlign::Center => body.push_str(" text-anchor=\"middle\""),
        HAlign::Right => body.push_str(" text-anchor=\"end\""),
    }
    match t.v_align {
        VAlign::Top => body.push_str(" dominant-baseline=\"text-before-edge\""),
        VAlign::Baseline => {}
        VAlign::Bottom => body.push_str(" dominant-baseline=\"text-after-edge\""),
    }
    // Per-character positions only for left-aligned text: other alignments move the whole run.
    if !t.dx.is_empty() && t.h_align == HAlign::Left {
        let mut x = 0.0f32;
        let mut list = Vec::new();
        for i in 0..text.chars().count() {
            list.push(num(x));
            x += t.dx.get(i).copied().unwrap_or(0.0);
        }
        let _ = write!(body, " x=\"{}\"", list.join(" "));
    }
    body.push('>');
    body.push_str(&escape(&text));
    body.push_str("</text>");
    body.push_str(close_b);
    body.push_str(close_a);
}

/// The em height in text units: LOGFONT height is the em when negative, the cell (about 1.2 em) when positive.
fn em_size(t: &Text) -> f32 {
    let h = t.font.height;
    let em = if h < 0.0 {
        -h
    } else if h > 0.0 {
        h / 1.2
    } else {
        12.0
    };
    if em.is_finite() && em > 0.0 {
        em
    } else {
        12.0
    }
}

/// A `font-family` value: the name the file asks for, quoted, then a generic family.
fn family(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
        .take(64)
        .collect();
    let clean = clean.trim();
    let lower = clean.to_ascii_lowercase();
    let generic = if lower.contains("courier") || lower.contains("consolas") || lower.contains("mono") {
        "monospace"
    } else if lower.contains("times") || lower.contains("georgia") || lower.contains("cambria") {
        "serif"
    } else {
        "sans-serif"
    };
    if clean.is_empty() {
        generic.to_owned()
    } else {
        format!("&apos;{clean}&apos;, {generic}")
    }
}

fn path_data(segs: &[Seg]) -> String {
    let mut d = String::with_capacity(segs.len() * 16);
    for seg in segs {
        match *seg {
            Seg::Move(x, y) => {
                let _ = write!(d, "M{} {}", num(x), num(y));
            }
            Seg::Line(x, y) => {
                let _ = write!(d, "L{} {}", num(x), num(y));
            }
            Seg::Cubic(a, b, c, e, x, y) => {
                let _ = write!(d, "C{} {} {} {} {} {}", num(a), num(b), num(c), num(e), num(x), num(y));
            }
            Seg::Close => d.push('Z'),
        }
    }
    d
}

fn png_data_uri(width: u32, height: u32, rgba: &[u8]) -> Option<String> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    let mut uri = String::from("data:image/png;base64,");
    base64(&png, &mut uri);
    Some(uri)
}

fn base64(bytes: &[u8], out: &mut String) {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(char::from(TABLE[(n >> 18) as usize & 63]));
        out.push(char::from(TABLE[(n >> 12) as usize & 63]));
        out.push(if chunk.len() > 1 { char::from(TABLE[(n >> 6) as usize & 63]) } else { '=' });
        out.push(if chunk.len() > 2 { char::from(TABLE[n as usize & 63]) } else { '=' });
    }
}

fn rgb(c: [u8; 4]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

fn opacity(name: &str, alpha: u8) -> String {
    if alpha == 255 {
        String::new()
    } else {
        format!(" {name}=\"{}\"", num(f32::from(alpha) / 255.0))
    }
}

/// A number with at most three decimals and no trailing zeros.
fn num(v: f32) -> String {
    num64(f64::from(v))
}

fn num64(v: f64) -> String {
    if !v.is_finite() {
        return "0".to_owned();
    }
    let s = format!("{v:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".to_owned()
    } else {
        s.to_owned()
    }
}

fn is_xml_char(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r') || (c >= ' ' && c != '\u{fffe}' && c != '\u{ffff}' && !('\u{7f}'..='\u{9f}').contains(&c))
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(items: Vec<Item>) -> Picture {
        Picture { width: 100.0, height: 50.0, items }
    }

    #[test]
    fn a_filled_path_becomes_a_path_element() {
        let svg = to_svg(&picture(vec![Item::Path {
            segs: vec![Seg::Move(0.0, 0.0), Seg::Line(10.0, 0.0), Seg::Line(10.0, 10.0), Seg::Close],
            fill: Some([255, 0, 0, 255]),
            stroke: Some(([0, 0, 255, 128], 2.0)),
            even_odd: true,
            region: None,
        }]))
        .unwrap();
        assert!(svg.starts_with("<svg "));
        assert!(svg.contains("viewBox=\"0 0 100 50\""));
        assert!(svg.contains("d=\"M0 0L10 0L10 10Z\""));
        assert!(svg.contains("fill=\"#ff0000\""));
        assert!(svg.contains("fill-rule=\"evenodd\""));
        assert!(svg.contains("stroke-opacity=\"0.502\""));
    }

    #[test]
    fn a_clip_region_wraps_the_item() {
        let svg = to_svg(&picture(vec![Item::Path {
            segs: vec![Seg::Move(0.0, 0.0), Seg::Line(10.0, 10.0)],
            fill: None,
            stroke: Some(([0, 0, 0, 255], 1.0)),
            even_odd: false,
            region: Some(vec![[0.0, 0.0, 5.0, 5.0]]),
        }]))
        .unwrap();
        assert!(svg.contains("<clipPath id=\"c1\"><rect x=\"0\" y=\"0\" width=\"5\" height=\"5\"/></clipPath>"));
        assert!(svg.contains("<g clip-path=\"url(#c1)\">"));
    }

    #[test]
    fn a_bitmap_is_embedded_as_a_png() {
        let svg = to_svg(&picture(vec![Item::Bitmap {
            rect: [0.0, 0.0, 10.0, 10.0],
            width: 1,
            height: 1,
            rgba: vec![1, 2, 3, 255],
            region: None,
        }]))
        .unwrap();
        assert!(svg.contains("xlink:href=\"data:image/png;base64,iVBOR"));
    }

    #[test]
    fn text_is_escaped_and_keeps_its_font() {
        let text = Text {
            transform: [1.0, 0.0, 0.0, 1.0, 5.0, 20.0],
            text: "a<b & \"c\"\u{1}".to_owned(),
            dx: Vec::new(),
            font: crate::Font { family: "Arial\"><script>".to_owned(), height: -12.0, weight: 700, ..Default::default() },
            color: [0, 0, 0, 255],
            background: None,
            h_align: HAlign::Left,
            v_align: VAlign::Baseline,
            clip: None,
            region: None,
        };
        let svg = to_svg(&picture(vec![Item::Text(Box::new(text))])).unwrap();
        assert!(svg.contains(">a&lt;b &amp; &quot;c&quot;</text>"));
        assert!(svg.contains("font-weight=\"bold\""));
        assert!(!svg.contains("<script"));
    }

    #[test]
    fn an_empty_or_unsized_picture_gives_nothing() {
        assert!(to_svg(&picture(Vec::new())).is_none());
        let sizeless = Picture { width: 0.0, height: 10.0, items: vec![] };
        assert!(to_svg(&sizeless).is_none());
    }
}
