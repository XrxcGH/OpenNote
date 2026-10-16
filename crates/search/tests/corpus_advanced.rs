//! The Phase 8 core benchmark for the advanced features, on the corpus of 1,000 pages: boolean and regular
//! expression search, the typed search syntax, the command palette, link previews, and tag plans. Numbers go in
//! docs/perf/phase-8-core.md.
//!
//! Run it like the other benchmarks, with the `perf` profile (the crate README has the command). The test is
//! ignored in a plain `cargo test`. A row passes when its median is within the budget and its 95th percentile is
//! within twice the budget. The search rows must meet the 100 ms budget of the phase at the 95th percentile.

mod common;

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use common::corpus::{corpus, word, NOW_MS};
use common::{notebook_id, page_id};
use opennote_core::Timestamp;
use opennote_search::syntax::parse;
use opennote_search::{Command, Palette, PaletteContext, PlaceList, Query, SearchIndex, SyntaxContext};

const SEARCH_BUDGET: Duration = Duration::from_millis(100);

struct Sample {
    fastest: Duration,
    median: Duration,
    p95: Duration,
    max: Duration,
}

fn sample(runs: usize, mut run: impl FnMut()) -> Sample {
    run();
    let mut times: Vec<Duration> = (0..runs)
        .map(|_| {
            let started = Instant::now();
            run();
            started.elapsed()
        })
        .collect();
    times.sort();
    Sample {
        fastest: times[0],
        median: times[times.len() / 2],
        p95: times[(times.len() * 95 / 100).min(times.len() - 1)],
        max: times[times.len() - 1],
    }
}

fn ms(duration: Duration) -> String {
    format!("{:.2}", duration.as_secs_f64() * 1_000.0)
}

/// A budget in milliseconds. Debug builds get five times as long, except for the search budget.
fn budget(release_ms: u64) -> Duration {
    Duration::from_millis(release_ms * if cfg!(debug_assertions) { 5 } else { 1 })
}

#[derive(Default)]
struct Report {
    text: String,
    misses: Vec<String>,
}

impl Report {
    fn heading(&mut self, title: &str) {
        let columns = "| Measure | Fastest | Median | 95th percentile | Slowest | Budget |\n|---|---|---|---|---|---|";
        let _ = writeln!(self.text, "\n### {title}\n\n{columns}");
    }

    fn row(&mut self, name: &str, sample: &Sample, budget: Duration, searching: bool) {
        let _ = writeln!(
            self.text,
            "| {name} | {} ms | {} ms | {} ms | {} ms | {} ms |",
            ms(sample.fastest),
            ms(sample.median),
            ms(sample.p95),
            ms(sample.max),
            ms(budget)
        );
        let missed = if searching {
            sample.p95 > SEARCH_BUDGET && !cfg!(debug_assertions)
        } else {
            sample.median > budget || sample.p95 > budget * 2
        };
        if missed {
            self.misses.push(format!(
                "{name}: median {} ms, 95th {} ms, budget {} ms",
                ms(sample.median),
                ms(sample.p95),
                ms(budget)
            ));
        }
    }
}

fn searching(report: &mut Report, index: &SearchIndex, rows: Vec<(String, Query)>) {
    for (name, query) in rows {
        let found = index.search(&query).unwrap().len();
        let time = sample(30, || {
            index.search(&query).unwrap();
        });
        report.row(&format!("{name} ({found} results)"), &time, SEARCH_BUDGET, true);
    }
}

fn boolean_rows(titles: &[String]) -> Vec<(String, Query)> {
    let (a, b, c, d) = (word(0), word(1), word(2), word(300));
    let first_title_word = titles[400].split(' ').next().unwrap_or_default().to_string();
    vec![
        (
            "Either of two common words".into(),
            Query::boolean(format!("{a} OR {b} ")),
        ),
        (
            "A common word without another".into(),
            Query::boolean(format!("{a} -{b} ")),
        ),
        (
            "A group, a word, and a word left out".into(),
            Query::boolean(format!("({c} OR {d}) {a} -{b} ")),
        ),
        ("Only a common word left out".into(), Query::boolean(format!("-{a} "))),
        (
            "A word in the title".into(),
            Query::boolean(format!("title:{first_title_word} ")),
        ),
        (
            "The first letters of a word, or another".into(),
            Query::boolean(format!("{a} OR {}", &d[..2])),
        ),
    ]
}

fn regex_rows() -> Vec<(String, Query)> {
    let inside_notebook = Query {
        notebooks: vec![notebook_id(2)],
        ..Query::regex(format!("\\b{}\\w*", word(300)))
    };
    let titles_only = Query {
        title_only: true,
        ..Query::regex("^[bd]a")
    };
    vec![
        (
            "A word and what follows it".into(),
            Query::regex(format!("\\b{}\\w*", word(300))),
        ),
        ("The same inside one notebook".into(), inside_notebook),
        ("Titles that start with two letters".into(), titles_only),
        (
            "Two words near each other".into(),
            Query::regex(format!("{} \\w+ {}", word(0), word(1))),
        ),
    ]
}

fn commands(count: usize) -> Vec<Command> {
    (0..count)
        .map(|n| Command {
            id: format!("command.{n}"),
            title: format!(
                "{} {}",
                ["New", "Open", "Insert", "Delete", "Toggle", "Go to"][n % 6],
                word(n * 7)
            ),
            category: ["File", "Edit", "Insert", "View", "Tools", "Search"][n / 6 % 6].to_string(),
            keywords: vec![word(n * 11)],
            shortcut: (n % 3 == 0).then(|| format!("Ctrl+{}", n % 10)),
            enabled: n % 17 != 0,
        })
        .collect()
}

fn once(time: Duration) -> Sample {
    Sample {
        fastest: time,
        median: time,
        p95: time,
        max: time,
    }
}

fn per_call(time: Sample, calls: u32) -> Sample {
    Sample {
        fastest: time.fastest / calls,
        median: time.median / calls,
        p95: time.p95 / calls,
        max: time.max / calls,
    }
}

fn syntax_row(report: &mut Report) {
    let places = PlaceList::new();
    let context = SyntaxContext {
        now: Timestamp::from_unix_ms(NOW_MS),
        utc_offset_minutes: -480,
        places: &places,
    };
    let (a, b, c) = (word(0), word(1), word(2));
    let text = format!("{a} OR {b} -{c} tag:area/3 type:text after:30d before:today in:x ");
    let time = sample(200, || {
        for _ in 0..100 {
            std::hint::black_box(parse(&text, &context));
        }
    });
    report.row(
        "Read one search box text with six operators",
        &per_call(time, 100),
        budget(1),
        false,
    );
}

fn palette_rows(report: &mut Report) {
    let started = Instant::now();
    let palette = Palette::new(commands(500));
    report.row("Load 500 commands (once)", &once(started.elapsed()), budget(30), false);
    let habits = PaletteContext {
        recent: (0..10).map(|n| format!("command.{}", n * 31)).collect(),
        ..PaletteContext::default()
    };
    for (name, query) in [
        ("Palette: empty query", ""),
        ("Palette: one letter", "n"),
        ("Palette: a category and a word", "file new"),
        ("Palette: a slip in a word", "toggel"),
        ("Palette: nothing matches", "qqqzzz"),
    ] {
        let time = sample(100, || {
            std::hint::black_box(palette.find(query, &habits));
        });
        report.row(name, &time, budget(16), false);
    }
}

fn index_rows(report: &mut Report, index: &SearchIndex, titles: &[String]) {
    let heading = titles[400].clone();
    let page = page_id(401);
    let time = sample(100, || {
        std::hint::black_box(index.link_preview(page, Some(&heading)).unwrap());
    });
    report.row("Preview a link to a heading", &time, budget(10), false);
    let time = sample(100, || {
        std::hint::black_box(index.link_preview(page, None).unwrap());
    });
    report.row("Preview a link to a page", &time, budget(10), false);
    let time = sample(30, || {
        std::hint::black_box(index.plan_tag_rename("area", "region").unwrap());
    });
    let pages = index.plan_tag_rename("area", "region").unwrap().page_count;
    report.row(
        &format!("Plan renaming a tag on {pages} pages"),
        &time,
        budget(50),
        false,
    );
    let time = sample(30, || {
        std::hint::black_box(index.plan_tag_delete("topic3").unwrap());
    });
    report.row("Plan deleting a tag", &time, budget(50), false);
}

#[test]
#[ignore = "a benchmark: run it with --profile perf and --ignored"]
fn the_advanced_features_meet_their_budgets_on_a_thousand_pages() {
    let corpus = corpus();
    let mut index = SearchIndex::open_in_memory().unwrap();
    for chunk in corpus.docs.chunks(100) {
        index.upsert_many(chunk).unwrap();
    }
    index.optimize().unwrap();
    let mut report = Report::default();
    report.heading("Boolean search");
    searching(&mut report, &index, boolean_rows(&corpus.titles));
    report.heading("Regular expression search");
    searching(&mut report, &index, regex_rows());
    report.heading("Typed syntax, palette, previews, and tag plans");
    syntax_row(&mut report);
    palette_rows(&mut report);
    index_rows(&mut report, &index, &corpus.titles);
    println!("{}", report.text);
    assert!(report.misses.is_empty(), "over budget:\n{}", report.misses.join("\n"));
}
