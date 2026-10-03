use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use opennote_core::{BlockId, Id, NotebookId, PageId, SectionId};

use super::*;
use crate::doc::{BlockText, PageDoc};

fn doc(n: u64, title: &str, blocks: &[&str]) -> PageDoc {
    PageDoc {
        page: PageId::from(Id::from_parts(1_000 + n, u128::from(n))),
        notebook: NotebookId::from(Id::from_parts(3_001, 1)),
        section: SectionId::from(Id::from_parts(4_001, 1)),
        revision: None,
        title: title.to_string(),
        tags: Vec::new(),
        created: Timestamp::from_unix_ms(n as i64),
        modified: Timestamp::from_unix_ms(n as i64),
        blocks: blocks
            .iter()
            .enumerate()
            .map(|(at, text)| BlockText {
                id: BlockId::from(Id::from_parts(2_000 + n, at as u128 + 1)),
                kind: BlockKind::Text,
                text: text.to_string(),
            })
            .collect(),
        locked: false,
        fingerprint: None,
    }
}

fn sample() -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let docs: Vec<PageDoc> = (1..=12)
        .map(|n| {
            let title = format!("Page {n}");
            let first = format!("intro {n}");
            let second = "mitosis ".repeat(n as usize % 4);
            doc(n, &title, &[&first, &second, "mitosis and meiosis"])
        })
        .collect();
    index.upsert_many(&docs).unwrap();
    index
}

fn summary(results: &SearchResults) -> Vec<(String, f64, Option<String>)> {
    let snippet = |hit: &SearchHit| hit.snippet.as_ref().map(|snippet| snippet.text.clone());
    results
        .hits
        .iter()
        .map(|hit| (hit.title.clone(), hit.score, snippet(hit)))
        .collect()
}

#[test]
fn a_pattern_is_checked_with_a_plain_message() {
    assert!(check("ph[ys]+ics\\d*").is_ok());
    assert_eq!(check("(open").unwrap_err(), "Unclosed group");
    assert!(check("[z-a]").is_err());
    assert!(check(&"a".repeat(MAX_PATTERN_CHARS + 1))
        .unwrap_err()
        .contains("longer"));
    assert!(check("(a{1000}){1000}").unwrap_err().contains("too large to run"));
}

#[test]
fn a_large_repetition_count_is_refused() {
    assert!(check("(?s)[e-t].{900}[0-9]{6}")
        .unwrap_err()
        .contains("too large to run"));
    assert!(check("a{2,101}").is_err());
    assert!(check("a{99999999999}").is_err());
    assert!(check("a{2,100} b{3}").is_ok());
    assert!(check("\\{999\\}").is_ok(), "escaped braces are not a repetition");
    assert!(check("[{999}]").is_ok(), "braces in a class are not a repetition");
}

#[test]
fn a_pattern_ignores_case_unless_it_says_not_to() {
    let found = |pattern: &str, text: &str| ranges(&compile(pattern).unwrap(), text);
    assert_eq!(found("mito", "Mitosis"), vec![0..4]);
    assert!(found("(?-i)mito", "Mitosis").is_empty());
    assert_eq!(found("^b", "a\nb"), vec![2..3], "lines are matched one by one");
    assert!(found("x*", "abc").is_empty(), "an empty match is no match");
}

#[test]
fn a_scan_paused_after_every_block_finds_what_one_pass_finds() {
    let index = sample();
    let query = Query::regex("mito\\w+");
    let context = RankContext::at(Timestamp::from_unix_ms(100_000));
    let whole = search(&index, &query, &context, &SearchLimits::default()).unwrap();
    assert!(whole.complete);
    assert_eq!(whole.hits.len(), 12);
    let mut scan = PatternScan::new(&query).unwrap();
    let mut steps = 0;
    while scan.step(&index, &|| true).unwrap() {
        steps += 1;
    }
    assert!(steps > 12, "{steps}");
    let sliced = scan.finish(&index, &context).unwrap();
    assert!(sliced.complete);
    assert_eq!(summary(&sliced), summary(&whole));
}

#[test]
fn a_search_past_its_deadline_or_cancelled_returns_what_it_read() {
    let index = sample();
    let query = Query::regex("mito\\w+");
    let context = RankContext::at(Timestamp::from_unix_ms(100_000));
    let late = search(&index, &query, &context, &SearchLimits::until(Instant::now())).unwrap();
    assert!(!late.complete);
    assert!(late.hits.len() < 12);
    let cancel = Arc::new(AtomicBool::new(true));
    let limits = SearchLimits {
        deadline: None,
        cancel: Some(cancel),
    };
    assert!(!search(&index, &query, &context, &limits).unwrap().complete);
}

#[test]
fn a_long_match_makes_a_short_snippet() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let long = "word ".repeat(4_000);
    index.upsert(&doc(1, "Long", &[&long])).unwrap();
    let hits = index.search(&Query::regex("(?s).+")).unwrap();
    let snippet = hits[0].snippet.as_ref().unwrap();
    assert!(snippet.text.len() <= 420, "{}", snippet.text.len());
    let end = snippet.highlights[0].end;
    assert!(end <= snippet.text.len());
}
