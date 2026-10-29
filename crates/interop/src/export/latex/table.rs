//! Tables as LaTeX in the booktabs style: `tabular` when the cells are short, `tabularx` when they are not, and
//! `longtable` when the table is long enough to cross a page.

use super::writer::{Writer, MAX_COLUMNS};
use crate::doc::Inline;

/// Rows after which a table is a `longtable`, so it can break across pages.
const LONG_AFTER: usize = 28;
/// The most characters of a cell for which a plain `tabular` is used.
const SHORT_CELL: usize = 28;

impl Writer<'_> {
    pub(super) fn table(&mut self, header: bool, rows: &[Vec<Vec<Inline>>]) -> String {
        let widest = rows.iter().map(Vec::len).max().unwrap_or(0);
        let columns = widest.min(MAX_COLUMNS);
        if columns == 0 || rows.is_empty() {
            return String::new();
        }
        if widest > MAX_COLUMNS {
            self.stats.wide_tables += 1;
        }
        let short = columns <= 4
            && rows.len() <= LONG_AFTER
            && rows.iter().flatten().all(|cell| {
                !cell.iter().any(|i| matches!(i, Inline::HardBreak))
                    && crate::doc::plain_text(cell).chars().count() <= SHORT_CELL
            });
        let was = std::mem::replace(&mut self.allow_notes, false);
        let lines: Vec<String> = rows
            .iter()
            .enumerate()
            .map(|(index, row)| self.row(row, columns, header && index == 0))
            .collect();
        self.allow_notes = was;
        let size = match columns {
            0..=6 => "\\small",
            7..=9 => "\\footnotesize",
            _ => "\\scriptsize",
        };
        let head = if header { 1 } else { 0 };
        let rule = |top: &str| format!("\\{top}rule");
        let mut out = String::new();
        let long = !short && rows.len() > LONG_AFTER;
        let (open, close) = if long {
            let width = format!(
                "P{{\\dimexpr(\\linewidth-{}\\tabcolsep)/{columns}\\relax}}",
                columns * 2
            );
            (
                format!("\\begin{{longtable}}{{{}}}", width.repeat(columns)),
                "\\end{longtable}",
            )
        } else if short {
            (
                format!("\\begin{{tabular}}{{{}}}", "l".repeat(columns)),
                "\\end{tabular}",
            )
        } else {
            (
                format!(
                    "\\noindent\\begin{{tabularx}}{{\\linewidth}}{{{}}}",
                    "Y".repeat(columns)
                ),
                "\\end{tabularx}",
            )
        };
        out.push_str(&format!(
            "{{{size}\\renewcommand{{\\arraystretch}}{{1.2}}\n{open}\n{}\n",
            rule("top")
        ));
        if header {
            out.push_str(&format!("{}\n{}\n", lines[0], rule("mid")));
            if long {
                out.push_str(&format!(
                    "\\endfirsthead\n{}\n{}\n{}\n\\endhead\n",
                    rule("top"),
                    lines[0],
                    rule("mid")
                ));
            }
        }
        out.push_str(&lines[head..].join("\n"));
        out.push_str(&format!("\n{}\n{close}}}", rule("bottom")));
        if short {
            format!("\\begin{{center}}\n{out}\n\\end{{center}}")
        } else {
            out
        }
    }

    /// One row: the cells joined by tabs, padded to the width, and ended. The first cell starts with `\relax`, so a
    /// cell that begins with a bracket is not read as the option of the break before it.
    fn row(&mut self, row: &[Vec<Inline>], columns: usize, bold: bool) -> String {
        let mut cells: Vec<String> = Vec::with_capacity(columns);
        for index in 0..columns {
            let text = row.get(index).map_or_else(String::new, |cell| self.inlines(cell));
            cells.push(if bold && !text.is_empty() {
                format!("\\textbf{{{text}}}")
            } else {
                text
            });
        }
        format!("\\relax {} \\\\", cells.join(" & "))
    }
}

#[cfg(test)]
mod tests {
    use super::super::writer::Library;
    use super::super::Engine;
    use super::*;

    fn cells(texts: &[&str]) -> Vec<Vec<Inline>> {
        texts.iter().map(|t| vec![Inline::text(*t)]).collect()
    }

    fn render(header: bool, rows: &[Vec<Vec<Inline>>]) -> String {
        let library = Library::new(Vec::new());
        Writer::new(Engine::Unicode, &library, 1).table(header, rows)
    }

    #[test]
    fn a_small_table_is_a_booktabs_tabular_with_a_bold_header() {
        let out = render(true, &[cells(&["Stage", "Where"]), cells(&["Light & dark", "[x]"])]);
        assert_eq!(
            out,
            "\\begin{center}\n{\\small\\renewcommand{\\arraystretch}{1.2}\n\\begin{tabular}{ll}\n\\toprule\n\
             \\relax \\textbf{Stage} & \\textbf{Where} \\\\\n\\midrule\n\\relax Light \\& dark & [x] \\\\\n\
             \\bottomrule\n\\end{tabular}}\n\\end{center}"
        );
    }

    #[test]
    fn long_cells_use_tabularx_and_many_rows_use_longtable() {
        let long = "a considerably longer cell that does not fit a plain column";
        let out = render(false, &[cells(&[long, "b"])]);
        assert!(
            out.contains("\\begin{tabularx}{\\linewidth}{YY}") && !out.contains("\\midrule"),
            "{out}"
        );
        let rows: Vec<_> = (0..40).map(|_| cells(&["a", "b", "c"])).collect();
        let out = render(true, &rows);
        assert!(
            out.contains("\\begin{longtable}{P{\\dimexpr(\\linewidth-6\\tabcolsep)/3\\relax}"),
            "{out}"
        );
        assert_eq!(out.matches("\\endhead").count(), 1);
        assert!(out.contains("\\endfirsthead"));
    }

    #[test]
    fn ragged_and_empty_tables_are_safe() {
        let out = render(false, &[cells(&["a", "b", "c"]), cells(&["d"])]);
        assert!(out.contains("\\relax d &  &  \\\\"), "{out}");
        assert_eq!(render(true, &[]), "");
        assert_eq!(render(true, &[Vec::new()]), "");
        let wide: Vec<Vec<Vec<Inline>>> = vec![(0..80).map(|_| vec![Inline::text("x")]).collect()];
        assert_eq!(render(false, &wide).matches(" & ").count(), 59);
    }
}
