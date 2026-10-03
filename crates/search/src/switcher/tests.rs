use opennote_core::Id;

use super::*;

fn page(n: u64) -> PageId {
    PageId::from(Id::from_parts(1_000 + n, u128::from(n)))
}

fn entry(n: u64, title: &str) -> SwitchEntry {
    SwitchEntry {
        page: page(n),
        title: title.to_string(),
        notebook: NotebookId::from(Id::from_parts(3_001, 1)),
        section: SectionId::from(Id::from_parts(4_001, 1)),
        modified: Timestamp::from_unix_ms(n as i64 * 1_000),
    }
}

fn switcher() -> Switcher {
    Switcher::from_entries(vec![
        entry(1, "Biology"),
        entry(2, "Cell biology notes"),
        entry(3, "Chemistry lab"),
        entry(4, "Physics lab"),
        entry(5, "Daily 2026-10-02"),
        entry(6, "Bio"),
    ])
}

fn titles(switch: &Switch) -> Vec<&str> {
    switch.hits.iter().map(|hit| hit.title.as_str()).collect()
}

fn context() -> SwitchContext {
    SwitchContext::default()
}

#[test]
fn an_empty_query_lists_recent_pages_first_and_then_the_newest() {
    let found = switcher().find(
        "  ",
        &SwitchContext {
            recent: vec![page(3), page(1), page(99)],
            current: Some(page(6)),
            ..context()
        },
    );
    assert_eq!(
        titles(&found),
        [
            "Chemistry lab",
            "Biology",
            "Daily 2026-10-02",
            "Physics lab",
            "Cell biology notes"
        ]
    );
    assert_eq!(found.hits[0].recent, Some(0));
    assert_eq!(found.hits[1].recent, Some(1));
    assert_eq!(found.hits[2].recent, None);
    assert!(found.hits.iter().all(|hit| hit.kind.is_none() && !hit.is_current));
    assert_eq!(found.create, None);
}

#[test]
fn the_limit_applies_to_an_empty_query_too() {
    let found = switcher().find("", &SwitchContext { limit: 2, ..context() });
    assert_eq!(titles(&found), ["Bio", "Daily 2026-10-02"]);
}

#[test]
fn typing_lists_matches_best_first() {
    let found = switcher().find("bio", &context());
    assert_eq!(titles(&found), ["Bio", "Biology", "Cell biology notes"]);
    let kinds: Vec<_> = found.hits.iter().map(|hit| hit.kind.unwrap()).collect();
    assert_eq!(kinds, [MatchKind::Exact, MatchKind::Prefix, MatchKind::WordPrefix]);
    assert_eq!(found.hits[1].highlights.len(), 1);
    assert_eq!(found.hits[1].highlights[0], 0..3);
    assert_eq!(found.create, None);
}

#[test]
fn a_fuzzy_query_finds_pages_by_scattered_letters() {
    let found = switcher().find("clab", &context());
    assert_eq!(
        titles(&found),
        ["Chemistry lab", "Physics lab"],
        "the c that starts a word wins"
    );
    assert!(switcher().find("zq", &context()).hits.is_empty());
    let found = switcher().find("lab", &context());
    assert_eq!(titles(&found), ["Physics lab", "Chemistry lab"]);
}

#[test]
fn recent_pages_win_ties_but_never_cross_a_better_kind() {
    let entries = vec![entry(1, "Notes alpha"), entry(2, "Notes beta"), entry(3, "Footnotes")];
    let switcher = Switcher::from_entries(entries);
    let plain = switcher.find("notes", &context());
    let beta_first = switcher.find(
        "notes",
        &SwitchContext {
            recent: vec![page(2)],
            ..context()
        },
    );
    assert_eq!(titles(&plain)[2], "Footnotes");
    assert_eq!(titles(&beta_first), ["Notes beta", "Notes alpha", "Footnotes"]);
    let wrong_kind_recent = switcher.find(
        "notes",
        &SwitchContext {
            recent: vec![page(3)],
            ..context()
        },
    );
    assert_eq!(
        titles(&wrong_kind_recent)[2],
        "Footnotes",
        "a recent substring match stays below prefix matches"
    );
}

#[test]
fn the_current_page_still_matches_and_says_so() {
    let found = switcher().find(
        "physics",
        &SwitchContext {
            current: Some(page(4)),
            ..context()
        },
    );
    assert_eq!(found.hits.len(), 1);
    assert!(found.hits[0].is_current);
}

#[test]
fn the_section_and_notebook_of_the_scope_break_ties() {
    let mut other = entry(2, "Notes two");
    other.section = SectionId::from(Id::from_parts(4_002, 2));
    other.notebook = NotebookId::from(Id::from_parts(3_002, 2));
    other.modified = Timestamp::from_unix_ms(9_000);
    let switcher = Switcher::from_entries(vec![entry(1, "Notes one"), other.clone()]);
    assert_eq!(titles(&switcher.find("notes", &context())), ["Notes two", "Notes one"]);
    let scoped = SwitchContext {
        scope: Some(SearchScope {
            notebook: Some(entry(1, "").notebook),
            section: Some(entry(1, "").section),
        }),
        ..context()
    };
    assert_eq!(titles(&switcher.find("notes", &scoped)), ["Notes one", "Notes two"]);
}

#[test]
fn nothing_found_offers_to_create_the_page() {
    let found = switcher().find("  Quantum   field   notes ", &context());
    assert!(found.hits.is_empty());
    assert_eq!(found.create.as_deref(), Some("Quantum field notes"));
    let found = switcher().find("???", &context());
    assert!(found.hits.is_empty());
    assert_eq!(found.create.as_deref(), Some("???"));
}

#[test]
fn a_new_title_is_cleaned_and_capped() {
    assert_eq!(new_page_title("  a \t b\n c "), Some("a b c".into()));
    assert_eq!(new_page_title(" \n "), None);
    let long = "x".repeat(MAX_NEW_TITLE_CHARS + 50);
    assert_eq!(new_page_title(&long).unwrap().chars().count(), MAX_NEW_TITLE_CHARS);
    assert_eq!(
        new_page_title(&format!("{} y", "x".repeat(MAX_NEW_TITLE_CHARS - 1)))
            .unwrap()
            .chars()
            .last(),
        Some('x')
    );
}

#[test]
fn equal_scores_come_out_in_a_steady_order() {
    let entries: Vec<_> = (1..=8).map(|n| entry(n, "Same title")).collect();
    let first = Switcher::from_entries(entries.clone()).find("same", &context());
    let mut shuffled = entries;
    shuffled.reverse();
    let second = Switcher::from_entries(shuffled).find("same", &context());
    let pages = |switch: &Switch| switch.hits.iter().map(|hit| hit.page).collect::<Vec<_>>();
    assert_eq!(pages(&first), pages(&second));
}

#[test]
fn the_limit_caps_matches() {
    let entries: Vec<_> = (1..=30).map(|n| entry(n, &format!("Note {n}"))).collect();
    let switcher = Switcher::from_entries(entries);
    assert_eq!(switcher.find("note", &context()).hits.len(), DEFAULT_LIMIT);
    assert_eq!(
        switcher
            .find("note", &SwitchContext { limit: 5, ..context() })
            .hits
            .len(),
        5
    );
    assert_eq!(
        switcher
            .find(
                "note",
                &SwitchContext {
                    limit: 5_000,
                    ..context()
                }
            )
            .hits
            .len(),
        30
    );
}
