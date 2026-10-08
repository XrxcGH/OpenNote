use super::*;

fn plain(markdown: &str) -> String {
    extract(markdown).text
}

#[test]
fn strips_emphasis_links_and_escapes() {
    let text = plain("The **thylakoid** membrane holds ==chlorophyll a== and splits water into O<sub>2</sub>.");
    assert_eq!(
        text,
        "The thylakoid membrane holds chlorophyll a and splits water into O2."
    );
    assert_eq!(
        plain("See [the leaf](opennote:page/01m3sa12426sg32pmtyffjaqcf#x) now"),
        "See the leaf now"
    );
    assert_eq!(plain("![Cross-section](assets/leaf.png)"), "Cross-section");
    assert_eq!(
        plain(r"A \*star\* and snake_case and \[\[Page\]\]"),
        "A *star* and snake_case and [[Page]]"
    );
    assert_eq!(plain("[[Page#Heading]] stays"), "[[Page#Heading]] stays");
}

#[test]
fn strips_block_marks() {
    let text =
        plain("> [!tip] Exam hint\n> Learn the Z-scheme.\n\n- [x] Read chapter 8\n- [ ] Lab write-up\n3. Third\n---");
    assert_eq!(
        text,
        "Exam hint\nLearn the Z-scheme.\nRead chapter 8\nLab write-up\nThird"
    );
}

#[test]
fn keeps_code_and_drops_fences() {
    let text = plain("Use `a*b` here\n```rust\nlet x = 1; // [not a link](x)\n```\nafter");
    assert_eq!(text, "Use a*b here\nlet x = 1; // [not a link](x)\nafter");
}

#[test]
fn reads_tables_and_entities() {
    assert_eq!(
        plain("| Name | Count |\n|---|---|\n| Ada&#32;L | 2<br>3 |"),
        "Name Count\nAda L 2 3"
    );
    assert_eq!(plain("Q&amp;A &copy; 1 < 2"), "Q&A &copy; 1 < 2");
}

#[test]
fn collects_headings_with_levels() {
    let found = extract("# Title\n\nbody\n## Light reactions\n#not a heading\n```\n# in code\n```");
    let headings: Vec<(u8, &str)> = found.headings.iter().map(|h| (h.level, h.text.as_str())).collect();
    assert_eq!(headings, [(1, "Title"), (2, "Light reactions")]);
}

#[test]
fn collects_inline_tags_outside_code() {
    let found = extract("Plan #Exam/Unit-3 and #todo, issue #123, C# and \\#escaped `#code`\n```\n#fenced\n```");
    assert_eq!(found.tags, ["exam/unit-3", "todo"]);
}

/// Runs `work` on a thread with the indexer's 2 MiB stack.
fn on_indexer_stack<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(2 << 20)
        .spawn(work)
        .unwrap()
        .join()
        .unwrap()
}

#[test]
fn crafted_brackets_neither_exhaust_the_stack_nor_stall() {
    let started = std::time::Instant::now();
    let nested = on_indexer_stack(|| {
        let nested = extract(&format!("{}a{}", "[".repeat(10_000), "](x)".repeat(10_000))).text;
        extract(&"[".repeat(400_000));
        extract(&"[a](".repeat(50_000));
        extract(&"`a``".repeat(50_000));
        nested
    });
    assert!(nested.contains('a'));
    let took = started.elapsed();
    assert!(took < std::time::Duration::from_secs(10), "{took:?}");
}

#[test]
fn links_nest_up_to_the_limit() {
    let markdown = format!("{}deep{}", "[".repeat(3), "](x)".repeat(3));
    assert_eq!(plain(&markdown), "deep");
}

#[test]
fn hard_breaks_escapes_and_callout_markers_never_reach_the_text() {
    assert_eq!(plain("Hello Bob,\\\nthe wombatphrase"), "Hello Bob,\nthe wombatphrase");
    assert_eq!(plain(r"Due today and \#urgent."), "Due today and #urgent.");
    assert_eq!(plain("> [!note] Callout\n> Hello"), "Callout\nHello");
}
