//! Where the pen goes: strokes spread over the page for latency samples, a continuous stroke for frame
//! pacing, and deterministic pseudo-random delays. Everything here is pure, so the tests cover it.

/// A pen sample on the page: CSS pixels from the top-left of the viewport, pressure from 0 to 1, and
/// tilt in degrees.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PenPoint {
    pub x: f64,
    pub y: f64,
    pub pressure: f64,
    pub tilt_x: i32,
    pub tilt_y: i32,
}

/// Distance between measured moves, in CSS pixels. It keeps each watched region clear of earlier ink:
/// the widest stroke reaches under 7 px past the previous point, and the region reaches 8 px back.
pub const STEP: f64 = 30.0;
/// Measured moves in each stroke.
pub const MOVES_PER_STROKE: usize = 8;
/// Empty space around the strokes and between them, in CSS pixels.
const MARGIN: f64 = 48.0;
const GAP: f64 = 60.0;
const ROW_SPACING: f64 = 44.0;

/// One measured move, with the pen-down point first when it starts a stroke.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlannedMove {
    pub start: Option<PenPoint>,
    pub point: PenPoint,
    /// The pen lifts after this move.
    pub last: bool,
}

/// Lays strokes out in rows over a page of `width` by `height` CSS pixels.
pub struct StrokePlan {
    origins: Vec<(f64, f64)>,
    next: usize,
}

impl StrokePlan {
    pub fn new(width: f64, height: f64) -> StrokePlan {
        let length = STEP * MOVES_PER_STROKE as f64;
        let columns = ((width - 2.0 * MARGIN + GAP) / (length + GAP)).floor().max(0.0) as usize;
        let rows = ((height - 2.0 * MARGIN) / ROW_SPACING).floor().max(-1.0) as i64 + 1;
        let mut origins = Vec::new();
        for row in 0..rows.max(0) as usize {
            for column in 0..columns {
                origins.push((
                    MARGIN + column as f64 * (length + GAP),
                    MARGIN + row as f64 * ROW_SPACING,
                ));
            }
        }
        StrokePlan { origins, next: 0 }
    }

    /// How many moves fit on one page before it must be cleared.
    pub fn capacity(&self) -> usize {
        self.origins.len() * MOVES_PER_STROKE
    }

    /// Starts again at the first stroke, after the page is cleared.
    pub fn restart(&mut self) {
        self.next = 0;
    }

    /// The next measured move, or None when the page is full.
    pub fn next_move(&mut self) -> Option<PlannedMove> {
        let stroke = self.next / MOVES_PER_STROKE;
        let step = self.next % MOVES_PER_STROKE + 1;
        let &(x, y) = self.origins.get(stroke)?;
        self.next += 1;
        Some(PlannedMove {
            start: (step == 1).then(|| stroke_point(x, y, stroke, 0)),
            point: stroke_point(x, y, stroke, step),
            last: step == MOVES_PER_STROKE,
        })
    }
}

/// The `step`th point of a stroke that starts at (x, y). The line wavers a little, and pressure and
/// tilt vary, so the samples cover a range of stroke shapes.
fn stroke_point(x: f64, y: f64, stroke: usize, step: usize) -> PenPoint {
    let phase = step as f64 * 1.1 + stroke as f64;
    PenPoint {
        x: x + step as f64 * STEP,
        y: y + 5.0 * phase.sin(),
        pressure: 0.6 + 0.25 * (phase * 0.8).sin(),
        tilt_x: (20.0 + 10.0 * phase.cos()).round() as i32,
        tilt_y: (10.0 * (phase * 0.5).sin()).round() as i32,
    }
}

/// A continuous stroke of `count` points: two waves across the page, for the frame pacing test.
pub fn pacing_stroke(width: f64, height: f64, count: usize) -> Vec<PenPoint> {
    let span = (width - 2.0 * MARGIN).max(1.0);
    let amplitude = ((height - 2.0 * MARGIN) / 3.0).max(0.0);
    (0..count)
        .map(|index| {
            let t = index as f64 / count.saturating_sub(1).max(1) as f64;
            let angle = t * std::f64::consts::TAU * 2.0;
            PenPoint {
                x: MARGIN + t * span,
                y: height / 2.0 + amplitude * angle.sin(),
                pressure: 0.5 + 0.2 * (angle * 3.0).sin(),
                tilt_x: 25,
                tilt_y: 0,
            }
        })
        .collect()
}

/// A small deterministic generator (xorshift64*), so every run waits the same pseudo-random delays.
pub struct Jitter(u64);

impl Jitter {
    pub fn new(seed: u64) -> Jitter {
        Jitter(seed.max(1))
    }

    /// A number from 0 up to, but not including, 1.
    pub fn next_unit(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        (x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// A delay of 0 to 2 frames in milliseconds, so samples don't lock to the display's refresh.
    pub fn delay_ms(&mut self, frame_ms: f64) -> f64 {
        self.next_unit() * 2.0 * frame_ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_the_page_with_strokes() {
        let mut plan = StrokePlan::new(1200.0, 800.0);
        assert_eq!(plan.capacity(), 3 * 17 * MOVES_PER_STROKE);
        let first = plan.next_move().unwrap();
        let start = first.start.unwrap();
        assert_eq!((start.x, first.point.x), (MARGIN, MARGIN + STEP));
        assert!(!first.last);
        let mut moves = vec![first];
        while let Some(planned) = plan.next_move() {
            moves.push(planned);
        }
        assert_eq!(moves.len(), plan.capacity());
        assert!(moves[MOVES_PER_STROKE - 1].last);
        assert!(moves[MOVES_PER_STROKE].start.is_some());
        for planned in &moves {
            let point = planned.point;
            assert!(point.x > 0.0 && point.x < 1200.0 && point.y > 0.0 && point.y < 800.0);
            assert!((0.3..=0.9).contains(&point.pressure));
        }
        plan.restart();
        assert_eq!(plan.next_move(), Some(moves[0]));
    }

    #[test]
    fn keeps_measured_points_apart() {
        let mut plan = StrokePlan::new(1200.0, 800.0);
        let (a, b) = (plan.next_move().unwrap().point, plan.next_move().unwrap().point);
        let distance = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
        assert!(distance >= STEP, "moves {distance} px apart");
    }

    #[test]
    fn handles_a_page_too_small_for_strokes() {
        let mut plan = StrokePlan::new(100.0, 50.0);
        assert_eq!(plan.capacity(), 0);
        assert!(plan.next_move().is_none());
    }

    #[test]
    fn draws_a_pacing_stroke_across_the_page() {
        let stroke = pacing_stroke(1200.0, 800.0, 480);
        assert_eq!(stroke.len(), 480);
        assert_eq!(stroke[0].x, MARGIN);
        assert!((stroke[479].x - (1200.0 - MARGIN)).abs() < 1e-9);
        assert!(stroke.iter().all(|point| point.y > MARGIN && point.y < 800.0 - MARGIN));
    }

    #[test]
    fn jitters_deterministically_within_two_frames() {
        let (mut a, mut b) = (Jitter::new(7), Jitter::new(7));
        let delays: Vec<f64> = (0..1000).map(|_| a.delay_ms(8.0)).collect();
        assert!(delays.iter().all(|delay| (0.0..16.0).contains(delay)));
        assert_eq!(delays[..5], (0..5).map(|_| b.delay_ms(8.0)).collect::<Vec<_>>()[..]);
        let mean = delays.iter().sum::<f64>() / delays.len() as f64;
        assert!((7.0..9.0).contains(&mean), "mean delay {mean}");
    }
}
