//! A page's handwriting as a one-page vector PDF that `\includegraphics` takes in every engine.
//!
//! The strokes are the ones `ink.svg` draws (`ink_lines`), at the same places and widths, so the PDF is the same
//! picture as the page's handwriting export. Each stroke is a path with round caps and joins; a stroke that is not
//! opaque gets a graphics state with its alpha. Page units are CSS pixels, so 1 unit is 0.75 point.

use std::fmt::Write as _;

use opennote_core::format::readable::InkLine;

/// Space around the strokes, in page units, as the SVG leaves.
const MARGIN: f64 = 8.0;
/// Points per page unit.
const SCALE: f64 = 0.75;
/// The most points one PDF holds. A page with more is drawn from every few points of each stroke.
const MAX_POINTS: usize = 4_000_000;

fn number(value: f64) -> String {
    let text = format!("{value:.2}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-" {
        "0".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// The PDF file for these strokes. `None` when there is nothing to draw.
pub fn ink_pdf(lines: &[InkLine]) -> Option<Vec<u8>> {
    let total: usize = lines.iter().map(|l| l.points.len()).sum();
    if total == 0 {
        return None;
    }
    let step = total.div_ceil(MAX_POINTS).max(1);
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for (x, y) in lines.iter().flat_map(|l| l.points.iter().copied()) {
        if x.is_finite() && y.is_finite() {
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    if min_x > max_x {
        return None;
    }
    let (view_x, view_y) = (min_x - MARGIN, min_y - MARGIN);
    let (view_w, view_h) = (max_x - min_x + 2.0 * MARGIN, max_y - min_y + 2.0 * MARGIN);
    let (width, height) = (
        (view_w * SCALE).clamp(1.0, 14_400.0),
        (view_h * SCALE).clamp(1.0, 14_400.0),
    );
    let mut alphas: Vec<u8> = Vec::new();
    let mut content = String::new();
    let _ = writeln!(
        content,
        "q {} 0 0 {} {} {} cm 1 J 1 j",
        number(SCALE),
        number(-SCALE),
        number(-view_x * SCALE),
        number((view_y + view_h) * SCALE)
    );
    for line in lines {
        let points: Vec<(f64, f64)> = line
            .points
            .iter()
            .copied()
            .filter(|(x, y)| x.is_finite() && y.is_finite())
            .enumerate()
            .filter(|(i, _)| i % step == 0)
            .map(|(_, p)| p)
            .collect();
        let Some(first) = points.first().copied() else {
            continue;
        };
        let [r, g, b, a] = line.color;
        if a < 255 {
            let at = alphas.iter().position(|x| *x == a).unwrap_or_else(|| {
                alphas.push(a);
                alphas.len() - 1
            });
            let _ = writeln!(content, "/A{at} gs");
        } else {
            content.push_str("/A255 gs\n");
        }
        let _ = writeln!(
            content,
            "{} {} {} RG {} w",
            number(f64::from(r) / 255.0),
            number(f64::from(g) / 255.0),
            number(f64::from(b) / 255.0),
            number(line.width.max(0.1))
        );
        let _ = write!(content, "{} {} m", number(first.0), number(first.1));
        for (x, y) in points.iter().skip(1) {
            let _ = write!(content, " {} {} l", number(*x), number(*y));
        }
        if points.len() == 1 {
            let _ = write!(content, " {} {} l", number(first.0 + 0.01), number(first.1));
        }
        content.push_str(" S\n");
    }
    content.push_str("Q\n");
    let mut states = String::from("/A255 << /CA 1 /ca 1 >>");
    for (at, alpha) in alphas.iter().enumerate() {
        let value = number(f64::from(*alpha) / 255.0);
        let _ = write!(states, " /A{at} << /CA {value} /ca {value} >>");
    }
    Some(assemble(&content, width, height, &states))
}

/// Puts the objects of the file together, with its cross-reference table.
fn assemble(content: &str, width: f64, height: f64, states: &str) -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Contents 4 0 R /Resources << /ExtGState << {states} >> >> >>",
            number(width),
            number(height)
        ),
        format!("<< /Length {} >>\nstream\n{content}endstream", content.len()),
    ];
    let mut out: Vec<u8> = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{body}\nendobj\n", index + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(points: &[(f64, f64)], color: [u8; 4], width: f64) -> InkLine {
        InkLine {
            points: points.to_vec(),
            color,
            width,
        }
    }

    #[test]
    fn a_stroke_becomes_a_valid_vector_page() {
        let pdf = ink_pdf(&[line(&[(10.0, 20.0), (50.0, 60.0)], [255, 0, 0, 255], 2.0)]).expect("a picture");
        let text = String::from_utf8(pdf).expect("ASCII");
        assert!(text.starts_with("%PDF-1.4\n") && text.ends_with("%%EOF\n"));
        // View box: x 2..58, y 12..68 -> 56 x 56 units -> 42 x 42 points.
        assert!(text.contains("/MediaBox [0 0 42 42]"), "{text}");
        assert!(text.contains("q 0.75 0 0 -0.75 -1.5 51 cm 1 J 1 j"), "{text}");
        assert!(text.contains("1 0 0 RG 2 w\n10 20 m 50 60 l S"), "{text}");
        // Every cross-reference offset points at its object.
        let xref = text.find("xref\n").expect("a table");
        for (number, row) in text[xref..].lines().skip(3).take(4).enumerate() {
            let offset: usize = row[..10].parse().expect("an offset");
            assert!(text[offset..].starts_with(&format!("{} 0 obj", number + 1)), "{row}");
        }
    }

    #[test]
    fn dots_alpha_and_nothing_to_draw() {
        let pdf = ink_pdf(&[line(&[(5.0, 5.0)], [0, 0, 0, 128], 3.0)]).expect("a dot");
        let text = String::from_utf8(pdf).expect("ASCII");
        assert!(
            text.contains("/A0 << /CA 0.5 /ca 0.5 >>") && text.contains("5 5 m 5.01 5 l S"),
            "{text}"
        );
        assert!(ink_pdf(&[]).is_none());
        assert!(ink_pdf(&[line(&[(f64::NAN, 1.0)], [0, 0, 0, 255], 1.0)]).is_none());
    }
}
