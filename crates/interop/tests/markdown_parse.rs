//! Reading the Markdown that Obsidian and Joplin write: wiki links, highlights, callouts, tables, and raw HTML.

use opennote_interop::doc::parse::{parse, SoftBreaks};
use opennote_interop::doc::write::to_markdown;
use opennote_interop::doc::{Block, Fold, Inline, Marks};

fn paragraph(markdown: &str) -> Vec<Inline> {
    match parse(markdown, SoftBreaks::Hard).blocks.into_iter().next() {
        Some(Block::Paragraph(content)) => content,
        other => panic!("expected a paragraph, found {other:?}"),
    }
}

#[test]
fn wiki_links_keep_their_target_and_label() {
    let content = paragraph("See [[Cell biology#Mitosis|the mitosis notes]] now");
    assert_eq!(
        content,
        vec![
            Inline::text("See "),
            Inline::marked("the mitosis notes", Marks::link("wiki:Cell biology#Mitosis")),
            Inline::text(" now"),
        ]
    );
}

#[test]
fn wiki_embeds_become_images_without_size_hints() {
    let content = paragraph("![[leaf.png|300]]");
    assert_eq!(
        content,
        vec![Inline::Image {
            dest: "leaf.png".to_owned(),
            alt: String::new()
        }]
    );
}

#[test]
fn highlights_open_and_close_but_escaped_equals_do_not() {
    let content = paragraph("a ==key== b \\=\\= c");
    let highlight = Marks {
        highlight: Some("honey".to_owned()),
        ..Marks::none()
    };
    assert_eq!(
        content,
        vec![
            Inline::text("a "),
            Inline::marked("key", highlight),
            Inline::text(" b == c")
        ]
    );
}

#[test]
fn an_unclosed_highlight_stays_plain_text() {
    assert_eq!(paragraph("x ==y z"), vec![Inline::text("x ==y z")]);
}

#[test]
fn soft_breaks_follow_the_option() {
    let hard = parse("one\ntwo", SoftBreaks::Hard).blocks;
    assert_eq!(to_markdown(&hard), "one\\\ntwo");
    let space = parse("one\ntwo", SoftBreaks::Space).blocks;
    assert_eq!(to_markdown(&space), "one two");
}

#[test]
fn obsidian_callouts_read_type_fold_and_title() {
    let parsed = parse(
        "> [!faq]- Why is the sky blue?\n> Scattering.\n\nAfter",
        SoftBreaks::Hard,
    );
    let Block::Callout {
        kind,
        fold,
        title,
        blocks,
    } = &parsed.blocks[0]
    else {
        panic!("expected a callout, found {:?}", parsed.blocks[0]);
    };
    assert_eq!((kind.as_str(), *fold), ("faq", Some(Fold::Folded)));
    assert_eq!(title, &vec![Inline::text("Why is the sky blue?")]);
    assert_eq!(blocks, &vec![Block::Paragraph(vec![Inline::text("Scattering.")])]);
    assert_eq!(
        to_markdown(&parsed.blocks),
        "> [!faq]- Why is the sky blue?\n> Scattering.\n\nAfter"
    );
}

#[test]
fn tables_become_table_blocks_and_nested_ones_become_lines() {
    let parsed = parse(
        "| a | b |\n|---|---|\n| 1 | 2 |\n\n- item\n\n  | x | y |\n  |---|---|\n  | 3 | 4 |",
        SoftBreaks::Hard,
    );
    let Block::Table { header, rows } = &parsed.blocks[0] else {
        panic!("expected a table, found {:?}", parsed.blocks[0]);
    };
    assert!(*header);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1][1], vec![Inline::text("2")]);
    assert_eq!(parsed.notes.tables_flattened, 1);
}

#[test]
fn unknown_html_is_dropped_and_counted_but_its_text_stays() {
    let parsed = parse(
        "Some <abbr title=\"x\">HTML</abbr> and <u>under</u>line<br>next",
        SoftBreaks::Hard,
    );
    assert_eq!(to_markdown(&parsed.blocks), "Some HTML and <u>under</u>line\\\nnext");
    assert_eq!(parsed.notes.html_dropped, 1);
}

#[test]
fn canonical_output_reparses_to_the_same_tree() {
    let source = "# Title\n\n1. one **bold _x_**\n2. two `code` and ~~gone~~\n\n> quote\n\n- [ ] todo\n- [x] done";
    let first = parse(source, SoftBreaks::Hard).blocks;
    let again = parse(&to_markdown(&first), SoftBreaks::Hard).blocks;
    assert_eq!(first, again);
}

#[test]
fn a_mark_name_cannot_close_its_tag_and_add_raw_html() {
    let evil = "x\"><img src=\"https://example.org/p.png\">";
    let quoted = "x&quot;&gt;&lt;img src=&quot;https://example.org/p.png&quot;&gt;";
    let source = format!(
        "<span data-color=\"{quoted}\">a</span> <mark data-color=\"{quoted}\">b</mark> \
         <span data-size=\"{quoted}\">c</span>"
    );
    let parsed = parse(&source, SoftBreaks::Hard);
    let written = to_markdown(&parsed.blocks);
    assert_eq!(written, "a b c");

    let marks = Marks {
        color: Some(evil.to_owned()),
        highlight: Some(evil.to_owned()),
        size: Some(evil.to_owned()),
        ..Marks::default()
    };
    let tree = vec![Block::Paragraph(vec![Inline::marked("t", marks)])];
    let written = to_markdown(&tree);
    assert!(!written.contains("<img"), "{written}");
    let reread = to_markdown(&parse(&written, SoftBreaks::Hard).blocks);
    assert!(!reread.contains("<img") && reread.contains('t'), "{reread}");
}

fn depth(blocks: &[Block]) -> usize {
    let inner = blocks.iter().map(|block| match block {
        Block::Quote(blocks) | Block::Callout { blocks, .. } => 1 + depth(blocks),
        Block::List { items, .. } => 1 + items.iter().map(|i| depth(&i.blocks)).max().unwrap_or(0),
        _ => 0,
    });
    inner.max().unwrap_or(0)
}

#[test]
fn deeply_nested_quotes_and_lists_stay_shallow_and_keep_their_text() {
    let quotes = format!("{} deep", ">".repeat(50_000));
    let bullets = format!("{}deep", "- ".repeat(50_000));
    let numbers = format!("{}deep", "1. ".repeat(50_000));
    let mixed = format!("{}deep", "> - ".repeat(25_000));
    for source in [quotes, bullets, numbers, mixed] {
        let parsed = parse(&source, SoftBreaks::Hard);
        assert!(depth(&parsed.blocks) <= opennote_interop::doc::parse::MAX_NESTING);
        let written = to_markdown(&parsed.blocks);
        assert!(written.contains("deep"), "{}", &written[..written.len().min(200)]);
        assert_eq!(parse(&written, SoftBreaks::Hard).blocks.len(), parsed.blocks.len());
    }
}
