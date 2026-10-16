//! The software drawing of the replay. Strokes are drawn as round-capped lines onto a canvas that only grows: each
//! frame draws the segments that finished since the last one, so a long recording costs no more per frame than a short
//! one. The pen's tip is a ring over the frame while a stroke is being drawn.

use super::{Scene, SceneStroke};

/// How long after a stroke's last point the ring stays, in nanoseconds.
const RING_HOLD_NS: u64 = 400_000_000;

struct Segment {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    end_ns: u64,
    color: [u8; 4],
    width: f32,
}

pub struct Renderer<'a> {
    scene: &'a Scene,
    canvas: Vec<u8>,
    frame: Vec<u8>,
    segments: Vec<Segment>,
    drawn: usize,
    /// The latest point reached, for the ring.
    tip: Option<(f32, f32, u64)>,
}

fn segments_of(strokes: &[SceneStroke]) -> Vec<Segment> {
    let mut all = Vec::new();
    for stroke in strokes {
        let mut previous = None;
        for point in &stroke.points {
            // A single point is a dot: a segment from the point to itself.
            let (x0, y0) = previous.unwrap_or((point.x, point.y));
            all.push(Segment {
                x0,
                y0,
                x1: point.x,
                y1: point.y,
                end_ns: point.t_ns,
                color: stroke.color,
                width: stroke.width.max(1.0),
            });
            previous = Some((point.x, point.y));
        }
    }
    // A stable sort keeps the points of one stroke in the order they were drawn.
    all.sort_by_key(|segment| segment.end_ns);
    all
}

impl<'a> Renderer<'a> {
    pub fn new(scene: &'a Scene) -> Self {
        Renderer {
            scene,
            canvas: scene.base.clone(),
            frame: scene.base.clone(),
            segments: segments_of(&scene.strokes),
            drawn: 0,
            tip: None,
        }
    }

    /// The frame at a time. Times must not go backwards.
    pub fn frame(&mut self, at_ns: u64) -> &[u8] {
        let (width, height) = (self.scene.width as usize, self.scene.height as usize);
        while let Some(segment) = self.segments.get(self.drawn) {
            if segment.end_ns > at_ns {
                break;
            }
            draw_line(&mut self.canvas, width, height, segment);
            self.tip = Some((segment.x1, segment.y1, segment.end_ns));
            self.drawn += 1;
        }
        self.frame.copy_from_slice(&self.canvas);
        if let Some((x, y, at)) = self.tip {
            if at_ns.saturating_sub(at) <= RING_HOLD_NS {
                draw_ring(&mut self.frame, width, height, x, y);
            }
        }
        &self.frame
    }
}

fn blend(pixel: &mut [u8], color: [u8; 4], coverage: f32) {
    let a = f32::from(color[3]) / 255.0 * coverage;
    // The pixel is BGRA: the color is RGBA.
    pixel[0] = (f32::from(pixel[0]) * (1.0 - a) + f32::from(color[2]) * a).round() as u8;
    pixel[1] = (f32::from(pixel[1]) * (1.0 - a) + f32::from(color[1]) * a).round() as u8;
    pixel[2] = (f32::from(pixel[2]) * (1.0 - a) + f32::from(color[0]) * a).round() as u8;
    pixel[3] = 255;
}

/// Fills a disc with a one-pixel soft edge.
fn disc(canvas: &mut [u8], width: usize, height: usize, cx: f32, cy: f32, radius: f32, color: [u8; 4]) {
    let x_from = (cx - radius - 1.0).floor().max(0.0) as usize;
    let x_to = ((cx + radius + 1.0).ceil().max(0.0) as usize).min(width.saturating_sub(1));
    let y_from = (cy - radius - 1.0).floor().max(0.0) as usize;
    let y_to = ((cy + radius + 1.0).ceil().max(0.0) as usize).min(height.saturating_sub(1));
    for y in y_from..=y_to {
        for x in x_from..=x_to {
            let distance = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let coverage = (radius + 0.5 - distance).clamp(0.0, 1.0);
            if coverage > 0.0 {
                let at = (y * width + x) * 4;
                blend(&mut canvas[at..at + 4], color, coverage);
            }
        }
    }
}

fn draw_line(canvas: &mut [u8], width: usize, height: usize, segment: &Segment) {
    let radius = segment.width / 2.0;
    let length = ((segment.x1 - segment.x0).powi(2) + (segment.y1 - segment.y0).powi(2)).sqrt();
    // A stamp every half radius leaves no gaps, and an opaque color is not darkened by the overlap.
    let steps = (length / (radius * 0.5).max(0.5)).ceil().max(1.0) as usize;
    let opaque = segment.color[3] == 255;
    for step in 0..=steps {
        let along = step as f32 / steps as f32;
        let x = segment.x0 + (segment.x1 - segment.x0) * along;
        let y = segment.y0 + (segment.y1 - segment.y0) * along;
        // A translucent highlighter is stamped once at the end points only, so the overlap doesn't stripe it.
        if opaque || step == 0 || step == steps || step % 2 == 0 {
            disc(canvas, width, height, x, y, radius, segment.color);
        }
    }
}

/// A ring around the pen's tip.
fn draw_ring(frame: &mut [u8], width: usize, height: usize, cx: f32, cy: f32) {
    const OUTER: f32 = 11.0;
    const INNER: f32 = 8.0;
    let ring = [220, 60, 50, 200];
    let x_from = (cx - OUTER - 1.0).floor().max(0.0) as usize;
    let x_to = ((cx + OUTER + 1.0).ceil().max(0.0) as usize).min(width.saturating_sub(1));
    let y_from = (cy - OUTER - 1.0).floor().max(0.0) as usize;
    let y_to = ((cy + OUTER + 1.0).ceil().max(0.0) as usize).min(height.saturating_sub(1));
    for y in y_from..=y_to {
        for x in x_from..=x_to {
            let distance = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let coverage = (OUTER + 0.5 - distance).clamp(0.0, 1.0) * (distance - INNER + 0.5).clamp(0.0, 1.0);
            if coverage > 0.0 {
                let at = (y * width + x) * 4;
                blend(&mut frame[at..at + 4], ring, coverage);
            }
        }
    }
}
