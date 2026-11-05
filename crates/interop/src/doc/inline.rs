//! Writing runs of text as Markdown: marks nest in the order of spec 7.7, and text is escaped as spec 7.6 says.

use super::escape::escape_around;
use super::parse::tags::{read_tag, Mark, Tag};
use super::parse::{parse, parse_page, SoftBreaks};
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

/// Makes a mark from its value.
type MakeMark = fn(String) -> Mark;

/// The marks of a run in nesting order (`R-MRK-24`). Code is not a nesting mark: it is written as a code span.
fn mark_list(marks: &Marks) -> Vec<Mark> {
    let mut list = Vec::new();
    let opt = |value: &Option<String>, make: fn(String) -> Mark| value.clone().map(make);
    list.extend(opt(&marks.float, Mark::Float));
    list.extend(opt(&marks.link, Mark::Link));
    list.extend(sorted(&marks.comments).into_iter().map(Mark::Comment));
    list.extend(opt(&marks.insertion, Mark::Insertion));
    list.extend(opt(&marks.deletion, Mark::Deletion));
    list.extend(opt(&marks.format_change, Mark::FormatChange));
    list.extend(opt(&marks.dir, Mark::Dir));
    list.extend(opt(&marks.lang, Mark::Lang));
    list.extend(opt(&marks.char_style, Mark::CharStyle));
    list.extend(marks.strong.then_some(Mark::Strong));
    list.extend(opt(&marks.weight, Mark::Weight));
    list.extend(marks.emphasis.then_some(Mark::Emphasis));
    list.extend(marks.strike.then_some(Mark::Strike {
        double: marks.strike_double,
    }));
    list.extend(marks.underline.then(|| Mark::Underline {
        line: marks.underline_line.clone(),
        color: marks.underline_color.clone(),
    }));
    let values: [(&Option<String>, MakeMark); 12] = [
        (&marks.highlight, Mark::Highlight),
        (&marks.shade, Mark::Shade),
        (&marks.color, Mark::Color),
        (&marks.font, Mark::Font),
        (&marks.size, Mark::Size),
        (&marks.caps, Mark::Caps),
        (&marks.tracking, Mark::Tracking),
        (&marks.scale, Mark::Scale),
        (&marks.shift, Mark::Shift),
        (&marks.kern, Mark::Kern),
        (&marks.otf, Mark::Otf),
        (&marks.effect, Mark::Effect),
    ];
    for (value, make) in values {
        list.extend(opt(value, make));
    }
    list.extend(marks.text_box.clone().map(|style| Mark::TextBox {
        style,
        color: marks.box_color.clone(),
    }));
    list.extend(marks.script.map(Mark::Script));
    list.extend(sorted(&marks.foreign).into_iter().map(Mark::Foreign));
    list
}

fn sorted(values: &[String]) -> Vec<String> {
    let mut values = values.to_vec();
    values.sort();
    values.dedup();
    values
}

/// The marks without one mark.
fn without(marks: &Marks, mark: &Mark) -> Marks {
    let mut out = marks.clone();
    match mark {
        Mark::Float(_) => out.float = None,
        Mark::Link(_) => out.link = None,
        Mark::Comment(id) => out.comments.retain(|c| c != id),
        Mark::Insertion(_) => out.insertion = None,
        Mark::Deletion(_) => out.deletion = None,
        Mark::FormatChange(_) => out.format_change = None,
        Mark::Dir(_) => out.dir = None,
        Mark::Lang(_) => out.lang = None,
        Mark::CharStyle(_) => out.char_style = None,
        Mark::Strong => out.strong = false,
        Mark::Weight(_) => out.weight = None,
        Mark::Emphasis => out.emphasis = false,
        Mark::Strike { .. } => {
            out.strike = false;
            out.strike_double = false;
        }
        Mark::Underline { .. } => {
            out.underline = false;
            out.underline_line = None;
            out.underline_color = None;
        }
        Mark::Highlight(_) => out.highlight = None,
        Mark::Shade(_) => out.shade = None,
        Mark::Color(_) => out.color = None,
        Mark::Font(_) => out.font = None,
        Mark::Size(_) => out.size = None,
        Mark::Caps(_) => out.caps = None,
        Mark::Tracking(_) => out.tracking = None,
        Mark::Scale(_) => out.scale = None,
        Mark::Shift(_) => out.shift = None,
        Mark::Kern(_) => out.kern = None,
        Mark::Otf(_) => out.otf = None,
        Mark::Effect(_) => out.effect = None,
        Mark::TextBox { .. } => {
            out.text_box = None;
            out.box_color = None;
        }
        Mark::Script(_) => out.script = None,
        Mark::Foreign(raw) => out.foreign.retain(|f| f != raw),
    }
    out
}

/// Whether a mark shows on spaces, so whitespace at its edges stays inside it (`R-WS-1`).
fn shows_on_spaces(mark: &Mark) -> bool {
    match mark {
        Mark::Underline { line, .. } => line.as_deref() != Some("words"),
        Mark::Strike { .. }
        | Mark::Highlight(_)
        | Mark::Shade(_)
        | Mark::TextBox { .. }
        | Mark::Insertion(_)
        | Mark::Deletion(_)
        | Mark::Foreign(_) => true,
        _ => false,
    }
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
    let text = emit(&toks, &insts, &outs, &pieces);
    let uses_delimiters = insts.iter().any(|inst| !inst.html && is_delimiter(&inst.mark));
    if uses_delimiters && !reads_back(&text, &pieces, breaks) {
        insts.iter_mut().for_each(|inst| inst.html = true);
        return emit(&toks, &insts, &outs, &pieces);
    }
    text
}

fn emit(toks: &[Tok], insts: &[Inst], outs: &[String], pieces: &[Inline]) -> String {
    let mut text = String::new();
    let mut after_note = false;
    for tok in toks {
        let piece = match *tok {
            Tok::Piece(i) => outs[i].clone(),
            Tok::Open(id) => tags(&insts[id]).0,
            Tok::Close(id) => tags(&insts[id]).1,
        };
        let note = matches!(tok, Tok::Piece(i) if matches!(pieces[*i], Inline::Note { .. }));
        // R-FN-3: a `!` before a reference and a `(` or `:` after one are escaped, so it stays a reference.
        let slashes = text.bytes().rev().skip(1).take_while(|b| *b == b'\\').count();
        if note && text.ends_with('!') && slashes % 2 == 0 {
            text.insert(text.len() - 1, '\\');
        }
        if after_note && piece.starts_with(['(', ':']) {
            text.push('\\');
        }
        if !piece.is_empty() {
            after_note = note;
        }
        text.push_str(&piece);
    }
    text
}

/// Whether the text, read as a paragraph, gives the same runs.
fn reads_back(text: &str, pieces: &[Inline], breaks: Breaks) -> bool {
    // A cell of a Markdown table writes its breaks as `<br>`, which only the reader of other apps' Markdown reads.
    let parsed = match breaks {
        Breaks::Html => parse(text, SoftBreaks::Space).blocks,
        _ => parse_page(text).blocks,
    };
    matches!(parsed.as_slice(), [Block::Paragraph(back)] if back == pieces)
}

fn is_delimiter(mark: &Mark) -> bool {
    matches!(mark, Mark::Strong | Mark::Emphasis | Mark::Strike { double: false }) || is_honey(mark)
}

/// Merges runs, turns soft breaks into spaces, and moves whitespace at the edges of marks outside them.
fn prepare(inlines: &[Inline], breaks: Breaks) -> Vec<Inline> {
    let mut merged: Vec<Inline> = Vec::new();
    for inline in inlines {
        match inline {
            Inline::Text { text, marks } => push_text(&mut merged, text, &normal(marks)),
            Inline::SoftBreak => push_text(&mut merged, " ", &Marks::none()),
            Inline::HardBreak if breaks == Breaks::Space => push_text(&mut merged, " ", &Marks::none()),
            Inline::Note { id, marks } => merged.push(Inline::Note {
                id: id.clone(),
                marks: normal(marks),
            }),
            other => merged.push(other.clone()),
        }
    }
    // R-WS-2: a reader drops a hard break at either end of a paragraph, so the writer writes none there.
    while matches!(merged.last(), Some(Inline::HardBreak)) {
        merged.pop();
    }
    let lead = merged.iter().take_while(|i| matches!(i, Inline::HardBreak)).count();
    merged.drain(..lead);
    while let Some(next) = trim_once(&merged) {
        merged = next;
    }
    merged
}

/// Marks with comments and foreign marks sorted, so equal marks compare equal.
fn normal(marks: &Marks) -> Marks {
    let mut marks = marks.clone();
    marks.comments = sorted(&marks.comments);
    marks.foreign = sorted(&marks.foreign);
    marks
}

fn piece_marks(piece: Option<&Inline>) -> Vec<Mark> {
    match piece {
        Some(Inline::Text { marks, .. } | Inline::Note { marks, .. }) => mark_list(marks),
        _ => Vec::new(),
    }
}

/// Moves the whitespace at one edge of one range outside it (`R-WS-1`), or `None` when no edge has any.
fn trim_once(pieces: &[Inline]) -> Option<Vec<Inline>> {
    for (i, piece) in pieces.iter().enumerate() {
        let Inline::Text { text, marks } = piece else {
            continue;
        };
        if marks.code || marks.math {
            continue;
        }
        let before = piece_marks(i.checked_sub(1).and_then(|p| pieces.get(p)));
        let after = piece_marks(pieces.get(i + 1));
        let core_start = text.trim_start_matches(char::is_whitespace);
        let core_end = text.trim_end_matches(char::is_whitespace);
        for mark in mark_list(marks).iter().filter(|m| !shows_on_spaces(m)) {
            let split = if !before.contains(mark) && core_start.len() < text.len() {
                let edge = &text[..text.len() - core_start.len()];
                [(edge, without(marks, mark)), (core_start, marks.clone())]
            } else if !after.contains(mark) && core_end.len() < text.len() {
                let edge = &text[core_end.len()..];
                [(core_end, marks.clone()), (edge, without(marks, mark))]
            } else {
                continue;
            };
            let mut out: Vec<Inline> = pieces[..i].to_vec();
            for (text, marks) in split {
                push_text(&mut out, text, &marks);
            }
            for piece in &pieces[i + 1..] {
                match piece {
                    Inline::Text { text, marks } => push_text(&mut out, text, marks),
                    other => out.push(other.clone()),
                }
            }
            return Some(out);
        }
    }
    None
}

/// The last or first character a piece shows, or `None` where a line ends.
fn edge(piece: &Inline, last: bool) -> Option<char> {
    match piece {
        Inline::Text { marks, .. } if marks.code => Some('`'),
        Inline::Text { text, marks } if marks.math && inline_math(text) => Some('$'),
        Inline::Text { text, .. } if last => text.chars().next_back(),
        Inline::Text { text, .. } => text.chars().next(),
        Inline::Image { .. } => Some(if last { ')' } else { '!' }),
        Inline::Note { .. } => Some(if last { ']' } else { '[' }),
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
            Inline::Note { id, .. } => format!("[^{id}]"),
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
            Inline::Text { marks, .. } | Inline::Note { marks, .. } => mark_list(marks),
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

/// The attribute of a `<span>` that holds one mark's value.
fn span_attr(mark: &Mark) -> Option<(&'static str, &str)> {
    Some(match mark {
        Mark::Float(v) => ("data-float", v),
        Mark::Comment(v) => ("data-comment", v),
        Mark::Insertion(v) => ("data-ins", v),
        Mark::Deletion(v) => ("data-del", v),
        Mark::FormatChange(v) => ("data-fmt", v),
        Mark::Dir(v) => ("dir", v),
        Mark::Lang(v) => ("lang", v),
        Mark::CharStyle(v) => ("data-style", v),
        Mark::Weight(v) => ("data-weight", v),
        Mark::Shade(v) => ("data-shade", v),
        Mark::Color(v) => ("data-color", v),
        Mark::Font(v) => ("data-font", v),
        Mark::Size(v) => ("data-size", v),
        Mark::Caps(v) => ("data-caps", v),
        Mark::Tracking(v) => ("data-tracking", v),
        Mark::Scale(v) => ("data-scale", v),
        Mark::Shift(v) => ("data-shift", v),
        Mark::Kern(v) => ("data-kern", v),
        Mark::Otf(v) => ("data-otf", v),
        Mark::Effect(v) => ("data-effect", v),
        _ => return None,
    })
}

/// The text that opens a mark and the text that closes it.
fn tags(inst: &Inst) -> (String, String) {
    let pair = |open: &str, close: &str| (open.to_owned(), close.to_owned());
    if let Some((key, value)) = span_attr(&inst.mark) {
        return (format!("<span {key}=\"{}\">", attr(value)), "</span>".to_owned());
    }
    match (&inst.mark, inst.html) {
        (Mark::Link(dest), _) => ("[".to_owned(), format!("]({})", link_dest(dest))),
        (Mark::Strong, false) => pair("**", "**"),
        (Mark::Strong, true) => pair("<strong>", "</strong>"),
        (Mark::Emphasis, false) => pair("*", "*"),
        (Mark::Emphasis, true) => pair("<em>", "</em>"),
        (Mark::Strike { double: true }, _) => pair("<del data-line=\"double\">", "</del>"),
        (Mark::Strike { .. }, false) => pair("~~", "~~"),
        (Mark::Strike { .. }, true) => pair("<del>", "</del>"),
        (Mark::Underline { line, color }, _) => {
            let mut open = String::from("<u");
            if let Some(line) = line {
                open.push_str(&format!(" data-line=\"{}\"", attr(line)));
            }
            if let Some(color) = color {
                open.push_str(&format!(" data-line-color=\"{}\"", attr(color)));
            }
            (open + ">", "</u>".to_owned())
        }
        (Mark::Highlight(name), false) if name == "honey" => pair("==", "=="),
        (Mark::Highlight(name), _) if name == "honey" => pair("<mark>", "</mark>"),
        (Mark::Highlight(name), _) => (format!("<mark data-color=\"{}\">", attr(name)), "</mark>".to_owned()),
        (Mark::TextBox { style, color }, _) => {
            let color = color
                .as_ref()
                .map_or(String::new(), |c| format!(" data-box-color=\"{}\"", attr(c)));
            (
                format!("<span data-box=\"{}\"{color}>", attr(style)),
                "</span>".to_owned(),
            )
        }
        (Mark::Script(Script::Sub), _) => pair("<sub>", "</sub>"),
        (Mark::Script(Script::Sup), _) => pair("<sup>", "</sup>"),
        // A foreign tag writes back byte for byte (R-INL-9). One that is not in the grammar is not written, so
        // whatever the tree holds can never start raw HTML.
        (Mark::Foreign(raw), _) => match read_tag(raw) {
            Some(Tag::Open { name, .. }) => (raw.clone(), format!("</{name}>")),
            _ => pair("", ""),
        },
        _ => pair("", ""),
    }
}
