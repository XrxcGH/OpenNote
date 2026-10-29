//! The list of operators, for the help line below the search box.

use serde::Serialize;

/// One operator, for the help line below the search box.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Operator {
    /// What to type.
    pub syntax: &'static str,
    /// An example.
    pub example: &'static str,
    /// What it does.
    pub meaning: &'static str,
}

const fn op(syntax: &'static str, example: &'static str, meaning: &'static str) -> Operator {
    Operator {
        syntax,
        example,
        meaning,
    }
}

/// Every operator and word of syntax, in the order the help line lists them.
pub const OPERATORS: [Operator; 12] = [
    op("\"words\"", "\"light reactions\"", "Words together, in this order"),
    op("OR", "mitosis OR meiosis", "Either word"),
    op("NOT or -", "cell -wall", "Leave out a word"),
    op("( )", "(cell OR tissue) -wall", "Group words"),
    op("title:", "title:review", "The word is in the title"),
    op("tag:", "tag:school/biology", "Pages with the tag"),
    op("in:", "in:\"Bio 201\"", "Pages of a notebook or section"),
    op("type:", "type:table", "Text, table, image, file, ink, or alt"),
    op("before:", "before:2026-03-01", "Changed before a day"),
    op("after:", "after:7d", "Changed on or after a day"),
    op("on:", "on:2026-03", "Changed in a day, month, or year"),
    op(
        "created-before:",
        "created-before:2026-03-01",
        "The same for the day a page was made",
    ),
];
