use super::*;

const LEAF: &str = "01m3sa12426sg32pmtyffjaqcf";
const OTHER: &str = "01m3sa8yf8bryf28a7sjgb7mmc";

fn page(id: &str) -> PageId {
    PageId::parse(id).unwrap()
}

fn rename(old: &str, new: &str) -> Rename {
    Rename {
        page: page(LEAF),
        old_title: old.into(),
        new_title: new.into(),
    }
}

#[test]
fn finds_title_links_with_and_without_a_heading() {
    let links = parse("See [[Photosynthesis]] and [[Leaf anatomy#Cross section]].");
    assert_eq!(links.len(), 2);
    assert_eq!(
        (links[0].title.as_str(), links[0].fragment.as_deref()),
        ("Photosynthesis", None)
    );
    assert_eq!(
        (links[1].title.as_str(), links[1].fragment.as_deref()),
        ("Leaf anatomy", Some("Cross section"))
    );
    assert_eq!(links[1].raw, "[[Leaf anatomy#Cross section]]");
    assert_eq!(links[0].start, 4);
}

#[test]
fn finds_the_escaped_spelling_writers_produce() {
    let links = parse(r"Read \[\[Snake\_case \*notes\*\]\] today");
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].title, "Snake_case *notes*");
    assert_eq!(links[0].raw, r"\[\[Snake\_case \*notes\*\]\]");
}

#[test]
fn finds_id_links() {
    let md =
        format!("[The leaf](opennote:page/{LEAF}) and [part](opennote:page/{OTHER}#{LEAF}) and [web](https://x.test)");
    let links = parse(&md);
    assert_eq!(links.len(), 2);
    assert_eq!(links[0].kind, LinkKind::Id);
    assert_eq!(
        (links[0].title.as_str(), links[0].target),
        ("The leaf", Some(page(LEAF)))
    );
    assert_eq!(links[1].fragment.as_deref(), Some(LEAF));
}

#[test]
fn ignores_code_escapes_and_broken_links() {
    let md = format!("`[[in code]]`\n```\n[[fenced]]\n```\n\\[text](opennote:page/{LEAF}) [[open and [[]] [[a\nb]]");
    assert!(parse(&md).is_empty(), "{:?}", parse(&md));
    assert!(parse("[x](opennote:page/not-an-id)").is_empty());
}

#[test]
fn rewrites_title_links_and_keeps_the_heading_and_spelling() {
    let md = "A [[Leaf]] B [[leaf#Veins]] C \\[\\[LEAF\\]\\] D [[Other]]";
    let out = rename("Leaf", "Foliage 2").rewrite(md);
    assert_eq!(
        out,
        "A [[Foliage 2]] B [[Foliage 2#Veins]] C \\[\\[Foliage 2\\]\\] D [[Other]]"
    );
}

#[test]
fn rewrites_id_links_only_when_the_text_is_the_old_title() {
    let md = format!("[Leaf](opennote:page/{LEAF}) [my notes](opennote:page/{LEAF}) [Leaf](opennote:page/{OTHER})");
    let out = rename("Leaf", "Foliage").rewrite(&md);
    let expect =
        format!("[Foliage](opennote:page/{LEAF}) [my notes](opennote:page/{LEAF}) [Leaf](opennote:page/{OTHER})");
    assert_eq!(out, expect);
}

#[test]
fn a_new_title_that_needs_escapes_uses_the_escaped_spelling() {
    let out = rename("Leaf", "Leaf [draft] *2*").rewrite("[[Leaf#Veins]]");
    assert_eq!(out, "\\[\\[Leaf \\[draft\\] \\*2\\*#Veins\\]\\]");
    assert_eq!(parse(&out)[0].title, "Leaf [draft] *2*");
}

#[test]
fn a_new_title_with_hashes_or_closing_brackets_reads_back_whole() {
    for (old, new) in [
        ("[[Leaf]]", "C# notes"),
        ("[[Leaf]]", "C#"),
        ("[[Leaf#Veins]]", "a]]b"),
        ("[[Leaf]]", "x]"),
        ("\\[\\[Leaf\\]\\]", "a]]b"),
        ("\\[\\[Leaf#Veins\\]\\]", "C# notes"),
    ] {
        let out = rename("Leaf", new).rewrite(old);
        let found = parse(&out);
        assert_eq!(found.len(), 1, "{out}");
        assert_eq!(found[0].raw, out);
        assert_eq!(found[0].title, new, "{out}");
        assert_eq!(found[0].fragment, parse(old)[0].fragment, "{out}");
    }
    assert_eq!(rename("Leaf", "a]]b").rewrite("[[Leaf]]"), "[[a\\]\\]b]]");
}

#[test]
fn a_plain_title_link_may_hold_escaped_brackets() {
    let found = parse("[[a\\[1\\]]] and [[b]c]]");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].title, "a[1]");
}

#[test]
fn rewriting_to_the_same_title_changes_nothing() {
    let md = "[[Leaf]] and [[Leaf#Veins]]";
    assert_eq!(rename("Leaf", "Leaf").rewrite(md), md);
}

#[test]
fn escape_and_unescape_round_trip() {
    for text in [
        "plain",
        "a*b_c",
        "_lead and trail_",
        "#1 and C#",
        "x == y",
        "Q&A &amp; &#32;",
        "[a]{b}<c>|d~e$f`g\\h",
    ] {
        assert_eq!(unescape(&escape(text)), text, "{text}");
    }
    assert_eq!(escape("snake_case"), "snake_case");
    assert_eq!(escape("#tag"), "\\#tag");
    assert_eq!(escape("Q&A"), "Q&A");
}

#[test]
fn crafted_brackets_take_linear_time() {
    let started = std::time::Instant::now();
    for text in [
        "[".repeat(200_000),
        "[a".repeat(100_000),
        "\\[\\[".repeat(50_000),
        "[a](".repeat(50_000),
        "[[a".repeat(60_000),
        "`a` ".repeat(50_000),
    ] {
        parse(&text);
    }
    let took = started.elapsed();
    assert!(took < std::time::Duration::from_secs(10), "{took:?}");
}
