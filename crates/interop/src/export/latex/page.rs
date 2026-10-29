//! The body of one page: its blocks in reading order, with pictures as figures and citations as `\cite`.

use opennote_core::model::{BlockData, Page};
use opennote_core::BlockId;
use serde_json::Value;

use super::escape::comment;
use super::inline::picture_path;
use super::writer::Writer;
use crate::doc::{Block, Inline};
use crate::export::convert::Converted;

const CITATION: &str = "ext:org.opennote/citation";
const BIBLIOGRAPHY: &str = "ext:org.opennote/bibliography";

/// The destination and description of a block that is only one picture.
fn lone_picture(block: &Block) -> Option<(&str, &str)> {
    match block {
        Block::Paragraph(content) => match content.as_slice() {
            [Inline::Image { dest, alt }] if picture_path(dest) => Some((dest, alt)),
            _ => None,
        },
        _ => None,
    }
}

impl Writer<'_> {
    /// The LaTeX of a converted page.
    pub(super) fn page_body(&mut self, page: &Page, converted: &Converted) -> String {
        self.notes = converted.notes.clone();
        let mut parts: Vec<String> = Vec::new();
        let mut start = 0;
        while start < converted.blocks.len() {
            let origin = converted.origins[start];
            let mut end = start + 1;
            while end < converted.blocks.len() && converted.origins[end] == origin {
                end += 1;
            }
            if let Some(live) = self.live(page, origin) {
                parts.push(live);
            } else {
                for block in &converted.blocks[start..end] {
                    parts.push(self.top_block(page, origin, block));
                }
            }
            start = end;
        }
        self.notes.clear();
        parts.retain(|part| !part.trim().is_empty());
        parts.join("\n\n")
    }

    fn top_block(&mut self, page: &Page, origin: BlockId, block: &Block) -> String {
        let Some((dest, alt)) = lone_picture(block) else {
            return self.block(block, 0);
        };
        let (caption, alt) = match page.blocks.get(origin).map(|b| &b.data) {
            Some(BlockData::Image(image)) => {
                if image.crop.is_some() {
                    self.stats.cropped_images += 1;
                }
                let shown = !image.decorative && !image.alt.is_empty();
                (shown.then(|| image.alt.clone()), image.alt.clone())
            }
            Some(BlockData::Ink(_)) => (None, alt.to_owned()),
            _ => ((!alt.is_empty()).then(|| alt.to_owned()), alt.to_owned()),
        };
        self.figure(dest, caption.as_deref(), &alt)
    }

    /// A picture on a line of its own, with a caption when it has a description.
    fn figure(&mut self, dest: &str, caption: Option<&str>, alt: &str) -> String {
        let mut out = String::from("\\begin{center}\n");
        if !alt.is_empty() {
            out.push_str(&format!("% alt: {}\n", comment(alt)));
        }
        out.push_str(&format!("\\includegraphics{{{dest}}}\n"));
        if let Some(caption) = caption {
            let was = std::mem::replace(&mut self.allow_notes, false);
            let text = self.esc(caption);
            self.allow_notes = was;
            out.push_str(&format!("\\captionof{{figure}}{{{text}}}\n"));
        }
        out.push_str("\\end{center}");
        out
    }

    /// A citation or a bibliography block, written from the citation library. `None` when the block is not one, or
    /// when the library does not have what it names; the words saved with the block are written then.
    fn live(&mut self, page: &Page, origin: BlockId) -> Option<String> {
        let BlockData::Other(other) = &page.blocks.get(origin)?.data else {
            return None;
        };
        match &*other.type_name {
            CITATION => {
                let entry = self.library.find(other.data.get("source")?.as_str()?)?;
                let key = entry.key.clone();
                self.stats.citations += 1;
                if !self.cited.contains(&key) {
                    self.cited.push(key.clone());
                }
                Some(format!("\\cite{{{key}}}"))
            }
            BIBLIOGRAPHY => {
                let wanted: Option<Vec<&str>> = match other.data.get("sources") {
                    Some(Value::Array(list)) => Some(list.iter().filter_map(Value::as_str).collect()),
                    _ => None,
                };
                let notebook = other.data.get("notebook").and_then(Value::as_str);
                let keys: Vec<String> = self
                    .library
                    .entries
                    .iter()
                    .filter(|entry| match &wanted {
                        Some(ids) => ids.contains(&entry.id.as_str()),
                        None => notebook.is_none_or(|n| entry.notebook == n),
                    })
                    .map(|entry| entry.key.clone())
                    .collect();
                if keys.is_empty() {
                    return None;
                }
                if self.bibliography {
                    self.stats.extra_bibliographies += 1;
                    return Some(String::new());
                }
                self.bibliography = true;
                for key in &keys {
                    if !self.listed.contains(key) {
                        self.listed.push(key.clone());
                    }
                }
                Some(bibliography_commands(&keys))
            }
            _ => None,
        }
    }
}

/// The commands that print the bibliography, listing these keys even when nothing cites them.
pub(super) fn bibliography_commands(keys: &[String]) -> String {
    let mut out = String::new();
    if !keys.is_empty() {
        out.push_str(&format!("\\nocite{{{}}}\n", keys.join(",")));
    }
    out.push_str("\\bibliographystyle{plain}\n\\bibliography{references}");
    out
}
