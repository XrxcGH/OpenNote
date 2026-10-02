//! The pages of the fixture notebook that carry content.

use std::sync::Arc;

use opennote_core::id::*;
use opennote_core::model::*;
use serde_json::json;

use super::notebook::*;

const PHOTOSYNTHESIS_TEXT: &str = "## Light reactions\n\nThe **thylakoid** membrane holds ==chlorophyll a== and \
splits water into O<sub>2</sub>.\n\n> [!tip] Exam hint\n> Learn the Z-scheme diagram.\n\n- [x] Read chapter 8\n- [ ] \
Lab write-up";

/// A freeform page with text and handwriting in two segments: strokes of every kind, then property changes, a
/// removal, and a new stroke.
pub fn photosynthesis(files: &mut Files, dir: &str) -> Page {
    let mut page = page(101, "Photosynthesis", revision(301, Some(id(300))));
    page.tags = vec!["biology".to_owned(), "exam/unit-3".to_owned()];
    page.view.mode = Named::Known(ViewMode::Paginated);
    page.view.background.pattern = Named::Known(Pattern::Ruled);
    let layer: BlockId = id(201);
    let elements: Vec<ElementId> = (401..=405).map(id).collect();
    let text = BlockData::Text(TextData {
        markdown: PHOTOSYNTHESIS_TEXT.into(),
        ids: elements.clone(),
        tags: [(elements[0], vec!["exam".to_owned()])].into(),
        styles: [(elements[0], "title".to_owned())].into(),
        checked: [elements[3]].into(),
        extra: JsonMap::new(),
    });
    let strokes = base_strokes(layer);
    let mut blocks = vec![
        block(202, "a0", floating(96.0, 120.0, Some(624.0)), text),
        block(201, "a1", floating(0.0, 0.0, None), ink_block(InkRole::Layer, 0, "")),
        block(
            203,
            "a2",
            floating(120.0, 168.0, None),
            anchored_ink(id(202), elements[1]),
        ),
    ];
    let records: Vec<InkRecord> = strokes.iter().cloned().map(InkRecord::Stroke).collect();
    add_segment(files, dir, &mut page, 501, &records);
    let later = later_records(layer, &strokes);
    add_segment(files, dir, &mut page, 502, &later);
    let (ink, _) = Ink::replay(page.ink.segments().to_vec(), vec![records, later]);
    page.ink = ink;
    if let BlockData::Ink(data) = &mut blocks[1].data {
        data.stroke_count = page.ink.count_in_block(layer);
    }
    for block in blocks {
        page.blocks.insert(Arc::new(block)).unwrap();
    }
    page
}

fn base_strokes(layer: BlockId) -> Vec<Arc<Stroke>> {
    let spec = |n, tool, palette, color, channels, points| StrokeSpec {
        n,
        block: layer,
        tool,
        palette,
        color,
        channels,
        points,
    };
    let pen = stroke(spec(
        601,
        0,
        1,
        [0x2b, 0x25, 0x21, 0xff],
        5,
        curve(1, 24, (100.0, 400.0)),
    ));
    let highlighter = stroke(spec(
        602,
        2,
        32,
        [0xff, 0xd8, 0x4d, 0x80],
        1,
        curve(2, 16, (100.0, 440.0)),
    ));
    let mut pencil = stroke(spec(
        603,
        1,
        0,
        [0x33, 0x66, 0x99, 0xff],
        7,
        curve(3, 20, (300.0, 400.0)),
    ));
    pencil.transform = Some(Affine([0.5, 0.0, 0.0, 0.5, 150.0, 200.0]));
    let mut piece = stroke(spec(
        604,
        3,
        3,
        [0x8b, 0x2c, 0x1f, 0xff],
        4,
        curve(4, 10, (120.0, 500.0)),
    ));
    piece.origin = Some(pen.id);
    piece.start_unknown = true;
    vec![pen, highlighter, pencil, piece]
        .into_iter()
        .map(Arc::new)
        .collect()
}

fn later_records(layer: BlockId, strokes: &[Arc<Stroke>]) -> Vec<InkRecord> {
    let brush = stroke(StrokeSpec {
        n: 605,
        block: layer,
        tool: 4,
        palette: 5,
        color: [0x5b, 0x3a, 0x8c, 0xff],
        channels: 1,
        points: curve(5, 1, (200.0, 520.0)),
    });
    vec![
        InkRecord::Props(StrokeProps {
            id: strokes[1].id,
            style: Some(StrokeStyle {
                tool: 2,
                palette: 33,
                color: [0x7f, 0xd6, 0xa8, 0x80],
                width: 12.0,
            }),
            transform: None,
            block: None,
        }),
        InkRecord::Props(StrokeProps {
            id: strokes[2].id,
            style: None,
            transform: Some(None),
            block: None,
        }),
        InkRecord::Remove(strokes[3].id),
        InkRecord::Stroke(Arc::new(brush)),
    ]
}

/// A flow page with links to another page and the web.
pub fn light_reactions(target: PageId) -> Page {
    let mut page = page(102, "Light reactions", revision(302, None));
    page.view.layout = Named::Known(Layout::Flow);
    let markdown = format!(
        "The light reactions take place in the [thylakoid](opennote:page/{target}) membranes. See also \
         [the textbook](https://example.org/biology).\n\n1. Light excites chlorophyll.\n2. Water is split."
    );
    page.blocks
        .insert(Arc::new(block(211, "a0", None, text(&markdown))))
        .unwrap();
    page
}

/// A page with tags and a title that needs escaping in Markdown.
pub fn calvin_cycle() -> Page {
    let mut page = page(103, "Calvin cycle #3 [draft]", revision(303, None));
    page.tags = vec!["exam/unit-3".to_owned()];
    let markdown = "The cycle turns carbon dioxide into sugar, with energy from the light reactions.";
    page.blocks
        .insert(Arc::new(block(221, "a0", None, text(markdown))))
        .unwrap();
    page
}

/// A flow page with every other version 1 block type, and two extension blocks.
pub fn cell_structure(files: &mut Files, dir: &str, linked: PageId) -> Page {
    let mut page = page(104, "Cell structure", revision(304, None));
    page.view.layout = Named::Known(Layout::Flow);
    let leaf = asset(files, dir, 701, ("Leaf section.png", "image/png", &PNG));
    let pdf: &[u8] = b"%PDF-1.4\n% Fixture handout\n";
    let handout = asset(files, dir, 702, ("Lab handout.pdf", "application/pdf", pdf));
    let intro = format!(
        "Cells have a membrane, a nucleus, and organelles. Compare [light reactions](opennote:page/{linked}).\n\n\
         ![Leaf, small](asset:{})",
        leaf.id
    );
    let drawing: BlockId = id(236);
    let mut blocks = vec![
        block(231, "a0", None, text(&intro)),
        block(232, "a1", None, image(leaf.id, "Cross-section of a leaf", false)),
        block(234, "a3", None, file(handout.id)),
        block(235, "a4", None, table()),
        block(
            236,
            "a5",
            Some(sized(400.0, 200.0)),
            ink_block(InkRole::Drawing, 2, "Sketch of a plant cell"),
        ),
        extension(237, "a6", Some("**Kanban board**: 2 columns, 7 cards")),
        extension(238, "a7", None),
    ];
    blocks[3].lock = Some(Named::Known(Lock::Position));
    for block in blocks {
        page.blocks.insert(Arc::new(block)).unwrap();
    }
    page.assets = [(leaf.id, leaf), (handout.id, handout)].into();
    let records = drawing_strokes(drawing);
    add_segment(files, dir, &mut page, 511, &records);
    page.ink = Ink::replay(page.ink.segments().to_vec(), vec![records]).0;
    page
}

/// Two strokes in the drawing, with every channel.
fn drawing_strokes(drawing: BlockId) -> Vec<InkRecord> {
    [(611, 6), (612, 7)]
        .into_iter()
        .map(|(n, seed)| {
            let s = stroke(StrokeSpec {
                n,
                block: drawing,
                tool: 0,
                palette: 2,
                color: [0x2f, 0x4b, 0x9c, 0xff],
                channels: 7,
                points: curve(seed, 30, (20.0, 40.0 + f64::from(seed) * 10.0)),
            });
            InkRecord::Stroke(Arc::new(s))
        })
        .collect()
}

fn sized(w: f64, h: f64) -> Frame {
    Frame {
        w: Some(w),
        h: Some(h),
        ..Frame::default()
    }
}

fn image(asset: AssetId, alt: &str, decorative: bool) -> BlockData {
    BlockData::Image(ImageData {
        asset,
        alt: alt.to_owned(),
        decorative,
        crop: (!decorative).then(|| Crop {
            x: 0.1,
            y: 0.0,
            w: 0.8,
            h: 1.0,
            extra: JsonMap::new(),
        }),
        extra: JsonMap::new(),
    })
}

fn file(asset: AssetId) -> BlockData {
    BlockData::File(FileData {
        asset,
        display: Named::Known(FileDisplay::Preview),
        alt: "The handout for the lab".to_owned(),
        decorative: false,
        extra: JsonMap::new(),
    })
}

fn table() -> BlockData {
    let columns = vec![
        TableColumn {
            id: id(801),
            width: Some(200.0),
            extra: JsonMap::new(),
        },
        TableColumn {
            id: id(802),
            width: None,
            extra: JsonMap::new(),
        },
    ];
    let row = |n: u64, a: &str, b: &str| TableRow {
        id: id(n),
        cells: [(columns[0].id, cell(a)), (columns[1].id, cell(b))].into(),
        extra: JsonMap::new(),
    };
    BlockData::Table(TableData {
        header: true,
        rows: vec![
            row(811, "Organelle", "Role"),
            row(812, "Mitochondria", "Makes energy\\\nfor the cell"),
            row(813, "Nucleus \\| core", "Holds the **DNA**"),
        ],
        columns,
        extra: JsonMap::new(),
    })
}

fn cell(markdown: &str) -> TableCell {
    TableCell {
        markdown: markdown.to_owned(),
        extra: JsonMap::new(),
    }
}

fn extension(n: u64, order: &str, fallback: Option<&str>) -> Block {
    let data = json!({"cards": 7, "columns": ["To do", "Done"]})
        .as_object()
        .cloned()
        .unwrap();
    let mut block = block(
        n,
        order,
        None,
        BlockData::Other(OtherData {
            type_name: "ext:org.example/kanban".into(),
            data,
            unreadable: None,
        }),
    );
    block.fallback = fallback.map(|markdown| Fallback {
        markdown: markdown.to_owned(),
        ..Fallback::default()
    });
    block
}

/// An empty block of anchored ink (spec 8.1) tied to a place in the page's text, with an unknown key to keep.
fn anchored_ink(text: BlockId, para: ElementId) -> BlockData {
    let anchor = InkAnchor {
        block: text,
        para: Some(para),
        at: Some(4),
        quote: Some(AnchorQuote {
            prefix: "The ".to_owned(),
            exact: "thylakoid".to_owned(),
            suffix: " membrane".to_owned(),
            extra: JsonMap::new(),
        }),
        dx: -6.5,
        dy: 14.0,
        extra: [("zzfuture".to_owned(), json!(1))].into_iter().collect(),
    };
    BlockData::Ink(InkBlockData {
        role: Named::Known(InkRole::Anchored),
        anchor: Some(anchor),
        ..InkBlockData::default()
    })
}
