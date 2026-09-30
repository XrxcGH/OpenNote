//! Compares a screenshot of a sheet with the matching PDF page rendered at the same resolution.
//!
//! Pixel differences mix real layout changes with antialiasing, which differs between the screen and a PDF
//! renderer. So this module also measures geometry that ignores antialiasing. It finds offsets by aligning ink
//! profiles, local shifts of small tiles, and ink that differs by more than 1 pixel.

use image::{Rgb, RgbImage, RgbaImage};
use serde::Serialize;

/// Darkness at or above this (0 to 255) counts as ink: text, pen strokes, and dark lines, but not paper rules.
pub const INK_THRESHOLD: f32 = 128.0;

/// A grayscale image stored as darkness: 0 is white, 255 is black.
pub struct Gray {
    pub width: usize,
    pub height: usize,
    pub dark: Vec<f32>,
}

impl Gray {
    /// Converts the top-left `width` by `height` pixels of an image, using Rec. 709 luma weights.
    pub fn from_rgba(image: &RgbaImage, width: usize, height: usize) -> Gray {
        let mut dark = Vec::with_capacity(width * height);
        for y in 0..height as u32 {
            for x in 0..width as u32 {
                let [r, g, b, _] = image.get_pixel(x, y).0;
                let luma = 0.2126 * f32::from(r) + 0.7152 * f32::from(g) + 0.0722 * f32::from(b);
                dark.push(255.0 - luma);
            }
        }
        Gray { width, height, dark }
    }

    fn at(&self, x: usize, y: usize) -> f32 {
        self.dark[y * self.width + x]
    }

    fn ink(&self, x: usize, y: usize) -> bool {
        self.at(x, y) >= INK_THRESHOLD
    }

    /// Total darkness of each row.
    pub fn rows(&self) -> Vec<f64> {
        self.dark
            .chunks(self.width)
            .map(|row| row.iter().map(|&v| f64::from(v)).sum())
            .collect()
    }

    /// Total darkness of each column.
    pub fn columns(&self) -> Vec<f64> {
        let mut sums = vec![0.0; self.width];
        for row in self.dark.chunks(self.width) {
            for (sum, &value) in sums.iter_mut().zip(row) {
                *sum += f64::from(value);
            }
        }
        sums
    }
}

/// Raw pixel differences over the common area of two images, in 8-bit channel steps.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PixelStats {
    pub mean_abs_diff: f64,
    /// Share of pixels where some channel differs by more than 16.
    pub share_over_16: f64,
    /// Share of pixels where some channel differs by more than 64.
    pub share_over_64: f64,
}

pub fn pixel_stats(a: &RgbaImage, b: &RgbaImage, width: u32, height: u32) -> PixelStats {
    let (mut total, mut over_16, mut over_64) = (0u64, 0u64, 0u64);
    for y in 0..height {
        for x in 0..width {
            let (pa, pb) = (a.get_pixel(x, y).0, b.get_pixel(x, y).0);
            let diffs = [0, 1, 2].map(|c| pa[c].abs_diff(pb[c]));
            total += diffs.iter().map(|&d| u64::from(d)).sum::<u64>();
            let worst = diffs.into_iter().max().unwrap_or(0);
            over_16 += u64::from(worst > 16);
            over_64 += u64::from(worst > 64);
        }
    }
    let pixels = (f64::from(width) * f64::from(height)).max(1.0);
    PixelStats {
        mean_abs_diff: total as f64 / (pixels * 3.0),
        share_over_16: over_16 as f64 / pixels,
        share_over_64: over_64 as f64 / pixels,
    }
}

/// How far `b` is shifted from `a` along one axis, and how well they match at that shift.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Offset {
    /// Positive when `b`'s content sits further right or down, in pixels, refined below a pixel.
    pub shift_px: f64,
    /// Normalized cross-correlation at the best whole-pixel shift, from -1 to 1.
    pub correlation: f64,
}

/// Aligns two profiles (row or column sums) by normalized cross-correlation within `max_shift` pixels.
pub fn profile_offset(a: &[f64], b: &[f64], max_shift: usize) -> Offset {
    let n = a.len().min(b.len());
    let mean = |v: &[f64]| v[..n].iter().sum::<f64>() / n.max(1) as f64;
    let (mean_a, mean_b) = (mean(a), mean(b));
    let score = |shift: i64| {
        let (mut dot, mut norm_a, mut norm_b) = (0.0, 0.0, 0.0);
        for i in 0..n as i64 {
            let j = i + shift;
            if j < 0 || j >= n as i64 {
                continue;
            }
            let (x, y) = (a[i as usize] - mean_a, b[j as usize] - mean_b);
            dot += x * y;
            norm_a += x * x;
            norm_b += y * y;
        }
        let norm = (norm_a * norm_b).sqrt();
        if norm > 0.0 {
            dot / norm
        } else {
            0.0
        }
    };
    let range = max_shift as i64;
    let scores: Vec<f64> = (-range..=range).map(score).collect();
    let best = (0..scores.len())
        .max_by(|&i, &j| {
            scores[i]
                .total_cmp(&scores[j])
                .then((j as i64 - range).abs().cmp(&(i as i64 - range).abs()))
        })
        .unwrap_or(max_shift);
    let refine = if best > 0 && best + 1 < scores.len() {
        parabola_peak(scores[best - 1], scores[best], scores[best + 1])
    } else {
        0.0
    };
    Offset {
        shift_px: best as f64 - range as f64 + refine,
        correlation: scores[best],
    }
}

/// The offset of a parabola's peak through three evenly spaced samples, from -0.5 to 0.5.
fn parabola_peak(left: f64, middle: f64, right: f64) -> f64 {
    let curvature = left - 2.0 * middle + right;
    if curvature.abs() < f64::EPSILON {
        return 0.0;
    }
    (0.5 * (left - right) / curvature).clamp(-0.5, 0.5)
}

/// Local alignment: each tile with ink is matched against the other image within a small search window.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct TileStats {
    pub tile_px: usize,
    pub search_px: usize,
    pub with_ink: usize,
    /// Tiles whose best match is at no shift at all.
    pub at_zero: usize,
    /// Tiles whose best match is within 1 pixel in both directions.
    pub within_1px: usize,
    /// The largest shift of any tile, in pixels (the larger of the two directions).
    pub max_shift_px: usize,
    /// The tile with the largest shift: its top-left corner and the shift found.
    pub worst: Option<[i64; 4]>,
}

/// Finds the best whole-pixel shift of each tile of `a` in `b`, by mean absolute darkness difference.
pub fn tile_shifts(a: &Gray, b: &Gray, tile: usize, radius: usize) -> TileStats {
    let mut stats = TileStats {
        tile_px: tile,
        search_px: radius,
        ..TileStats::default()
    };
    let (width, height) = (a.width.min(b.width), a.height.min(b.height));
    let mut y = radius;
    while y + tile + radius <= height {
        let mut x = radius;
        while x + tile + radius <= width {
            if has_ink(a, x, y, tile) {
                let (dx, dy) = best_shift(a, b, (x, y), tile, radius as i64);
                record_tile(&mut stats, [x as i64, y as i64, dx, dy]);
            }
            x += tile;
        }
        y += tile;
    }
    stats
}

fn has_ink(image: &Gray, x: usize, y: usize, tile: usize) -> bool {
    let inked = (y..y + tile).flat_map(|row| (x..x + tile).map(move |col| (col, row)));
    inked.filter(|&(col, row)| image.ink(col, row)).count() * 50 >= tile * tile
}

fn best_shift(a: &Gray, b: &Gray, (x, y): (usize, usize), tile: usize, radius: i64) -> (i64, i64) {
    let cost = |dx: i64, dy: i64| {
        let mut sum = 0.0f32;
        for row in y..y + tile {
            let other = (row as i64 + dy) as usize;
            for col in x..x + tile {
                sum += (a.at(col, row) - b.at((col as i64 + dx) as usize, other)).abs();
            }
        }
        sum
    };
    let mut best: (i64, i64, f32) = (0, 0, cost(0, 0));
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let value = cost(dx, dy);
            let nearer = dx.abs().max(dy.abs()) < best.0.abs().max(best.1.abs());
            if value < best.2 * 0.999 || (value <= best.2 && nearer) {
                best = (dx, dy, value);
            }
        }
    }
    (best.0, best.1)
}

fn record_tile(stats: &mut TileStats, tile: [i64; 4]) {
    let shift = tile[2].unsigned_abs().max(tile[3].unsigned_abs()) as usize;
    stats.with_ink += 1;
    stats.at_zero += usize::from(shift == 0);
    stats.within_1px += usize::from(shift <= 1);
    if shift > stats.max_shift_px {
        stats.max_shift_px = shift;
        stats.worst = Some(tile);
    }
}

/// Grows an ink mask by `radius` pixels in every direction (a square dilation).
fn dilate(image: &Gray, radius: usize) -> Vec<bool> {
    let (w, h) = (image.width, image.height);
    let mut rows = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let (from, to) = (x.saturating_sub(radius), (x + radius).min(w - 1));
            rows[y * w + x] = (from..=to).any(|col| image.ink(col, y));
        }
    }
    let mut grown = vec![false; w * h];
    for y in 0..h {
        let (from, to) = (y.saturating_sub(radius), (y + radius).min(h - 1));
        for x in 0..w {
            grown[y * w + x] = (from..=to).any(|row| rows[row * w + x]);
        }
    }
    grown
}

/// The share of ink pixels, in either image, with no ink in the other image within `tolerance` pixels.
pub fn ink_mismatch(a: &Gray, b: &Gray, tolerance: usize) -> f64 {
    let (near_a, near_b) = (dilate(a, tolerance), dilate(b, tolerance));
    let (mut ink, mut unmatched) = (0usize, 0usize);
    for i in 0..a.dark.len().min(b.dark.len()) {
        let (in_a, in_b) = (a.dark[i] >= INK_THRESHOLD, b.dark[i] >= INK_THRESHOLD);
        ink += usize::from(in_a) + usize::from(in_b);
        unmatched += usize::from(in_a && !near_b[i]) + usize::from(in_b && !near_a[i]);
    }
    if ink == 0 {
        0.0
    } else {
        unmatched as f64 / ink as f64
    }
}

/// A picture of the differences: ink in both in gray, ink only on screen in red, ink only in the PDF in blue.
/// Pale colors mark ink that is off by exactly 1 pixel, which antialiasing alone can cause.
pub fn overlay(screen: &Gray, pdf: &Gray) -> RgbImage {
    let (near_screen, near_pdf) = (dilate(screen, 1), dilate(pdf, 1));
    RgbImage::from_fn(screen.width as u32, screen.height as u32, |x, y| {
        let i = y as usize * screen.width + x as usize;
        let (s, p) = (screen.dark[i] >= INK_THRESHOLD, pdf.dark[i] >= INK_THRESHOLD);
        Rgb(match (s, p) {
            (true, true) => [96, 96, 96],
            (true, false) if near_pdf[i] => [240, 170, 170],
            (true, false) => [220, 0, 0],
            (false, true) if near_screen[i] => [170, 190, 240],
            (false, true) => [0, 60, 230],
            (false, false) => {
                let paper = 255 - (screen.dark[i] * 0.25) as u8;
                [paper, paper, paper]
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    /// A white image with a few black glyph-like boxes, shifted by (dx, dy).
    fn page(dx: i64, dy: i64) -> RgbaImage {
        RgbaImage::from_fn(200, 160, |x, y| {
            let (x, y) = (x as i64 - dx, y as i64 - dy);
            let inked = [(20, 20, 30, 12), (70, 24, 8, 40), (110, 90, 50, 6), (40, 100, 16, 16)]
                .iter()
                .any(|&(bx, by, bw, bh)| x >= bx && x < bx + bw && y >= by && y < by + bh);
            if inked {
                Rgba([20, 20, 20, 255])
            } else {
                Rgba([255, 252, 246, 255])
            }
        })
    }

    fn gray(image: &RgbaImage) -> Gray {
        Gray::from_rgba(image, image.width() as usize, image.height() as usize)
    }

    #[test]
    fn identical_pages_have_no_differences() {
        let a = page(0, 0);
        let stats = pixel_stats(&a, &a, 200, 160);
        assert_eq!(stats.mean_abs_diff, 0.0);
        assert_eq!(stats.share_over_16, 0.0);
        let g = gray(&a);
        assert_eq!(profile_offset(&g.rows(), &g.rows(), 10).shift_px, 0.0);
        assert_eq!(ink_mismatch(&g, &g, 0), 0.0);
        let tiles = tile_shifts(&g, &g, 32, 4);
        assert!(tiles.with_ink > 0);
        assert_eq!(tiles.at_zero, tiles.with_ink);
        assert_eq!(tiles.max_shift_px, 0);
    }

    #[test]
    fn finds_a_shift_between_pages() {
        let (a, b) = (gray(&page(0, 0)), gray(&page(2, -3)));
        let columns = profile_offset(&a.columns(), &b.columns(), 10);
        let rows = profile_offset(&a.rows(), &b.rows(), 10);
        assert!((columns.shift_px - 2.0).abs() < 0.3, "columns {columns:?}");
        assert!((rows.shift_px + 3.0).abs() < 0.3, "rows {rows:?}");
        assert!(columns.correlation > 0.9);
        let tiles = tile_shifts(&a, &b, 32, 4);
        assert_eq!(tiles.max_shift_px, 3);
        assert_eq!(tiles.at_zero, 0);
    }

    #[test]
    fn a_one_pixel_tolerance_forgives_a_one_pixel_shift() {
        let (a, b) = (gray(&page(0, 0)), gray(&page(1, 0)));
        assert!(ink_mismatch(&a, &b, 0) > 0.0);
        assert_eq!(ink_mismatch(&a, &b, 1), 0.0);
        let far = gray(&page(4, 0));
        assert!(ink_mismatch(&a, &far, 1) > 0.0);
    }

    #[test]
    fn refines_a_peak_between_pixels() {
        assert_eq!(parabola_peak(1.0, 2.0, 1.0), 0.0);
        assert!(parabola_peak(1.0, 2.0, 1.5) > 0.0);
        assert!(parabola_peak(1.5, 2.0, 1.0) < 0.0);
    }

    #[test]
    fn draws_an_overlay_of_the_differences() {
        let (a, b) = (gray(&page(0, 0)), gray(&page(3, 0)));
        let picture = overlay(&a, &b);
        assert_eq!(picture.dimensions(), (200, 160));
        assert_eq!(picture.get_pixel(20, 20).0, [220, 0, 0]);
        assert_eq!(picture.get_pixel(25, 25).0, [96, 96, 96]);
    }
}
