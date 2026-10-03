//! Reading CSV files: comma, semicolon, or tab separated text with quoted fields.

use crate::text::Decoded;

/// A CSV file as rows of cells.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Csv {
    /// The rows, each as wide as the widest row.
    pub rows: Vec<Vec<String>>,
}

impl Csv {
    /// How many columns the file has.
    pub fn width(&self) -> usize {
        self.rows.first().map_or(0, Vec::len)
    }
}

/// Reads CSV text. The separator is the one of comma, semicolon, and tab that the first line uses most. Fields
/// may be quoted with `"`, hold line breaks and separators, and write a quote as two. Rows are padded to the
/// widest row, and rows with no cells are dropped.
pub fn parse(text: &str) -> Csv {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let separator = detect_separator(text);
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut was_quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    field.push('"');
                    chars.next();
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
            c if c == separator => {
                row.push(std::mem::take(&mut field));
                was_quoted = false;
            }
            '\r' => {}
            '\n' => {
                end_row(&mut rows, &mut row, &mut field, was_quoted);
                was_quoted = false;
            }
            c => field.push(c),
        }
    }
    end_row(&mut rows, &mut row, &mut field, was_quoted);
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    for row in &mut rows {
        row.resize(width, String::new());
    }
    Csv { rows }
}

fn end_row(rows: &mut Vec<Vec<String>>, row: &mut Vec<String>, field: &mut String, was_quoted: bool) {
    if row.is_empty() && field.is_empty() && !was_quoted {
        return;
    }
    row.push(std::mem::take(field));
    rows.push(std::mem::take(row));
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
pub fn parse_bytes(bytes: &[u8]) -> (Csv, Decoded) {
    let decoded = crate::text::decode(bytes);
    (parse(&decoded.text), decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(csv.rows, vec![vec!["a", "b", "c"], vec!["1", "2", ""]]);
    }

    #[test]
    fn an_empty_quoted_row_is_kept_but_blank_lines_are_not() {
        assert_eq!(parse("a,b\n\"\",\n").rows.len(), 2);
        assert!(parse("").rows.is_empty());
    }
}
