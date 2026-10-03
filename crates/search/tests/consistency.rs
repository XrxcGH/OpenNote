//! Index consistency after random edits: the index must always agree with a plain in-memory model.

mod common;

use std::collections::{BTreeMap, BTreeSet};

use common::{doc, notebook_id, page_id, DocExt};
use opennote_search::{PageDoc, Query, SearchIndex};

const WORDS: [&str; 8] = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
const TAGS: [&str; 4] = ["t1", "t1/sub", "t2", "t2/deep/er"];

/// A small deterministic generator, so a failure repeats.
struct Rng(u64);

impl Rng {
    fn below(&mut self, below: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % below as u64) as usize
    }

    fn words(&mut self, count: usize) -> Vec<&'static str> {
        (0..count).map(|_| WORDS[self.below(WORDS.len())]).collect()
    }
}

#[derive(Clone)]
struct Model {
    words: BTreeSet<&'static str>,
    tags: BTreeSet<&'static str>,
    notebook: u64,
}

fn random_doc(rng: &mut Rng, n: u64) -> (PageDoc, Model) {
    let count = 1 + rng.below(2);
    let title = rng.words(count);
    let mut words: BTreeSet<&'static str> = title.iter().copied().collect();
    let mut page = doc(n, &title.join(" ")).notebook(1 + rng.below(2) as u64);
    for _ in 0..rng.below(4) {
        let count = 1 + rng.below(6);
        let text = rng.words(count);
        words.extend(text.iter().copied());
        page = page.text(&text.join(" "));
    }
    let tags: Vec<&'static str> = (0..rng.below(3)).map(|_| TAGS[rng.below(TAGS.len())]).collect();
    let notebook = page.notebook;
    let model = Model {
        words,
        tags: tags.iter().copied().collect(),
        notebook: notebook_number(notebook),
    };
    (page.tags(&tags), model)
}

fn notebook_number(id: opennote_core::NotebookId) -> u64 {
    (1..=2).find(|n| notebook_id(*n) == id).unwrap()
}

fn found(index: &SearchIndex, query: Query) -> BTreeSet<u64> {
    let query = Query { limit: 500, ..query };
    index
        .search(&query)
        .unwrap()
        .iter()
        .map(|hit| hit.page.id().time_ms() - 1_000)
        .collect()
}

fn check(index: &SearchIndex, model: &BTreeMap<u64, Model>) {
    assert_eq!(index.page_count().unwrap(), model.len());
    let held: BTreeSet<u64> = index
        .indexed_pages()
        .unwrap()
        .iter()
        .map(|p| p.page.id().time_ms() - 1_000)
        .collect();
    assert_eq!(held, model.keys().copied().collect::<BTreeSet<_>>());
    for word in WORDS {
        let want: BTreeSet<u64> = model
            .iter()
            .filter(|(_, m)| m.words.contains(word))
            .map(|(n, _)| *n)
            .collect();
        assert_eq!(found(index, Query::text(format!("{word} "))), want, "word {word}");
    }
    let both: BTreeSet<u64> = model
        .iter()
        .filter(|(_, m)| m.words.contains("alpha") && m.words.contains("echo"))
        .map(|(n, _)| *n)
        .collect();
    assert_eq!(found(index, Query::text("echo alpha ")), both, "two words");
    check_filters(index, model);
}

fn check_filters(index: &SearchIndex, model: &BTreeMap<u64, Model>) {
    for tag in ["t1", "t1/sub", "t2", "t2/deep"] {
        let inside = |t: &&str| *t == tag || t.starts_with(&format!("{tag}/"));
        let want: BTreeSet<u64> = model
            .iter()
            .filter(|(_, m)| m.tags.iter().any(inside))
            .map(|(n, _)| *n)
            .collect();
        assert_eq!(
            found(
                index,
                Query {
                    tags: vec![tag.into()],
                    ..Query::default()
                }
            ),
            want,
            "tag {tag}"
        );
    }
    let in_two: BTreeSet<u64> = model.iter().filter(|(_, m)| m.notebook == 2).map(|(n, _)| *n).collect();
    assert_eq!(
        found(
            index,
            Query {
                notebooks: vec![notebook_id(2)],
                ..Query::default()
            }
        ),
        in_two
    );
}

#[test]
fn the_index_agrees_with_a_model_after_random_edits() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let mut index = SearchIndex::open_in_memory().unwrap();
    let mut model: BTreeMap<u64, Model> = BTreeMap::new();
    for step in 1..=400 {
        let n = 1 + rng.below(25) as u64;
        match rng.below(10) {
            0..=5 => {
                let (page, entry) = random_doc(&mut rng, n);
                index.upsert(&page).unwrap();
                model.insert(n, entry);
            }
            6 | 7 => {
                assert_eq!(index.delete_page(page_id(n)).unwrap(), model.remove(&n).is_some());
            }
            8 => {
                index
                    .upsert(&doc(n, "secret").text("alpha bravo").tags(&["t1"]).locked())
                    .unwrap();
                model.remove(&n);
            }
            _ => {
                let batch: Vec<(PageDoc, Model)> = (0..3).map(|k| random_doc(&mut rng, 1 + (n + k) % 25)).collect();
                let docs: Vec<PageDoc> = batch.iter().map(|(page, _)| page.clone()).collect();
                index.upsert_many(&docs).unwrap();
                for (page, entry) in batch {
                    model.insert(page.page.id().time_ms() - 1_000, entry);
                }
            }
        }
        if step % 10 == 0 {
            check(&index, &model);
        }
    }
    check(&index, &model);
    index.clear().unwrap();
    check(&index, &BTreeMap::new());
}
