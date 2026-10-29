//! Boolean search text: `OR`, `AND`, `NOT`, a minus sign, parentheses, quoted phrases, and `title:`.
//!
//! The reader never fails. A typed query is often half written, so a missing right side, an open bracket, or a
//! stray closing bracket is dropped and the rest still searches. Operators count only in capital letters, so the
//! word "or" stays a word. Words next to each other are all required, as in a plain query.
//!
//! The result is an FTS5 expression built from quoted words alone, so no input can break its syntax. Words the
//! text leaves out become an FTS5 `NOT`. A text that only leaves words out has nothing to find, so those words
//! go in [`ParsedText::exclude`] and the search lists every other page.
//!
//! The text is read up to [`MAX_QUERY_CHARS`](crate::query::MAX_QUERY_CHARS) characters and
//! [`MAX_QUERY_TERMS`] words. Brackets nest at most
//! [`MAX_DEPTH`] deep, and a deeper one is dropped like a stray operator, so no text can exhaust the stack.

use crate::query::{clamp_text, in_columns, phrase, ParsedText, Term, MAX_QUERY_TERMS};
use crate::text::words;

/// How deep brackets may nest.
const MAX_DEPTH: usize = 32;

enum Token {
    Open {
        title: bool,
    },
    Close,
    Or,
    And,
    Not,
    Term {
        words: Vec<String>,
        title: bool,
        closed: bool,
    },
}

enum Node {
    Term { term: Term, title: bool },
    And(Vec<Node>),
    Or(Vec<Node>),
    Not(Box<Node>),
}

/// Reads boolean text. Returns `None` when it holds no words at all.
pub(crate) fn parse(text: &str, columns: &[&str]) -> Option<ParsedText> {
    let text = clamp_text(text);
    let tokens = tokenize(text);
    let typing = !text.ends_with(char::is_whitespace);
    let mut parser = Parser {
        last: tokens.len().wrapping_sub(1),
        tokens,
        at: 0,
        typing,
        depth: 0,
    };
    let root = parser.all()?;
    let mut terms = Vec::new();
    collect(&root, &mut terms);
    let expression = positive(&root, columns);
    let exclude = match expression {
        Some(_) => None,
        None => negative(&root, columns),
    };
    if expression.is_none() && exclude.is_none() {
        return None;
    }
    Some(ParsedText {
        expression: expression.unwrap_or_default(),
        exclude,
        terms,
    })
}

fn tokenize(text: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut terms = 0;
    let mut rest = text;
    while let Some(start) = rest.find(|c: char| !c.is_whitespace()) {
        rest = &rest[start..];
        let (token, after) = next(rest);
        terms += token.iter().filter(|t| matches!(t, Token::Term { .. })).count();
        if terms > MAX_QUERY_TERMS {
            break;
        }
        tokens.extend(token);
        rest = after;
    }
    tokens
}

/// The token at the start of `rest`, which begins with a character that is not white space, and what follows it.
fn next(rest: &str) -> (Vec<Token>, &str) {
    let first = rest.chars().next().unwrap_or(' ');
    match first {
        '(' => (vec![Token::Open { title: false }], &rest[1..]),
        ')' => (vec![Token::Close], &rest[1..]),
        '-' if rest[1..].starts_with(|c: char| !c.is_whitespace() && c != '-') => (vec![Token::Not], &rest[1..]),
        '-' => (Vec::new(), &rest[1..]),
        '"' => phrase_at(rest, false),
        _ => chunk_at(rest),
    }
}

fn phrase_at(rest: &str, title: bool) -> (Vec<Token>, &str) {
    let inner = &rest[1..];
    let (body, closed, after) = match inner.find('"') {
        Some(end) => (&inner[..end], true, &inner[end + 1..]),
        None => (inner, false, ""),
    };
    (term_token(body, title, closed), after)
}

fn chunk_at(rest: &str) -> (Vec<Token>, &str) {
    let mut end = rest
        .find(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .unwrap_or(rest.len());
    // A quote right after `title:` starts a phrase.
    if title_value(rest).is_some_and(|value| value.starts_with('"')) {
        end = 6;
    }
    let chunk = &rest[..end];
    let after = &rest[end..];
    match chunk {
        "OR" => return (vec![Token::Or], after),
        "AND" => return (vec![Token::And], after),
        "NOT" => return (vec![Token::Not], after),
        _ => {}
    }
    let Some(value) = title_value(chunk) else {
        return (term_token(chunk, false, false), after);
    };
    if value.is_empty() {
        if let Some(inside) = after.strip_prefix('(') {
            return (vec![Token::Open { title: true }], inside);
        }
        if after.starts_with('"') {
            return phrase_at(after, true);
        }
    }
    (term_token(value, true, false), after)
}

/// The text after `title:`, if the chunk starts with it in any case.
fn title_value(chunk: &str) -> Option<&str> {
    let head = chunk.get(..6)?;
    head.eq_ignore_ascii_case("title:").then(|| &chunk[6..])
}

fn term_token(text: &str, title: bool, closed: bool) -> Vec<Token> {
    let found: Vec<String> = words(text).into_iter().map(|w| w.folded).collect();
    if found.is_empty() {
        return Vec::new();
    }
    vec![Token::Term {
        words: found,
        title,
        closed,
    }]
}

struct Parser {
    tokens: Vec<Token>,
    at: usize,
    last: usize,
    typing: bool,
    /// How many brackets the reader is inside.
    depth: usize,
}

impl Parser {
    /// Everything, stray closing brackets included: what follows one is read as more required words.
    fn all(&mut self) -> Option<Node> {
        let mut parts = Vec::new();
        while self.at < self.tokens.len() {
            parts.extend(self.or(false, false));
            self.at += 1;
        }
        join(parts, Node::And)
    }

    fn or(&mut self, title: bool, negated: bool) -> Option<Node> {
        let mut parts = Vec::new();
        parts.extend(self.and(title, negated));
        while matches!(self.tokens.get(self.at), Some(Token::Or)) {
            self.at += 1;
            parts.extend(self.and(title, negated));
        }
        join(parts, Node::Or)
    }

    fn and(&mut self, title: bool, negated: bool) -> Option<Node> {
        let mut parts = Vec::new();
        while let Some(token) = self.tokens.get(self.at) {
            match token {
                Token::Close | Token::Or => break,
                Token::And => self.at += 1,
                _ => parts.extend(self.unary(title, negated)),
            }
        }
        join(parts, Node::And)
    }

    /// A part with any number of `NOT`s before it. Two of them cancel out.
    fn unary(&mut self, title: bool, negated: bool) -> Option<Node> {
        let mut nots = 0;
        while matches!(self.tokens.get(self.at), Some(Token::Not)) {
            self.at += 1;
            nots += 1;
        }
        let mut node = self.primary(title, negated || nots > 0)?;
        for _ in 0..nots {
            node = match node {
                Node::Not(twice) => *twice,
                other => Node::Not(Box::new(other)),
            };
        }
        Some(node)
    }

    fn primary(&mut self, title: bool, negated: bool) -> Option<Node> {
        let at = self.at;
        self.at += 1;
        match self.tokens.get(at)? {
            Token::Open { .. } if self.depth >= MAX_DEPTH => None,
            Token::Open { title: inner } => {
                let inner = *inner;
                self.depth += 1;
                let node = self.or(title || inner, negated);
                self.depth -= 1;
                if matches!(self.tokens.get(self.at), Some(Token::Close)) {
                    self.at += 1;
                }
                node
            }
            Token::Term {
                words,
                title: own,
                closed,
            } => Some(Node::Term {
                term: Term {
                    words: words.clone(),
                    prefix: self.typing && at == self.last && !closed && !negated,
                },
                title: title || *own,
            }),
            // An operator with nothing to work on, or a closing bracket with no opening one.
            _ => None,
        }
    }
}

fn join(mut parts: Vec<Node>, make: fn(Vec<Node>) -> Node) -> Option<Node> {
    match parts.len() {
        0 => None,
        1 => parts.pop(),
        _ => Some(make(parts)),
    }
}

/// The words to find, in the order typed, for snippets and highlights.
fn collect(node: &Node, terms: &mut Vec<Term>) {
    match node {
        Node::Term { term, .. } => terms.push(term.clone()),
        Node::And(parts) | Node::Or(parts) => parts.iter().for_each(|part| collect(part, terms)),
        Node::Not(_) => {}
    }
}

/// The expression for the pages that match, or `None` if the node only leaves words out. A word marked
/// `title:` matches in the title. Any other word matches in `columns`, or in every column if there are none.
fn positive(node: &Node, columns: &[&str]) -> Option<String> {
    match node {
        Node::Term { term, title } => Some(if *title {
            format!("title : ({})", phrase(term))
        } else {
            in_columns(phrase(term), columns)
        }),
        Node::Or(parts) => {
            let found: Vec<String> = parts.iter().filter_map(|part| positive(part, columns)).collect();
            group(found, " OR ")
        }
        Node::And(parts) => {
            let found: Vec<String> = parts.iter().filter_map(|part| positive(part, columns)).collect();
            let wanted = group(found, " AND ")?;
            match left_out(parts, columns) {
                Some(left) => Some(format!("({wanted} NOT {left})")),
                None => Some(wanted),
            }
        }
        Node::Not(_) => None,
    }
}

/// The words that a group of required parts leaves out, as one expression.
fn left_out(parts: &[Node], columns: &[&str]) -> Option<String> {
    let found: Vec<String> = parts
        .iter()
        .filter_map(|part| match part {
            Node::Not(inner) => positive(inner, columns),
            _ => None,
        })
        .collect();
    group(found, " OR ")
}

/// The expression for the pages that a text leaves out, when it finds nothing.
fn negative(node: &Node, columns: &[&str]) -> Option<String> {
    match node {
        Node::Not(inner) => positive(inner, columns),
        Node::And(parts) => left_out(parts, columns),
        _ => None,
    }
}

fn group(mut found: Vec<String>, joint: &str) -> Option<String> {
    match found.len() {
        0 => None,
        1 => found.pop(),
        _ => Some(format!("({})", found.join(joint))),
    }
}

#[cfg(test)]
mod tests;
