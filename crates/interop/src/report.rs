//! Import and export reports: what came over, what was simplified, and what was skipped and why.
//!
//! FEATURES.md asks for one report for each page, so nothing disappears without a word. The interface shows a
//! report as data, and [`Report::to_markdown`] makes a readable copy for a page or a file.

use serde::Serialize;

/// What happened to a part of the source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// It came over as it was.
    CameOver,
    /// It came over in a simpler form.
    Simplified,
    /// It did not come over.
    Skipped,
}

/// One line of a report.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Entry {
    /// What happened.
    pub outcome: Outcome,
    /// The part of the source, such as `3 images`.
    pub what: String,
    /// Why it was simplified or skipped.
    pub why: Option<String>,
}

/// The entries of one page, or of the source as a whole when `title` is empty.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct PageReport {
    /// The page's title.
    pub title: String,
    /// Where the page came from, such as a file path.
    pub source: String,
    /// What happened to its parts.
    pub entries: Vec<Entry>,
}

impl PageReport {
    /// Notes a part that came over as it was.
    pub fn came_over(&mut self, what: impl Into<String>) {
        self.push(Outcome::CameOver, what.into(), None);
    }

    /// Notes a part that came over in a simpler form.
    pub fn simplified(&mut self, what: impl Into<String>, why: impl Into<String>) {
        self.push(Outcome::Simplified, what.into(), Some(why.into()));
    }

    /// Notes a part that did not come over.
    pub fn skipped(&mut self, what: impl Into<String>, why: impl Into<String>) {
        self.push(Outcome::Skipped, what.into(), Some(why.into()));
    }

    /// Notes a count of things, if there are any: `came_over_count(3, "image", "images")` says `3 images`.
    pub fn came_over_count(&mut self, count: usize, one: &str, many: &str) {
        if count > 0 {
            self.came_over(counted(count, one, many));
        }
    }

    /// Notes a count of simplified things, if there are any.
    pub fn simplified_count(&mut self, count: usize, (one, many): (&str, &str), why: &str) {
        if count > 0 {
            self.simplified(counted(count, one, many), why);
        }
    }

    /// Notes a count of skipped things, if there are any.
    pub fn skipped_count(&mut self, count: usize, (one, many): (&str, &str), why: &str) {
        if count > 0 {
            self.skipped(counted(count, one, many), why);
        }
    }

    fn push(&mut self, outcome: Outcome, what: String, why: Option<String>) {
        self.entries.push(Entry { outcome, what, why });
    }

    /// Whether anything was simplified or skipped.
    pub fn has_losses(&self) -> bool {
        self.entries.iter().any(|e| e.outcome != Outcome::CameOver)
    }
}

/// `1 image` or `3 images`.
pub fn counted(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

/// Entries of a report that share an outcome and a reason.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LossGroup {
    /// Simplified or skipped.
    pub outcome: Outcome,
    /// Why, in the words the report uses.
    pub why: String,
    /// A few of the parts affected, such as `3 images`.
    pub examples: Vec<String>,
    /// How many pages the group touched. Entries about the whole source count none.
    pub pages: usize,
}

/// Whether the report describes an import or an export.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReportKind {
    /// Something came into OpenNote.
    Import,
    /// Something went out of OpenNote.
    Export,
}

/// The report of one import or export.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Report {
    /// Import or export.
    pub kind: ReportKind,
    /// What was imported or exported, such as `Obsidian vault "Biology"`.
    pub source: String,
    /// Entries about the whole source, such as files that were not notes.
    pub general: PageReport,
    /// One report for each page.
    pub pages: Vec<PageReport>,
}

impl Report {
    /// An empty report.
    pub fn new(kind: ReportKind, source: impl Into<String>) -> Report {
        Report {
            kind,
            source: source.into(),
            general: PageReport::default(),
            pages: Vec::new(),
        }
    }

    /// Starts the report of a page and returns it, to fill in.
    pub fn page(&mut self, title: impl Into<String>, source: impl Into<String>) -> &mut PageReport {
        self.pages.push(PageReport {
            title: title.into(),
            source: source.into(),
            entries: Vec::new(),
        });
        let last = self.pages.len() - 1;
        &mut self.pages[last]
    }

    /// Adds a finished page report.
    pub fn add_page(&mut self, page: PageReport) {
        self.pages.push(page);
    }

    /// How many pages lost something, and how many entries were skipped.
    pub fn loss_counts(&self) -> (usize, usize) {
        let pages = self.pages.iter().filter(|p| p.has_losses()).count();
        let skipped = self
            .pages
            .iter()
            .chain(std::iter::once(&self.general))
            .flat_map(|p| &p.entries)
            .filter(|e| e.outcome == Outcome::Skipped)
            .count();
        (pages, skipped)
    }

    /// What was simplified or skipped, grouped by the reason, with the worst first. A group counts the pages it
    /// touched and shows a few examples, so a report of thousands of pages stays readable.
    pub fn loss_groups(&self) -> Vec<LossGroup> {
        let mut groups: Vec<LossGroup> = Vec::new();
        let pages = self
            .pages
            .iter()
            .map(|p| (true, p))
            .chain(std::iter::once((false, &self.general)));
        for (is_page, page) in pages {
            let mut seen_here: Vec<usize> = Vec::new();
            for entry in page.entries.iter().filter(|e| e.outcome != Outcome::CameOver) {
                let why = entry.why.clone().unwrap_or_default();
                let index = match groups.iter().position(|g| g.outcome == entry.outcome && g.why == why) {
                    Some(index) => index,
                    None => {
                        groups.push(LossGroup {
                            outcome: entry.outcome,
                            why,
                            examples: Vec::new(),
                            pages: 0,
                        });
                        groups.len() - 1
                    }
                };
                let group = &mut groups[index];
                if is_page && !seen_here.contains(&index) {
                    group.pages += 1;
                    seen_here.push(index);
                }
                if group.examples.len() < 3 && !group.examples.contains(&entry.what) {
                    group.examples.push(entry.what.clone());
                }
            }
        }
        groups.sort_by(|a, b| {
            let rank = |o: Outcome| u8::from(o != Outcome::Skipped);
            rank(a.outcome).cmp(&rank(b.outcome)).then(b.pages.cmp(&a.pages))
        });
        groups
    }

    /// A short Markdown summary: the counts, then what was lost grouped by reason, then at most `limit` pages
    /// that lost something. The full report is [`Report::to_markdown`].
    pub fn summary_markdown(&self, limit: usize) -> String {
        let verb = match self.kind {
            ReportKind::Import => "Import",
            ReportKind::Export => "Export",
        };
        let (changed, skipped) = self.loss_counts();
        let mut out = format!("# {verb} report\n\n{}\n\n", self.source);
        out.push_str(&format!(
            "{}. {} changed in some way, and {} skipped.\n",
            counted(self.pages.len(), "page", "pages"),
            counted(changed, "page was", "pages were"),
            counted(skipped, "part was", "parts were"),
        ));
        let groups = self.loss_groups();
        if !groups.is_empty() {
            out.push_str("\n## What changed\n\n");
        }
        for group in &groups {
            let label = if group.outcome == Outcome::Skipped {
                "Skipped"
            } else {
                "Simplified"
            };
            let reach = if group.pages > 0 {
                format!(" On {}.", counted(group.pages, "page", "pages"))
            } else {
                String::new()
            };
            out.push_str(&format!(
                "- {label}: {}. {}{reach}\n",
                group.examples.join("; "),
                group.why
            ));
        }
        let lossy: Vec<&PageReport> = self.pages.iter().filter(|p| p.has_losses()).collect();
        if !lossy.is_empty() {
            out.push_str("\n## Pages that changed\n\n");
        }
        for page in lossy.iter().take(limit) {
            let title = if page.title.is_empty() { "Untitled" } else { &page.title };
            out.push_str(&format!("- {title}\n"));
        }
        if lossy.len() > limit {
            out.push_str(&format!("- And {} more.\n", lossy.len() - limit));
        }
        out
    }

    /// A readable copy of the report, in Markdown.
    pub fn to_markdown(&self) -> String {
        let verb = match self.kind {
            ReportKind::Import => "Import",
            ReportKind::Export => "Export",
        };
        let (changed, skipped) = self.loss_counts();
        let mut out = format!("# {verb} report: {}\n\n", self.source);
        out.push_str(&format!(
            "{}. {} changed in some way, and {} skipped.\n",
            counted(self.pages.len(), "page", "pages"),
            counted(changed, "page was", "pages were"),
            counted(skipped, "part was", "parts were"),
        ));
        write_entries(&mut out, &self.general);
        for page in &self.pages {
            let title = if page.title.is_empty() { "Untitled" } else { &page.title };
            out.push_str(&format!("\n## {title}\n"));
            if !page.source.is_empty() {
                out.push_str(&format!("\nFrom {}.\n", page.source));
            }
            write_entries(&mut out, page);
        }
        out
    }
}

fn write_entries(out: &mut String, page: &PageReport) {
    if page.entries.is_empty() {
        return;
    }
    out.push('\n');
    for entry in &page.entries {
        let label = match entry.outcome {
            Outcome::CameOver => "Came over",
            Outcome::Simplified => "Simplified",
            Outcome::Skipped => "Skipped",
        };
        match &entry.why {
            Some(why) => out.push_str(&format!("- {label}: {}. {why}\n", entry.what)),
            None => out.push_str(&format!("- {label}: {}\n", entry.what)),
        }
    }
}
