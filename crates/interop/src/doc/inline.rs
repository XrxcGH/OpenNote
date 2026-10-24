//! Writing runs of text as Markdown: marks nest in the order of spec 7.7, and text is escaped as spec 7.6 says.

use super::escape::escape_around;
use super::parse::{parse, SoftBreaks};
use super::{push_text, Block, Inline, Marks, Script};

/// How a hard break is written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Breaks {
    /// A backslash and a line break, for paragraphs.
    Backslash,
    /// `<br>`, for table cells.
    Html,
    /// A space, for headings and titles.
    Space,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Mark {
    Link(String),
    Strong,
    Emphasis,
    Strike,
    Underline,
    Highlight(String),
    Color(String),
    Size(String),
    Script(Script),
}

/// The marks that a delimiter writes, so whitespace at their edges moves outside.
fn has_delimiters(marks: &Marks) -> bool {
    marks.strong || marks.emphasis || marks.strike || marks.highlight.is_some()
}

/// The marks of a run in nesting order. Code is not a nesting mark: it is written as a code span.
fn mark_list(marks: &Marks) -> Vec<Mark> {
    let mut list = Vec::new();
    if let Some(dest) = &marks.link {
        list.push(Mark::Link(dest.clone()));
    }
    let flags = [
        (marks.strong, Mark::Strong),
        (marks.emphasis, Mark::Emphasis),
        (marks.strike, Mark::Strike),
        (marks.underline, Mark::Underline),
    ];
    list.extend(flags.into_iter().filter(|(on, _)| *on).map(|(_, mark)| mark));
    if let Some(name) = &marks.highlight {
        list.push(Mark::Highlight(name.clone()));
    }
    if let Some(color) = &marks.color {
        list.push(Mark::Color(color.clone()));
    }
    if let Some(size) = &marks.size {
        list.push(Mark::Size(size.clone()));
    }
    list.extend(marks.script.map(Mark::Script));
    list
}

/// Writes inlines as one paragraph of Markdown.
///
/// Marks use delimiters where CommonMark's rules let them work. Some overlapping delimiters next to punctuation
/// read differently in different parsers. So the writer checks its own work: if the text does not read back as
/// the same runs, every mark is written with its HTML tags instead.
pub fn write_inlines(inlines: &[Inline], breaks: Breaks) -> String {
    let pieces = prepare(inlines, breaks);
    let outs = render_pieces(&pieces, breaks);
    let (toks, mut insts) = plan(&pieces);
    choose_forms(&toks, &mut insts, &pieces, &outs);
    let text = emit(&toks, &insts, &outs);
    let uses_delimiters = insts.iter().any(|inst| !inst.html && is_delimiter(&inst.mark));
    if uses_delimiters && !reads_back(&text, &pieces) {
        insts.iter_mut().for_each(|inst| inst.html = true);
        return emit(&toks, &insts, &outs);
    }
    text
}

fn emit(toks: &[Tok], insts: &[Inst], outs: &[String]) -> String {
    let mut text = String::new();
    for tok in toks {
        match *tok {
            Tok::Piece(i) => text.push_str(&outs[i]),
            Tok::Open(id) => text.push_str(&tags(&insts[id]).0),
            Tok::Close(id) => text.push_str(&tags(&insts[id]).1),
        }
    }
    text
}

/// Whether the text, read as a paragraph, gives the same runs.
fn reads_back(text: &str, pieces: &[Inline]) -> bool {
    let parsed = parse(text, SoftBreaks::Space).blocks;
    matches!(parsed.as_slice(), [Block::Paragraph(back)] if back == pieces)
}

fn is_delimiter(mark: &Mark) -> bool {
    matches!(mark, Mark::Strong | Mark::Emphasis | Mark::Strike) || is_honey(mark)
}

/// Merges runs, turns soft breaks into spaces, and moves whitespace at the edges of marks outside them.
fn prepare(inlines: &[Inline], breaks: Breaks) -> Vec<Inline> {
    let mut merged: Vec<Inline> = Vec::new();
    for inline in inlines {
        match inline {
            Inline::Text { text, marks } => push_text(&mut merged, text, marks),
            Inline::SoftBreak => push_text(&mut merged, " ", &Marks::none()),
            Inline::HardBreak if breaks == Breaks::Space => push_text(&mut merged, " ", &Marks::none()),
            other => merged.push(other.clone()),
        }
    }
    let mut out = Vec::new();
    for i in 0..merged.len() {
        split_edges(&merged, i, &mut out);
    }
    let mut result = Vec::new();
    for inline in out {
        match inline {
            Inline::Text { text, marks } => push_text(&mut result, &text, &marks),
            other => result.push(other),
        }
    }
    result
}

fn marks_at(pieces: &[Inline], i: Option<usize>) -> Option<&Marks> {
    match pieces.get(i?) {
        Some(Inline::Text { marks, .. }) => Some(marks),
        _ => None,
    }
}

/// The marks that `marks` and `other` share, among those that delimiters write.
fn shared_delimiters(marks: &Marks, other: Option<&Marks>) -> Marks {
    let mut shared = marks.clone();
    shared.strong &= other.is_some_and(|o| o.strong);
    shared.emphasis &= other.is_some_and(|o| o.emphasis);
    shared.strike &= other.is_some_and(|o| o.strike);
    if other.map(|o| &o.highlight) != Some(&marks.highlight) {
        shared.highlight = None;
    }
    shared
}

/// Pushes the run at `i`, split so that whitespace at either edge of a marked range sits outside the marks.
fn split_edges(pieces: &[Inline], i: usize, out: &mut Vec<Inline>) {
    let Inline::Text { text, marks } = &pieces[i] else {
        out.push(pieces[i].clone());
        return;
    };
    if marks.code || marks.math || !has_delimiters(marks) {
        out.push(pieces[i].clone());
        return;
    }
    let prev = marks_at(pieces, i.checked_sub(1));
    let next = marks_at(pieces, Some(i + 1));
    let core = text.trim_matches(char::is_whitespace);
    if core.is_empty() {
        let both = shared_delimiters(&shared_delimiters(marks, prev), next);
        out.push(Inline::marked(text.clone(), both));
        return;
    }
    let lead = &text[..text.len() - text.trim_start_matches(char::is_whitespace).len()];
    let trail = &text[text.trim_end_matches(char::is_whitespace).len()..];
    if !lead.is_empty() {
        out.push(Inline::marked(lead, shared_delimiters(marks, prev)));
    }
    out.push(Inline::marked(core, marks.clone()));
    if !trail.is_empty() {
        out.push(Inline::marked(trail, shared_delimiters(marks, next)));
    }
}

/// The last or first character a piece shows, or `None` where a line ends.
fn edge(piece: &Inline, last: bool) -> Option<char> {
    match piece {
        Inline::Text { marks, .. } if marks.code => Some('`'),
        Inline::Text { text, marks } if marks.math && inline_math(text) => Some('$'),
        Inline::Text { text, .. } if last => text.chars().next_back(),
        Inline::Text { text, .. } => text.chars().next(),
        Inline::Image { .. } => Some(if last { ')' } else { '!' }),
        Inline::HardBreak | Inline::SoftBreak => None,
    }
}

fn render_pieces(pieces: &[Inline], breaks: Breaks) -> Vec<String> {
    let mut outs = Vec::with_capacity(pieces.len());
    for (i, piece) in pieces.iter().enumerate() {
        let prev = i.checked_sub(1).and_then(|p| edge(&pieces[p], true));
        let next = pieces.get(i + 1).and_then(|p| edge(p, false));
        outs.push(match piece {
            Inline::Text { text, marks } if marks.code => code_span(text),
            Inline::Text { text, marks } if marks.math && inline_math(text) => format!("${text}$"),
            Inline::Text { text, .. } => escape_around(text, prev, next),
            Inline::HardBreak | Inline::SoftBreak => match breaks {
                Breaks::Html => "<br>".to_owned(),
                _ => "\\\n".to_owned(),
            },
            Inline::Image { dest, alt } => {
                let alt = escape_around(&alt.replace('\n', " "), Some(' '), Some(' '));
                format!("![{}]({})", alt.trim(), link_dest(dest))
            }
        });
    }
    outs
}

/// Whether TeX can be written as `$...$`: one line, no space at either edge, and no `$` of its own.
pub fn inline_math(text: &str) -> bool {
    !text.is_empty()
        && !text.contains(['\n', '$'])
        && !text.starts_with(char::is_whitespace)
        && !text.ends_with(char::is_whitespace)
}

/// A code span with the fewest backticks that work, padded where spec 7.7 says.
pub fn code_span(text: &str) -> String {
    let mut run = 0;
    let mut runs = std::collections::BTreeSet::new();
    for c in text.chars().chain(std::iter::once(' ')) {
        if c == '`' {
            run += 1;
        } else if run > 0 {
            runs.insert(run);
            run = 0;
        }
    }
    let fence = "`".repeat((1..).find(|n| !runs.contains(n)).unwrap_or(1));
    let padded = text.starts_with('`')
        || text.ends_with('`')
        || (text.starts_with(' ') && text.ends_with(' ') && !text.chars().all(|c| c == ' '));
    let pad = if padded { " " } else { "" };
    format!("{fence}{pad}{text}{pad}{fence}")
}

/// A link destination: bare when it can be, between angle brackets otherwise.
pub fn link_dest(dest: &str) -> String {
    let plain = !dest.is_empty()
        && !dest
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '(' | ')' | '<' | '>' | '\\'));
    if plain {
        return dest.to_owned();
    }
    let mut out = String::from("<");
    for c in dest.chars().filter(|c| !matches!(c, '\n' | '\r')) {
        if matches!(c, '<' | '>' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('>');
    out
}

enum Tok {
    Open(usize),
    Close(usize),
    Piece(usize),
}

struct Inst {
    mark: Mark,
    html: bool,
}

/// Lays out where each mark opens and closes. A mark that ends while an inner mark goes on is closed, and
/// the inner marks reopen after it.
fn plan(pieces: &[Inline]) -> (Vec<Tok>, Vec<Inst>) {
    let mut toks = Vec::new();
    let mut insts: Vec<Inst> = Vec::new();
    let mut open: Vec<usize> = Vec::new();
    for (i, piece) in pieces.iter().enumerate() {
        let want = match piece {
            Inline::Text { marks, .. } => mark_list(marks),
            _ => Vec::new(),
        };
        let keep = open
            .iter()
            .zip(&want)
            .take_while(|(id, mark)| insts[**id].mark == **mark)
            .count();
        while open.len() > keep {
            toks.extend(open.pop().map(Tok::Close));
        }
        for mark in &want[keep..] {
            insts.push(Inst {
                mark: mark.clone(),
                html: false,
            });
            open.push(insts.len() - 1);
            toks.push(Tok::Open(insts.len() - 1));
        }
        toks.push(Tok::Piece(i));
    }
    while let Some(id) = open.pop() {
        toks.push(Tok::Close(id));
    }
    (toks, insts)
}

fn is_punct(c: char) -> bool {
    c.is_ascii_punctuation() || !(c.is_alphanumeric() || c.is_whitespace() || c.is_control())
}

/// CommonMark's rule for a delimiter that opens: not before whitespace, and not before punctuation unless the
/// character before it is whitespace or punctuation too.
fn can_open(prev: Option<char>, next: Option<char>) -> bool {
    let Some(next) = next.filter(|c| !c.is_whitespace()) else {
        return false;
    };
    !is_punct(next) || prev.is_none_or(|p| p.is_whitespace() || is_punct(p))
}

/// The mirror image of [`can_open`].
fn can_close(prev: Option<char>, next: Option<char>) -> bool {
    let Some(prev) = prev.filter(|c| !c.is_whitespace()) else {
        return false;
    };
    !is_punct(prev) || next.is_none_or(|n| n.is_whitespace() || is_punct(n))
}

/// The pieces that touch the delimiter at token `t`: the nearest one before it and the nearest one after it.
fn neighbors(toks: &[Tok], t: usize, pieces: &[Inline], outs: &[String]) -> (Option<char>, Option<char>) {
    let piece_at = |tok: &Tok| match tok {
        Tok::Piece(i) => Some(*i),
        _ => None,
    };
    let before = toks[..t].iter().rev().find_map(piece_at);
    let after = toks[t + 1..].iter().find_map(piece_at);
    let prev = before
        .filter(|&i| edge(&pieces[i], true).is_some())
        .and_then(|i| outs[i].chars().next_back());
    let next = after
        .filter(|&i| edge(&pieces[i], false).is_some())
        .and_then(|i| outs[i].chars().next());
    (prev, next)
}

fn is_honey(mark: &Mark) -> bool {
    matches!(mark, Mark::Highlight(name) if name == "honey")
}

/// Decides, for each mark, whether its delimiters work where it sits, or its HTML tags must be used.
fn choose_forms(toks: &[Tok], insts: &mut [Inst], pieces: &[Inline], outs: &[String]) {
    let mut open_ok = vec![true; insts.len()];
    let mut close_ok = vec![true; insts.len()];
    for (t, tok) in toks.iter().enumerate() {
        let (prev, next) = neighbors(toks, t, pieces, outs);
        // A text `=` next to the `==` of a highlight would read as part of it.
        let clear = |mark: &Mark| !is_honey(mark) || (prev != Some('=') && next != Some('='));
        match *tok {
            Tok::Open(id) => open_ok[id] = can_open(prev, next) && clear(&insts[id].mark),
            Tok::Close(id) => close_ok[id] = can_close(prev, next) && clear(&insts[id].mark),
            Tok::Piece(_) => {}
        }
    }
    for (id, inst) in insts.iter_mut().enumerate() {
        inst.html = !(is_delimiter(&inst.mark) && open_ok[id] && close_ok[id]);
    }
}

/// A mark name as the value of a quoted attribute. The readers accept only safe names, but the writer must stay
/// safe whatever the tree holds, so a quote can never end the attribute and start raw HTML.
fn attr(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

/// The text that opens a mark and the text that closes it.
fn tags(inst: &Inst) -> (String, String) {
    let pair = |open: &str, close: &str| (open.to_owned(), close.to_owned());
    match (&inst.mark, inst.html) {
        (Mark::Link(dest), _) => ("[".to_owned(), format!("]({})", link_dest(dest))),
        (Mark::Strong, false) => pair("**", "**"),
        (Mark::Strong, true) => pair("<strong>", "</strong>"),
        (Mark::Emphasis, false) => pair("*", "*"),
        (Mark::Emphasis, true) => pair("<em>", "</em>"),
        (Mark::Strike, false) => pair("~~", "~~"),
        (Mark::Strike, true) => pair("<del>", "</del>"),
        (Mark::Underline, _) => pair("<u>", "</u>"),
        (Mark::Highlight(name), false) if name == "honey" => pair("==", "=="),
        (Mark::Highlight(name), _) if name == "honey" => pair("<mark>", "</mark>"),
        (Mark::Highlight(name), _) => (format!("<mark data-color=\"{}\">", attr(name)), "</mark>".to_owned()),
        (Mark::Color(color), _) => (format!("<span data-color=\"{}\">", attr(color)), "</span>".to_owned()),
        (Mark::Size(size), _) => (format!("<span data-size=\"{}\">", attr(size)), "</span>".to_owned()),
        (Mark::Script(Script::Sub), _) => pair("<sub>", "</sub>"),
        (Mark::Script(Script::Sup), _) => pair("<sup>", "</sup>"),
    }
}
