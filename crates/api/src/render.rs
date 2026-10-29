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

fn finite((x, y): &(f64, f64)) -> bool {
    x.is_finite() && y.is_finite()
}

/// Where page units land in the picture: subtract the origin, then multiply by the scale.
struct Frame {
    min_x: f64,
    min_y: f64,
    scale: f64,
    width: u32,
    height: u32,
}

impl Frame {
    /// The frame around every finite point, with each stroke's half width and a margin.
    fn around(lines: &[Polyline]) -> Frame {
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
        Frame {
            min_x,
            min_y,
            scale,
            width: ((span_x * scale).ceil() as u32).clamp(1, MAX_SIDE),
            height: ((span_y * scale).ceil() as u32).clamp(1, MAX_SIDE),
        }
    }
}

/// A box of pixels, inclusive.
#[derive(Clone, Copy)]
struct Area {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
}

impl Area {
    /// The pixels within `reach` of any point, inside `limit`; none when that is empty.
    fn around(points: &[(f64, f64)], reach: f64, limit: Area) -> Option<Area> {
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for &(x, y) in points {
            x0 = x0.min(x - reach);
            y0 = y0.min(y - reach);
            x1 = x1.max(x + reach);
            y1 = y1.max(y + reach);
        }
        let area = Area {
            x0: x0.max(limit.x0 as f64) as usize,
            y0: y0.max(limit.y0 as f64) as usize,
            x1: x1.min(limit.x1 as f64).max(0.0) as usize,
            y1: y1.min(limit.y1 as f64).max(0.0) as usize,
        };
        (area.x1 >= area.x0 && area.y1 >= area.y0).then_some(area)
    }

    fn width(self) -> usize {
        self.x1 + 1 - self.x0
    }

    fn index(self, x: usize, y: usize) -> usize {
        (y - self.y0) * self.width() + (x - self.x0)
    }
}

/// The picture being drawn.
struct Canvas {
    frame: Frame,
    pixels: Vec<u8>,
    coverage: Vec<f32>,
    segments: usize,
}

impl Canvas {
    fn whole(&self) -> Area {
        Area {
            x0: 0,
            y0: 0,
            x1: self.frame.width as usize - 1,
            y1: self.frame.height as usize - 1,
        }
    }

    /// Draws one stroke; false when it had nothing to draw or the segment budget is spent.
    fn stroke(&mut self, line: &Polyline) -> bool {
        let frame = &self.frame;
        let points: Vec<(f64, f64)> = line
            .points
            .iter()
            .filter(|point| finite(point))
            .map(|(x, y)| ((x - frame.min_x) * frame.scale, (y - frame.min_y) * frame.scale))
            .collect();
        if points.is_empty() || self.segments >= MAX_SEGMENTS {
            return false;
        }
        let radius = (line.width.clamp(0.0, 200.0) * frame.scale / 2.0).max(0.5);
        let Some(area) = Area::around(&points, radius + 1.0, self.whole()) else {
            return false;
        };
        self.coverage.clear();
        self.coverage.resize(area.width() * (area.y1 + 1 - area.y0), 0.0);
        let pairs: Vec<((f64, f64), (f64, f64))> = if points.len() == 1 {
            vec![(points[0], points[0])]
        } else {
            points.windows(2).map(|pair| (pair[0], pair[1])).collect()
        };
        for (a, b) in pairs {
            self.segments += 1;
            if self.segments > MAX_SEGMENTS {
                break;
            }
            self.cover(a, b, radius, area);
        }
        self.blend(line.rgba, area);
        true
    }

    /// Marks how much of each pixel the segment from `a` to `b` covers, keeping the most of any segment.
    fn cover(&mut self, a: (f64, f64), b: (f64, f64), radius: f64, area: Area) {
        let Some(near) = Area::around(&[a, b], radius + 1.0, area) else {
            return;
        };
        for y in near.y0..=near.y1 {
            for x in near.x0..=near.x1 {
                let distance = segment_distance((x as f64 + 0.5, y as f64 + 0.5), a, b);
                let cover = (radius + 0.5 - distance).clamp(0.0, 1.0) as f32;
                let cell = &mut self.coverage[area.index(x, y)];
                *cell = cell.max(cover);
            }
        }
    }

    /// Lays the stroke's color over the picture by its coverage and opacity.
    fn blend(&mut self, rgba: [u8; 4], area: Area) {
        let alpha = f32::from(rgba[3]) / 255.0;
        let width = self.frame.width as usize;
        for y in area.y0..=area.y1 {
            for x in area.x0..=area.x1 {
                let cover = self.coverage[area.index(x, y)] * alpha;
                if cover <= 0.0 {
                    continue;
                }
                let at = (y * width + x) * 3;
                for (pixel, over) in self.pixels[at..at + 3].iter_mut().zip(rgba) {
                    let (under, over) = (f32::from(*pixel), f32::from(over));
                    *pixel = (under + (over - under) * cover).round() as u8;
                }
            }
        }
    }
}

/// Draws `lines` at most [`MAX_SIDE`] pixels on the longer side. A page without strokes is a small blank picture.
pub fn rasterize(lines: &[Polyline]) -> Rendered {
    let frame = Frame::around(lines);
    let (width, height) = (frame.width, frame.height);
    let mut canvas = Canvas {
        pixels: vec![255u8; width as usize * height as usize * 3],
        frame,
        coverage: Vec::new(),
        segments: 0,
    };
    let strokes = lines.iter().filter(|line| canvas.stroke(line)).count();
    let mut png = Vec::new();
    let image = image::RgbImage::from_raw(width, height, canvas.pixels).unwrap_or_else(|| image::RgbImage::new(1, 1));
    if image
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .is_err()
    {
        png.clear();
    }
    Rendered {
        width,
        height,
        strokes,
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
