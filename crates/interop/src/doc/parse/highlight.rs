//! Reading `==highlights==` out of text, where CommonMark has no syntax for them.

use super::Builder;
use crate::doc::{push_text, Inline, Marks};

impl Builder {
    pub(super) fn text(&mut self, text: &str) {
        if self.image.is_some() || self.code.is_some() {
            self.push_inline_text(text, &Marks::none());
            return;
        }
        let mut rest = text;
        while let Some(at) = rest.find("==") {
            let (before, after) = rest.split_at(at);
            let after = &after[2..];
            self.plain(before);
            if !self.toggle_highlight(before, after) {
                self.plain("==");
            }
            rest = after;
        }
        self.plain(rest);
    }

    pub(super) fn plain(&mut self, text: &str) {
        let marks = self.marks();
        push_text(&mut self.cur, text, &marks);
    }

    /// Opens or closes a `==` highlight when CommonMark-style flanking allows it.
    fn toggle_highlight(&mut self, before: &str, after: &str) -> bool {
        let prev = before.chars().next_back().or_else(|| match self.cur.last() {
            Some(Inline::Text { text, .. }) => text.chars().next_back(),
            Some(Inline::Image { .. }) => Some(')'),
            _ => None,
        });
        if let Some(index) = self.highlight_open {
            if prev.is_some_and(|c| !c.is_whitespace()) && index < self.cur.len() {
                self.cur.remove(index);
                self.highlight_open = None;
                self.md.highlight = None;
                return true;
            }
            return false;
        }
        let next = after.chars().next();
        if next.is_some_and(|c| c.is_whitespace() || c == '=') {
            return false;
        }
        let marks = self.marks();
        self.cur.push(Inline::marked("==", marks));
        self.highlight_open = Some(self.cur.len() - 1);
        self.md.highlight = Some("honey".to_owned());
        true
    }

    /// A `==` that never closed is plain text, not the start of a highlight.
    pub(super) fn revert_open_highlight(&mut self) {
        let Some(index) = self.highlight_open.take() else {
            return;
        };
        self.md.highlight = None;
        for inline in self.cur.iter_mut().skip(index + 1) {
            if let Inline::Text { marks, .. } = inline {
                if marks.highlight.as_deref() == Some("honey") {
                    marks.highlight = None;
                }
            }
        }
    }
}
