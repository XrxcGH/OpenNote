//! Handwriting read as a picture, for the platforms whose recognizer reads images rather than strokes: Apple's
//! Vision on a Mac, and Tesseract on Linux. The strokes are drawn dark on white at a size the OCR engine reads
//! well, the engine finds the words, and each stroke goes to the word whose box it overlaps most. A stroke that
//! overlaps no word is taken for drawing and left out, as Ink Analysis does on Windows.

use std::sync::Arc;

use super::{validate_all, InkLine, InkOptions, InkRecognition, InkRecognizer, InkStroke, InkWord, StrokeKey};
use crate::error::IntelError;
use crate::geometry::Rect;
use crate::ocr::{OcrEngine, OcrImage, OcrOptions, PixelFormat, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE};

/// How tall, in pixels, a typical stroke is drawn. A letter's strokes are about its height, and OCR engines read
/// letters of about this size best.
const STROKE_HEIGHT: f32 = 36.0;
/// White space around the writing, in pixels.
const MARGIN: f32 = 24.0;
/// Half the width of a drawn line, in pixels.
const PEN_RADIUS: f32 = 1.8;

/// Where the strokes were drawn: a page point `p` is at pixel `(p - origin) * scale + MARGIN`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Placement {
    pub origin_x: f32,
    pub origin_y: f32,
    pub scale: f32,
}

impl Placement {
    /// A box in the picture's pixels, back in page units.
    pub fn to_page(self, pixels: &Rect) -> Rect {
        Rect {
            x: (pixels.x - MARGIN) / self.scale + self.origin_x,
            y: (pixels.y - MARGIN) / self.scale + self.origin_y,
            width: pixels.width / self.scale,
            height: pixels.height / self.scale,
        }
    }
}

fn stroke_box(stroke: &InkStroke) -> Rect {
    let (mut left, mut top, mut right, mut bottom) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for point in &stroke.points {
        left = left.min(point.x);
        top = top.min(point.y);
        right = right.max(point.x);
        bottom = bottom.max(point.y);
    }
    Rect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

/// Draws the strokes, black on white, one byte per pixel. The scale makes the median stroke, by its longer side,
/// [`STROKE_HEIGHT`] pixels tall, and shrinks the picture when it would pass the OCR size limits.
pub(crate) fn draw(strokes: &[InkStroke]) -> Result<(OcrImage, Placement), IntelError> {
    let boxes: Vec<Rect> = strokes.iter().map(stroke_box).collect();
    let all = Rect::union_all(&boxes).ok_or_else(|| IntelError::InvalidInput("no strokes to read".to_owned()))?;
    let mut heights: Vec<f32> = boxes.iter().map(|b| b.height.max(b.width)).collect();
    heights.sort_by(f32::total_cmp);
    let typical = heights[heights.len() / 2].max(1e-3);
    let mut scale = (STROKE_HEIGHT / typical).clamp(0.05, 50.0);
    let side = |extent: f32, scale: f32| extent * scale + 2.0 * MARGIN;
    let max_side = MAX_IMAGE_SIDE as f32 - 2.0;
    for _ in 0..64 {
        let (w, h) = (side(all.width, scale), side(all.height, scale));
        if w <= max_side && h <= max_side && f64::from(w) * f64::from(h) <= MAX_IMAGE_PIXELS as f64 * 0.98 {
            break;
        }
        scale *= 0.8;
    }
    let width = side(all.width, scale).ceil().max(1.0) as u32;
    let height = side(all.height, scale).ceil().max(1.0) as u32;
    let placement = Placement {
        origin_x: all.x,
        origin_y: all.y,
        scale,
    };
    let mut pixels = vec![255u8; width as usize * height as usize];
    let to_pixel = |x: f32, y: f32| ((x - all.x) * scale + MARGIN, (y - all.y) * scale + MARGIN);
    for stroke in strokes {
        let points: Vec<(f32, f32)> = stroke.points.iter().map(|p| to_pixel(p.x, p.y)).collect();
        if points.len() == 1 {
            line(&mut pixels, width, height, points[0], points[0]);
        }
        for pair in points.windows(2) {
            line(&mut pixels, width, height, pair[0], pair[1]);
        }
    }
    Ok((OcrImage::new(width, height, PixelFormat::Gray8, pixels)?, placement))
}

/// Darkens every pixel whose center is within [`PEN_RADIUS`] of the segment.
fn line(pixels: &mut [u8], width: u32, height: u32, a: (f32, f32), b: (f32, f32)) {
    let r = PEN_RADIUS;
    let left = (a.0.min(b.0) - r).floor().max(0.0) as u32;
    let top = (a.1.min(b.1) - r).floor().max(0.0) as u32;
    let right = ((a.0.max(b.0) + r).ceil() as u32).min(width.saturating_sub(1));
    let bottom = ((a.1.max(b.1) + r).ceil() as u32).min(height.saturating_sub(1));
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length = dx * dx + dy * dy;
    for y in top..=bottom {
        for x in left..=right {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let t = if length > 0.0 {
                (((px - a.0) * dx + (py - a.1) * dy) / length).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let (cx, cy) = (a.0 + t * dx - px, a.1 + t * dy - py);
            if cx * cx + cy * cy <= r * r {
                pixels[y as usize * width as usize + x as usize] = 0;
            }
        }
    }
}

fn overlap(a: &Rect, b: &Rect) -> f32 {
    let w = a.right().min(b.right()) - a.x.max(b.x);
    let h = a.bottom().min(b.bottom()) - a.y.max(b.y);
    // A straight stroke has no height or width, so a line touching the box still counts a little.
    (w.max(0.0) + 1e-3) * (h.max(0.0) + 1e-3) * f32::from(u8::from(w >= 0.0 && h >= 0.0))
}

/// Handwriting through an OCR engine.
pub struct PictureInk {
    ocr: Arc<dyn OcrEngine>,
}

impl PictureInk {
    /// Reads handwriting with `ocr`.
    pub fn new(ocr: Arc<dyn OcrEngine>) -> PictureInk {
        PictureInk { ocr }
    }
}

impl InkRecognizer for PictureInk {
    fn recognize(&self, strokes: &[InkStroke], _options: &InkOptions) -> Result<InkRecognition, IntelError> {
        validate_all(strokes)?;
        if strokes.is_empty() {
            return Ok(InkRecognition::default());
        }
        let (image, placement) = draw(strokes)?;
        let found = self.ocr.recognize(&image, &OcrOptions::default())?;
        let boxes: Vec<Rect> = strokes.iter().map(stroke_box).collect();
        // Every word of every line, in page units, with the strokes it gets.
        let mut words: Vec<(usize, Rect, String, Vec<usize>)> = Vec::new();
        for (index, line) in found.lines.iter().enumerate() {
            for word in &line.words {
                words.push((index, placement.to_page(&word.bounds), word.text.clone(), Vec::new()));
            }
        }
        for (stroke, stroke_box) in boxes.iter().enumerate() {
            let best = words
                .iter()
                .enumerate()
                .map(|(at, (_, word_box, _, _))| (at, overlap(stroke_box, word_box)))
                .filter(|(_, area)| *area > 0.0)
                .max_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((at, _)) = best {
                words[at].3.push(stroke);
            }
        }
        let mut lines: Vec<InkLine> = Vec::new();
        for (index, _) in found.lines.iter().enumerate() {
            let line_words: Vec<InkWord> = words
                .iter()
                .filter(|(line, _, _, kept)| *line == index && !kept.is_empty())
                .map(|(_, word_box, text, kept)| InkWord {
                    text: text.clone(),
                    alternates: Vec::new(),
                    strokes: kept.iter().map(|&at| strokes[at].key).collect::<Vec<StrokeKey>>(),
                    bounds: Rect::union_all(kept.iter().map(|&at| &boxes[at])).unwrap_or(*word_box),
                })
                .collect();
            let Some(bounds) = Rect::union_all(line_words.iter().map(|word| &word.bounds)) else {
                continue;
            };
            lines.push(InkLine {
                text: line_words
                    .iter()
                    .map(|word| word.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                bounds,
                words: line_words,
            });
        }
        Ok(InkRecognition { lines })
    }

    fn check_ready(&self) -> Result<(), IntelError> {
        self.ocr.check_ready()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::geometry::Language;
    use crate::ink::InkPoint;
    use crate::ocr::{OcrLine, OcrResult, OcrWord};

    fn stroke(id: u8, points: &[(f32, f32)]) -> InkStroke {
        InkStroke {
            key: StrokeKey([id; 16]),
            points: points.iter().map(|&(x, y)| InkPoint { x, y }).collect(),
        }
    }

    #[test]
    fn strokes_are_drawn_dark_on_white_at_a_readable_size() {
        // One upright stroke 10 units tall, and a dot.
        let (image, placement) = draw(&[stroke(1, &[(5.0, 0.0), (5.0, 10.0)]), stroke(2, &[(20.0, 5.0)])]).unwrap();
        assert_eq!(
            placement.scale,
            STROKE_HEIGHT / 10.0,
            "the median stroke is drawn at the set height"
        );
        let at = |x: f32, y: f32| {
            let (px, py) = (
                (x * placement.scale + MARGIN) as usize,
                (y * placement.scale + MARGIN) as usize,
            );
            image.pixels()[py * image.width() as usize + px]
        };
        assert_eq!(at(0.0, 5.0), 0, "the stroke is drawn");
        assert_eq!(at(15.0, 5.0), 0, "the dot is drawn");
        assert_eq!(at(7.0, 5.0), 255, "the space between is white");
        assert_eq!(image.pixels()[0], 255, "the margin is white");
        let back = placement.to_page(&Rect {
            x: MARGIN,
            y: MARGIN,
            width: placement.scale * 15.0,
            height: placement.scale * 10.0,
        });
        assert!((back.x - 5.0).abs() < 1e-4 && (back.width - 15.0).abs() < 1e-4);
    }

    #[test]
    fn a_long_page_of_writing_is_shrunk_to_the_size_limits() {
        let strokes: Vec<InkStroke> = (0..400)
            .map(|i| stroke(1, &[(i as f32 * 40.0, 0.0), (i as f32 * 40.0 + 5.0, 10.0)]))
            .collect();
        let (image, _) = draw(&strokes).unwrap();
        assert!(image.width() <= MAX_IMAGE_SIDE && image.height() <= MAX_IMAGE_SIDE);
    }

    /// An OCR engine that finds the words it was given, at boxes in the picture's pixels, and keeps the picture.
    struct Found {
        words: Vec<(usize, &'static str, Rect)>,
        seen: Mutex<Option<(u32, u32)>>,
    }

    impl OcrEngine for Found {
        fn available_languages(&self) -> Result<Vec<Language>, IntelError> {
            Ok(vec![Language::new("en")?])
        }

        fn recognize(&self, image: &OcrImage, _: &OcrOptions) -> Result<OcrResult, IntelError> {
            *self.seen.lock().unwrap() = Some((image.width(), image.height()));
            let mut lines: Vec<OcrLine> = Vec::new();
            for (line, text, bounds) in &self.words {
                if lines.len() <= *line {
                    lines.push(OcrLine {
                        text: String::new(),
                        bounds: *bounds,
                        words: Vec::new(),
                    });
                }
                lines[*line].words.push(OcrWord {
                    text: (*text).to_owned(),
                    bounds: *bounds,
                });
            }
            Ok(OcrResult {
                language: Language::new("en")?,
                lines,
                angle: None,
            })
        }
    }

    #[test]
    fn each_stroke_goes_to_the_word_it_overlaps_and_drawings_are_left_out() {
        // "hi" written as two strokes, "yo" as one, on two lines, and a doodle far below.
        let strokes = [
            stroke(1, &[(0.0, 0.0), (0.0, 10.0)]),
            stroke(2, &[(4.0, 3.0), (4.0, 10.0)]),
            stroke(3, &[(0.0, 20.0), (8.0, 30.0)]),
            stroke(4, &[(0.0, 80.0), (30.0, 90.0)]),
        ];
        let (_, placement) = draw(&strokes).unwrap();
        // The engine's word boxes, in pixels of the picture.
        let pixels = |x: f32, y: f32, w: f32, h: f32| Rect {
            x: x * placement.scale + MARGIN,
            y: y * placement.scale + MARGIN,
            width: w * placement.scale,
            height: h * placement.scale,
        };
        let ocr = Arc::new(Found {
            words: vec![
                (0, "hi", pixels(-1.0, -1.0, 6.0, 12.0)),
                (1, "yo", pixels(-1.0, 19.0, 10.0, 12.0)),
            ],
            seen: Mutex::new(None),
        });
        let found = PictureInk::new(ocr.clone())
            .recognize(&strokes, &InkOptions::default())
            .unwrap();
        assert!(ocr.seen.lock().unwrap().is_some(), "the engine read a picture");
        assert_eq!(found.text(), "hi\nyo");
        assert_eq!(
            found.lines[0].words[0].strokes,
            vec![StrokeKey([1; 16]), StrokeKey([2; 16])]
        );
        assert_eq!(found.lines[1].words[0].strokes, vec![StrokeKey([3; 16])]);
        let bounds = found.lines[0].words[0].bounds;
        assert_eq!((bounds.x, bounds.y, bounds.width, bounds.height), (0.0, 0.0, 4.0, 10.0));
        assert!(
            found
                .lines
                .iter()
                .flat_map(|l| &l.words)
                .all(|w| !w.strokes.contains(&StrokeKey([4; 16]))),
            "the doodle is not writing"
        );
    }

    #[test]
    fn no_strokes_read_as_nothing_and_bad_strokes_are_refused() {
        let ink = PictureInk::new(Arc::new(Found {
            words: Vec::new(),
            seen: Mutex::new(None),
        }));
        assert_eq!(
            ink.recognize(&[], &InkOptions::default()).unwrap(),
            InkRecognition::default()
        );
        assert!(ink
            .recognize(&[stroke(1, &[(f32::NAN, 0.0)])], &InkOptions::default())
            .is_err());
    }
}
