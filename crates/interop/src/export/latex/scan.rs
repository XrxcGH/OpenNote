//! The token scan that checks one equation: balanced braces and environments, no unescaped `$`, and none of the
//! control words outside `math::MATH`. The scan also cleans the text (comments and blank lines go) and notes what a display
//! needs: a label, a row break, or an environment that is the whole equation.

use super::math::{allowed_math, DISPLAY_ENVIRONMENTS, ENVIRONMENTS};

/// The longest equation that is kept.
const MAX_CHARS: usize = 20_000;

/// Equation text that passed the check.
#[derive(Debug, PartialEq, Eq)]
pub struct Checked {
    /// The TeX, without comments and blank lines.
    pub tex: String,
    /// Whether it holds a `\label`.
    pub labeled: bool,
    /// The environment that makes up the whole equation, such as `align`.
    pub whole: Option<String>,
    /// Whether a row break or alignment tab stands outside any environment, so a display needs `aligned`.
    pub rows: bool,
}

fn key_ok(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 80
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'_' | b'.' | b'-'))
}

/// The text inside the braces that start at `at` (an opening brace), and where they end.
pub(super) fn braced(chars: &[char], at: usize) -> Option<(String, usize)> {
    if chars.get(at) != Some(&'{') {
        return None;
    }
    let mut depth = 0usize;
    let mut text = String::new();
    for (i, &c) in chars.iter().enumerate().skip(at) {
        match c {
            '{' => {
                depth += 1;
                if depth > 1 {
                    text.push(c);
                }
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((text, i));
                }
                text.push(c);
            }
            _ => text.push(c),
        }
    }
    None
}

fn skip_space(chars: &[char], mut at: usize) -> usize {
    while chars.get(at).is_some_and(|c| *c == ' ' || *c == '\t') {
        at += 1;
    }
    at
}

/// Lines trimmed, blank lines removed, which TeX would read as a paragraph end.
fn tidy(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Where the letters that follow a backslash end.
fn word_end(chars: &[char], from: usize) -> usize {
    chars[from..]
        .iter()
        .position(|c| !c.is_ascii_alphabetic())
        .map_or(chars.len(), |p| from + p)
}

/// Checks the TeX of one equation and cleans it. `None` when it cannot be kept.
pub fn check(source: &str, inline: bool) -> Option<Checked> {
    if source.chars().count() > MAX_CHARS {
        return None;
    }
    let chars: Vec<char> = source
        .chars()
        .filter(|c| *c != '\r' && (*c == '\n' || *c == '\t' || !c.is_control()))
        .collect();
    if source.contains("^^") {
        return None;
    }
    Scan {
        out: String::with_capacity(chars.len()),
        chars,
        at: 0,
        stack: Vec::new(),
        top_levels: Vec::new(),
        depth: 0,
        lefts: 0,
        rights: 0,
        labeled: false,
        rows: false,
        inline,
    }
    .run()
}

struct Scan {
    chars: Vec<char>,
    at: usize,
    out: String,
    /// The environments that are open.
    stack: Vec<String>,
    /// The environments that are open at the top, with where each starts and ends in `out`.
    top_levels: Vec<(String, usize, usize)>,
    depth: usize,
    lefts: usize,
    rights: usize,
    labeled: bool,
    rows: bool,
    inline: bool,
}

impl Scan {
    fn run(mut self) -> Option<Checked> {
        while self.at < self.chars.len() {
            let c = self.chars[self.at];
            match c {
                '%' => self.comment(),
                '$' | '#' => return None,
                '^' if self.chars.get(self.at + 1) == Some(&'^') => return None,
                '{' => {
                    self.depth += 1;
                    self.keep(c);
                }
                '}' => {
                    self.depth = self.depth.checked_sub(1)?;
                    self.keep(c);
                }
                '&' => {
                    self.alignment()?;
                    self.keep(c);
                }
                '\\' => self.backslash()?,
                _ => self.keep(c),
            }
        }
        self.finish()
    }

    fn keep(&mut self, c: char) {
        self.out.push(c);
        self.at += 1;
    }

    /// A comment runs to the end of its line, and the line break stays.
    fn comment(&mut self) {
        while self.at < self.chars.len() && self.chars[self.at] != '\n' {
            self.at += 1;
        }
    }

    /// An alignment tab or a row break. Outside an environment it only makes sense in a display, at the top.
    fn alignment(&mut self) -> Option<()> {
        if self.stack.is_empty() {
            if self.inline || self.depth > 0 {
                return None;
            }
            self.rows = true;
        }
        Some(())
    }

    fn backslash(&mut self) -> Option<()> {
        let next = *self.chars.get(self.at + 1)?;
        if !next.is_ascii() {
            return None;
        }
        if next.is_ascii_alphabetic() {
            return self.word();
        }
        if next == '\\' {
            self.alignment()?;
        }
        if next == '\n' {
            return None;
        }
        self.out.push('\\');
        self.out.push(next);
        self.at += 2;
        Some(())
    }

    /// A control word: the commands that take an argument here, and the ones that are refused.
    fn word(&mut self) -> Option<()> {
        let start = self.at;
        let end = word_end(&self.chars, start + 1);
        let word: String = self.chars[start + 1..end].iter().collect();
        self.out.extend(&self.chars[start..end]);
        self.at = end;
        match word.as_str() {
            "begin" | "end" => self.environment(&word),
            "label" | "ref" | "eqref" => self.reference(&word),
            "left" => {
                self.lefts += 1;
                Some(())
            }
            "right" => {
                self.rights += 1;
                Some(())
            }
            _ => allowed_math(&word).then_some(()),
        }
    }

    /// Copies the text up to the closing brace at `close`.
    fn copy_through(&mut self, close: usize) {
        self.out.extend(&self.chars[self.at..=close]);
        self.at = close + 1;
    }

    fn environment(&mut self, word: &str) -> Option<()> {
        let (name, close) = braced(&self.chars, skip_space(&self.chars, self.at))?;
        if !ENVIRONMENTS.contains(&name.as_str()) {
            return None;
        }
        if word == "begin" {
            if self.stack.is_empty() {
                self.top_levels
                    .push((name.clone(), self.out.len() - "\\begin".len(), 0));
            }
            self.stack.push(name);
        } else {
            if self.stack.pop().as_deref() != Some(name.as_str()) {
                return None;
            }
            if self.stack.is_empty() {
                let tail = self.out.len() + (close + 1 - self.at);
                self.top_levels.last_mut()?.2 = tail;
            }
        }
        self.copy_through(close);
        Some(())
    }

    fn reference(&mut self, word: &str) -> Option<()> {
        let (key, close) = braced(&self.chars, skip_space(&self.chars, self.at))?;
        if !key_ok(&key) {
            return None;
        }
        self.labeled |= word == "label";
        self.copy_through(close);
        Some(())
    }

    fn finish(self) -> Option<Checked> {
        if self.depth != 0 || !self.stack.is_empty() || self.lefts != self.rights {
            return None;
        }
        let tex = tidy(&self.out);
        if tex.is_empty() {
            return None;
        }
        let whole = match self.top_levels.as_slice() {
            [(name, 0, end)] if *end == self.out.trim_end().len() && self.out.trim_start().len() == self.out.len() => {
                Some(name.clone())
            }
            _ => None,
        };
        Some(Checked {
            tex,
            labeled: self.labeled,
            whole: whole.filter(|n| DISPLAY_ENVIRONMENTS.contains(&n.as_str())),
            rows: self.rows,
        })
    }
}
