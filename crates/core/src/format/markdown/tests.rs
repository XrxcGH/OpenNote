#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use super::*;

/// The escaping examples of spec Appendix B.5.
#[test]
fn the_examples_of_appendix_b5() {
    let cases = [
        ("5 * 3 = 15", "5 \\* 3 = 15"),
        ("a == b", "a \\=\\= b"),
        ("Costs $5", "Costs \\$5"),
        ("#biology and C#", "\\#biology and C#"),
        ("snake_case and _draft", "snake_case and \\_draft"),
        ("[draft]", "\\[draft\\]"),
        ("AT&T and &amp;", "AT&T and \\&amp;"),
        ("x < y", "x \\< y"),
        ("~5 minutes", "\\~5 minutes"),
        ("{note}", "\\{note}"),
        ("1. Not a list", "1\\. Not a list"),
        ("- not a bullet", "\\- not a bullet"),
        (" leading space", "&#32;leading space"),
    ];
    for (text, escaped) in cases {
        assert_eq!(escape_text(text, true), escaped, "{text:?}");
        assert_eq!(unescape_text(escaped), text);
    }
}

#[test]
fn line_start_rules_follow_hard_breaks() {
    assert_eq!(escape_text("- a", false), "- a");
    assert_eq!(escape_text("a\n- b\n> c\n+ d", true), "a\\\n\\- b\\\n\\> c\\\n\\+ d");
    assert_eq!(escape_text("x\r\n2) y", true), "x\\\n2\\) y");
    assert_eq!(escape_text("1234567890. no", true), "1234567890. no");
    assert_eq!(escape_text("12a. no", true), "12a. no");
    assert_eq!(escape_text("=x= and =", true), "\\=x= and =");
    assert_eq!(escape_text("tail ", true), "tail&#32;");
    assert_eq!(escape_text("a\tb", false), "a&#9;b");
    assert_eq!(escape_text("nul\0", false), "nul\u{fffd}");
    assert_eq!(escape_text("a | b ` c \\", false), "a \\| b \\` c \\\\");
}

#[test]
fn underscores_between_letters_or_digits_stay() {
    assert_eq!(
        escape_text("über_straße 1_2 a__b _x x_", false),
        "über_straße 1_2 a\\_\\_b \\_x x\\_"
    );
    assert_eq!(escape_text("日本_語", false), "日本_語");
}

#[test]
fn references_are_escaped_only_when_complete() {
    assert_eq!(escape_text("&#32; &x; &; & ;", false), "\\&#32; \\&x; &; & ;");
}

#[test]
fn finds_links_outside_code() {
    let markdown = "See [a](opennote:page/01m3sa12426sg32pmtyffjaqcf#01m3sa14y9zszek1wdk3snddsn) and \
                    ![img](<asset:01m3sa43z1tp9rdr5e8df2jbxy>) and `[no](https://code.example)` and \
                    [web](https://example.org/a_(b)) and <mailto:someone@example.org> and \\[x](y) and \
                    [s](opennote:section/01m3s9v8ym7yt5c8yb61tthbwt) [n](opennote:notebook/01m3s9q9xbpmxwz4cz4ht6twg9) \
                    [o](gopher:x)\n```\n[fenced](https://no.example)\n```\n[after](opennote:page/bad)";
    let links = outgoing_links(markdown);
    let page = PageId::parse("01m3sa12426sg32pmtyffjaqcf").unwrap();
    let anchor = Id::parse("01m3sa14y9zszek1wdk3snddsn").unwrap();
    assert_eq!(
        links,
        [
            LinkTarget::Page {
                page,
                anchor: Some(anchor)
            },
            LinkTarget::Asset(AssetId::parse("01m3sa43z1tp9rdr5e8df2jbxy").unwrap()),
            LinkTarget::External("https://example.org/a_(b)".to_owned()),
            LinkTarget::External("mailto:someone@example.org".to_owned()),
            LinkTarget::Section(SectionId::parse("01m3s9v8ym7yt5c8yb61tthbwt").unwrap()),
            LinkTarget::Notebook(NotebookId::parse("01m3s9q9xbpmxwz4cz4ht6twg9").unwrap()),
            LinkTarget::Other("gopher:x".to_owned()),
            LinkTarget::Other("opennote:page/bad".to_owned()),
        ]
    );
}

struct Resolver;

impl crate::seams::LinkResolver for Resolver {
    fn page_md(&self, _from: PageId, to: PageId) -> Option<String> {
        (to.to_string() == "01m3sa12426sg32pmtyffjaqcf").then(|| format!("../{to}/page.md"))
    }

    fn asset_file(&self, asset: AssetId) -> Option<String> {
        Some(format!("{asset}-leaf.png"))
    }
}

#[test]
fn rewrites_page_and_asset_links_for_page_md() {
    let markdown = "[a](opennote:page/01m3sa12426sg32pmtyffjaqcf#01m3sa14y9zszek1wdk3snddsn) \
                    [b](opennote:page/01m3saznsm2jxj28tzqrqhddv4) ![c](<asset:01m3sa43z1tp9rdr5e8df2jbxy>) \
                    `![d](asset:01m3sa43z1tp9rdr5e8df2jbxy)`";
    let rewritten = rewrite_links(markdown, PageId::ZERO, &Resolver);
    assert_eq!(
        rewritten,
        "[a](../01m3sa12426sg32pmtyffjaqcf/page.md) [b](opennote:page/01m3saznsm2jxj28tzqrqhddv4) \
         ![c](assets/01m3sa43z1tp9rdr5e8df2jbxy-leaf.png) `![d](asset:01m3sa43z1tp9rdr5e8df2jbxy)`"
    );
}

#[test]
fn destinations_are_bare_only_when_safe() {
    assert_eq!(write_destination("assets/a.png"), "assets/a.png");
    assert_eq!(write_destination("a b"), "<a b>");
    assert_eq!(write_destination("a>b\\c"), "<a\\>b\\\\c>");
    assert_eq!(write_destination(""), "<>");
}
