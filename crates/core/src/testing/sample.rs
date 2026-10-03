//! Fixed sample values, modeled on the examples of the spec, for tests that need a known page.

use std::sync::Arc;

use crate::id::{AssetId, BlockId, DeviceId, NotebookId, PageId, RevisionId, SectionId, StrokeId};
use crate::model::{
    Asset, Block, BlockData, Channels, DeviceRef, Fallback, Frame, ImageData, InkBlockData, InkRecord, InkRole,
    JsonMap, Named, NotebookFile, OtherData, Page, PageEntry, Point, Revision, SectionFile, Stroke, StrokeStyle,
    TextData,
};
use crate::order::OrderKey;
use crate::testing::gen::encode_test_points;
use crate::time::{TestClock, Timestamp};

fn at(text: &str) -> Timestamp {
    Timestamp::parse(text).expect("sample times are valid")
}

fn key(text: &str) -> OrderKey {
    OrderKey::parse(text).expect("sample keys are valid")
}

fn id<T: std::str::FromStr>(text: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    text.parse().expect("sample IDs are valid")
}

/// A test clock at `2026-09-30T14:00:00.000Z`.
pub fn test_clock() -> TestClock {
    TestClock::new(at("2026-09-30T14:00:00.000Z"))
}

/// The device of the spec's examples.
pub fn sample_device() -> DeviceRef {
    DeviceRef {
        id: id::<DeviceId>("01m1e34qm04rx4vfj1927vgwgm"),
        label: "Windows device GWGM".to_owned(),
    }
}

/// The ID of the sample page.
pub fn sample_page_id() -> PageId {
    id("01m3sa12426sg32pmtyffjaqcf")
}

/// The ID of the sample page's handwriting layer.
pub fn sample_ink_block() -> BlockId {
    id("01m3sa1242ayy4avvsz3yx5gxj")
}

/// The stroke of spec 9.7, in the sample page's handwriting layer.
pub fn sample_stroke() -> Stroke {
    let points = [
        Point {
            x: 640,
            y: 1_280,
            pressure: 32_768,
            t: 0,
            ..Point::default()
        },
        Point {
            x: 672,
            y: 1_344,
            pressure: 34_078,
            t: 42,
            ..Point::default()
        },
        Point {
            x: 720,
            y: 1_440,
            pressure: 36_044,
            t: 83,
            ..Point::default()
        },
    ];
    let channels = Channels(Channels::PRESSURE | Channels::TIME);
    let (encoded, bbox) = encode_test_points(&points, channels);
    Stroke {
        id: id::<StrokeId>("01m3sa8wb93eknedj0qexh7af2"),
        block: sample_ink_block(),
        start: Timestamp::from_unix_ms(1_790_777_258_345),
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
        point_count: 3,
        points: Arc::from(encoded),
    }
}

fn block(id_text: &str, order: &str, frame: Frame, data: BlockData) -> Arc<Block> {
    Arc::new(Block {
        id: id(id_text),
        order: key(order),
        frame: Some(frame),
        lock: None,
        created: at("2026-09-30T14:03:25.001Z"),
        modified: at("2026-09-30T14:05:40.020Z"),
        data,
        fallback: None,
        extra: JsonMap::new(),
    })
}

fn frame(x: f64, y: f64, w: Option<f64>, h: Option<f64>) -> Frame {
    Frame {
        x: Some(x),
        y: Some(y),
        w,
        h,
        ..Frame::default()
    }
}

fn sample_asset() -> Asset {
    Asset {
        id: id("01m3sa43z1tp9rdr5e8df2jbxy"),
        file: "01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png".to_owned(),
        mime: "image/png".to_owned(),
        bytes: 482_113,
        sha256: [0x5f; 32],
        name: "Leaf section.png".to_owned(),
        width: Some(1_600),
        height: Some(1_200),
        created: at("2026-09-30T14:05:02.305Z"),
        extra: JsonMap::new(),
    }
}

fn sample_extension() -> Arc<Block> {
    let kanban = OtherData {
        type_name: "ext:org.example/kanban".into(),
        data: JsonMap::new(),
        unreadable: None,
    };
    let frame = frame(96.0, 900.0, Some(600.0), Some(300.0));
    let mut extension = Block::clone(&block(
        "01m3sa5x98mzky5xcv2a5xp2n6",
        "a3",
        frame,
        BlockData::Other(kanban),
    ));
    extension.fallback = Some(Fallback {
        markdown: "**Kanban board**: 2 columns, 7 cards".to_owned(),
        ..Fallback::default()
    });
    Arc::new(extension)
}

fn sample_blocks() -> Vec<Arc<Block>> {
    let text = TextData {
        markdown: "## Light reactions

The **thylakoid** membrane holds ==chlorophyll a==."
            .into(),
        ids: vec![id("01m3sa14y9zszek1wdk3snddt0"), id("01m3sa14y9zszek1wdk3snddt1")],
        ..TextData::default()
    };
    let image = ImageData {
        asset: sample_asset().id,
        alt: "Cross-section of a leaf".to_owned(),
        decorative: false,
        crop: None,
        extra: JsonMap::new(),
    };
    let ink = InkBlockData {
        role: Named::Known(InkRole::Layer),
        stroke_count: 1,
        ..InkBlockData::default()
    };
    let text_frame = frame(96.0, 120.0, Some(624.0), None);
    let image_frame = frame(760.0, 140.0, Some(320.0), Some(240.0));
    vec![
        block("01m3sa14y9zszek1wdk3snddsn", "a0", text_frame, BlockData::Text(text)),
        block("01m3sa43z6vy2m3w1j4qw8y09j", "a1", image_frame, BlockData::Image(image)),
        block(
            "01m3sa1242ayy4avvsz3yx5gxj",
            "a2",
            frame(0.0, 0.0, None, None),
            BlockData::Ink(ink),
        ),
        sample_extension(),
    ]
}

/// A page like the one in spec 5.5, not saved yet. It has a text block, an image, and an extension block with
/// a fallback. Its handwriting layer holds the stroke of spec 9.7 as a pending record.
pub fn sample_page() -> Page {
    let revision = Revision::new(
        id::<RevisionId>("01m3sa8yf8bryf28a7sjgb7mmc"),
        at("2026-09-30T14:07:40.520Z"),
        sample_device(),
        "OpenNote 0.4.0 (windows)",
    );
    let mut page = Page::new(sample_page_id(), at("2026-09-30T14:03:22.114Z"), revision);
    page.title = "Photosynthesis".to_owned();
    page.modified = at("2026-09-30T14:07:40.412Z");
    page.tags = vec!["biology".to_owned(), "exam/unit-3".to_owned()];
    for block in sample_blocks() {
        page.blocks.insert(block).expect("sample block IDs are unique");
    }
    let asset = sample_asset();
    page.assets.insert(asset.id, asset);
    let stroke = Arc::new(sample_stroke());
    page.ink.insert(stroke.clone());
    page.ink.push_pending(InkRecord::Stroke(stroke));
    page
}

/// A section like the one in spec 4.2. It holds the sample page and a subpage.
pub fn sample_section() -> SectionFile {
    let entry = |id_text: &str, title: &str, parent: Option<PageId>| PageEntry {
        id: id(id_text),
        title: title.to_owned(),
        parent,
        order: key("a0"),
        pinned: parent.is_none(),
        color: None,
        changed: at("2026-09-30T14:20:05.300Z"),
        moving: None,
        extra: JsonMap::new(),
    };
    SectionFile {
        id: id::<SectionId>("01m3s9v8ym7yt5c8yb61tthbwt"),
        title: "Lab reports".to_owned(),
        color: Some(crate::model::Color::Palette("indigo".into())),
        group: None,
        order: key("a1"),
        created: at("2026-09-30T14:00:12.500Z"),
        changed: at("2026-09-30T14:20:05.300Z"),
        defaults: None,
        encryption: None,
        pages: vec![
            entry("01m3sa12426sg32pmtyffjaqcf", "Photosynthesis", None),
            entry("01m3saznsm2jxj28tzqrqhddv4", "Light reactions", Some(sample_page_id())),
        ],
        extra: JsonMap::new(),
        format: Default::default(),
    }
}

/// A notebook like the one in spec 4.1, without groups.
pub fn sample_notebook() -> NotebookFile {
    NotebookFile::new(
        id::<NotebookId>("01m3s9q9xbpmxwz4cz4ht6twg9"),
        "Biology",
        at("2026-09-30T13:58:02.411Z"),
    )
}

/// The asset ID of the sample page's image.
pub fn sample_asset_id() -> AssetId {
    sample_asset().id
}
