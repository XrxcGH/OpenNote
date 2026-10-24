//! Importing Rich Text Format files (`.rtf`).
//!
//! RTF is text with control words, such as `\b` for bold and `\par` for a paragraph mark, in nested groups
//! between braces. This reader tokenizes the file once, keeps a stack of group states with a fixed depth, skips
//! the destinations that hold no shown text (font tables, pictures, headers, notes), and hands the shown text to a
//! [`Flow`]. It brings over headings (by outline level), paragraphs, bold, italic, underline, strikethrough,
//! raised and lowered text, web links, lists, and tables.

use encoding_rs::{Encoding, WINDOWS_1252};

use super::flow::{Flow, ParaProps};
use super::rtf_words::{destination, Destination};
use super::Problem;
use crate::doc::Marks;

/// The deepest nesting of groups kept. Deeper groups share the state of the deepest one.
const MAX_DEPTH: usize = 512;
/// The longest control word and parameter read. Longer ones are cut.
const MAX_WORD: usize = 32;
const MAX_DIGITS: usize = 10;
/// The longest captured text, such as a field instruction.
const MAX_CAPTURE: usize = 2_048;

/// What a group's text is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Capture {
    /// A field instruction, such as `HYPERLINK "https://example.org"`.
    Instruction,
    /// The number or bullet of a list paragraph.
    ListText,
}

/// The state of one group.
#[derive(Clone, Debug, Default)]
pub(super) struct Group {
    pub marks: Marks,
    pub skip: bool,
    pub capture: Option<Capture>,
    /// This group started the capture, so its end finishes it.
    pub captures: bool,
    pub uc: usize,
    pub link: Option<String>,
    /// The instruction of the field this group is, once its instruction group has ended.
    pub instruction: Option<String>,
    pub para: ParaProps,
    /// The list paragraph's list, as an override number, or `Some(0)` for an old-style list.
    pub list: Option<i32>,
    pub level: u8,
    pub depth: i32,
    /// A control word starting with `\*`: an unknown destination is skipped.
    pub starred: bool,
}

/// Reads RTF text into a flow.
pub(super) struct Reader {
    pub flow: Flow,
    pub stack: Vec<Group>,
    pub state: Group,
    overflow: usize,
    pub encoding: &'static Encoding,
    bytes: Vec<u8>,
    run: String,
    run_marks: Marks,
    captured: String,
    pub list_text: Option<String>,
    /// Characters of a `\u` fallback still to skip.
    pub skip_fallback: usize,
    /// The first half of a surrogate pair given by `\u`.
    pub surrogate: Option<u16>,
    /// Whether the cell being read holds a table of its own.
    pub nested: bool,
}

/// Whether the bytes start like an RTF file, after any white space.
pub(super) fn is_rtf(data: &[u8]) -> bool {
    let start = data.iter().position(|b| !b.is_ascii_whitespace()).unwrap_or(0);
    data.get(start..).is_some_and(|d| d.starts_with(b"{\\rtf"))
}

/// Reads an RTF file.
pub(super) fn read(data: &[u8]) -> Result<Flow, Problem> {
    if !is_rtf(data) {
        return Err(Problem::Damaged("it is not an RTF file"));
    }
    let mut reader = Reader {
        flow: Flow::default(),
        stack: Vec::new(),
        state: Group {
            uc: 1,
            ..Group::default()
        },
        overflow: 0,
        encoding: WINDOWS_1252,
        bytes: Vec::new(),
        run: String::new(),
        run_marks: Marks::none(),
        captured: String::new(),
        list_text: None,
        skip_fallback: 0,
        surrogate: None,
        nested: false,
    };
    reader.run(data);
    reader.flush();
    Ok(reader.flow)
}

impl Reader {
    fn run(&mut self, data: &[u8]) {
        let mut pos = data.iter().position(|b| *b == b'{').unwrap_or(0);
        while let Some(&byte) = data.get(pos) {
            pos += 1;
            match byte {
                b'{' => self.open(),
                b'}' => {
                    if !self.close() {
                        return;
                    }
                }
                b'\\' => pos = self.control(data, pos),
                b'\r' | b'\n' => {}
                _ => self.byte(byte),
            }
        }
    }

    fn open(&mut self) {
        self.decode();
        self.skip_fallback = 0;
        if self.stack.len() >= MAX_DEPTH {
            self.overflow += 1;
            return;
        }
        let mut inner = self.state.clone();
        inner.captures = false;
        inner.starred = false;
        let outer = std::mem::replace(&mut self.state, inner);
        self.stack.push(outer);
    }

    /// Ends a group. Returns false at the end of the document.
    fn close(&mut self) -> bool {
        self.decode();
        self.skip_fallback = 0;
        if self.overflow > 0 {
            self.overflow -= 1;
            return true;
        }
        let ended = self.state.capture.filter(|_| self.state.captures);
        let Some(outer) = self.stack.pop() else {
            return false;
        };
        self.state = outer;
        match ended {
            Some(Capture::Instruction) => self.state.instruction = Some(std::mem::take(&mut self.captured)),
            Some(Capture::ListText) => self.list_text = Some(std::mem::take(&mut self.captured)),
            None => {}
        }
        true
    }

    /// Reads a control word or symbol after a backslash at `pos`, and returns the position after it.
    fn control(&mut self, data: &[u8], mut pos: usize) -> usize {
        let Some(&first) = data.get(pos) else {
            return pos;
        };
        if !first.is_ascii_alphabetic() {
            return self.symbol(data, pos);
        }
        let start = pos;
        while data.get(pos).is_some_and(u8::is_ascii_alphabetic) {
            pos += 1;
        }
        let word = String::from_utf8_lossy(data.get(start..pos.min(start + MAX_WORD)).unwrap_or(&[])).into_owned();
        let negative = data.get(pos) == Some(&b'-');
        let digits_at = pos + usize::from(negative);
        let mut end = digits_at;
        while data.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        let param = if end > digits_at {
            let digits = data.get(digits_at..end.min(digits_at + MAX_DIGITS)).unwrap_or(&[]);
            let value: i64 = std::str::from_utf8(digits)
                .ok()
                .and_then(|d| d.parse().ok())
                .unwrap_or(0);
            let value = if negative { -value } else { value };
            Some(value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32)
        } else {
            None
        };
        pos = if end > digits_at { end } else { pos };
        if data.get(pos) == Some(&b' ') {
            pos += 1;
        }
        self.word(&word, param);
        pos
    }

    fn symbol(&mut self, data: &[u8], pos: usize) -> usize {
        let Some(&c) = data.get(pos) else {
            return pos;
        };
        match c {
            b'\'' => {
                let hex = data.get(pos + 1..pos + 3).and_then(|h| std::str::from_utf8(h).ok());
                if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    self.byte(byte);
                    return pos + 3;
                }
                return pos + 1;
            }
            b'*' => self.state.starred = true,
            b'\\' | b'{' | b'}' => self.byte(c),
            b'~' => self.text_char('\u{A0}'),
            b'_' => self.text_char('-'),
            b'\r' | b'\n' => self.word("par", None),
            _ => {}
        }
        pos + 1
    }

    fn word(&mut self, word: &str, param: Option<i32>) {
        self.decode();
        self.skip_fallback = 0;
        match destination(word) {
            Destination::Skip(loss) => {
                self.state.skip = true;
                if let Some(loss) = loss {
                    *super::rtf_words::loss_counter(&mut self.flow.losses, loss) += 1;
                }
                return;
            }
            Destination::Capture(kind) => {
                self.state.capture = Some(kind);
                self.state.captures = true;
                self.captured.clear();
                return;
            }
            Destination::None if self.state.starred && super::rtf_words::is_unknown(word) => {
                self.state.skip = true;
                return;
            }
            Destination::None => {}
        }
        self.state.starred = false;
        super::rtf_words::apply(self, word, param);
    }

    /// A text byte, decoded with the file's code page once the run of bytes ends.
    fn byte(&mut self, byte: u8) {
        if self.skip_fallback > 0 {
            self.skip_fallback -= 1;
            return;
        }
        if self.state.skip {
            return;
        }
        self.bytes.push(byte);
    }

    fn decode(&mut self) {
        if self.bytes.is_empty() {
            return;
        }
        let bytes = std::mem::take(&mut self.bytes);
        let (text, _, _) = self.encoding.decode(&bytes);
        for c in text.chars() {
            self.text_char(c);
        }
    }

    /// A shown character: into the capture, or into the current run of text.
    pub(super) fn text_char(&mut self, c: char) {
        if self.state.skip {
            return;
        }
        if self.state.capture.is_some() {
            if self.captured.len() < MAX_CAPTURE {
                self.captured.push(c);
            }
            return;
        }
        let mut marks = self.state.marks.clone();
        marks.link = self.state.link.clone();
        if marks != self.run_marks {
            self.flush_run();
            self.run_marks = marks;
        }
        self.run.push(c);
    }

    pub(super) fn flush_run(&mut self) {
        if !self.run.is_empty() {
            let text = std::mem::take(&mut self.run);
            self.flow.text(&text, &self.run_marks);
        }
    }

    pub(super) fn flush(&mut self) {
        self.decode();
        self.flush_run();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{Block, Inline};

    fn blocks(rtf: &str) -> Vec<Block> {
        read(rtf.as_bytes()).expect("reads").finish().0
    }

    #[test]
    fn formatting_links_and_code_pages_come_through() {
        let rtf = concat!(
            r"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Arial;}}{\info{\title T}}",
            r"\pard\outlinelevel0 Title\par",
            r"\pard Plain \b bold\b0 , caf\'e9 \u8211\'96 ",
            r#"{\field{\*\fldinst{HYPERLINK "https://example.com/"}}{\fldrslt{site}}}\par"#,
            r"{\*\unknowndest junk}{\pict\pngblip 89504e47}\par}",
        );
        let got = blocks(rtf);
        assert!(matches!(&got[0], Block::Heading { level: 1, .. }));
        let Block::Paragraph(inlines) = &got[1] else {
            panic!("a paragraph")
        };
        let text: String = inlines
            .iter()
            .map(|i| match i {
                Inline::Text { text, .. } => text.as_str(),
                _ => "",
            })
            .collect();
        assert_eq!(text, "Plain bold, café – site");
        assert!(inlines
            .iter()
            .any(|i| matches!(i, Inline::Text { marks, .. } if marks.strong)));
        assert!(inlines
            .iter()
            .any(|i| matches!(i, Inline::Text { marks, .. } if marks.link.as_deref() == Some("https://example.com/"))));
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn tables_and_lists_are_grouped() {
        let rtf = r"{\rtf1 \trowd\cellx100\cellx200\pard\intbl A\cell B\cell\row
            \pard{\listtext 1.\tab}\ls1 one\par{\listtext 2.\tab}\ls1 two\par
            \pard{\listtext\'b7\tab}\ls2 dot\par}";
        let got = blocks(rtf);
        assert!(matches!(&got[0], Block::Table { rows, .. } if rows.len() == 1 && rows[0].len() == 2));
        assert!(matches!(&got[1], Block::List { ordered: true, items, .. } if items.len() == 2));
        assert!(matches!(&got[2], Block::List { ordered: false, .. }));
    }

    #[test]
    fn deep_nesting_and_cut_files_end_quietly() {
        let deep = format!("{{\\rtf1 {}text{}", "{".repeat(100_000), "}".repeat(10));
        let _ = blocks(&deep);
        for cut in [
            "{\\rtf1 \\'",
            "{\\rtf1 \\u",
            "{\\rtf1 \\b-",
            "{\\rtf1 {\\*",
            "{\\rtf1 \\u-99999999999999 x",
        ] {
            let _ = blocks(cut);
        }
        assert!(read(b"plain text").is_err());
    }
}
