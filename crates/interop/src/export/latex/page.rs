//! The body of one page: its blocks in reading order, with pictures as figures and citations as `\cite`.

use opennote_core::model::{BlockData, Crop, Page};
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

/// The picture with the crop the person made, or `None` when the crop shows all of it or is not a rectangle inside the
/// picture. `adjustbox` applies the crop as fractions of the picture, so it holds at any resolution. The file in
/// `images/` stays whole, so a reader who wants the rest of the picture finds it there.
fn cropped(dest: &str, crop: &Crop) -> Option<String> {
    let (x, y, w, h) = (crop.x, crop.y, crop.w, crop.h);
    if ![x, y, w, h].iter().all(|v| v.is_finite()) || x < 0.0 || y < 0.0 || w <= 0.0 || h <= 0.0 {
        return None;
    }
    let (right, bottom) = ((1.0 - x - w).max(0.0), (1.0 - y - h).max(0.0));
    if x + y + right + bottom < 0.0001 {
        return None;
    }
    let range = |from: f64, to: f64| format!("{:.0}% to {:.0}%", from * 100.0, (to * 100.0).min(100.0));
    let (across, down) = (range(x, x + w), range(y, y + h));
    Some(format!(
        "% cropped in OpenNote: the part from {across} across and {down} down; images/ holds the whole picture\n\
         \\adjustbox{{trim={{{x:.4}\\width {bottom:.4}\\height {right:.4}\\width {y:.4}\\height}},clip,\
         max size={{\\linewidth}}{{0.55\\textheight}}}}{{\\includegraphics[width=!,height=!]{{{dest}}}}}\n"
    ))
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
        let (caption, alt, crop) = match page.blocks.get(origin).map(|b| &b.data) {
            Some(BlockData::Image(image)) => {
                let shown = !image.decorative && !image.alt.is_empty();
                (shown.then(|| image.alt.clone()), image.alt.clone(), image.crop.as_ref())
            }
            Some(BlockData::Ink(_)) => (None, alt.to_owned(), None),
            _ => ((!alt.is_empty()).then(|| alt.to_owned()), alt.to_owned(), None),
        };
        self.figure(dest, caption.as_deref(), &alt, crop)
    }

    /// A picture on a line of its own, with a caption when it has a description.
    fn figure(&mut self, dest: &str, caption: Option<&str>, alt: &str, crop: Option<&Crop>) -> String {
        let mut out = String::from("\\begin{center}\n");
        if !alt.is_empty() {
            out.push_str(&format!("% alt: {}\n", comment(alt)));
        }
        match crop.and_then(|crop| cropped(dest, crop)) {
            Some(cropped) => out.push_str(&cropped),
            None => out.push_str(&format!("\\includegraphics{{{dest}}}\n")),
        }
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

#[cfg(test)]
mod tests {
    use opennote_core::model::{Crop, JsonMap};

    use super::cropped;

    fn crop(x: f64, y: f64, w: f64, h: f64) -> Crop {
        Crop {
            x,
            y,
            w,
            h,
            extra: JsonMap::new(),
        }
    }

    #[test]
    fn a_crop_is_written_as_the_fractions_trimmed_from_each_side() {
        // 10% from the left and 20% from the top, half as wide and 30% as tall: 40% is left on the right, 50% below.
        let tex = cropped("images/a.png", &crop(0.1, 0.2, 0.5, 0.3)).expect("a crop");
        assert!(
            tex.contains(r"trim={0.1000\width 0.5000\height 0.4000\width 0.2000\height},clip"),
            "{tex}"
        );
        assert!(tex.starts_with("% cropped in OpenNote: the part from 10% to 60% across and 20% to 50% down"));
        assert!(tex.ends_with("{\\includegraphics[width=!,height=!]{images/a.png}}\n"));
    }

    #[test]
    fn a_crop_that_shows_everything_or_is_not_a_rectangle_is_not_written() {
        assert_eq!(cropped("images/a.png", &crop(0.0, 0.0, 1.0, 1.0)), None);
        assert_eq!(cropped("images/a.png", &crop(0.2, 0.0, 0.0, 1.0)), None);
        assert_eq!(cropped("images/a.png", &crop(-0.1, 0.0, 0.5, 0.5)), None);
        assert_eq!(cropped("images/a.png", &crop(f64::NAN, 0.0, 0.5, 0.5)), None);
    }

    #[test]
    fn a_crop_that_runs_past_the_edge_trims_nothing_negative() {
        let tex = cropped("images/a.png", &crop(0.5, 0.0, 0.8, 1.0)).expect("a crop");
        assert!(
            tex.contains(r"trim={0.5000\width 0.0000\height 0.0000\width 0.0000\height}"),
            "{tex}"
        );
    }
}
