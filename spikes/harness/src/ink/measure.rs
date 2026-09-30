//! The two measurements for each renderer mode. Latency samples time each pen move to the first frame
//! that shows its ink. A continuous stroke shows frame pacing.

use std::time::{Duration, Instant};

use serde_json::Value;

use super::cdp::CdpPen;
use super::page;
use super::pen::{Pen, Target};
use super::plan::{pacing_stroke, Jitter, PenPoint, StrokePlan};
use super::Injector;
use crate::common::capture::{ChangeWatcher, Region};
use crate::common::webview::Controller;
use crate::common::{clock, Result};

/// The watched square around each move, in physical pixels. The stroke is at least 12 px wide.
pub const REGION_PX: u32 = 24;
/// A change of more than this in any color channel counts as ink. Ink on paper changes by about 200.
pub const THRESHOLD: u8 = 48;
/// A move whose ink hasn't appeared by then counts as a timeout.
pub const TIMEOUT: Duration = Duration::from_millis(250);
/// The continuous stroke: 480 moves at 240 per second, a common report rate for pen digitizers.
pub const PACING_MOVES: usize = 480;
pub const PACING_PERIOD: Duration = Duration::from_micros(4167);
/// Paper within this of its own color in every channel counts as blank.
const BLANK_TOLERANCE: u8 = 12;
/// Stop a method after this many failures in a row at the start, or invalid samples in a row later.
const GIVE_UP_AFTER: usize = 12;

/// The drawing surface under test: the ink page, or the native baseline window.
pub trait Surface {
    /// Clears the ink and waits until the blank surface is on screen.
    fn clear(&self) -> Result<()>;
}

/// What a latency measurement needs: the surface, the screen watcher, and where the window is.
pub struct Rig<'a> {
    pub surface: &'a dyn Surface,
    pub watcher: &'a mut ChangeWatcher,
    pub target: Target,
    /// The page size in CSS pixels.
    pub page: (f64, f64),
    /// The display's refresh interval, for the pseudo-random delays and for latencies in frames.
    pub frame_ms: f64,
}

/// One timed move. Times are performance counter milliseconds.
#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub t0_ms: f64,
    pub point: PenPoint,
    /// Whether the watched square was blank paper before the move. Only a predicted tail should
    /// leave ink there.
    pub blank: bool,
    pub outcome: Outcome,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    /// The ink appeared in a frame presented at `present_ms`, which combined `accumulated` updates.
    Shown {
        present_ms: f64,
        accumulated: u32,
    },
    Timeout,
    /// The sample couldn't be trusted, for example because the capture was interrupted.
    Invalid(String),
}

/// Times `count` pen moves with `injector`, spread over the page in short strokes. One unmeasured
/// stroke goes first, because the first input after a quiet spell is slower than the rest.
pub fn latency_samples(rig: &mut Rig, injector: &mut dyn Injector, count: usize, seed: u64) -> Result<Vec<Sample>> {
    let mut plan = StrokePlan::new(rig.page.0, rig.page.1);
    if plan.capacity() == 0 {
        return Err("The page is too small for the test strokes.".into());
    }
    warm_up(rig, injector, &mut plan)?;
    let mut jitter = Jitter::new(seed);
    let mut samples = Vec::with_capacity(count);
    let mut touching = None;
    while samples.len() < count && !gave_up(&samples) {
        let Some(planned) = plan.next_move() else {
            clear_page(rig)?;
            plan.restart();
            continue;
        };
        if let Some(start) = planned.start {
            injector.down(&start)?;
            pause_ms(3.0 * rig.frame_ms);
        }
        touching = Some(planned.point);
        pause_ms(jitter.delay_ms(rig.frame_ms));
        samples.push(measure_move(rig, injector, planned.point)?);
        if planned.last {
            injector.up(&planned.point)?;
            touching = None;
        }
    }
    if let Some(point) = touching {
        injector.up(&point)?;
    }
    match samples.last().map(|sample| &sample.outcome) {
        Some(Outcome::Invalid(reason)) if gave_up(&samples) => Err(reason.clone().into()),
        _ => Ok(samples),
    }
}

/// Draws the plan's first stroke without timing it, then clears the page and restarts the plan.
fn warm_up(rig: &mut Rig, injector: &mut dyn Injector, plan: &mut StrokePlan) -> Result<()> {
    clear_page(rig)?;
    while let Some(planned) = plan.next_move() {
        if let Some(start) = planned.start {
            injector.down(&start)?;
        }
        pause_ms(rig.frame_ms);
        injector.move_to(&planned.point)?;
        if planned.last {
            pause_ms(rig.frame_ms);
            injector.up(&planned.point)?;
            break;
        }
    }
    plan.restart();
    clear_page(rig)
}

/// Clears the ink and waits two more frames, so the blank surface is on screen before the next baseline.
fn clear_page(rig: &mut Rig) -> Result<()> {
    rig.surface.clear()?;
    pause_ms(2.0 * rig.frame_ms);
    Ok(())
}

/// Watches the square around `point`, sends the move, and waits for the ink.
fn measure_move(rig: &mut Rig, injector: &mut dyn Injector, point: PenPoint) -> Result<Sample> {
    let (x, y) = rig.target.area.to_screen(point.x, point.y);
    rig.watcher.set_region(Region::around(x, y, REGION_PX));
    let blank = take_baseline(rig)?;
    let start = clock::now();
    injector.move_to(&point)?;
    let outcome = match rig.watcher.wait_for_change(THRESHOLD, TIMEOUT) {
        Ok(Some(present)) if present >= start => Outcome::Shown {
            present_ms: clock::ticks_to_ms(present),
            accumulated: rig.watcher.last_change().accumulated_frames,
        },
        Ok(Some(_)) => Outcome::Invalid("The region changed before the input was sent.".into()),
        Ok(None) => Outcome::Timeout,
        Err(error) => Outcome::Invalid(error.to_string()),
    };
    Ok(Sample {
        t0_ms: clock::ticks_to_ms(start),
        point,
        blank,
        outcome,
    })
}

/// Takes the baseline, waiting up to three frames for the square to be blank. Returns whether it was.
fn take_baseline(rig: &mut Rig) -> Result<bool> {
    for attempt in 0..4 {
        if attempt > 0 {
            pause_ms(rig.frame_ms);
        }
        // A capture interrupted by a desktop switch restarts, so one retry is enough.
        if rig.watcher.reset_baseline().is_err() {
            rig.watcher.reset_baseline()?;
        }
        if rig.watcher.baseline_is_blank(BLANK_TOLERANCE) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// True when the first samples all failed, or the latest ones were all invalid.
pub fn gave_up(samples: &[Sample]) -> bool {
    if samples.len() < GIVE_UP_AFTER {
        return false;
    }
    let failed = |sample: &Sample| !matches!(sample.outcome, Outcome::Shown { .. });
    let first_failed = samples.len() == GIVE_UP_AFTER && samples.iter().all(failed);
    let recent = &samples[samples.len() - GIVE_UP_AFTER..];
    first_failed
        || recent
            .iter()
            .all(|sample| matches!(sample.outcome, Outcome::Invalid(_)))
}

/// Frame timing during one continuous stroke.
pub struct Pacing {
    /// Intervals between the page's animation frames, in milliseconds.
    pub raf_ms: Vec<f64>,
    /// Intervals between desktop presents, in milliseconds.
    pub present_ms: Vec<f64>,
    /// Presents that combined more than one update, which hides a frame from the intervals.
    pub accumulated: usize,
    pub injected: usize,
}

/// Draws a continuous stroke at 240 moves per second with the synthetic pen, while the page records
/// its animation frames and the screen watcher records desktop presents.
pub fn continuous_stroke(rig: &mut Rig, controller: &Controller) -> Result<Pacing> {
    let points = pacing_stroke(rig.page.0, rig.page.1, PACING_MOVES);
    page::clear(controller)?;
    page::call(controller, "pacingStart", Value::Null)?;
    let target = rig.target;
    let pen = std::thread::spawn(move || draw_on_schedule(&mut Pen::new(target)?, &points));
    let watch = PACING_PERIOD * PACING_MOVES as u32 + Duration::from_millis(150);
    let frames = rig.watcher.collect_presents(watch);
    let injected = pen.join().map_err(|_| "The pen thread panicked.")??;
    let raf_ms = serde_json::from_value(page::call(controller, "pacingStop", Value::Null)?)?;
    let frames = frames?;
    let present_ms = frames
        .windows(2)
        .map(|pair| clock::elapsed_ms(pair[0].present_time, pair[1].present_time))
        .collect();
    Ok(Pacing {
        raf_ms,
        present_ms,
        accumulated: frames.iter().filter(|frame| frame.accumulated_frames > 1).count(),
        injected,
    })
}

/// The same stroke sent through the DevTools Protocol, which skips the Windows pointer stack. Only the
/// page's animation frames are recorded, because this thread sends the input.
pub fn continuous_stroke_cdp(rig: &mut Rig, controller: &Controller) -> Result<Pacing> {
    let points = pacing_stroke(rig.page.0, rig.page.1, PACING_MOVES);
    page::clear(controller)?;
    page::call(controller, "pacingStart", Value::Null)?;
    let injected = draw_on_schedule(&mut CdpPen::new(controller), &points)?;
    pause_ms(150.0);
    let raf_ms = serde_json::from_value(page::call(controller, "pacingStop", Value::Null)?)?;
    Ok(Pacing {
        raf_ms,
        present_ms: Vec::new(),
        accumulated: 0,
        injected,
    })
}

/// Sends the stroke on a schedule, so the moves keep a steady rate however long each takes.
fn draw_on_schedule(injector: &mut dyn Injector, points: &[PenPoint]) -> Result<usize> {
    let (Some(first), Some(last)) = (points.first(), points.last()) else {
        return Ok(0);
    };
    injector.down(first)?;
    let start = Instant::now();
    for (index, point) in points.iter().enumerate().skip(1) {
        let due = start + PACING_PERIOD * index as u32;
        std::thread::sleep(due.saturating_duration_since(Instant::now()));
        injector.move_to(point)?;
    }
    injector.up(last)?;
    Ok(points.len())
}

fn pause_ms(ms: f64) {
    if ms > 0.0 {
        std::thread::sleep(Duration::from_secs_f64(ms / 1000.0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(outcome: Outcome) -> Sample {
        let point = PenPoint {
            x: 0.0,
            y: 0.0,
            pressure: 0.5,
            tilt_x: 0,
            tilt_y: 0,
        };
        Sample {
            t0_ms: 0.0,
            point,
            blank: true,
            outcome,
        }
    }

    #[test]
    fn gives_up_when_no_ink_ever_appears() {
        let shown = sample(Outcome::Shown {
            present_ms: 20.0,
            accumulated: 1,
        });
        let timeouts = vec![sample(Outcome::Timeout); GIVE_UP_AFTER];
        assert!(gave_up(&timeouts));
        assert!(!gave_up(&timeouts[..GIVE_UP_AFTER - 1]));
        let mut mixed = timeouts.clone();
        mixed[3] = shown.clone();
        assert!(!gave_up(&mixed));
        mixed.push(sample(Outcome::Timeout));
        assert!(!gave_up(&mixed), "later timeouts are counted, not fatal");
    }

    #[test]
    fn gives_up_after_a_run_of_invalid_samples() {
        let mut samples = vec![
            sample(Outcome::Shown {
                present_ms: 20.0,
                accumulated: 1
            });
            5
        ];
        samples.extend(vec![sample(Outcome::Invalid("lost".into())); GIVE_UP_AFTER]);
        assert!(gave_up(&samples));
        samples.push(sample(Outcome::Timeout));
        assert!(!gave_up(&samples));
    }
}
