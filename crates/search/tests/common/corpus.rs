//! A made-up notebook of a thousand pages, for the benchmark. The same seed always gives the same pages.
#![allow(dead_code)]

use opennote_core::{Id, RevisionId, Timestamp};
use opennote_search::{BlockKind, BlockText, PageDoc};

use super::{block_id, notebook_id, page_id, section_id};

pub const PAGES: u64 = 1_000;
pub const DAY_MS: i64 = 86_400_000;
/// The day of this round, 2026-10-02, as Unix milliseconds.
pub const NOW_MS: i64 = 1_790_900_000_000;

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    pub fn below(&mut self, below: usize) -> usize {
        (self.next() % below as u64) as usize
    }

    pub fn chance(&mut self, percent: usize) -> bool {
        self.below(100) < percent
    }
}

/// One of 3,600 pronounceable words. Low numbers are drawn far more often, as in real text.
pub fn word(index: usize) -> String {
    let syllable = |n: usize| format!("{}{}", b"bdfgklmnprst"[n % 12] as char, b"aeiou"[n / 12 % 5] as char);
    format!("{}{}", syllable(index % 60), syllable(index / 60 % 60))
}

pub fn draw(rng: &mut Rng) -> String {
    word(rng.below(3_600) * rng.below(3_600) / 3_600)
}

pub fn sentence(rng: &mut Rng, words: usize) -> String {
    (0..words).map(|_| draw(rng)).collect::<Vec<_>>().join(" ")
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    chars
        .next()
        .map_or_else(String::new, |first| first.to_uppercase().chain(chars).collect())
}

pub struct Corpus {
    pub docs: Vec<PageDoc>,
    pub titles: Vec<String>,
    /// Pages whose titles other pages say in plain text.
    pub mentioned: Vec<u64>,
}

/// Titles of two to four words. About one in twelve repeats an earlier title, so some links are ambiguous.
fn make_titles(rng: &mut Rng) -> Vec<String> {
    let mut titles: Vec<String> = Vec::new();
    for _ in 0..PAGES {
        let title = if !titles.is_empty() && rng.chance(8) {
            titles[rng.below(titles.len())].clone()
        } else {
            let words = 2 + rng.below(3);
            capitalized(&sentence(rng, words))
        };
        titles.push(title);
    }
    titles
}

/// One paragraph: plain words, now and then a heading, emphasis, links, and the title of a page others mention.
fn paragraph(rng: &mut Rng, n: u64, titles: &[String], mentioned: &[u64]) -> String {
    let length = 25 + rng.below(45);
    let mut text = sentence(rng, length);
    if rng.chance(25) {
        text = format!("## {}\n\n{text}", sentence(rng, 3));
    }
    if rng.chance(15) {
        text.push_str(&format!(" **{}** and _{}_", draw(rng), draw(rng)));
    }
    if rng.chance(30) {
        let target = if rng.chance(90) {
            titles[rng.below(titles.len())].clone()
        } else {
            capitalized(&sentence(rng, 3))
        };
        text.push_str(&format!(" see [[{target}]]"));
    }
    if rng.chance(5) {
        let page = page_id(1 + rng.below(titles.len()) as u64);
        text.push_str(&format!(" [more](opennote:page/{page})"));
    }
    if rng.chance(6) {
        let target = mentioned[rng.below(mentioned.len())];
        if target != n {
            text.push_str(&format!(" about {}", titles[(target - 1) as usize]));
        }
    }
    text
}

fn make_blocks(rng: &mut Rng, n: u64, titles: &[String], mentioned: &[u64]) -> Vec<BlockText> {
    let mut blocks: Vec<BlockText> = Vec::new();
    let mut push = |kind: BlockKind, text: String| {
        let id = block_id(n, blocks.len() as u64);
        blocks.push(BlockText { id, kind, text });
    };
    push(
        BlockKind::Text,
        format!("# {}\n\n{}", titles[(n - 1) as usize], sentence(rng, 30)),
    );
    for _ in 0..3 + rng.below(6) {
        push(BlockKind::Text, paragraph(rng, n, titles, mentioned));
    }
    if rng.chance(20) {
        let cells = format!(
            "| {} | {} |\n| --- | --- |\n| {} | {} |",
            draw(rng),
            draw(rng),
            draw(rng),
            draw(rng)
        );
        push(BlockKind::Table, cells);
    }
    if rng.chance(10) {
        push(BlockKind::Image, sentence(rng, 8));
    }
    blocks
}

fn make_doc(rng: &mut Rng, n: u64, titles: &[String], mentioned: &[u64]) -> PageDoc {
    let notebook = 1 + n % 4;
    let section = (notebook - 1) * 6 + 1 + (n / 4) % 6;
    let age = rng.below(730) as i64;
    let modified = NOW_MS - age * DAY_MS - rng.below(DAY_MS as usize) as i64;
    PageDoc {
        page: page_id(n),
        notebook: notebook_id(notebook),
        section: section_id(section),
        revision: Some(RevisionId::from(Id::from_parts(10_000 + n, 1))),
        title: titles[(n - 1) as usize].clone(),
        tags: vec![format!("topic{}", n % 40), format!("area/{}/{}", n % 7, n % 13)],
        created: Timestamp::from_unix_ms(modified - 30 * DAY_MS),
        modified: Timestamp::from_unix_ms(modified),
        blocks: make_blocks(rng, n, titles, mentioned),
        locked: false,
        fingerprint: None,
    }
}

pub fn corpus() -> Corpus {
    let mut rng = Rng::new(0x2545_F491_4F6C_DD1D);
    let titles = make_titles(&mut rng);
    let mentioned: Vec<u64> = (0..30).map(|k| 1 + k * 31).collect();
    let docs = (1..=PAGES)
        .map(|n| make_doc(&mut rng, n, &titles, &mentioned))
        .collect();
    Corpus {
        docs,
        titles,
        mentioned,
    }
}
