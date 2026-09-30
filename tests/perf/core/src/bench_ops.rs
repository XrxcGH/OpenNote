//! Operation benchmarks: applying a typing batch and a 500-point stroke (plan 13.9). Owned by WP3.
//!
//! Both run on a budget page in memory: 500 blocks, one of them a handwriting layer with 5,000 strokes of 80
//! points. Each measure covers what the core does for one request: resolving it against the page, applying the
//! transaction, and recording it for undo. The quick set for pull requests runs fewer times against doubled
//! gates.
//!
//! The stroke measure checks the strokes' fields but not their points, because the point decoder is not in
//! this build yet. `DECODES_POINTS` turns the full check on once it is.

use std::sync::Arc;
use std::time::Duration;

use opennote_core::id::{BlockId, ClientId, Id, PageId, RevisionId, StrokeId};
use opennote_core::model::{
    Block, BlockData, Channels, InkBlockData, InkRecord, InkRole, JsonMap, Named, Page, Point, Revision, Stroke,
    StrokeStyle, TextData,
};
use opennote_core::ops::apply::OpsApplier;
use opennote_core::ops::resolve::{
    resolve, resolve_add_strokes, resolve_checked_strokes, Edit, ResolveCtx, StrokeTxnMeta, TxnRequest,
};
use opennote_core::ops::undo::{UndoStack, MAX_ENTRIES};
use opennote_core::ops::{CoalesceKey, CoalesceKind, Txn};
use opennote_core::testing::gen::encode_test_points;
use opennote_core::testing::sample::sample_device;
use opennote_core::{Clock, Limits, OrderKey, TestClock, Timestamp};

use crate::harness::{time, BenchCtx, Samples};

/// Whether the stroke measure decodes points with the real point decoder. Turn it on once `format::points`
/// is implemented, so the measure covers the whole path of plan 7.2.
const DECODES_POINTS: bool = false;

/// Blocks on the budget page, one of them the handwriting layer.
const BLOCKS: usize = 500;
/// Strokes in the handwriting layer.
const STROKES: usize = 5_000;
/// Points in each of those strokes.
const POINTS: usize = 80;
/// Bytes of Markdown in each text block.
const TEXT_BYTES: usize = 2_048;

/// Runs the `ops` suite and adds its measurements to the report.
pub fn run(ctx: &mut BenchCtx) -> Result<(), String> {
    let runs = if ctx.quick { 300 } else { 2_000 };
    let gate = |ms: f64| Some(if ctx.quick { ms * 2.0 } else { ms });
    let mut bench = Bench::new()?;
    let typing = bench.typing(runs)?;
    let stroke = bench.strokes(runs)?;
    let undo = bench.undo(runs.min(500))?;
    let report = &mut ctx.report;
    report.add("ops.typing_batch.p99", "ms", ms(typing.percentile(99.0)), gate(0.5));
    report.add("ops.typing_batch.p50", "ms", ms(typing.percentile(50.0)), None);
    report.add("ops.stroke_500.p99", "ms", ms(stroke.percentile(99.0)), gate(2.0));
    report.add("ops.stroke_500.p50", "ms", ms(stroke.percentile(50.0)), None);
    report.add("ops.undo_step.p99", "ms", ms(undo.percentile(99.0)), None);
    Ok(())
}

/// Milliseconds, divided from whole nanoseconds so the report shows `0.0372` rather than `0.037200000000000004`.
fn ms(duration: Duration) -> f64 {
    duration.as_nanos() as f64 / 1_000_000.0
}

/// The budget page, its client, and its undo stack.
struct Bench {
    page: Page,
    undo: UndoStack,
    clock: TestClock,
    client: ClientId,
    limits: Limits,
    seq: u64,
}

impl Bench {
    fn new() -> Result<Bench, String> {
        Ok(Bench {
            page: budget_page()?,
            undo: UndoStack::new(MAX_ENTRIES),
            clock: TestClock::new(Timestamp::from_unix_ms(1_790_776_800_000)),
            client: ClientId::parse("bench-1").map_err(|e| e.to_string())?,
            limits: Limits::default(),
            seq: 0,
        })
    }

    /// Applies a transaction and records it, as a page session does.
    fn commit(&mut self, txn: &Txn) -> Result<(), String> {
        self.page.apply(txn).map_err(|e| e.to_string())?;
        self.undo.record(txn, self.clock.monotonic());
        Ok(())
    }

    /// Typing five characters at the end of a text block's first paragraph, as one `setText` request.
    fn typing(&mut self, runs: usize) -> Result<Samples, String> {
        let blocks: Vec<BlockId> = self.page.blocks.iter().skip(1).map(|b| b.id).collect();
        let mut samples = Samples::default();
        for run in 0..runs {
            let block = blocks[(run / 20) % blocks.len()];
            let request = self.typing_request(block)?;
            self.clock.advance(Duration::from_millis(120));
            let (result, took) = time(|| {
                let ctx = ResolveCtx {
                    clock: &self.clock,
                    limits: &self.limits,
                    imported: &|_| None,
                };
                let txn = resolve(&self.page, &request, &ctx).map_err(|e| e.to_string())?;
                self.commit(&txn)
            });
            result?;
            samples.push(took);
        }
        Ok(samples)
    }

    fn typing_request(&mut self, block: BlockId) -> Result<TxnRequest, String> {
        let Some(BlockData::Text(text)) = self.page.blocks.get(block).map(|b| &b.data) else {
            return Err(format!("{block} is not a text block"));
        };
        let at = text.markdown.find("\n\n").unwrap_or(text.markdown.len());
        let markdown = format!("{} more{}", &text.markdown[..at], &text.markdown[at..]);
        self.seq += 1;
        Ok(TxnRequest {
            page: self.page.id,
            client: self.client.clone(),
            client_seq: self.seq,
            coalesce: Some(CoalesceKey {
                kind: CoalesceKind::Typing,
                target: block.to_string(),
            }),
            ui: None,
            edits: vec![Edit::SetText { block, markdown }],
        })
    }

    /// Adding one 500-point stroke to the handwriting layer.
    fn strokes(&mut self, runs: usize) -> Result<Samples, String> {
        let layer = self.page.blocks.iter().next().map(|b| b.id).ok_or("no blocks")?;
        let mut samples = Samples::default();
        for run in 0..runs {
            let stroke = make_stroke(
                StrokeId(Id::from_parts(1_800_000_000_000, run as u128)),
                layer,
                500,
                run,
            );
            self.seq += 1;
            let meta = StrokeTxnMeta {
                page: self.page.id,
                client: self.client.clone(),
                client_seq: self.seq,
                coalesce: None,
            };
            self.clock.advance(Duration::from_millis(400));
            let (result, took) = time(|| {
                let ctx = ResolveCtx {
                    clock: &self.clock,
                    limits: &self.limits,
                    imported: &|_| None,
                };
                let strokes = vec![Arc::new(stroke)];
                let txn = if DECODES_POINTS {
                    resolve_add_strokes(&self.page, &meta, strokes, &ctx)
                } else {
                    resolve_checked_strokes(&self.page, &meta, strokes, &ctx)
                };
                self.commit(&txn.map_err(|e| e.to_string())?)
            });
            result?;
            samples.push(took);
        }
        Ok(samples)
    }

    /// Undoing the steps the other measures recorded, one at a time.
    fn undo(&mut self, runs: usize) -> Result<Samples, String> {
        let mut samples = Samples::default();
        for _ in 0..runs {
            let (result, took) = time(|| self.undo.undo(&mut self.page, &OpsApplier, &self.clock, &self.client));
            match result.map_err(|e| e.to_string())? {
                Some(_) => samples.push(took),
                None => break,
            }
        }
        Ok(samples)
    }
}

/// A stroke of `points` points that wander from a start that depends on `seed`.
fn make_stroke(id: StrokeId, block: BlockId, points: usize, seed: usize) -> Stroke {
    let channels = Channels(Channels::PRESSURE | Channels::TILT | Channels::TIME);
    let start_x = (seed % 700) as i32 * 64;
    let start_y = (seed / 700 % 1_000) as i32 * 64;
    let points: Vec<Point> = (0..points)
        .map(|i| {
            let i32_i = i as i32;
            Point {
                x: start_x + i32_i * 23 + (i32_i * 7 % 13),
                y: start_y + i32_i * 11 - (i32_i * 5 % 17),
                pressure: 20_000 + (i as u16 % 64) * 300,
                tilt_x: 1_200 - (i as i16 % 40) * 10,
                tilt_y: -800 + (i as i16 % 30) * 10,
                t: i as u32 * 40,
            }
        })
        .collect();
    let (encoded, bbox) = encode_test_points(&points, channels);
    Stroke {
        id,
        block,
        start: Timestamp::from_unix_ms(1_790_776_800_000 + seed as i64 * 900),
        start_unknown: false,
        style: StrokeStyle {
            tool: 0,
            palette: 1,
            color: [0x2b, 0x25, 0x21, 0xff],
            width: 2.0,
        },
        transform: None,
        origin: None,
        bbox,
        channels,
        point_count: points.len() as u32,
        points: Arc::from(encoded),
    }
}

/// Paragraphs of three sentences, about `TEXT_BYTES` long in all.
fn markdown(seed: usize) -> String {
    let sentence = format!("Paragraph {seed} notes the light reactions and the Calvin cycle in some detail.");
    let mut paragraphs = Vec::new();
    let mut len = 0;
    while len < TEXT_BYTES {
        let paragraph = [sentence.as_str(); 3].join(" ");
        len += paragraph.len() + 2;
        paragraphs.push(paragraph);
    }
    paragraphs.join("\n\n")
}

/// The budget page of plan 13.9: a handwriting layer with 5,000 strokes, then 499 text blocks.
fn budget_page() -> Result<Page, String> {
    let at = Timestamp::from_unix_ms(1_790_776_800_000);
    let revision = Revision::new(
        RevisionId(Id::from_parts(1_790_776_800_000, 1)),
        at,
        sample_device(),
        "bench",
    );
    let mut page = Page::new(PageId(Id::from_parts(1_790_776_800_000, 2)), at, revision);
    let keys = OrderKey::spread(None, None, BLOCKS).map_err(|e| e.to_string())?;
    let layer = BlockId(Id::from_parts(1_790_776_800_000, 1_000));
    for (index, order) in keys.into_iter().enumerate() {
        let data = if index == 0 {
            BlockData::Ink(InkBlockData {
                role: Named::Known(InkRole::Layer),
                stroke_count: STROKES as u32,
                ..InkBlockData::default()
            })
        } else {
            BlockData::Text(TextData {
                markdown: markdown(index).into(),
                ..TextData::default()
            })
        };
        let block = Block {
            id: if index == 0 {
                layer
            } else {
                BlockId(Id::from_parts(1_790_776_800_000, 1_000 + index as u128))
            },
            order,
            frame: None,
            lock: None,
            created: at,
            modified: at,
            data,
            fallback: None,
            extra: JsonMap::new(),
        };
        page.blocks.insert(Arc::new(block)).map_err(|e| e.to_string())?;
    }
    for index in 0..STROKES {
        let id = StrokeId(Id::from_parts(1_790_776_800_000, 10_000 + index as u128));
        let stroke = Arc::new(make_stroke(id, layer, POINTS, index));
        page.ink.insert(stroke.clone());
        page.ink.push_pending(InkRecord::Stroke(stroke));
    }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_budget_page_has_the_planned_size() {
        let page = budget_page().unwrap();
        assert_eq!(page.blocks.len(), BLOCKS);
        assert_eq!(page.ink.len(), STROKES);
    }

    #[test]
    fn typing_groups_and_strokes_are_undo_steps() {
        let mut bench = Bench::new().unwrap();
        assert_eq!(bench.typing(3).unwrap().len(), 3);
        assert_eq!(bench.strokes(3).unwrap().len(), 3);
        assert_eq!(bench.page.ink.len(), STROKES + 3);
        assert_eq!(bench.undo(10).unwrap().len(), 4, "one typing group and three strokes");
        assert_eq!(bench.page.ink.len(), STROKES);
    }

    #[test]
    fn the_quick_suite_reports_its_measures() {
        let mut ctx = BenchCtx {
            pages: 1,
            quick: true,
            dir: std::env::temp_dir(),
            report: crate::harness::Report::default(),
        };
        run(&mut ctx).unwrap();
        let names: Vec<&str> = ctx.report.results.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"ops.typing_batch.p99") && names.contains(&"ops.stroke_500.p99"));
    }
}
