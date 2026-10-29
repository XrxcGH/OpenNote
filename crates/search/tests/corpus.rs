//! The Phase 8 core benchmark on a corpus of 1,000 pages: building, saving, searching, switching, linking, and
//! reopening. Numbers go in docs/perf/phase-8-core.md.
//!
//! A debug build says little about speed, so run it as the other benchmarks do, with the `perf` profile. The
//! crate README has the command. The test is ignored in a plain `cargo test`.
//!
//! Every row of the report prints as a line of a Markdown table. The test fails if a budget is missed. A row
//! passes when its median is within the budget and its 95th percentile is within twice the budget, because a
//! busy machine stretches the slow end of a run. The search rows must meet the 100 ms budget at the 95th
//! percentile, as the phase requires. A debug build gives every other budget five times as long.

mod common;

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::corpus::{corpus, word, Corpus, DAY_MS, NOW_MS, PAGES};
use common::world::MemSource;
use common::{notebook_id, page_id, section_id};
use opennote_core::session::events::{IndexHint, IndexSink};
use opennote_core::Timestamp;
use opennote_search::mentions::find_mentions;
use opennote_search::{
    BackgroundIndexer, BlockKind, DateRange, Indexer, IndexerConfig, Job, Query, SearchIndex, SearchScope, SharedIndex,
    SwitchContext, Switcher,
};

#[derive(Clone, Copy)]
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

/// The budget for a row, in milliseconds. Debug builds get five times as long.
fn budget(release_ms: u64) -> Duration {
    let scale = if cfg!(debug_assertions) { 5 } else { 1 };
    Duration::from_millis(release_ms * scale)
}

/// The search budget of the phase, which no build gets more time for.
const SEARCH_BUDGET: Duration = Duration::from_millis(100);

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

    fn once(&mut self, name: &str, time: Duration, budget: Duration) {
        let _ = writeln!(self.text, "| {name} | {} ms | | | | {} ms |", ms(time), ms(budget));
        if time > budget {
            self.misses
                .push(format!("{name}: {} ms over {} ms", ms(time), ms(budget)));
        }
    }

    fn row(&mut self, name: &str, sample: Sample, budget: Duration) {
        self.line(name, sample, budget);
        if sample.median > budget || sample.p95 > budget * 2 {
            self.misses.push(format!(
                "{name}: median {} ms and 95th {} ms over {} ms",
                ms(sample.median),
                ms(sample.p95),
                ms(budget)
            ));
        }
    }

    fn search_row(&mut self, name: &str, sample: Sample) {
        self.line(name, sample, SEARCH_BUDGET);
        if sample.p95 > SEARCH_BUDGET && !cfg!(debug_assertions) {
            self.misses
                .push(format!("{name}: 95th percentile {} ms over 100 ms", ms(sample.p95)));
        }
    }

    fn line(&mut self, name: &str, sample: Sample, budget: Duration) {
        let _ = writeln!(
            self.text,
            "| {name} | {} ms | {} ms | {} ms | {} ms | {} ms |",
            ms(sample.fastest),
            ms(sample.median),
            ms(sample.p95),
            ms(sample.max),
            ms(budget)
        );
    }

    fn fact(&mut self, name: &str, value: String) {
        let _ = writeln!(self.text, "| {name} | {value} | | | | |");
    }
}

fn copy_files(from: &Path, to_dir: &Path) -> PathBuf {
    let to = to_dir.join("search.db");
    for suffix in ["", "-wal"] {
        let source = format!("{}{suffix}", from.display());
        if Path::new(&source).exists() {
            std::fs::copy(&source, format!("{}{suffix}", to.display())).unwrap();
        }
    }
    to
}

fn file_size(path: &Path) -> u64 {
    ["", "-wal"]
        .iter()
        .map(|suffix| std::fs::metadata(format!("{}{suffix}", path.display())).map_or(0, |m| m.len()))
        .sum()
}

/// The corpus, the report being written, and the index on disk.
struct Bench {
    corpus: Corpus,
    report: Report,
    dir: tempfile::TempDir,
    index: SearchIndex,
}

impl Bench {
    fn path(&self) -> PathBuf {
        self.dir.path().join("search.db")
    }

    fn describe(&mut self) {
        let words: usize = (self.corpus.docs.iter())
            .flat_map(|doc| doc.blocks.iter())
            .map(|block| block.text.split_whitespace().count())
            .sum();
        let distinct = self.corpus.titles.iter().collect::<BTreeSet<_>>().len();
        self.report.heading("The corpus");
        self.report.fact("Pages", PAGES.to_string());
        self.report.fact("Words in all blocks", words.to_string());
        self.report.fact("Distinct titles", distinct.to_string());
    }

    fn build_and_reopen(&mut self) {
        self.report.heading("File: build, check, reopen, rebuild");
        let started = Instant::now();
        for chunk in self.corpus.docs.chunks(100) {
            self.index.upsert_many(chunk).unwrap();
        }
        self.index.optimize().unwrap();
        let time = started.elapsed();
        self.report
            .once("Build all pages, 100 at a time, then optimize", time, budget(5_000));
        let size = file_size(&self.path()) as f64 / 1_048_576.0;
        self.report.fact("Index file with its log", format!("{size:.1} MB"));
        let started = Instant::now();
        assert!(self.index.check().unwrap().is_ok());
        self.report
            .once("check() of every rule", started.elapsed(), budget(1_000));
        let started = Instant::now();
        assert!(self.index.is_healthy());
        self.report.once("SQLite quick check", started.elapsed(), budget(500));
        self.crash_and_rebuild();
    }

    fn crash_and_rebuild(&mut self) {
        let image_dir = tempfile::tempdir().unwrap();
        let image = copy_files(&self.path(), image_dir.path());
        let started = Instant::now();
        let crashed = SearchIndex::open(&image).unwrap();
        self.report.once(
            "Open after a crash (check and compare tables)",
            started.elapsed(),
            budget(500),
        );
        assert!(crashed.was_unclean());
        drop(crashed);

        let started = Instant::now();
        let docs = &self.corpus.docs;
        self.index
            .rebuild_with(|next| docs.chunks(100).try_for_each(|chunk| next.upsert_many(chunk)))
            .unwrap();
        self.report
            .once("Rebuild into a new file and swap", started.elapsed(), budget(5_000));
        let path = self.path();
        let started = Instant::now();
        let closed = std::mem::replace(&mut self.index, SearchIndex::open_in_memory().unwrap());
        closed.close().unwrap();
        self.report.once("Close", started.elapsed(), budget(500));
        let started = Instant::now();
        self.index = SearchIndex::open(&path).unwrap();
        self.report
            .once("Open after a clean stop", started.elapsed(), budget(200));
        assert_eq!(self.index.page_count().unwrap(), PAGES as usize);
    }

    fn saving(&mut self) {
        self.report.heading("Saving one page");
        let mut docs = self.corpus.docs.clone();
        let mut turn = 0;
        let save = sample(200, || {
            turn += 1;
            let doc = &mut docs[(turn * 7) % PAGES as usize];
            doc.blocks[0].text.push_str(" edited");
            self.index.upsert(doc).unwrap();
        });
        self.report.row("Index one saved page", save, budget(30));
        let rename = sample(100, || {
            turn += 1;
            let doc = &mut docs[(turn * 11) % PAGES as usize];
            doc.title = format!("{} {}", doc.title, turn);
            let written = self.index.write(std::slice::from_ref(doc)).unwrap();
            for rename in &written.renames {
                self.index.rename_edits(rename).unwrap();
            }
        });
        self.report
            .row("Index one renamed page and list its link edits", rename, budget(50));
    }

    fn searching(&mut self) {
        self.report.heading("Searching");
        for (name, query) in self.queries() {
            let found = self.index.search(&query).unwrap().len();
            let time = sample(30, || {
                self.index.search(&query).unwrap();
            });
            self.report.search_row(&format!("{name} ({found} results)"), time);
        }
    }

    fn queries(&self) -> Vec<(&'static str, Query)> {
        let (common_word, mid_word) = (word(0), word(300));
        let scope = SearchScope {
            notebook: Some(notebook_id(2)),
            section: Some(section_id(8)),
        };
        let filtered = Query {
            notebooks: vec![notebook_id(2)],
            tags: vec!["area/3".into()],
            date: Some(DateRange {
                from: Some(Timestamp::from_unix_ms(NOW_MS - 365 * DAY_MS)),
                ..DateRange::default()
            }),
            block_types: vec![BlockKind::Text],
            ..Query::text(&common_word[..2])
        };
        vec![
            ("One common word", Query::text(format!("{common_word} "))),
            ("One mid-frequency word", Query::text(format!("{mid_word} "))),
            ("One rare word", Query::text(word(3_000))),
            ("The first letters of a word", Query::text(&common_word[..2])),
            (
                "Two words and a prefix",
                Query::text(format!("{} {} {}", word(1), word(2), &word(5)[..3])),
            ),
            ("Phrase", Query::text(format!("\"{} {}\"", word(0), word(1)))),
            ("A title", Query::text(self.corpus.titles[400].to_lowercase())),
            (
                "Common word from inside a notebook and section",
                Query {
                    scope: Some(scope),
                    ..Query::text(format!("{common_word} "))
                },
            ),
            ("Filters: notebook, tag, date, block type", filtered),
            (
                "Page 3 of a common word (offset 40)",
                Query {
                    offset: 40,
                    limit: 20,
                    ..Query::text(format!("{common_word} "))
                },
            ),
            ("No words, newest first", Query::default()),
            ("A word nobody wrote", Query::text("qzxvj")),
        ]
    }

    fn switching(&mut self) {
        self.report.heading("Quick switcher");
        let mut switcher = Switcher::new();
        let started = Instant::now();
        switcher.refresh(&self.index).unwrap();
        self.report.once("Load every title", started.elapsed(), budget(30));
        let context = SwitchContext {
            recent: (1..=12).map(page_id).collect(),
            current: Some(page_id(3)),
            scope: Some(SearchScope {
                notebook: Some(notebook_id(2)),
                section: None,
            }),
            limit: 20,
        };
        let title = self.corpus.titles[250].clone();
        let mut swapped: Vec<char> = title.chars().collect();
        swapped.swap(1, 2);
        let queries = [
            ("Empty query (recent pages)", String::new()),
            ("One letter", "b".to_string()),
            ("Four letters of a title", title.chars().take(4).collect()),
            ("A whole title", title.clone()),
            ("A title with two letters swapped", swapped.into_iter().collect()),
            ("Letters from several words", "kbdl".to_string()),
            ("Nothing matches (every stage runs)", "zzzqqqxxx".to_string()),
        ];
        for (name, query) in &queries {
            let found = switcher.find(query, &context).hits.len();
            let time = sample(40, || {
                switcher.find(query, &context);
            });
            self.report.row(&format!("{name} ({found} results)"), time, budget(16));
        }
    }

    fn linking(&mut self) {
        self.report.heading("Links");
        let started = Instant::now();
        let graph = self.index.link_graph(None).unwrap();
        let name = format!(
            "Build the link graph ({} edges, {} broken)",
            graph.edges().len(),
            graph.broken().len()
        );
        self.report.once(&name, started.elapsed(), budget(150));
        let hub = (graph.pages().iter())
            .max_by_key(|page| graph.connections(page.page).incoming.len())
            .unwrap()
            .page;
        let hub_links = graph.connections(hub).incoming.len();
        let backlinks = sample(30, || {
            self.index.backlinks(hub).unwrap();
        });
        let name = format!("Backlinks of the most linked page ({hub_links} pages link to it)");
        self.report.row(&name, backlinks, budget(30));
        let outgoing = sample(30, || {
            self.index.outgoing_links(page_id(42)).unwrap();
        });
        self.report.row("Outgoing links of one page", outgoing, budget(10));
        let title = self.corpus.titles[100].clone();
        let resolve = sample(100, || {
            self.index.resolve_title(&title, None, Some(page_id(1))).unwrap();
        });
        self.report.row("Resolve one title link", resolve, budget(5));
        let started = Instant::now();
        drop(self.index.resolver().unwrap());
        self.report
            .once("Load every title into a Resolver", started.elapsed(), budget(30));
        let hood = sample(30, || {
            graph.neighbors(hub, 3);
        });
        let name = format!("Pages within 3 links of the hub ({})", graph.neighbors(hub, 3).len());
        self.report.row(&name, hood, budget(10));
        self.report
            .fact("Pages with no links", graph.orphans().len().to_string());
        let repair = sample(30, || {
            self.index.repair_edits(hub).unwrap();
        });
        self.report
            .row("Edits that repair stale links of one page", repair, budget(10));
        self.mentions();
    }

    fn mentions(&mut self) {
        let mentioned = self.corpus.mentioned.clone();
        let all = sample(10, || {
            for page in &mentioned {
                self.index.unlinked_mentions(page_id(*page), 50).unwrap();
            }
        });
        let name = format!(
            "Unlinked mentions of {} titles, one list after another",
            mentioned.len()
        );
        self.report.row(&name, all, budget(100 * mentioned.len() as u64));
        let first = page_id(mentioned[3]);
        let one = sample(30, || {
            self.index.unlinked_mentions(first, 50).unwrap();
        });
        let listed = self.index.unlinked_mentions(first, 50).unwrap().len();
        let name = format!("Unlinked mentions of one title ({listed} pages)");
        self.report.row(&name, one, budget(100));
        let block = self.corpus.docs[10].blocks[1].text.repeat(8);
        let title = self.corpus.titles[(mentioned[3] - 1) as usize].clone();
        let exact = sample(50, || {
            find_mentions(&block, &title);
        });
        let name = format!("Exact mentions in a {} byte block", block.len());
        self.report.row(&name, exact, budget(5));
    }

    fn indexing(&mut self) {
        self.report.heading("Indexer");
        let source = MemSource::default();
        for doc in &self.corpus.docs {
            source.world().save(doc.clone());
        }
        let notebooks: Vec<_> = (1..=4).map(notebook_id).collect();
        let shared: SharedIndex = Arc::new(Mutex::new(SearchIndex::open_in_memory().unwrap()));
        let mut indexer = Indexer::new(shared.clone(), source.clone(), IndexerConfig::default(), None);
        let started = Instant::now();
        indexer.enqueue(Job::Start {
            notebooks: notebooks.clone(),
        });
        indexer.run(Instant::now());
        let name = "Start on an empty index: read and index every page";
        self.report.once(name, started.elapsed(), budget(5_000));
        assert_eq!(shared.lock().unwrap().page_count().unwrap(), PAGES as usize);
        let noop = sample(10, || {
            for notebook in &notebooks {
                indexer.enqueue(Job::Reconcile { notebook: *notebook });
            }
            indexer.run(Instant::now());
        });
        let name = "Start again with nothing changed: compare 1,000 pages";
        self.report.row(name, noop, budget(100));
        self.background(&source, notebooks);
    }

    fn background(&mut self, source: &MemSource, notebooks: Vec<opennote_core::NotebookId>) {
        let config = IndexerConfig {
            debounce: Duration::ZERO,
            ..IndexerConfig::default()
        };
        let background = BackgroundIndexer::spawn(SearchIndex::open_in_memory().unwrap(), source.clone(), config, None);
        let handle = background.handle();
        handle.start(notebooks);
        assert!(handle.flush(Duration::from_secs(60)));
        let mut saves = 0;
        let docs = &self.corpus.docs;
        let latency = sample(50, || {
            saves += 1;
            let mut doc = docs[(saves * 13) % PAGES as usize].clone();
            doc.blocks[0].text.push_str(" background");
            source.world().save(doc.clone());
            handle.page_saved(&IndexHint {
                notebook: doc.notebook,
                page: doc.page,
                revision: doc.revision.unwrap(),
                changed_blocks: Vec::new(),
                removed_blocks: Vec::new(),
                title_changed: false,
            });
            assert!(handle.flush(Duration::from_secs(10)));
        });
        self.report
            .row("A save becomes searchable (no debounce)", latency, budget(100));
    }
}

#[test]
#[ignore = "a benchmark: run it with --profile perf and --ignored"]
fn a_thousand_pages_meet_the_phase_8_budgets() {
    let mut bench = Bench {
        corpus: corpus(),
        report: Report::default(),
        dir: tempfile::tempdir().unwrap(),
        index: SearchIndex::open_in_memory().unwrap(),
    };
    bench.index = SearchIndex::open(&bench.path()).unwrap();
    bench.describe();
    bench.build_and_reopen();
    bench.saving();
    bench.searching();
    bench.switching();
    bench.linking();
    bench.indexing();
    println!("{}", bench.report.text);
    assert!(
        bench.report.misses.is_empty(),
        "budgets missed:\n{}",
        bench.report.misses.join("\n")
    );
}
