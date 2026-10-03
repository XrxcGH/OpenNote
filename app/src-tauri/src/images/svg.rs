//! The size of an SVG image from its root element (Phase 4 ARCHITECTURE.md section 12.2): `width` and `height` in
//! absolute units, else the `viewBox`, else 300 by 150, as a browser sizes an `<img>` of it. The file is never
//! rendered here, and the page shows it only through `<img>`, which runs no script and loads nothing else.

/// The default size of a replaced element without one (CSS 2, section 10.3.2).
const DEFAULT: (u32, u32) = (300, 150);

/// The size the root `<svg>` element asks for, or None when the text holds no `<svg>` element.
pub fn size(bytes: &[u8]) -> Option<(u32, u32)> {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(64 * 1024)]);
    let attributes = root_attributes(&text)?;
    let get = |name: &str| {
        attributes
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };
    let width = get("width").and_then(length);
    let height = get("height").and_then(length);
    let view_box = get("viewBox").and_then(view_box);
    let (w, h) = match (width, height, view_box) {
        (Some(w), Some(h), _) => (w, h),
        (Some(w), None, Some((vw, vh))) => (w, w * vh / vw),
        (None, Some(h), Some((vw, vh))) => (h * vw / vh, h),
        (None, None, Some((vw, vh))) => (vw, vh),
        (Some(w), None, None) => (w, f64::from(DEFAULT.1)),
        (None, Some(h), None) => (f64::from(DEFAULT.0), h),
        (None, None, None) => return Some(DEFAULT),
    };
    Some((pixels(w), pixels(h)))
}

fn pixels(value: f64) -> u32 {
    // Clamped to the core's largest side, so the cast never wraps.
    value.round().clamp(1.0, 1_000_000.0) as u32
}

/// The attributes of the first `<svg` start tag, past any XML declaration, comments, and doctype.
fn root_attributes(text: &str) -> Option<Vec<(String, String)>> {
    let start = find_tag(text, "svg")?;
    let rest = &text[start + 4..];
    let end = rest.find('>')?;
    Some(parse_attributes(&rest[..end]))
}

fn find_tag(text: &str, name: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(found) = text[from..].find('<') {
        let at = from + found;
        let rest = &text[at + 1..];
        if rest.starts_with("!--") {
            from = at + 4 + rest.find("-->")?;
            continue;
        }
        if rest.starts_with(name)
            && rest[name.len()..].starts_with(|c: char| c.is_ascii_whitespace() || c == '>' || c == '/')
        {
            return Some(at);
        }
        from = at + 1;
    }
    None
}

fn parse_attributes(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = tag;
    while let Some(eq) = rest.find('=') {
        let key = rest[..eq]
            .trim()
            .rsplit(|c: char| c.is_ascii_whitespace())
            .next()
            .unwrap_or("");
        let after = rest[eq + 1..].trim_start();
        let Some(quote) = after.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            break;
        };
        let Some(close) = after[1..].find(quote) else {
            break;
        };
        out.push((key.to_owned(), after[1..1 + close].to_owned()));
        rest = &after[close + 2..];
    }
    out
}

/// A CSS length in pixels, for the absolute units only. Percentages and font-relative units have no fixed size.
fn length(value: &str) -> Option<f64> {
    let value = value.trim();
    let split = value
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E'))
        .unwrap_or(value.len());
    let (number, unit) = value.split_at(split);
    let number: f64 = number.parse().ok()?;
    let scale = match unit.trim() {
        "" | "px" => 1.0,
        "in" => 96.0,
        "cm" => 96.0 / 2.54,
        "mm" => 96.0 / 25.4,
        "pt" => 96.0 / 72.0,
        "pc" => 16.0,
        _ => return None,
    };
    let pixels = number * scale;
    (pixels.is_finite() && pixels > 0.0).then_some(pixels)
}

fn view_box(value: &str) -> Option<(f64, f64)> {
    let numbers: Vec<f64> = value
        .split(|c: char| c.is_ascii_whitespace() || c == ',')
        .filter(|part| !part.is_empty())
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    match numbers.as_slice() {
        [_, _, w, h] if *w > 0.0 && *h > 0.0 && w.is_finite() && h.is_finite() => Some((*w, *h)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_come_from_attributes_then_the_view_box_then_the_default() {
        let cases: &[(&str, (u32, u32))] = &[
            (r#"<svg width="120" height="80"/>"#, (120, 80)),
            (
                r#"<?xml version="1.0"?><!-- <svg width="1"> --><svg viewBox="0 0 30 20"></svg>"#,
                (30, 20),
            ),
            (
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="1in" height='48pt'>"#,
                (96, 64),
            ),
            (r#"<svg width="60" viewBox="0, 0, 30, 20">"#, (60, 40)),
            (r#"<svg height="50%" viewBox="0 0 40 10">"#, (40, 10)),
            (r#"<svg width="10em" height="2em">"#, DEFAULT),
            (r#"<svg>"#, DEFAULT),
        ];
        for (text, expected) in cases {
            assert_eq!(size(text.as_bytes()), Some(*expected), "{text}");
        }
        assert_eq!(size(b"<html><body>no image</body></html>"), None);
        assert_eq!(size(b"<svgfoo width=\"3\">"), None);
    }
}
