//! The parts that hold the text of footnotes, endnotes, and comments (`footnotes.xml`, `endnotes.xml`,
//! `comments.xml`), and the replies and resolved state of comments (`commentsExtended.xml`).

use std::collections::HashMap;

use super::styles::children;
use crate::import::xmltree::{Element, Node};

/// One comment as the file holds it.
#[derive(Clone, Debug)]
pub(super) struct CommentSource {
    pub author: Option<String>,
    pub date: Option<String>,
    /// The `w:comment` element, whose paragraphs are the text.
    pub body: Element,
    /// The comment this one replies to.
    pub parent: Option<String>,
    /// Whether the comment is resolved.
    pub done: bool,
}

/// The text of notes and comments, by their IDs in the file.
#[derive(Clone, Debug, Default)]
pub(super) struct Sources {
    pub footnotes: HashMap<String, Element>,
    pub endnotes: HashMap<String, Element>,
    pub comments: HashMap<String, CommentSource>,
    /// Comment IDs in file order, so replies keep their order.
    pub order: Vec<String>,
    /// The replies of each top comment, in file order, worked out once when the comments are read.
    replies_of: HashMap<String, Vec<String>>,
    /// Comments past the most an import reads.
    pub dropped_comments: usize,
}

/// The most comments an import reads, so a file with a flood of them cannot stall it.
pub(super) const MAX_COMMENTS: usize = 10_000;

/// The notes of a `w:footnotes` or `w:endnotes` part. Separators and continuation notices are not notes.
pub(super) fn read_notes(root: &Element, name: &str) -> HashMap<String, Element> {
    children(root, name)
        .filter(|n| matches!(n.attr("w:type"), None | Some("normal")))
        .filter_map(|n| Some((n.attr("w:id")?.to_owned(), n.clone())))
        .collect()
}

/// The `w14:paraId` of the last paragraph of a comment, which `commentsExtended.xml` names it by.
fn last_para_id(comment: &Element) -> Option<String> {
    comment
        .children
        .iter()
        .rev()
        .find_map(|n| match n {
            Node::Element(p) if p.name == "w:p" => p.attr("w14:paraid"),
            _ => None,
        })
        .map(str::to_ascii_uppercase)
}

impl Sources {
    /// Reads the comments and, when there is one, the extended part with replies and resolved state.
    pub fn read_comments(&mut self, comments: &Element, extended: Option<&Element>) {
        let mut by_para: HashMap<String, String> = HashMap::new();
        for c in children(comments, "w:comment") {
            let Some(id) = c.attr("w:id") else {
                continue;
            };
            if self.comments.len() >= MAX_COMMENTS {
                self.dropped_comments += 1;
                continue;
            }
            if let Some(para) = last_para_id(c) {
                by_para.insert(para, id.to_owned());
            }
            self.order.push(id.to_owned());
            self.comments.insert(
                id.to_owned(),
                CommentSource {
                    author: c.attr("w:author").map(str::to_owned),
                    date: c.attr("w:date").map(str::to_owned),
                    body: c.clone(),
                    parent: None,
                    done: false,
                },
            );
        }
        if let Some(extended) = extended {
            self.read_extended(extended, &by_para);
        }
        self.replies_of.clear();
        for r in &self.order {
            let top = self.thread(r);
            if top != *r {
                self.replies_of.entry(top).or_default().push(r.clone());
            }
        }
    }

    /// Reads the replies and resolved state of `commentsExtended.xml`, which names comments by paragraph ID.
    fn read_extended(&mut self, extended: &Element, by_para: &HashMap<String, String>) {
        for ex in children(extended, "w15:commentex") {
            let Some(id) = ex.attr("w15:paraid").and_then(|p| by_para.get(&p.to_ascii_uppercase())) else {
                continue;
            };
            let parent = ex
                .attr("w15:paraidparent")
                .and_then(|p| by_para.get(&p.to_ascii_uppercase()))
                .filter(|p| *p != id)
                .cloned();
            let done = ex.attr("w15:done").is_some_and(|v| v == "1" || v == "true");
            if let Some(comment) = self.comments.get_mut(id) {
                comment.parent = parent;
                comment.done = done;
            }
        }
    }

    /// The top comment of a thread: the comment itself, or the comment it replies to, following at most a few
    /// steps so a loop in the file cannot hang the import.
    pub fn thread(&self, id: &str) -> String {
        let mut current = id.to_owned();
        for _ in 0..8 {
            match self.comments.get(&current).and_then(|c| c.parent.clone()) {
                Some(parent) => current = parent,
                None => break,
            }
        }
        current
    }

    /// The replies of a comment, in file order.
    pub fn replies(&self, id: &str) -> Vec<&CommentSource> {
        self.replies_of
            .get(id)
            .into_iter()
            .flatten()
            .filter_map(|r| self.comments.get(r))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    #[test]
    fn replies_and_resolved_state_come_from_the_extended_part() {
        let comments = parse(
            r#"<w:comments>
              <w:comment w:id="0" w:author="Ann" w:date="2026-10-01T10:00:00Z"><w:p w14:paraId="0A1"><w:r>
              <w:t>Check this.</w:t></w:r></w:p></w:comment>
              <w:comment w:id="1" w:author="Ben" w:date="2026-10-02T10:00:00Z"><w:p w14:paraId="0B2"><w:r>
              <w:t>Done.</w:t></w:r></w:p></w:comment>
            </w:comments>"#,
        );
        let extended = parse(
            r#"<w15:commentsEx><w15:commentEx w15:paraId="0A1" w15:done="1"/>
              <w15:commentEx w15:paraId="0B2" w15:paraIdParent="0A1" w15:done="0"/></w15:commentsEx>"#,
        );
        let mut sources = Sources::default();
        sources.read_comments(&comments, Some(&extended));
        assert!(sources.comments["0"].done);
        assert_eq!(sources.thread("1"), "0");
        let replies = sources.replies("0");
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].author.as_deref(), Some("Ben"));
    }

    /// Builds a `w:comments` part and its extended part where every comment after the first replies to it.
    fn reply_flood(count: usize) -> (Element, Element) {
        let mut comments = String::from("<w:comments>");
        let mut extended = String::from("<w15:commentsEx>");
        for i in 0..count {
            comments.push_str(&format!(
                r#"<w:comment w:id="{i}" w:author="A"><w:p w14:paraId="{i:X}"><w:r><w:t>c</w:t></w:r></w:p></w:comment>"#
            ));
            let parent = if i == 0 {
                String::new()
            } else {
                r#" w15:paraIdParent="0""#.to_owned()
            };
            extended.push_str(&format!(r#"<w15:commentEx w15:paraId="{i:X}"{parent}/>"#));
        }
        comments.push_str("</w:comments>");
        extended.push_str("</w15:commentsEx>");
        (parse(&comments), parse(&extended))
    }

    #[test]
    fn replies_of_every_comment_are_found_in_linear_time() {
        // Looking up the replies of every comment once per comment used to scan all comments each time, so
        // 10,000 comments took minutes. Worked out once, the lookups take far less than a second.
        let (comments, extended) = reply_flood(MAX_COMMENTS);
        let mut sources = Sources::default();
        sources.read_comments(&comments, Some(&extended));
        let start = std::time::Instant::now();
        let total: usize = sources.order.iter().map(|id| sources.replies(id).len()).sum();
        assert_eq!(total, MAX_COMMENTS - 1);
        assert_eq!(sources.replies("0").len(), MAX_COMMENTS - 1);
        assert!(
            start.elapsed() < std::time::Duration::from_secs(5),
            "took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn comments_past_the_cap_are_counted_not_read() {
        let (comments, extended) = reply_flood(MAX_COMMENTS + 3);
        let mut sources = Sources::default();
        sources.read_comments(&comments, Some(&extended));
        assert_eq!(sources.comments.len(), MAX_COMMENTS);
        assert_eq!(sources.dropped_comments, 3);
    }

    #[test]
    fn separators_are_not_notes() {
        let root = parse(
            r#"<w:footnotes><w:footnote w:type="separator" w:id="-1"/><w:footnote w:id="1"><w:p/></w:footnote>
                </w:footnotes>"#,
        );
        let notes = read_notes(&root, "w:footnote");
        assert_eq!(notes.len(), 1);
        assert!(notes.contains_key("1"));
    }
}
