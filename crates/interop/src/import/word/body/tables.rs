//! Tables of the body: their cells as text with line breaks, held to the table's grid.

use super::{Item, Kind, Reader};
use crate::doc::{Block, Inline};
use crate::import::sheet::MAX_TABLE_CELLS;
use crate::import::word::styles::{child, children, val};
use crate::import::xmltree::Element;

/// The most grid columns one table cell may span when the table names no grid. Word itself makes tables of at most
/// 63 columns.
const MAX_SPAN: usize = 64;

impl Reader<'_> {
    pub(super) fn table(&mut self, tbl: &Element) -> Option<Block> {
        let mut rows: Vec<Vec<Vec<Inline>>> = Vec::new();
        let mut header = false;
        let saved = (self.table_run.clone(), self.base.clone(), self.para_run.clone());
        self.table_run = child(tbl, "w:tblpr")
            .and_then(|p| val(p, "w:tblstyle"))
            .map(|id| self.styles.run_chain(id))
            .unwrap_or_default();
        self.in_table += 1;
        // A span comes from the file and can say anything, up to billions of columns. It is held to the table's
        // grid, and the empty cells it adds to the table's cell budget, so a span never sizes an allocation.
        let grid = child(tbl, "w:tblgrid").map_or(0, |g| children(g, "w:gridcol").count());
        let widest = if grid == 0 { MAX_SPAN } else { grid.min(MAX_SPAN) };
        let mut budget = MAX_TABLE_CELLS;
        for (index, tr) in children(tbl, "w:tr").enumerate() {
            let is_header = child(tr, "w:trpr").is_some_and(|p| child(p, "w:tblheader").is_some());
            header |= is_header && index == 0;
            let mut cells = Vec::new();
            for tc in children(tr, "w:tc") {
                let props = child(tc, "w:tcpr");
                let span: usize = props
                    .and_then(|p| val(p, "w:gridspan"))
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(1)
                    .clamp(1, widest);
                let continues = props
                    .and_then(|p| child(p, "w:vmerge"))
                    .is_some_and(|m| m.attr("w:val") != Some("restart"));
                self.stats.merged_cells += usize::from(span > 1 || continues);
                cells.push(if continues { Vec::new() } else { self.cell(tc) });
                let padding = (span - 1).min(budget);
                budget = budget.saturating_sub(padding + 1);
                cells.extend(std::iter::repeat_with(Vec::new).take(padding));
            }
            if !cells.is_empty() {
                rows.push(cells);
            }
        }
        self.in_table -= 1;
        (self.table_run, self.base, self.para_run) = saved;
        if rows.is_empty() {
            return None;
        }
        let look_first_row = child(tbl, "w:tblpr")
            .and_then(|p| child(p, "w:tbllook"))
            .and_then(|l| l.attr("w:firstrow"))
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
        let header = header || look_first_row;
        if header {
            // Header cells are shown in bold anyway, so bold text in them says nothing.
            for cell in rows.first_mut().into_iter().flatten() {
                for inline in cell {
                    if let Inline::Text { marks, .. } = inline {
                        marks.strong = false;
                    }
                }
            }
        }
        Some(Block::table(header, rows))
    }

    /// The text of a table cell: its paragraphs, joined by line breaks.
    pub(super) fn cell(&mut self, tc: &Element) -> Vec<Inline> {
        let mut inner = Vec::new();
        self.block_content(tc, &mut inner);
        let mut inlines: Vec<Inline> = Vec::new();
        for item in inner {
            let (content, prefix) = match item {
                Item::Para(para) => {
                    let bullet = matches!(para.kind, Kind::ListItem { .. });
                    (para.inlines, bullet)
                }
                Item::Table(Block::Table { rows, .. }) => {
                    self.stats.nested_tables += 1;
                    let mut flat = Vec::new();
                    for (n, cell) in rows.into_iter().flatten().enumerate() {
                        if n > 0 {
                            flat.push(Inline::text(" | "));
                        }
                        flat.extend(cell);
                    }
                    (flat, false)
                }
                _ => continue,
            };
            if content.is_empty() {
                continue;
            }
            if !inlines.is_empty() {
                inlines.push(Inline::HardBreak);
            }
            if prefix {
                inlines.push(Inline::text("\u{2022} "));
            }
            inlines.extend(content);
        }
        inlines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::word::body::Item;
    use crate::import::word::numbering::Numbering;
    use crate::import::word::styles::Styles;
    use crate::import::xmltree;
    use std::collections::HashMap;

    fn table_of(xml: &str) -> Vec<Vec<Vec<Inline>>> {
        let root = xmltree::parse(xml);
        let (rels, styles, numbering) = (HashMap::new(), Styles::default(), Numbering::default());
        let mut reader = Reader::new(&rels, &styles, &numbering);
        let items = reader.document(&root);
        match items.into_iter().next() {
            Some(Item::Table(Block::Table { rows, .. })) => rows,
            other => panic!("a table, not {other:?}"),
        }
    }

    #[test]
    fn a_huge_grid_span_is_held_to_the_table_grid() {
        // A span of four billion columns would take about 96 GB of empty cells.
        let rows = table_of(
            r#"<w:document><w:body><w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>
            <w:tr><w:tc><w:tcPr><w:gridSpan w:val="4000000000"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p></w:tc>
            </w:tr>
            <w:tr><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr>
            </w:tbl></w:body></w:document>"#,
        );
        assert_eq!(rows[0].len(), 3);
        assert_eq!(rows[1].len(), 3);
    }

    #[test]
    fn a_huge_grid_span_without_a_grid_is_held_to_the_widest_word_table() {
        let rows = table_of(
            r#"<w:document><w:body><w:tbl>
            <w:tr><w:tc><w:tcPr><w:gridSpan w:val="18446744073709551615"/></w:tcPr><w:p/></w:tc></w:tr>
            </w:tbl></w:body></w:document>"#,
        );
        assert_eq!(rows[0].len(), MAX_SPAN);
    }
}
