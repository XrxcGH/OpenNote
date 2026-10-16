//! Random text through the Markdown writer and parser: what the writer escapes, the parser must read back.

use opennote_interop::doc::parse::{parse, SoftBreaks};
use opennote_interop::doc::write::to_markdown;
use opennote_interop::doc::{push_text, Block, Inline, Marks};

/// A small deterministic generator, so a failure repeats.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// The characters that Markdown treats specially, with letters, digits, and spaces to put them among.
const ALPHABET: &[char] = &[
    '*', '_', '~', '=', '$', '#', '[', ']', '<', '>', '&', '|', '\\', '`', '-', '+', '.', ')', '(', '!', '{', ' ', ' ',
    'a', 'b', 'Z', '1', '2', ';', '"', '\'', '\u{e9}',
];

fn random_text(rng: &mut Rng, max: usize) -> String {
    (0..1 + rng.below(max))
        .map(|_| ALPHABET[rng.below(ALPHABET.len())])
        .collect()
}

fn reads_back(inlines: Vec<Inline>) -> Vec<Inline> {
    let markdown = to_markdown(&[Block::Paragraph(inlines.clone())]);
    let parsed = parse(&markdown, SoftBreaks::Space).blocks;
    match parsed.as_slice() {
        [Block::Paragraph(back)] => back.clone(),
        other => panic!("{inlines:?} was written as {markdown:?} and read as {other:?}"),
    }
}

#[test]
fn plain_text_survives_the_writer_and_the_parser() {
    let mut rng = Rng(0x2545_f491_4f6c_dd1d);
    for _ in 0..3_000 {
        let text = random_text(&mut rng, 14);
        if text.trim().is_empty() {
            continue;
        }
        let mut expected = Vec::new();
        push_text(&mut expected, &text, &Marks::none());
        let markdown = to_markdown(&[Block::Paragraph(expected.clone())]);
        assert_eq!(
            reads_back(expected.clone()),
            expected,
            "text {text:?} was written as {markdown:?}"
        );
    }
}

/// The marks that runs get: none, or one or two of the marks that use delimiters.
fn mark_choices() -> Vec<Marks> {
    let marks = |change: fn(&mut Marks)| {
        let mut marks = Marks::none();
        change(&mut marks);
        marks
    };
    vec![
        marks(|m| m.strong = true),
        marks(|m| m.emphasis = true),
        marks(|m| m.strike = true),
        marks(|m| m.underline = true),
        marks(|m| m.highlight = Some("honey".to_owned())),
        marks(|m| (m.strong, m.emphasis) = (true, true)),
        marks(|m| m.code = true),
    ]
}

/// Runs with random text and marks, whose edges are plain text, so the writer has nothing to move.
fn random_runs(rng: &mut Rng, choices: &[Marks]) -> Option<Vec<Inline>> {
    let mut inlines: Vec<Inline> = Vec::new();
    for _ in 0..1 + rng.below(4) {
        let marks = if rng.below(2) == 0 {
            Marks::none()
        } else {
            choices[rng.below(choices.len())].clone()
        };
        let text = random_text(rng, 6);
        let text = if marks == Marks::none() {
            text
        } else {
            text.trim().to_owned()
        };
        push_text(&mut inlines, &text, &marks);
    }
    let has_text = |i: &Inline| matches!(i, Inline::Text { text, .. } if !text.trim().is_empty());
    let empty_run = inlines
        .iter()
        .any(|i| matches!(i, Inline::Text { text, .. } if text.is_empty()));
    let edges_ok = inlines.first().is_some_and(has_text) && inlines.last().is_some_and(has_text);
    (edges_ok && !empty_run).then_some(inlines)
}

#[test]
fn marked_runs_survive_the_writer_and_the_parser() {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let choices = mark_choices();
    for _ in 0..3_000 {
        let Some(inlines) = random_runs(&mut rng, &choices) else {
            continue;
        };
        let markdown = to_markdown(&[Block::Paragraph(inlines.clone())]);
        assert_eq!(reads_back(inlines.clone()), inlines, "written as {markdown:?}");
    }
}
