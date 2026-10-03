//! `ink.svg` (spec 11.3): every stroke as a path, one group per ink block.
//!
//! The spec leaves some layout open. OpenNote and the reference reader both follow these rules.
//!
//! Paths are in page coordinates: each point after its stroke's transform, plus its block's offset. A floating
//! block's offset is its frame's `x` and `y`.
//!
//! Flowing blocks stack at `x = 0`. The first starts 24 units below the lowest point of the floating blocks, or
//! at `y = 0` when no floating block has points. Each flowing block takes its frame's `h`, or else the largest
//! `y` of its points, and then 24 units of space.
//!
//! A group without strokes is written as `<g/>`. A stroke of one point repeats it, so its round cap shows.
//! Stroke widths and opacity are rounded to 0.01. A transformed stroke is as wide as its nominal width times the
//! square root of the absolute determinant of its transform (spec 11.3).

use std::fmt::Write as _;

use super::{quoted, seal};
use crate::format::json::fixed;
use crate::format::markdown::one_line;
use crate::format::points::decode_points;
use crate::model::{Block, BlockData, Page, Stroke};

/// Space around the strokes, and between stacked flowing blocks.
const MARGIN: f64 = 8.0;
const FLOW_GAP: f64 = 24.0;

/// One stroke as page coordinates.
struct DrawnStroke<'a> {
    stroke: &'a Stroke,
    points: Vec<(f64, f64)>,
}

/// Renders `ink.svg` (spec 11.3).
pub fn render_ink_svg(page: &Page) -> Vec<u8> {
    let groups = layout(page);
    let mut bounds: Option<(f64, f64, f64, f64)> = None;
    for (x, y) in groups.iter().flatten().flat_map(|s| s.points.iter().copied()) {
        bounds = Some(match bounds {
            None => (x, y, x, y),
            Some((a, b, c, d)) => (a.min(x), b.min(y), c.max(x), d.max(y)),
        });
    }
    let (min_x, min_y, max_x, max_y) = bounds.unwrap_or_default();
    let view = [
        fixed(min_x - MARGIN, 1),
        fixed(min_y - MARGIN, 1),
        fixed(max_x - min_x + 2.0 * MARGIN, 1),
        fixed(max_y - min_y + 2.0 * MARGIN, 1),
    ];
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    let _ = writeln!(
        out,
        "<!-- opennote: {{\"page\": {}, \"revision\": {}, \"format\": {}, \"checksum\": \"crc32:00000000\"}} -->",
        quoted(&page.id.to_string()),
        quoted(&page.revision.id.to_string()),
        crate::FORMAT_VERSION
    );
    let [vx, vy, vw, vh] = &view;
    let _ = writeln!(
        out,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" viewBox=\"{vx} {vy} {vw} {vh}\" \
         width=\"{vw}\" height=\"{vh}\">"
    );
    let title = one_line(&page.title);
    let title = if title.is_empty() {
        "Handwriting".to_owned()
    } else {
        format!("Handwriting: {title}")
    };
    let _ = writeln!(out, "  <title>{}</title>", xml_text(&title));
    for group in &groups {
        write_group(&mut out, group);
    }
    out.push_str("</svg>\n");
    seal(out)
}

fn write_group(out: &mut String, strokes: &[DrawnStroke<'_>]) {
    if strokes.is_empty() {
        out.push_str("  <g/>\n");
        return;
    }
    out.push_str("  <g>\n");
    for drawn in strokes {
        let style = &drawn.stroke.style;
        let [r, g, b, a] = style.color;
        let mut path = String::new();
        let mut points = drawn.points.clone();
        if points.len() == 1 {
            points.extend(points.first().copied());
        }
        for (i, (x, y)) in points.iter().enumerate() {
            let command = if i == 0 { 'M' } else { 'L' };
            let _ = write!(path, "{command}{} {}", fixed(*x, 1), fixed(*y, 1));
        }
        let opacity = if a < 255 {
            format!(" stroke-opacity=\"{}\"", fixed(f64::from(a) / 255.0, 2))
        } else {
            String::new()
        };
        let _ = writeln!(
            out,
            "    <path d=\"{path}\" fill=\"none\" stroke=\"#{r:02x}{g:02x}{b:02x}\"{opacity} stroke-width=\"{}\" \
             stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
            fixed(
                f64::from(style.width) * drawn.stroke.transform.map_or(1.0, |t| t.width_scale()),
                2
            )
        );
    }
    out.push_str("  </g>\n");
}

/// Every ink block's strokes in page coordinates, in block order, highlighters first in each block.
fn layout(page: &Page) -> Vec<Vec<DrawnStroke<'_>>> {
    let ink_blocks: Vec<&Block> = page
        .blocks
        .iter()
        .filter(|b| matches!(b.data, BlockData::Ink(_)))
        .map(|b| &**b)
        .collect();
    let mut groups: Vec<Vec<DrawnStroke<'_>>> = ink_blocks.iter().map(|b| block_strokes(page, b)).collect();
    let floating_bottom = ink_blocks
        .iter()
        .zip(&mut groups)
        .filter(|(block, _)| block.is_floating())
        .filter_map(|(block, strokes)| {
            let frame = block.frame.as_ref()?;
            shift(strokes, frame.x.unwrap_or(0.0), frame.y.unwrap_or(0.0));
            strokes
                .iter()
                .flat_map(|s| s.points.iter().map(|p| p.1))
                .reduce(f64::max)
        })
        .reduce(f64::max);
    let mut cursor = floating_bottom.map_or(0.0, |bottom| bottom + FLOW_GAP);
    for (block, strokes) in ink_blocks.iter().zip(&mut groups) {
        if block.is_floating() {
            continue;
        }
        let lowest = strokes
            .iter()
            .flat_map(|s| s.points.iter().map(|p| p.1))
            .fold(0.0, f64::max);
        let height = block.frame.as_ref().and_then(|f| f.h).unwrap_or(lowest);
        shift(strokes, 0.0, cursor);
        cursor += height + FLOW_GAP;
    }
    groups
}

fn shift(strokes: &mut [DrawnStroke<'_>], dx: f64, dy: f64) {
    for point in strokes.iter_mut().flat_map(|s| s.points.iter_mut()) {
        point.0 += dx;
        point.1 += dy;
    }
}

/// The strokes of one ink block in block coordinates: highlighters first, each set by start time, then ID.
fn block_strokes<'a>(page: &'a Page, block: &Block) -> Vec<DrawnStroke<'a>> {
    let (highlighters, others): (Vec<&Stroke>, Vec<&Stroke>) = page
        .ink
        .in_block(block.id)
        .map(|s| &**s)
        .partition(|s| s.is_highlighter());
    highlighters
        .into_iter()
        .chain(others)
        .filter_map(|stroke| {
            let points = decode_points(&stroke.points, stroke.point_count, stroke.channels).ok()?;
            let points = points
                .iter()
                .map(|p| {
                    let (x, y) = (f64::from(p.x) / 64.0, f64::from(p.y) / 64.0);
                    stroke.transform.map_or((x, y), |t| t.apply(x, y))
                })
                .collect();
            Some(DrawnStroke { stroke, points })
        })
        .collect()
}

/// Text for XML content: `&`, `<`, and `>` escaped, and characters XML doesn't allow replaced.
fn xml_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\t' => out.push(c),
            c if c < '\u{20}' || c == '\u{fffe}' || c == '\u{ffff}' => out.push('\u{fffd}'),
            c => out.push(c),
        }
    }
    out
}
