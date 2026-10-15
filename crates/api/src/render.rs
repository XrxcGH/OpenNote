//! Draws a page's strokes as a PNG for `GET /v1/pages/{id}/render`, so an agent can look at handwriting and
//! drawings without a screenshot. Each stroke is a round-capped polyline over white, with its own color and
//! opacity; overlapping parts of one stroke are drawn once, so a highlighter doesn't darken where it crosses itself.
//! Text isn't drawn here: `read_page` and `inspect_page` give it.

use std::io::Cursor;

/// One stroke in page units.
#[derive(Debug, Clone, PartialEq)]
pub struct Polyline {
    pub points: Vec<(f64, f64)>,
    pub rgba: [u8; 4],
    pub width: f64,
}

/// A drawn page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    pub width: u32,
    pub height: u32,
    pub strokes: usize,
    pub png: Vec<u8>,
}

/// The longest side of a picture, in pixels.
pub const MAX_SIDE: u32 = 1600;
/// The most segments drawn; a page with more is drawn up to here and says so.
pub const MAX_SEGMENTS: usize = 400_000;
const MARGIN: f64 = 8.0;

/// Draws `lines` at most [`MAX_SIDE`] pixels on the longer side. A page without strokes is a small blank picture.
pub fn rasterize(lines: &[Polyline]) -> Rendered {
    let finite = |(x, y): &(f64, f64)| x.is_finite() && y.is_finite();
    let mut bounds: Option<(f64, f64, f64, f64)> = None;
    for line in lines {
        let pad = line.width.clamp(0.0, 200.0) / 2.0;
        for &(x, y) in line.points.iter().filter(|point| finite(point)) {
            let (a, b, c, d) = bounds.unwrap_or((x - pad, y - pad, x + pad, y + pad));
            bounds = Some((a.min(x - pad), b.min(y - pad), c.max(x + pad), d.max(y + pad)));
        }
    }
    let (min_x, min_y, max_x, max_y) = bounds.unwrap_or((0.0, 0.0, 64.0, 64.0));
    let (min_x, min_y) = (min_x - MARGIN, min_y - MARGIN);
    let (span_x, span_y) = (max_x + MARGIN - min_x, max_y + MARGIN - min_y);
    let scale = (f64::from(MAX_SIDE) / span_x.max(span_y)).min(2.0);
    let width = ((span_x * scale).ceil() as u32).clamp(1, MAX_SIDE);
    let height = ((span_y * scale).ceil() as u32).clamp(1, MAX_SIDE);
    let mut pixels = vec![255u8; width as usize * height as usize * 3];
    let mut segments = 0usize;
    let mut coverage = vec![0f32; 0];
    let mut drawn = 0;
    for line in lines {
        let points: Vec<(f64, f64)> = line
            .points
            .iter()
            .filter(|point| finite(point))
            .map(|(x, y)| ((x - min_x) * scale, (y - min_y) * scale))
            .collect();
        if points.is_empty() || segments >= MAX_SEGMENTS {
            continue;
        }
        let radius = (line.width.clamp(0.0, 200.0) * scale / 2.0).max(0.5);
        // This stroke's box in pixels, and its coverage there.
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for &(x, y) in &points {
            x0 = x0.min(x - radius - 1.0);
            y0 = y0.min(y - radius - 1.0);
            x1 = x1.max(x + radius + 1.0);
            y1 = y1.max(y + radius + 1.0);
        }
        let bx0 = x0.max(0.0) as usize;
        let by0 = y0.max(0.0) as usize;
        let bx1 = (x1.min(f64::from(width - 1)).max(0.0)) as usize;
        let by1 = (y1.min(f64::from(height - 1)).max(0.0)) as usize;
        if bx1 < bx0 || by1 < by0 {
            continue;
        }
        let bw = bx1 + 1 - bx0;
        coverage.clear();
        coverage.resize(bw * (by1 + 1 - by0), 0.0);
        let pairs: Vec<((f64, f64), (f64, f64))> = if points.len() == 1 {
            vec![(points[0], points[0])]
        } else {
            points.windows(2).map(|pair| (pair[0], pair[1])).collect()
        };
        for (a, b) in pairs {
            segments += 1;
            if segments > MAX_SEGMENTS {
                break;
            }
            let sx0 = ((a.0.min(b.0) - radius - 1.0).max(bx0 as f64)) as usize;
            let sy0 = ((a.1.min(b.1) - radius - 1.0).max(by0 as f64)) as usize;
            let sx1 = ((a.0.max(b.0) + radius + 1.0).min(bx1 as f64)) as usize;
            let sy1 = ((a.1.max(b.1) + radius + 1.0).min(by1 as f64)) as usize;
            for py in sy0..=sy1 {
                for px in sx0..=sx1 {
                    let distance = segment_distance((px as f64 + 0.5, py as f64 + 0.5), a, b);
                    let cover = (radius + 0.5 - distance).clamp(0.0, 1.0) as f32;
                    let cell = &mut coverage[(py - by0) * bw + (px - bx0)];
                    *cell = cell.max(cover);
                }
            }
        }
        let alpha = f32::from(line.rgba[3]) / 255.0;
        for py in by0..=by1 {
            for px in bx0..=bx1 {
                let cover = coverage[(py - by0) * bw + (px - bx0)] * alpha;
                if cover <= 0.0 {
                    continue;
                }
                let at = (py * width as usize + px) * 3;
                for channel in 0..3 {
                    let under = f32::from(pixels[at + channel]);
                    let over = f32::from(line.rgba[channel]);
                    pixels[at + channel] = (under + (over - under) * cover).round() as u8;
                }
            }
        }
        drawn += 1;
    }
    let mut png = Vec::new();
    let image = image::RgbImage::from_raw(width, height, pixels).unwrap_or_else(|| image::RgbImage::new(1, 1));
    if image.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).is_err() {
        png.clear();
    }
    Rendered {
        width,
        height,
        strokes: drawn,
        png,
    }
}

fn segment_distance(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length = dx * dx + dy * dy;
    let t = if length == 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / length).clamp(0.0, 1.0)
    };
    let (cx, cy) = (a.0 + t * dx, a.1 + t * dy);
    ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rendered: &Rendered, x: u32, y: u32) -> [u8; 3] {
        let image = image::load_from_memory(&rendered.png).expect("a png").to_rgb8();
        image.get_pixel(x, y).0
    }

    #[test]
    fn draws_strokes_in_their_color_on_white() {
        let line = Polyline {
            points: vec![(0.0, 0.0), (100.0, 0.0)],
            rgba: [200, 0, 0, 255],
            width: 4.0,
        };
        let rendered = rasterize(&[line]);
        assert_eq!(rendered.strokes, 1);
        assert!(rendered.width > rendered.height);
        let middle_y = rendered.height / 2;
        assert_eq!(pixel(&rendered, rendered.width / 2, middle_y), [200, 0, 0]);
        assert_eq!(pixel(&rendered, 0, 0), [255, 255, 255]);
    }

    #[test]
    fn a_page_without_strokes_or_with_nonsense_is_still_a_picture() {
        assert!(!rasterize(&[]).png.is_empty());
        let nonsense = Polyline {
            points: vec![(f64::NAN, 1.0), (f64::INFINITY, 2.0), (1e300, -1e300)],
            rgba: [0, 0, 0, 255],
            width: f64::MAX,
        };
        let rendered = rasterize(&[nonsense]);
        assert!(rendered.width <= MAX_SIDE && rendered.height <= MAX_SIDE);
        assert!(!rendered.png.is_empty());
    }
}
