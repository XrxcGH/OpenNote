//! The pages, operations, and model that the property tests share.
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;

use super::{block_id, notebook_id, page_id, section_id};
use opennote_core::{Id, RevisionId, Timestamp};
use opennote_search::{BlockKind, BlockText, PageDoc, Query, SearchIndex};

pub const VOCAB: [&str; 10] = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet",
];
pub const TAGS: [&str; 4] = ["zt1", "zt1/zsub", "zt1/zsub/zdeep", "zt2"];
pub const PAGES: u64 = 10;

pub fn config() -> ProptestConfig {
    ProptestConfig {
        cases: std::env::var("PROPTEST_CASES")
            .ok()
            .and_then(|cases| cases.parse().ok())
            .unwrap_or(40),
        failure_persistence: None,
        ..ProptestConfig::default()
    }
}

/// A page as the properties build it.
#[derive(Clone, Debug)]
pub struct Spec {
    pub page: u64,
    pub notebook: u64,
    pub section: u64,
    pub title: Vec<usize>,
    pub blocks: Vec<Vec<Piece>>,
    pub tags: Vec<usize>,
    pub locked: bool,
    pub modified: i64,
}

/// A piece of a block: a word, a title link, an ID link, or a heading mark.
#[derive(Clone, Debug)]
pub enum Piece {
    Word(usize),
    Link(Vec<usize>),
    IdLink(u64),
    Heading,
}

pub fn words_of(indices: &[usize]) -> String {
    indices.iter().map(|i| VOCAB[*i]).collect::<Vec<_>>().join(" ")
}

impl Spec {
    pub fn title(&self) -> String {
        words_of(&self.title)
    }

    pub fn markdown(&self, block: usize) -> String {
        let mut out = String::new();
        for piece in &self.blocks[block] {
            match piece {
                Piece::Word(i) => out.push_str(VOCAB[*i]),
                Piece::Link(title) => out.push_str(&format!("[[{}]]", words_of(title))),
                Piece::IdLink(page) => out.push_str(&format!("[x](opennote:page/{})", page_id(*page))),
                Piece::Heading => {
                    out.push_str("\n\n# ");
                    continue;
                }
            }
            out.push(' ');
        }
        out
    }

    pub fn doc(&self) -> PageDoc {
        let blocks = (0..self.blocks.len())
            .map(|k| BlockText {
                id: block_id(self.page, k as u64),
                kind: BlockKind::Text,
                text: self.markdown(k),
            })
            .filter(|block| !block.text.trim().is_empty())
            .collect();
        PageDoc {
            page: page_id(self.page),
            notebook: notebook_id(self.notebook),
            section: section_id(self.section),
            revision: Some(RevisionId::from(Id::from_parts(5_000 + self.page, 1))),
            title: self.title(),
            tags: self.tags.iter().map(|t| TAGS[*t].to_string()).collect(),
            created: Timestamp::from_unix_ms(self.modified),
            modified: Timestamp::from_unix_ms(self.modified),
            blocks,
            locked: self.locked,
            fingerprint: None,
        }
    }

    /// The words a search for one word should find this page by: its title and its text.
    pub fn words(&self) -> BTreeSet<&'static str> {
        let mut found: BTreeSet<&'static str> = self.title.iter().map(|i| VOCAB[*i]).collect();
        for block in &self.blocks {
            for piece in block {
                match piece {
                    Piece::Word(i) => {
                        found.insert(VOCAB[*i]);
                    }
                    Piece::Link(title) => found.extend(title.iter().map(|i| VOCAB[*i])),
                    _ => {}
                }
            }
        }
        found
    }

    pub fn has_tag(&self, tag: &str) -> bool {
        self.tags
            .iter()
            .any(|t| TAGS[*t] == tag || TAGS[*t].starts_with(&format!("{tag}/")))
    }
}

pub fn spec() -> impl Strategy<Value = Spec> {
    let piece = prop_oneof![
        6 => (0..VOCAB.len()).prop_map(Piece::Word),
        2 => prop::collection::vec(0..VOCAB.len(), 1..3).prop_map(Piece::Link),
        1 => (1..=PAGES).prop_map(Piece::IdLink),
        1 => Just(Piece::Heading),
    ];
    (
        1..=PAGES,
        1..=2u64,
        1..=3u64,
        prop::collection::vec(0..VOCAB.len(), 1..3),
        prop::collection::vec(prop::collection::vec(piece, 0..6), 0..4),
        prop::collection::vec(0..TAGS.len(), 0..3),
        prop::bool::weighted(0.1),
        0..1_000i64,
    )
        .prop_map(
            |(page, notebook, section, title, blocks, tags, locked, modified)| Spec {
                page,
                notebook,
                section,
                title,
                blocks,
                tags,
                locked,
                modified,
            },
        )
}

#[derive(Clone, Debug)]
pub enum Op {
    Upsert(Spec),
    Delete(u64),
    Relocate(u64, u64, u64),
    DeleteSection(u64),
    DeleteNotebook(u64),
    PurgeSection(u64),
    Clear,
    Rebuild(Vec<Spec>),
}

pub fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        10 => spec().prop_map(Op::Upsert),
        2 => (1..=PAGES).prop_map(Op::Delete),
        2 => (1..=PAGES, 1..=2u64, 1..=3u64).prop_map(|(p, n, s)| Op::Relocate(p, n, s)),
        1 => (1..=3u64).prop_map(Op::DeleteSection),
        1 => (1..=2u64).prop_map(Op::DeleteNotebook),
        1 => (1..=3u64).prop_map(Op::PurgeSection),
        1 => Just(Op::Clear),
        1 => prop::collection::vec(spec(), 0..6).prop_map(Op::Rebuild),
    ]
}

pub type Model = BTreeMap<u64, Spec>;

pub fn apply_model(model: &mut Model, op: &Op) {
    match op {
        Op::Upsert(spec) => {
            if spec.locked {
                model.remove(&spec.page);
            } else {
                model.insert(spec.page, spec.clone());
            }
        }
        Op::Delete(page) => {
            model.remove(page);
        }
        Op::Relocate(page, notebook, section) => {
            if let Some(spec) = model.get_mut(page) {
                spec.notebook = *notebook;
                spec.section = *section;
            }
        }
        Op::DeleteSection(section) | Op::PurgeSection(section) => model.retain(|_, spec| spec.section != *section),
        Op::DeleteNotebook(notebook) => model.retain(|_, spec| spec.notebook != *notebook),
        Op::Clear => model.clear(),
        Op::Rebuild(specs) => {
            model.clear();
            // Later documents win, and a locked one removes the page, as with any other write.
            for spec in specs {
                if spec.locked {
                    model.remove(&spec.page);
                } else {
                    model.insert(spec.page, spec.clone());
                }
            }
        }
    }
}

pub fn apply_index(index: &mut SearchIndex, op: &Op) {
    match op {
        Op::Upsert(spec) => index.upsert(&spec.doc()).unwrap(),
        Op::Delete(page) => {
            index.delete_page(page_id(*page)).unwrap();
        }
        Op::Relocate(page, notebook, section) => {
            index
                .relocate(page_id(*page), notebook_id(*notebook), section_id(*section))
                .unwrap();
        }
        Op::DeleteSection(section) => {
            index.delete_section(section_id(*section)).unwrap();
        }
        Op::DeleteNotebook(notebook) => {
            index.delete_notebook(notebook_id(*notebook)).unwrap();
        }
        Op::PurgeSection(section) => {
            index.purge_section(section_id(*section)).unwrap();
        }
        Op::Clear => index.clear().unwrap(),
        Op::Rebuild(specs) => {
            let docs: Vec<PageDoc> = specs.iter().map(Spec::doc).collect();
            index.rebuild_with(|next| next.upsert_many(&docs)).unwrap();
        }
    }
}

pub fn pages_of(hits: &[opennote_search::SearchHit]) -> BTreeSet<u64> {
    hits.iter().map(|hit| hit.page.id().time_ms() - 1_000).collect()
}

/// The index and the model agree on everything the model knows.
pub fn agree(index: &SearchIndex, model: &Model) -> Result<(), TestCaseError> {
    let report = index.check().unwrap();
    prop_assert!(report.is_ok(), "{:?}", report.problems);
    prop_assert_eq!(index.page_count().unwrap(), model.len());
    let held: BTreeMap<u64, (u64, u64, String)> = index
        .indexed_pages()
        .unwrap()
        .into_iter()
        .map(|page| {
            let n = page.page.id().time_ms() - 1_000;
            let nb = (1..=2).find(|k| notebook_id(*k) == page.notebook).unwrap();
            let sec = (1..=3).find(|k| section_id(*k) == page.section).unwrap();
            (n, (nb, sec, page.title))
        })
        .collect();
    let expected: BTreeMap<u64, (u64, u64, String)> = model
        .iter()
        .map(|(n, spec)| (*n, (spec.notebook, spec.section, spec.title())))
        .collect();
    prop_assert_eq!(held, expected);
    for word in VOCAB {
        let query = Query {
            limit: 500,
            ..Query::text(format!("{word} "))
        };
        let found = pages_of(&index.search(&query).unwrap());
        let wanted: BTreeSet<u64> = model
            .iter()
            .filter(|(_, spec)| spec.words().contains(word))
            .map(|(n, _)| *n)
            .collect();
        prop_assert_eq!(found, wanted, "word {}", word);
    }
    for tag in ["zt1", "zt1/zsub", "zt2"] {
        let query = Query {
            tags: vec![tag.to_string()],
            limit: 500,
            ..Query::default()
        };
        let found = pages_of(&index.search(&query).unwrap());
        let wanted: BTreeSet<u64> = model
            .iter()
            .filter(|(_, spec)| spec.has_tag(tag))
            .map(|(n, _)| *n)
            .collect();
        prop_assert_eq!(found, wanted, "tag {}", tag);
    }
    Ok(())
}

/// The link graph, built from one pass over all links, agrees with resolving each page's links on its own.
pub fn graph_agrees(index: &SearchIndex) -> Result<(), TestCaseError> {
    let graph = index.link_graph(None).unwrap();
    let mut expected: BTreeMap<(u64, u64), u32> = BTreeMap::new();
    let mut broken = 0;
    for page in graph.pages() {
        for link in index.outgoing_links(page.page).unwrap() {
            match link.targets.first() {
                Some(target) if target.page != page.page => {
                    let key = (page.page.id().time_ms() - 1_000, target.page.id().time_ms() - 1_000);
                    *expected.entry(key).or_default() += 1;
                }
                Some(_) => {}
                None => broken += 1,
            }
        }
    }
    let got: BTreeMap<(u64, u64), u32> = graph
        .edges()
        .iter()
        .map(|edge| {
            (
                (edge.from.id().time_ms() - 1_000, edge.to.id().time_ms() - 1_000),
                edge.count,
            )
        })
        .collect();
    prop_assert_eq!(got, expected);
    prop_assert_eq!(graph.broken().len(), broken);
    Ok(())
}
