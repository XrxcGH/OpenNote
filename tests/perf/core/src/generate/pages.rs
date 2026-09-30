//! Generated pages of the sizes plan 13.9 lists: light, medium, budget, and very large.

use std::sync::Arc;

use opennote_core::format::names::asset_file_name;
use opennote_core::format::segment::encode_segment;
use opennote_core::format::{segment_footer_crc, SegmentHeader};
use opennote_core::model::{
    Asset, Block, BlockData, DeviceRef, Frame, ImageData, Ink, InkBlockData, InkRecord, InkRole, JsonMap, Layout,
    Named, Page, Revision, SegmentRef, Stroke, TextData,
};
use opennote_core::{AssetId, BlockId, OrderKey, PageId, SegmentId, Timestamp};

use super::pen::{handwriting, PenProfile};
use super::Rng;

/// A 1 by 1 transparent PNG, the image every generated image block shows.
pub const PNG: [u8; 67] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/// The SHA-256 hash of [`PNG`].
const PNG_SHA256: &str = "ebf4f635a17d10d6eb46ba680b70142419aa3220f228001a036d311a22ee9d2a";

/// The words of generated sentences.
const WORDS: &str = "cell membrane light energy water chlorophyll sugar carbon plant leaf enzyme protein \
                     the and of splits makes into stores moves through each a with";

/// How much a page holds (plan 13.9).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageKind {
    /// 10 to 50 blocks, and up to 200 strokes. 60% of pages.
    Light,
    /// 100 to 200 blocks, and about 1,000 strokes. 30% of pages.
    Medium,
    /// 500 blocks and 5,000 strokes, the page budget of BRAND.md. 9% of pages.
    Budget,
    /// 5,000 blocks, or 500 blocks with 50,000 strokes. 1% of pages.
    VeryLarge,
}

impl PageKind {
    /// A kind drawn with the shares of plan 13.9.
    pub fn draw(rng: &mut Rng) -> PageKind {
        match rng.below(100) {
            0..60 => PageKind::Light,
            60..90 => PageKind::Medium,
            90..99 => PageKind::Budget,
            _ => PageKind::VeryLarge,
        }
    }

    /// Blocks and strokes for a page of this kind.
    fn size(self, rng: &mut Rng) -> (usize, usize) {
        match self {
            PageKind::Light => (rng.between(10, 50) as usize, rng.below(201) as usize),
            PageKind::Medium => (rng.between(100, 200) as usize, rng.between(800, 1_200) as usize),
            PageKind::Budget => (500, 5_000),
            PageKind::VeryLarge if rng.chance(0.5) => (5_000, 5_000),
            PageKind::VeryLarge => (500, 50_000),
        }
    }
}

/// A generated page with the files it refers to.
pub struct Built {
    /// The page, with its ink committed to its segments.
    pub page: Page,
    /// Segment files by ID.
    pub segments: Vec<(SegmentId, Vec<u8>)>,
    /// Asset files by name.
    pub assets: Vec<(String, Vec<u8>)>,
}

/// The device every generated page names.
pub fn device() -> DeviceRef {
    DeviceRef {
        id: "01m1e34qm04rx4vfj1927vgwgm".parse().expect("a valid ID"),
        label: "Windows device GWGM".to_owned(),
    }
}

fn sentence(rng: &mut Rng) -> String {
    let vocabulary: Vec<&str> = WORDS.split(' ').collect();
    let words: Vec<&str> = (0..rng.between(6, 24))
        .map(|_| vocabulary[rng.below(vocabulary.len() as u64) as usize])
        .collect();
    let mut text = words.join(" ");
    text.replace_range(..1, &text[..1].to_uppercase());
    text + "."
}

fn text_block(rng: &mut Rng, id: BlockId, order: OrderKey, y: f64) -> Block {
    let markdown = match rng.below(6) {
        0 => format!("## {}\n\n{}", sentence(rng).trim_end_matches('.'), sentence(rng)),
        1 => format!("- [x] {}\n- [ ] {}", sentence(rng), sentence(rng)),
        _ => (0..rng.between(1, 3))
            .map(|_| sentence(rng))
            .collect::<Vec<_>>()
            .join(" "),
    };
    let frame = rng.chance(0.5).then(|| Frame {
        x: Some(96.0),
        y: Some(y),
        w: Some(624.0),
        ..Frame::default()
    });
    block(
        id,
        order,
        frame,
        BlockData::Text(TextData {
            markdown: markdown.into(),
            ..TextData::default()
        }),
    )
}

fn block(id: BlockId, order: OrderKey, frame: Option<Frame>, data: BlockData) -> Block {
    Block {
        id,
        order,
        frame,
        lock: None,
        created: Timestamp::from_unix_ms(1_790_777_000_000),
        modified: Timestamp::from_unix_ms(1_790_777_000_000),
        data,
        fallback: None,
        extra: JsonMap::new(),
    }
}

/// A page of `kind`, with its handwriting in two segments: most in a base, the rest from a later save.
pub fn build_page(rng: &mut Rng, kind: PageKind, id: PageId, title: &str, pen: &PenProfile) -> Built {
    let (blocks, strokes) = kind.size(rng);
    let revision = Revision::new(
        rng.id(1_790_777_300_000),
        Timestamp::from_unix_ms(1_790_777_300_000),
        device(),
        "opennote-perf",
    );
    let mut page = Page::new(id, Timestamp::from_unix_ms(1_790_777_000_000), revision);
    page.title = title.to_owned();
    if rng.chance(0.4) {
        page.view.layout = Named::Known(Layout::Flow);
    }
    let keys = OrderKey::spread(None, None, blocks + 2).expect("keys for new blocks");
    let layer: BlockId = rng.id(1_790_777_000_001);
    let mut built = Built {
        page,
        segments: Vec::new(),
        assets: Vec::new(),
    };
    for (i, key) in keys.iter().take(blocks).enumerate() {
        let id = rng.id(1_790_777_000_002);
        let block = text_block(rng, id, key.clone(), 120.0 + 40.0 * i as f64);
        built.page.blocks.insert(Arc::new(block)).expect("unique block IDs");
    }
    if rng.chance(0.1) {
        add_image(rng, &mut built, keys[blocks].clone());
    }
    let ink = handwriting(rng, pen, layer, strokes, 400.0);
    let data = BlockData::Ink(InkBlockData {
        role: Named::Known(InkRole::Layer),
        stroke_count: ink.len() as u32,
        ..InkBlockData::default()
    });
    let frame = Frame {
        x: Some(0.0),
        y: Some(0.0),
        ..Frame::default()
    };
    built
        .page
        .blocks
        .insert(Arc::new(block(layer, keys[blocks + 1].clone(), Some(frame), data)))
        .expect("unique");
    commit_ink(rng, &mut built, ink);
    built
}

fn add_image(rng: &mut Rng, built: &mut Built, order: OrderKey) {
    let asset_id: AssetId = rng.id(1_790_777_000_003);
    let file = asset_file_name(asset_id, "Leaf section.png", "image/png");
    let mut sha256 = [0u8; 32];
    for (slot, pair) in sha256.iter_mut().zip(PNG_SHA256.as_bytes().chunks(2)) {
        *slot = u8::from_str_radix(std::str::from_utf8(pair).expect("hex"), 16).expect("hex");
    }
    let asset = Asset {
        id: asset_id,
        file: file.clone(),
        mime: "image/png".to_owned(),
        bytes: PNG.len() as u64,
        sha256,
        name: "Leaf section.png".to_owned(),
        width: Some(1),
        height: Some(1),
        created: Timestamp::from_unix_ms(1_790_777_000_000),
        extra: JsonMap::new(),
    };
    let image = ImageData {
        asset: asset_id,
        alt: "Cross-section of a leaf".to_owned(),
        decorative: false,
        crop: None,
        extra: JsonMap::new(),
    };
    let frame = Frame {
        x: Some(760.0),
        y: Some(140.0),
        w: Some(320.0),
        h: Some(240.0),
        ..Frame::default()
    };
    built
        .page
        .blocks
        .insert(Arc::new(block(
            rng.id(1_790_777_000_004),
            order,
            Some(frame),
            BlockData::Image(image),
        )))
        .expect("unique");
    built.page.assets.insert(asset_id, asset);
    built.assets.push((file, PNG.to_vec()));
}

/// Writes the strokes as two segments and lists them on the page.
fn commit_ink(rng: &mut Rng, built: &mut Built, strokes: Vec<Stroke>) {
    let records: Vec<InkRecord> = strokes.into_iter().map(|s| InkRecord::Stroke(Arc::new(s))).collect();
    let split = records.len() - records.len() / 20;
    let mut entries = Vec::new();
    let mut all = Vec::new();
    for part in [&records[..split], &records[split..]] {
        if part.is_empty() {
            continue;
        }
        let header = SegmentHeader {
            id: rng.id(1_790_777_200_000),
            page: built.page.id,
            created: Timestamp::from_unix_ms(1_790_777_200_000),
        };
        let bytes = encode_segment(&header, part);
        entries.push(SegmentRef {
            id: header.id,
            bytes: bytes.len() as u64,
            records: part.len() as u32,
            crc32: segment_footer_crc(&bytes).expect("a footer"),
            extra: JsonMap::new(),
        });
        built.segments.push((header.id, bytes));
        all.push(part.to_vec());
    }
    built.page.ink = Ink::replay(entries, all).0;
}
