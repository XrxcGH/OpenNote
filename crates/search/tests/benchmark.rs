//! The Phase 8 budget: a query over 10,000 pages answers in under 100 ms (DEVELOPMENT.md, Phase 8).

mod common;

use std::time::{Duration, Instant};

use common::{doc, notebook_id, DocExt};
use opennote_core::Timestamp;
use opennote_search::{BlockKind, DateRange, PageDoc, Query, SearchIndex};

const PAGES: u64 = 10_000;
/// The budget of the phase. A debug build is far slower than the app, and a busy machine slower still, so a debug
/// build gets five times as long. Run with `--profile perf` for the real check.
const BUDGET: Duration = Duration::from_millis(if cfg!(debug_assertions) { 500 } else { 100 });

struct Rng(u64);

impl Rng {
    fn below(&mut self, below: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % below as u64) as usize
    }
}

/// One of 3,600 pronounceable words. Low numbers are drawn far more often, as in real text.
fn word(index: usize) -> String {
    let syllable = |n: usize| format!("{}{}", b"bdfgklmnprst"[n % 12] as char, b"aeiou"[n / 12 % 5] as char);
    format!("{}{}", syllable(index % 60), syllable(index / 60 % 60))
}

fn draw(rng: &mut Rng) -> String {
    let skewed = rng.below(3_600) * rng.below(3_600) / 3_600;
    word(skewed)
}

fn sentence(rng: &mut Rng, words: usize) -> String {
    (0..words).map(|_| draw(rng)).collect::<Vec<_>>().join(" ")
}

fn page(rng: &mut Rng, n: u64) -> PageDoc {
    let page = doc(n, &sentence(rng, 3))
        .notebook(1 + n % 5)
        .section(1 + n % 40)
        .modified((n * 60_000) as i64)
        .tags(&[&format!("topic{}", n % 50), &format!("area/{}/{}", n % 7, n % 13)]);
    let page = (0..3).fold(page, |page, _| {
        page.text(&format!("{} **{}** [[{}]]", sentence(rng, 30), draw(rng), draw(rng)))
    });
    page.block(BlockKind::Table, &sentence(rng, 12))
}

fn median(mut run: impl FnMut() -> usize) -> (Duration, usize) {
    let hits = run();
    let mut times: Vec<Duration> = (0..7)
        .map(|_| {
            let start = Instant::now();
            run();
            start.elapsed()
        })
        .collect();
    times.sort();
    (times[3], hits)
}

#[test]
fn ten_thousand_pages_answer_queries_under_100_ms() {
    let dir = tempfile::tempdir().unwrap();
    let mut index = SearchIndex::open(&dir.path().join("search.db")).unwrap();
    let mut rng = Rng(0x2545_F491_4F6C_DD1D);
    let started = Instant::now();
    for chunk in (1..=PAGES).collect::<Vec<_>>().chunks(1_000) {
        let docs: Vec<PageDoc> = chunk.iter().map(|n| page(&mut rng, *n)).collect();
        index.upsert_many(&docs).unwrap();
    }
    index.optimize().unwrap();
    println!("indexed {PAGES} pages in {:?}", started.elapsed());
    assert_eq!(index.page_count().unwrap(), PAGES as usize);

    let (common, rare) = (word(0), word(3_000));
    let filtered = Query {
        notebooks: vec![notebook_id(2)],
        tags: vec!["area/3".into()],
        date: Some(DateRange {
            from: Some(Timestamp::from_unix_ms(100_000_000)),
            ..DateRange::default()
        }),
        ..Query::text(&word(0)[..2])
    };
    let queries = [
        ("common word", Query::text(format!("{common} "))),
        ("prefix typed so far", Query::text(&common[..2])),
        (
            "two words and a prefix",
            Query::text(format!("{} {} {}", word(1), word(2), &word(5)[..3])),
        ),
        ("rare word", Query::text(rare)),
        ("phrase", Query::text(format!("\"{} {}\"", word(0), word(1)))),
        (
            "block type",
            Query {
                block_types: vec![BlockKind::Table],
                ..Query::text(word(2))
            },
        ),
        ("every filter", filtered),
        ("no words, newest first", Query::default()),
    ];
    let mut over = Vec::new();
    for (name, query) in queries {
        let (time, hits) = median(|| index.search(&query).unwrap().len());
        println!("{name}: {hits} results in {time:?}");
        if time >= BUDGET {
            over.push(format!("{name} took {time:?}"));
        }
    }
    assert!(over.is_empty(), "over the budget of {BUDGET:?}: {over:?}");
}
