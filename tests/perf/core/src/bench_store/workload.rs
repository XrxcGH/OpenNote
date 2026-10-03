//! The pages, strokes, and transactions the storage benchmarks write.

use std::sync::Arc;

use opennote_core::model::{
    Block, BlockData, Channels, DeviceRef, Frame, InkBlockData, InkRecord, InkRole, JsonMap, Named, Page, Point,
    Revision, Stroke, StrokeStyle, TextData,
};
use opennote_core::ops::{Op, Origin, PageFields, Txn};
use opennote_core::testing::gen::encode_test_points;
use opennote_core::{BlockId, ClientId, Id, OrderKey, PageId, RevisionId, SectionId, StrokeId, Timestamp, TxnId};

/// The time every generated ID starts from: 2026-09-30.
const EPOCH_MS: u64 = 1_790_726_400_000;

/// How much work each measurement does, and how its budget scales.
#[derive(Clone, Debug, PartialEq)]
pub struct Workload {
    /// Blocks on the benchmark page, including its handwriting layer.
    pub blocks: usize,
    /// Strokes in the handwriting layer.
    pub strokes: usize,
    /// Points in each stroke.
    pub points: usize,
    /// Timed page opens, and timed saves after one new stroke.
    pub runs: usize,
    /// Timed journal appends with their flushes.
    pub appends: usize,
    /// The journal bytes that recovery replays.
    pub journal_bytes: u64,
    /// Timed recoveries.
    pub recoveries: usize,
    /// 1 for the budgets of plan 13.9, and 2 for the quick set, whose limits are doubled.
    pub gate_scale: f64,
}

impl Workload {
    /// The budget page of plan 13.9: 500 blocks and 5,000 strokes, and a 4 MiB journal. The quick set for pull
    /// requests takes fewer samples and doubles the limits.
    pub fn budget(quick: bool) -> Workload {
        Workload {
            blocks: 500,
            strokes: 5_000,
            points: 80,
            runs: if quick { 20 } else { 100 },
            appends: if quick { 200 } else { 1_000 },
            journal_bytes: 4 << 20,
            recoveries: if quick { 1 } else { 3 },
            gate_scale: if quick { 2.0 } else { 1.0 },
        }
    }
}

/// The IDs of the benchmark notebook.
pub struct Ids {
    pub notebook: opennote_core::NotebookId,
    pub section: SectionId,
    pub page: PageId,
    pub layer: BlockId,
}

/// The benchmark notebook's IDs, the same on every run.
pub fn ids() -> Ids {
    let id = |n: u128| Id::from_parts(EPOCH_MS, n);
    Ids {
        notebook: opennote_core::NotebookId(id(1)),
        section: SectionId(id(2)),
        page: PageId(id(3)),
        layer: BlockId(id(4)),
    }
}

/// The device that writes the benchmark pages.
pub fn device() -> DeviceRef {
    DeviceRef {
        id: opennote_core::DeviceId(Id::from_parts(EPOCH_MS, 5)),
        label: "Benchmark device".to_owned(),
    }
}

/// A page with `blocks - 1` text blocks and a handwriting layer of `strokes` strokes, all of them pending, as
/// a page is before its first save.
pub fn budget_page(workload: &Workload) -> Page {
    let ids = ids();
    let at = Timestamp::from_unix_ms(EPOCH_MS as i64);
    let revision = Revision::new(RevisionId(Id::from_parts(EPOCH_MS, 6)), at, device(), "opennote-perf");
    let mut page = Page::new(ids.page, at, revision);
    page.title = "Budget page".to_owned();
    let count = workload.blocks.max(1);
    let keys = OrderKey::spread(None, None, count).unwrap_or_default();
    for (n, key) in keys.into_iter().enumerate() {
        let block = if n == 0 {
            layer(ids.layer, key, at, workload.strokes)
        } else {
            text_block(n, key, at)
        };
        let _ = page.blocks.insert(Arc::new(block));
    }
    for n in 0..workload.strokes {
        let stroke = stroke(n as u64, workload.points);
        page.ink.insert(stroke.clone());
        page.ink.push_pending(InkRecord::Stroke(stroke));
    }
    page
}

fn layer(id: BlockId, order: OrderKey, at: Timestamp, strokes: usize) -> Block {
    let data = InkBlockData {
        role: Named::Known(InkRole::Layer),
        stroke_count: u32::try_from(strokes).unwrap_or(u32::MAX),
        ..InkBlockData::default()
    };
    block(id, order, at, Frame::default(), BlockData::Ink(data))
}

fn text_block(n: usize, order: OrderKey, at: Timestamp) -> Block {
    let markdown = format!(
        "## Note {n}\n\nThe **light reactions** take place in the thylakoid membrane, where chlorophyll a absorbs \
         light and splits water. Paragraph {n} of the benchmark page."
    );
    let data = TextData {
        markdown: Arc::from(markdown),
        ..TextData::default()
    };
    let frame = Frame {
        x: Some(96.0),
        y: Some(120.0 + 80.0 * n as f64),
        w: Some(624.0),
        ..Frame::default()
    };
    let id = BlockId(Id::from_parts(EPOCH_MS, 1_000_000 + n as u128));
    block(id, order, at, frame, BlockData::Text(data))
}

fn block(id: BlockId, order: OrderKey, at: Timestamp, frame: Frame, data: BlockData) -> Block {
    Block {
        id,
        order,
        frame: Some(frame),
        lock: None,
        created: at,
        modified: at,
        data,
        fallback: None,
        extra: JsonMap::new(),
    }
}

/// Stroke `n`: a line of handwriting with `points` points, pressure, and times at 240 Hz, placed on a grid so
/// strokes don't overlap.
pub fn stroke(n: u64, points: usize) -> Arc<Stroke> {
    let x0 = i32::try_from(n % 50).unwrap_or(0) * 64 * 16;
    let y0 = i32::try_from(n / 50 % 1_000).unwrap_or(0) * 64 * 24;
    let wobble = |i: usize| i32::try_from((i as u64).wrapping_mul(n | 1) % 23).unwrap_or(0) - 11;
    let line: Vec<Point> = (0..points)
        .map(|i| Point {
            x: x0 + i32::try_from(i).unwrap_or(0) * 24 + wobble(i),
            y: y0 + wobble(i.wrapping_add(7)) * 3,
            pressure: 30_000u16.wrapping_add(u16::try_from(i % 40).unwrap_or(0) * 40),
            t: u32::try_from(i).unwrap_or(0) * 42,
            ..Point::default()
        })
        .collect();
    let channels = Channels(Channels::PRESSURE | Channels::TIME);
    let (encoded, bbox) = encode_test_points(&line, channels);
    Arc::new(Stroke {
        id: StrokeId(Id::from_parts(EPOCH_MS + n, u128::from(n))),
        block: ids().layer,
        start: Timestamp::from_unix_ms((EPOCH_MS + n) as i64),
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
        point_count: u32::try_from(points).unwrap_or(u32::MAX),
        points: Arc::from(encoded),
    })
}

/// A transaction at `at` with these operations.
pub fn txn(n: u64, at: Timestamp, ops: Vec<Op>) -> Txn {
    Txn {
        id: TxnId(Id::from_parts(EPOCH_MS, 2_000_000 + u128::from(n))),
        at,
        origin: Origin::Local,
        client: ClientId::parse("main-1").expect("a valid client ID"),
        coalesce: None,
        ui: None,
        ops,
    }
}

/// A rename of the page, about the size of a typing batch in the journal.
pub fn retitle(page: &Page, title: String) -> Op {
    Op::SetPage {
        before: PageFields {
            title: Some(page.title.clone()),
            ..PageFields::default()
        },
        after: PageFields {
            title: Some(title),
            ..PageFields::default()
        },
    }
}
