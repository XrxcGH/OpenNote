//! Reading column names out of the `CREATE TABLE` statements in `sqlite_master`.

/// The column names of a `CREATE TABLE` statement, and which column, if any, is the row ID itself.
pub(super) fn parse_columns(sql: &str) -> (Vec<String>, Option<usize>) {
    let mut columns = Vec::new();
    let mut rowid_column = None;
    for part in definitions(sql) {
        let (name, rest) = split_name(part.trim());
        let first = name.to_ascii_uppercase();
        if name.is_empty() || ["PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "CONSTRAINT"].contains(&first.as_str()) {
            continue;
        }
        let rest = rest.to_ascii_uppercase();
        if rest.split_whitespace().next() == Some("INTEGER") && rest.contains("PRIMARY KEY") {
            rowid_column = Some(columns.len());
        }
        columns.push(name);
    }
    (columns, rowid_column)
}

/// The parts of a `CREATE TABLE` statement between its outer parentheses, split at the commas that are not
/// inside quotes or inner parentheses.
fn definitions(sql: &str) -> Vec<String> {
    let Some(open) = sql.find('(') else {
        return Vec::new();
    };
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut quote: Option<char> = None;
    for c in sql[open..].chars() {
        if let Some(end) = quote {
            current.push(c);
            if c == end {
                quote = None;
            }
            continue;
        }
        match c {
            '\'' | '"' | '`' => {
                quote = Some(c);
                current.push(c);
            }
            '[' => {
                quote = Some(']');
                current.push(c);
            }
            '(' => {
                depth += 1;
                if depth > 1 {
                    current.push(c);
                }
            }
            ')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    parts.push(std::mem::take(&mut current));
                    break;
                }
                current.push(c);
            }
            ',' if depth == 1 => parts.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    parts
}

/// Splits a column definition into the column's name, without its quotes, and the rest.
fn split_name(part: &str) -> (String, &str) {
    let mut chars = part.chars();
    let end = match chars.next() {
        Some('"') => Some('"'),
        Some('`') => Some('`'),
        Some('\'') => Some('\''),
        Some('[') => Some(']'),
        _ => None,
    };
    match end {
        Some(end) => match part[1..].find(end) {
            Some(i) => (part[1..1 + i].to_owned(), &part[i + 2..]),
            None => (part[1..].to_owned(), ""),
        },
        None => match part.find(char::is_whitespace) {
            Some(i) => (part[..i].to_owned(), &part[i..]),
            None => (part.to_owned(), ""),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_names_come_out_of_the_create_statement() {
        let (columns, rowid) = parse_columns(
            "CREATE TABLE \"Note\" (\"Text\" varchar, [Theme] varchar(10), `Id` varchar primary key not null, \
             Seen integer DEFAULT (1, 2), CreatedAt bigint, PRIMARY KEY (Id), UNIQUE (Text))",
        );
        assert_eq!(columns, ["Text", "Theme", "Id", "Seen", "CreatedAt"]);
        assert_eq!(rowid, None);
        let (columns, rowid) = parse_columns("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)");
        assert_eq!(columns, ["id", "body"]);
        assert_eq!(rowid, Some(0));
    }
}
