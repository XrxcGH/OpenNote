//! Reading CSV files: comma, semicolon, or tab separated text with quoted fields.

use crate::text::Decoded;

/// A CSV file as rows of cells, cut to the [`Limits`] it was read with.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Csv {
    /// The rows that were kept, each with at most the column limit's cells. Rows are not padded: a short row
    /// stands for empty cells up to [`Csv::width`].
    pub rows: Vec<Vec<String>>,
    /// How many rows came after the row limit and were not kept.
    pub cut_rows: usize,
    /// How many cells lay beyond the column limit and were not kept.
    pub cut_cells: usize,
}

impl Csv {
    /// How many columns the widest kept row has.
    pub fn width(&self) -> usize {
        self.rows.iter().map(Vec::len).max().unwrap_or(0)
    }
}

/// How much of a file [`parse`] keeps. A CSV file is untrusted: one line of commas can name millions of columns, so
/// the limits apply while reading, before anything is sized by the file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// The most rows kept. Later rows are counted, not stored.
    pub rows: usize,
    /// The most cells kept in a row. Later cells are counted, not stored.
    pub columns: usize,
}

/// Reads CSV text. The separator is the one of comma, semicolon, and tab that the first line uses most. Fields
/// may be quoted with `"`, hold line breaks and separators, and write a quote as two. Rows with no cells are
/// dropped. At most `limits.rows` rows of at most `limits.columns` cells are kept, and the rest are counted.
pub fn parse(text: &str, limits: Limits) -> Csv {
    let mut csv = Csv::default();
    let mut reader = rows(text, limits.columns);
    for row in reader.by_ref() {
        if csv.rows.len() < limits.rows {
            csv.rows.push(row);
        } else {
            csv.cut_rows += 1;
        }
    }
    csv.cut_cells = reader.cut_cells;
    csv
}

/// The rows of CSV text one at a time, each with at most `columns` cells, for a caller that needs one row at a
/// time rather than the whole table. [`Rows::cut_cells`] counts the cells left out so far.
pub fn rows(text: &str, columns: usize) -> Rows<'_> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    Rows {
        separator: detect_separator(text),
        chars: text.chars().peekable(),
        columns,
        cut_cells: 0,
    }
}

/// An iterator over the rows of CSV text. See [`rows`].
pub struct Rows<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
    separator: char,
    columns: usize,
    /// How many cells beyond the column limit were left out so far.
    pub cut_cells: usize,
}

impl Rows<'_> {
    fn push(&mut self, row: &mut Vec<String>, field: &mut String) {
        let field = std::mem::take(field);
        if row.len() < self.columns {
            row.push(field);
        } else {
            self.cut_cells += 1;
        }
    }
}

impl Iterator for Rows<'_> {
    type Item = Vec<String>;

    fn next(&mut self) -> Option<Vec<String>> {
        let mut row: Vec<String> = Vec::new();
        let mut field = String::new();
        let (mut quoted, mut was_quoted) = (false, false);
        while let Some(c) = self.chars.next() {
            if quoted {
                match c {
                    '"' if self.chars.peek() == Some(&'"') => {
                        field.push('"');
                        self.chars.next();
                    }
                    '"' => quoted = false,
                    c => field.push(c),
                }
                continue;
            }
            match c {
                '"' if field.is_empty() => {
                    quoted = true;
                    was_quoted = true;
                }
                c if c == self.separator => {
                    self.push(&mut row, &mut field);
                    was_quoted = false;
                }
                '\r' => {}
                '\n' if row.is_empty() && field.is_empty() && !was_quoted => {}
                '\n' => {
                    self.push(&mut row, &mut field);
                    return Some(row);
                }
                c => field.push(c),
            }
        }
        if row.is_empty() && field.is_empty() && !was_quoted {
            return None;
        }
        self.push(&mut row, &mut field);
        Some(row)
    }
}

fn detect_separator(text: &str) -> char {
    let mut quoted = false;
    let mut counts = [0usize; 3];
    for c in text.chars() {
        match c {
            '"' => quoted = !quoted,
            '\n' if !quoted => break,
            ',' if !quoted => counts[0] += 1,
            ';' if !quoted => counts[1] += 1,
            '\t' if !quoted => counts[2] += 1,
            _ => {}
        }
    }
    let best = counts
        .iter()
        .enumerate()
        .max_by_key(|(i, n)| (**n, 3 - *i))
        .map_or(0, |(i, _)| i);
    if counts[best] == 0 {
        ','
    } else {
        [',', ';', '\t'][best]
    }
}

/// Decodes the bytes of a CSV file and reads it.
pub fn parse_bytes(bytes: &[u8], limits: Limits) -> (Csv, Decoded) {
    let decoded = crate::text::decode(bytes);
    (parse(&decoded.text, limits), decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: Limits = Limits {
        rows: usize::MAX,
        columns: usize::MAX,
    };

    fn parse(text: &str) -> Csv {
        super::parse(text, ALL)
    }

    #[test]
    fn quoted_fields_keep_separators_quotes_and_line_breaks() {
        let csv = parse("Name,Note\r\n\"Smith, Ann\",\"said \"\"hi\"\"\nthen left\"\r\nBob,\r\n");
        assert_eq!(
            csv.rows,
            vec![
                vec!["Name", "Note"],
                vec!["Smith, Ann", "said \"hi\"\nthen left"],
                vec!["Bob", ""],
            ]
        );
    }

    #[test]
    fn the_separator_follows_the_first_line() {
        assert_eq!(parse("a;b;c\n1;2;3").rows[1], vec!["1", "2", "3"]);
        assert_eq!(parse("a\tb\n1\t2").rows[1], vec!["1", "2"]);
        assert_eq!(parse("only one column\nsecond").width(), 1);
    }

    #[test]
    fn a_byte_order_mark_blank_lines_and_short_rows_are_handled() {
        let csv = parse("\u{feff}a,b,c\n\n1,2\n");
        assert_eq!(csv.rows, vec![vec!["a", "b", "c"], vec!["1", "2"]]);
        assert_eq!(csv.width(), 3);
    }

    #[test]
    fn an_empty_quoted_row_is_kept_but_blank_lines_are_not() {
        assert_eq!(parse("a,b\n\"\",\n").rows.len(), 2);
        assert!(parse("").rows.is_empty());
    }

    #[test]
    fn a_file_wider_and_longer_than_the_limits_is_cut_while_it_is_read() {
        // One line of 100,000 commas over 100,000 short lines: padding every row to the widest would make 10^10
        // cells. Only the limits' rows and cells are kept, and the rest are counted.
        let mut text = ",".repeat(100_000);
        text.push('\n');
        text.push_str(&"x\n".repeat(100_000));
        let csv = super::parse(
            &text,
            Limits {
                rows: 10_001,
                columns: 1_000,
            },
        );
        assert_eq!(csv.rows.len(), 10_001);
        assert_eq!(csv.cut_rows, 90_000);
        assert_eq!(csv.width(), 1_000);
        assert_eq!(csv.cut_cells, 100_001 - 1_000);
        assert!(csv.rows[1..].iter().all(|row| row.len() == 1));
    }

    #[test]
    fn rows_are_read_one_at_a_time() {
        let mut reader = rows("a,b,c\n\n1,2,3,4\n", 3);
        assert_eq!(
            reader.next(),
            Some(vec!["a".to_owned(), "b".to_owned(), "c".to_owned()])
        );
        assert_eq!(
            reader.next(),
            Some(vec!["1".to_owned(), "2".to_owned(), "3".to_owned()])
        );
        assert_eq!(reader.next(), None);
        assert_eq!(reader.cut_cells, 1);
    }
}
