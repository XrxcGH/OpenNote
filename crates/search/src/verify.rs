//! Checking that the index agrees with itself.
//!
//! [`SearchIndex::check`] looks for every way the tables can disagree. A page may lack its full-text row, or a
//! full-text row may lack its page. A block, link, tag, or heading may outlive its page. A title may not
//! be the folded form of the stored one. Blocks may not be numbered in a row. A link or heading may point at a
//! block the page does not have.
//!
//! A healthy index has none of these. The property tests run the check after every random edit. The app can
//! run it from "Check notebook" to decide whether to rebuild.
//!
//! The checks that need only SQL run as counting queries. They are fast enough for an index of tens of
//! thousands of pages.

use opennote_core::{NotebookId, PageId, SectionId};

use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::tags;
use crate::text::fold;
use crate::write::MAX_ALIASES;

/// What a check found.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CheckReport {
    /// One line for each kind of disagreement, with how many rows it affects. Empty for a healthy index.
    pub problems: Vec<String>,
}

impl CheckReport {
    /// Whether the index agrees with itself.
    pub fn is_ok(&self) -> bool {
        self.problems.is_empty()
    }

    fn note(&mut self, count: impl TryInto<i64>, what: &str) {
        let count = count.try_into().unwrap_or(i64::MAX);
        if count > 0 {
            self.problems.push(format!("{count} {what}"));
        }
    }
}

/// The tables that hold rows of a page, which must not outlive it. Aliases may: they are kept by page ID while
/// the page's notebook is closed.
const CHILD_TABLES: [&str; 4] = ["tags", "blocks", "headings", "links"];

/// The other counting checks: each query counts the rows that break one rule.
const RULES: [(&str, &str); 9] = [
    (
        "pages without a full-text row",
        "SELECT COUNT(*) FROM pages p
         WHERE NOT EXISTS (SELECT 1 FROM page_fts_docsize d WHERE d.id = p.rid)",
    ),
    (
        "full-text rows without a page",
        "SELECT COUNT(*) FROM page_fts_docsize d
         WHERE NOT EXISTS (SELECT 1 FROM pages p WHERE p.rid = d.id)",
    ),
    (
        "pages whose blocks are not numbered in a row",
        "SELECT COUNT(*) FROM (SELECT 1 FROM blocks GROUP BY page
         HAVING MIN(ord) != 0 OR MAX(ord) != COUNT(*) - 1)",
    ),
    (
        "headings whose block is not on the page",
        "SELECT COUNT(*) FROM headings h
         WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.page = h.page AND b.id = h.block)",
    ),
    (
        "links whose block is not on the page",
        "SELECT COUNT(*) FROM links l
         WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.page = l.page AND b.id = l.block)",
    ),
    (
        "title links without a title, or ID links without a target",
        "SELECT COUNT(*) FROM links
         WHERE (kind = 'title' AND (title_norm IS NULL OR title_norm = ''))
            OR (kind = 'id' AND target IS NULL) OR kind NOT IN ('title', 'id')",
    ),
    (
        "aliases that are empty or equal to the page's own title",
        "SELECT COUNT(*) FROM aliases a JOIN pages p ON p.id = a.page
         WHERE a.title_norm = '' OR a.title_norm = p.title_norm",
    ),
    (
        "pages with more aliases than the limit",
        "SELECT COUNT(*) FROM (SELECT 1 FROM aliases GROUP BY page HAVING COUNT(*) > ?1)",
    ),
    (
        "two pages with the same ID",
        "SELECT COUNT(*) FROM (SELECT 1 FROM pages GROUP BY id HAVING COUNT(*) > 1)",
    ),
];

impl SearchIndex {
    /// Checks the index against its own rules. A report with problems means the index should be rebuilt.
    pub fn check(&self) -> Result<CheckReport> {
        let mut report = CheckReport::default();
        if !self.is_healthy() {
            report.problems.push("SQLite's quick check failed".to_string());
        }
        for table in CHILD_TABLES {
            let sql =
                format!("SELECT COUNT(*) FROM {table} c WHERE NOT EXISTS (SELECT 1 FROM pages p WHERE p.rid = c.page)");
            let count: i64 = self.conn.query_row(&sql, [], |row| row.get(0))?;
            report.note(count, &format!("{table} without a page"));
        }
        for (name, sql) in RULES {
            let count: i64 = if sql.contains("?1") {
                self.conn.query_row(sql, [MAX_ALIASES as i64], |row| row.get(0))?
            } else {
                self.conn.query_row(sql, [], |row| row.get(0))?
            };
            report.note(count, name);
        }
        self.check_pages(&mut report)?;
        self.check_tags(&mut report)?;
        self.check_headings(&mut report)?;
        Ok(report)
    }

    /// Titles are stored folded for matching, and IDs must read back.
    fn check_pages(&self, report: &mut CheckReport) -> Result<()> {
        let mut statement = self
            .conn
            .prepare("SELECT id, notebook, section, title, title_norm FROM pages")?;
        let rows = statement.query_map([], |row| {
            let text = |n: usize| row.get::<_, String>(n);
            Ok((text(0)?, text(1)?, text(2)?, text(3)?, text(4)?))
        })?;
        let (mut bad_titles, mut bad_ids) = (0, 0);
        for row in rows {
            let (id, notebook, section, title, norm) = row?;
            bad_titles += usize::from(fold(&title) != norm);
            let readable = parse_id::<PageId>(&id).is_ok()
                && parse_id::<NotebookId>(&notebook).is_ok()
                && parse_id::<SectionId>(&section).is_ok();
            bad_ids += usize::from(!readable);
        }
        report.note(bad_titles, "pages whose folded title is not the fold of the title");
        report.note(bad_ids, "pages with an ID that does not parse");
        Ok(())
    }

    /// Tags are stored in normal form.
    fn check_tags(&self, report: &mut CheckReport) -> Result<()> {
        let mut statement = self.conn.prepare("SELECT tag FROM tags")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut bad = 0;
        for tag in rows {
            let tag = tag?;
            bad += usize::from(tags::normalize(&tag).as_deref() != Some(tag.as_str()));
        }
        report.note(bad, "tags that are not in normal form");
        Ok(())
    }

    /// Headings are stored with their folded text for matching.
    fn check_headings(&self, report: &mut CheckReport) -> Result<()> {
        let mut statement = self.conn.prepare("SELECT text, norm FROM headings")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut bad = 0;
        for row in rows {
            let (text, norm) = row?;
            bad += usize::from(fold(&text) != norm);
        }
        report.note(bad, "headings whose folded text is wrong");
        Ok(())
    }
}
