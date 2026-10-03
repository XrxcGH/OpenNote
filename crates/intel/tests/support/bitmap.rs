//! Test helpers: a tiny bitmap font, so tests can draw text without fonts or downloads.

use opennote_intel::ocr::{OcrImage, PixelFormat};

const GLYPH_ROWS: usize = 7;
const GLYPH_COLUMNS: usize = 5;

/// A 5 by 7 capital letter, row by row. Only the letters the tests need.
fn glyph(letter: char) -> Option<[&'static str; GLYPH_ROWS]> {
    Some(match letter {
        'H' => ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
        'E' => ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
        'L' => ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
        'O' => [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
        'P' => ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
        'N' => ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
        'T' => ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
        ' ' => ["....."; GLYPH_ROWS],
        _ => return None,
    })
}

/// Where the text of a rendered image sits, for checking word boxes.
pub struct Layout {
    /// The margin around the text, in pixels.
    pub margin: u32,
    /// Pixels per font dot.
    pub scale: u32,
}

impl Layout {
    /// The height of one line of text.
    pub fn line_height(&self) -> u32 {
        GLYPH_ROWS as u32 * self.scale
    }

    /// The top of line `index`, which are spaced one line height apart with a gap of the same size.
    pub fn line_top(&self, index: u32) -> u32 {
        self.margin + index * self.line_height() * 2
    }

    /// The left edge of the character at `column` of a line.
    pub fn column_left(&self, column: u32) -> u32 {
        self.margin + column * (GLYPH_COLUMNS as u32 + 1) * self.scale
    }
}

/// Draws `lines` as black text and returns the image. The background is white, or fully
/// transparent when `transparent` is set, which makes an RGBA image.
pub fn render(lines: &[&str], layout: &Layout, transparent: bool) -> OcrImage {
    let columns = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0) as u32;
    let width = layout.column_left(columns) + layout.margin;
    let height = layout.line_top(lines.len() as u32) + layout.margin;
    let (format, background, ink): (_, &[u8], &[u8]) = if transparent {
        (PixelFormat::Rgba8, &[255, 255, 255, 0], &[0, 0, 0, 255])
    } else {
        (PixelFormat::Gray8, &[255], &[0])
    };
    let bpp = format.bytes_per_pixel();
    let mut pixels: Vec<u8> = background
        .iter()
        .copied()
        .cycle()
        .take((width * height) as usize * bpp)
        .collect();
    for (row, line) in lines.iter().enumerate() {
        for (column, letter) in line.chars().enumerate() {
            let dots = glyph(letter).unwrap_or_else(|| panic!("the test font has no {letter:?}"));
            for (dy, dot_row) in dots.iter().enumerate() {
                for dx in dot_row
                    .chars()
                    .enumerate()
                    .filter(|&(_, dot)| dot == '#')
                    .map(|(dx, _)| dx)
                {
                    let left = layout.column_left(column as u32) + dx as u32 * layout.scale;
                    let top = layout.line_top(row as u32) + dy as u32 * layout.scale;
                    fill(&mut pixels, width, (left, top, layout.scale), ink);
                }
            }
        }
    }
    OcrImage::new(width, height, format, pixels).expect("the image is well formed")
}

/// Fills a square of `size` pixels at `(left, top)` with one pixel's bytes.
fn fill(pixels: &mut [u8], width: u32, (left, top, size): (u32, u32, u32), color: &[u8]) {
    for y in top..top + size {
        for x in left..left + size {
            let at = (y * width + x) as usize * color.len();
            pixels[at..at + color.len()].copy_from_slice(color);
        }
    }
}
