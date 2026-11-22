//! Token-level translation of formulas between OpenNote's stored form and Excel's file form (ADR 0067).
//!
//! OpenNote's A1 rows count from the first data row, so rows move by one when the table has a header row. A bare
//! `[Col]` is the cell of that column in the formula's row, except as an argument of a function that takes a range,
//! where it is the whole column. In Excel it becomes a structured reference to the table's ListObject, or plain A1
//! references when the table has none. `E` becomes `EXP(1)`, and functions newer than Excel 2007 get the `_xlfn.`
//! prefix the file format requires. Everything else is copied as it is. The same golden cases run in TypeScript
//! (`app/src/features/tables/fixtures/translate.json`).

/// A table as formulas see it, in the workbook being written or read.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TableRef {
    /// The name OpenNote formulas use for the table, such as `Table1`.
    pub name: String,
    /// The name of its Excel ListObject, when it has one.
    pub excel: Option<String>,
    /// The name of its worksheet.
    pub sheet: String,
    /// Whether its first row is a header row.
    pub header: bool,
    /// The names `[Col]` matches, in column order: the header text or the column letter.
    pub columns: Vec<String>,
    /// Its rows, the header row included.
    pub rows: usize,
}

/// Where a formula sits.
#[derive(Clone, Copy, Debug)]
pub struct Context<'a> {
    /// The tables of the workbook.
    pub book: &'a [TableRef],
    /// The place in `book` of the formula's own table.
    pub own: usize,
    /// The Excel row of the formula's cell, from 1. `None` for a defined name, whose references name their sheet.
    pub row: Option<usize>,
}

/// Functions whose arguments take whole ranges, so a bare `[Col]` inside them is the whole column.
const RANGE_FUNCTIONS: &str = concat!(
    "AGGREGATE AND AVERAGE AVERAGEA AVERAGEIF AVERAGEIFS CHOOSECOLS CHOOSEROWS COLUMNS CONCAT CORREL ",
    "COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS COVARIANCE.P COVARIANCE.S DROP FILTER HLOOKUP INDEX LARGE ",
    "LOOKUP MATCH MAX MAXA MAXIFS MEDIAN MIN MINA MINIFS MODE MODE.MULT MODE.SNGL OR PERCENTILE ",
    "PERCENTILE.EXC PERCENTILE.INC PRODUCT QUARTILE QUARTILE.EXC QUARTILE.INC RANK RANK.AVG RANK.EQ ROWS ",
    "SMALL SORT SORTBY STDEV STDEV.P STDEV.S STDEVA STDEVP SUBTOTAL SUM SUMIF SUMIFS SUMPRODUCT TAKE ",
    "TEXTJOIN TOCOL TOROW UNIQUE VAR VAR.P VAR.S VARA VARP VLOOKUP XLOOKUP XMATCH XOR ",
);

/// Functions added after Excel 2007, which the file form writes with the `_xlfn.` prefix ([MS-XLSX] 2.2.2).
const FUTURE_FUNCTIONS: &str = concat!(
    "ACOT ACOTH AGGREGATE ARABIC BASE BETA.DIST BETA.INV BINOM.DIST BINOM.INV BITAND BITLSHIFT BITOR ",
    "BITRSHIFT BITXOR BYCOL BYROW CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV ",
    "CHISQ.INV.RT CHISQ.TEST CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH ",
    "COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST ",
    "F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FILTER FLOOR.MATH FLOOR.PRECISE FORECAST.LINEAR FORMULATEXT ",
    "GAMMA GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS HSTACK HYPGEOM.DIST IFNA IFS IMCOSH IMCOT IMCSC ",
    "IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOMITTED ISOWEEKNUM LAMBDA LET LOGNORM.DIST LOGNORM.INV ",
    "MAKEARRAY MAP MAXIFS MINIFS MODE.MULT MODE.SNGL NEGBINOM.DIST NORM.DIST NORM.INV NORM.S.DIST ",
    "NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC ",
    "PERMUTATIONA PHI POISSON.DIST QUARTILE.EXC QUARTILE.INC RANDARRAY RANK.AVG RANK.EQ REDUCE RRI SCAN ",
    "SEC SECH SEQUENCE SHEET SHEETS SKEW.P SORT SORTBY STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT ",
    "T.INV T.INV.2T T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW UNICHAR UNICODE ",
    "UNIQUE VALUETOTEXT ARRAYTOTEXT VAR.P VAR.S VSTACK WEIBULL.DIST WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR ",
);

/// The worksheet functions that also take the `_xlws.` prefix after `_xlfn.`.
const WORKSHEET_PREFIXED: &str = "FILTER SORT";

/// Whether `name` is one of the space-separated names of `list`.
fn listed(list: &str, name: &str) -> bool {
    list.split_whitespace().any(|n| n == name)
}

/// The largest column of a worksheet, `XFD`.
const MAX_COLUMN: usize = 16_384;
/// The largest row of a worksheet.
const MAX_ROW: usize = 1_048_576;

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    /// Copied as it is: spaces, operators, brackets, strings, error codes.
    Text(String),
    /// A number.
    Num(String),
    /// A name: a function, a cell, a defined name, a table, or a sheet.
    Name(String),
    /// A bracketed part with its brackets.
    Bracket(String),
    /// A quoted sheet name with its quotes.
    Quoted(String),
}

#[derive(Clone, Copy, PartialEq)]
enum Dialect {
    OpenNote,
    Excel,
}

fn is_name_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '\\' || c == '$'
}

fn is_name_part(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '.' | '$' | '\\')
}

fn tokenize(src: &str, dialect: Dialect) -> Vec<Tok> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    let take = |from: usize, to: usize| chars[from..to].iter().collect::<String>();
    while i < chars.len() {
        let c = chars[i];
        let start = i;
        if c == '"' || c == '\'' {
            i += 1;
            while i < chars.len() {
                if chars[i] == c && chars.get(i + 1) == Some(&c) {
                    i += 2;
                } else if chars[i] == c {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            let text = take(start, i);
            out.push(if c == '"' { Tok::Text(text) } else { Tok::Quoted(text) });
        } else if c == '[' {
            i += 1;
            let mut depth = 1;
            while i < chars.len() && depth > 0 {
                match (dialect, chars[i]) {
                    (Dialect::OpenNote, ']') if chars.get(i + 1) == Some(&']') => i += 1,
                    (Dialect::OpenNote, ']') | (Dialect::Excel, ']') => depth -= 1,
                    (Dialect::Excel, '[') => depth += 1,
                    (Dialect::Excel, '\'') => i += 1,
                    _ => {}
                }
                i += 1;
            }
            out.push(Tok::Bracket(take(start, i.min(chars.len()))));
        } else if c == '#' && chars.get(i + 1).is_some_and(|n| n.is_ascii_alphabetic()) {
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || matches!(chars[i], '/' | '_')) {
                i += 1;
            }
            if i < chars.len() && matches!(chars[i], '!' | '?') {
                i += 1;
            }
            out.push(Tok::Text(take(start, i)));
        } else if c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(char::is_ascii_digit)) {
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            if i < chars.len() && matches!(chars[i], 'e' | 'E') {
                let mut j = i + 1;
                if j < chars.len() && matches!(chars[j], '+' | '-') {
                    j += 1;
                }
                if j < chars.len() && chars[j].is_ascii_digit() {
                    i = j;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            out.push(Tok::Num(take(start, i)));
        } else if is_name_start(c) {
            while i < chars.len() && is_name_part(chars[i]) {
                i += 1;
            }
            out.push(Tok::Name(take(start, i)));
        } else {
            i += 1;
            out.push(Tok::Text(c.to_string()));
        }
    }
    out
}

/// A cell reference split into its parts: column `$`, letters, row `$`, and row number.
struct Cell {
    col_abs: bool,
    letters: String,
    row_abs: bool,
    row: usize,
}

fn cell_of(name: &str) -> Option<Cell> {
    let (col_abs, rest) = name.strip_prefix('$').map_or((false, name), |r| (true, r));
    let split = rest.find(|c: char| !c.is_ascii_alphabetic())?;
    let (letters, rest) = rest.split_at(split);
    let (row_abs, digits) = rest.strip_prefix('$').map_or((false, rest), |r| (true, r));
    if letters.is_empty() || letters.len() > 3 || digits.is_empty() || digits.len() > 7 {
        return None;
    }
    if !digits.bytes().all(|b| b.is_ascii_digit()) || digits.starts_with('0') {
        return None;
    }
    let row: usize = digits.parse().ok()?;
    (column_number(letters)? <= MAX_COLUMN && row <= MAX_ROW).then(|| Cell {
        col_abs,
        letters: letters.to_owned(),
        row_abs,
        row,
    })
}

fn column_number(letters: &str) -> Option<usize> {
    letters.bytes().try_fold(0usize, |n, b| {
        b.is_ascii_alphabetic()
            .then(|| n * 26 + usize::from(b.to_ascii_uppercase() - b'A' + 1))
    })
}

/// The letters of a column, counting from 0.
pub fn column_letters(mut index: usize) -> String {
    let mut out = Vec::new();
    loop {
        out.push(b'A' + (index % 26) as u8);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// A sheet name as a reference writes it, quoted when it is not a plain name.
pub fn sheet_prefix(sheet: &str) -> String {
    let plain = sheet.chars().next().is_some_and(|c| c.is_alphabetic() || c == '_')
        && sheet.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '.'))
        && cell_of(sheet).is_none();
    if plain {
        format!("{sheet}!")
    } else {
        format!("'{}'!", sheet.replace('\'', "''"))
    }
}

/// Moves a row by `by`, or `None` when it leaves the sheet.
fn moved(row: usize, by: isize) -> Option<usize> {
    let r = row.checked_add_signed(by)?;
    (1..=MAX_ROW).contains(&r).then_some(r)
}

/// The text of an OpenNote column name inside `[...]`: `]` doubles.
fn opennote_escape(name: &str) -> String {
    name.replace(']', "]]")
}

/// The text of an Excel column name inside a structured reference: `'`, `[`, `]`, and `#` take a `'` before them.
fn excel_escape(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if matches!(c, '\'' | '[' | ']' | '#') {
            out.push('\'');
        }
        out.push(c);
    }
    out
}

fn excel_unescape(name: &str) -> String {
    let mut out = String::new();
    let mut chars = name.chars();
    while let Some(c) = chars.next() {
        if c == '\'' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else {
            out.push(c);
        }
    }
    out
}

struct Walker<'a> {
    toks: Vec<Tok>,
    cx: Context<'a>,
    /// The functions whose brackets enclose the current token, innermost last. Plain brackets push an empty name.
    calls: Vec<String>,
}

impl Walker<'_> {
    fn next_is(&self, at: usize, text: &str) -> bool {
        matches!(self.toks.get(at + 1), Some(Tok::Text(t)) if t == text)
    }

    fn prev_is(&self, at: usize, text: &str) -> bool {
        at > 0 && matches!(self.toks.get(at - 1), Some(Tok::Text(t)) if t == text)
    }

    fn in_range_function(&self) -> bool {
        self.calls.last().is_some_and(|f| {
            let bare = strip_prefixes(f).to_ascii_uppercase();
            listed(RANGE_FUNCTIONS, &bare)
        })
    }

    fn track(&mut self, at: usize) {
        match &self.toks[at] {
            Tok::Text(t) if t == "(" => {
                let name = match at.checked_sub(1).and_then(|p| self.toks.get(p)) {
                    Some(Tok::Name(n)) => n.clone(),
                    _ => String::new(),
                };
                self.calls.push(name);
            }
            Tok::Text(t) if t == ")" => {
                self.calls.pop();
            }
            _ => {}
        }
    }

    fn table_named(&self, name: &str, excel: bool) -> Option<usize> {
        self.cx.book.iter().position(|t| {
            let own = if excel {
                t.excel.as_deref()
            } else {
                Some(t.name.as_str())
            };
            own.is_some_and(|n| n.eq_ignore_ascii_case(name))
        })
    }

    fn table_on_sheet(&self, sheet: &str) -> Option<usize> {
        self.cx.book.iter().position(|t| t.sheet.eq_ignore_ascii_case(sheet))
    }

    /// The row shift of references into table `t`: one for a header row, the other way when reading.
    fn shift(&self, t: usize, to_excel: bool) -> isize {
        match (self.cx.book.get(t).is_some_and(|t| t.header), to_excel) {
            (false, _) => 0,
            (true, true) => 1,
            (true, false) => -1,
        }
    }

    fn row_ref(&self, at: usize) -> bool {
        self.prev_is(at, ":") || self.next_is(at, ":")
    }
}

fn strip_prefixes(name: &str) -> &str {
    let mut bare = name;
    for prefix in ["_xlfn.", "_xlws.", "_xlpm."] {
        if bare.len() > prefix.len() && bare[..prefix.len()].eq_ignore_ascii_case(prefix) {
            bare = &bare[prefix.len()..];
        }
    }
    bare
}

/// Translates an OpenNote formula, without its `=`, into Excel's file form.
pub fn to_excel(formula: &str, cx: &Context<'_>) -> String {
    let mut w = Walker {
        toks: tokenize(formula, Dialect::OpenNote),
        cx: *cx,
        calls: Vec::new(),
    };
    let mut out = String::new();
    // The table a sheet qualifier just named, for the reference after it.
    let mut qualified: Option<usize> = None;
    for at in 0..w.toks.len() {
        let target = qualified.take();
        let table = target.unwrap_or(cx.own);
        let tok = w.toks[at].clone();
        match tok {
            Tok::Name(name) if w.next_is(at, "(") => {
                let upper = name.to_ascii_uppercase();
                if listed(FUTURE_FUNCTIONS, &upper) {
                    out.push_str("_xlfn.");
                    if listed(WORKSHEET_PREFIXED, &upper) {
                        out.push_str("_xlws.");
                    }
                }
                out.push_str(&name);
            }
            Tok::Name(name) if w.next_is(at, "!") => match w.table_named(&name, false) {
                Some(t) => {
                    out.push_str(&sheet_prefix(&cx.book[t].sheet));
                    qualified = Some(t);
                }
                None => {
                    out.push_str(&name);
                    out.push('!');
                }
            },
            Tok::Text(t) if t == "!" && at > 0 && matches!(w.toks[at - 1], Tok::Name(_)) => {
                // Written with the sheet name above.
                if target.is_some() {
                    qualified = target;
                }
            }
            Tok::Name(name) if matches!(w.toks.get(at + 1), Some(Tok::Bracket(_))) => match w.table_named(&name, false)
            {
                Some(t) => qualified = Some(t),
                None => out.push_str(&name),
            },
            Tok::Bracket(raw) => {
                let after_name = at > 0 && matches!(w.toks[at - 1], Tok::Name(_));
                if after_name && target.is_none() {
                    // A table this workbook does not hold: the reference stays as it is.
                    out.push_str(&raw);
                } else {
                    out.push_str(&struct_to_excel(&w, &raw, table, after_name));
                }
            }
            Tok::Name(name) => {
                let qualify = cx.row.is_none() && target.is_none() && !w.prev_is(at, ":");
                let prefix = |out: &mut String| {
                    if qualify {
                        out.push_str(&sheet_prefix(&cx.book[cx.own].sheet));
                    }
                };
                if let Some(cell) = cell_of(&name) {
                    prefix(&mut out);
                    match moved(cell.row, w.shift(table, true)) {
                        Some(row) => out.push_str(&cell_text(&cell, row)),
                        None => out.push_str("#REF!"),
                    }
                } else if let Some((abs, row)) = row_number(&name).filter(|_| w.row_ref(at)) {
                    prefix(&mut out);
                    push_row(&mut out, abs, row, w.shift(table, true));
                } else if name == "E" || name == "e" {
                    out.push_str("EXP(1)");
                } else {
                    if w.row_ref(at) && name.trim_start_matches('$').chars().all(|c| c.is_ascii_alphabetic()) {
                        prefix(&mut out);
                    }
                    out.push_str(&name);
                }
            }
            Tok::Num(n) if w.row_ref(at) => match row_number(&n) {
                Some((abs, row)) => {
                    if cx.row.is_none() && target.is_none() && !w.prev_is(at, ":") {
                        out.push_str(&sheet_prefix(&cx.book[cx.own].sheet));
                    }
                    push_row(&mut out, abs, row, w.shift(table, true));
                }
                None => out.push_str(&n),
            },
            Tok::Num(t) | Tok::Text(t) | Tok::Quoted(t) => out.push_str(&t),
        }
        w.track(at);
    }
    out
}

/// A whole-row reference such as `3` or `$3`.
fn row_number(text: &str) -> Option<(bool, usize)> {
    let (abs, digits) = text.strip_prefix('$').map_or((false, text), |d| (true, d));
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((abs, digits.parse().ok()?))
}

fn push_row(out: &mut String, abs: bool, row: usize, by: isize) {
    match moved(row, by) {
        Some(r) => {
            if abs {
                out.push('$');
            }
            out.push_str(&r.to_string());
        }
        None => out.push_str("#REF!"),
    }
}

fn cell_text(cell: &Cell, row: usize) -> String {
    format!(
        "{}{}{}{row}",
        if cell.col_abs { "$" } else { "" },
        cell.letters,
        if cell.row_abs { "$" } else { "" }
    )
}

/// A structured reference of OpenNote's form, `[Col]` or `[@Col]`, in table `t`, in Excel's form.
fn struct_to_excel(w: &Walker<'_>, raw: &str, t: usize, explicit: bool) -> String {
    let cx = &w.cx;
    let table = &cx.book[t];
    let inner = raw.strip_prefix('[').and_then(|r| r.strip_suffix(']')).unwrap_or(raw);
    if inner.starts_with('[') || inner.starts_with('#') {
        // A form OpenNote copies from Excel, such as Sales[[#Headers],[Amount]].
        return match &table.excel {
            Some(name) => format!("{name}{raw}"),
            None => "#REF!".to_owned(),
        };
    }
    let (at_sign, name) = inner.strip_prefix('@').map_or((false, inner), |n| (true, n));
    let name = name.replace("]]", "]");
    let this_row = at_sign || (!explicit && !w.in_range_function() && cx.row.is_some());
    let Some(col) = table
        .columns
        .iter()
        .position(|c| c.trim().eq_ignore_ascii_case(name.trim()))
    else {
        return "#REF!".to_owned();
    };
    let own = t == cx.own;
    match &table.excel {
        Some(list) if this_row => format!("{list}[[#This Row],[{}]]", excel_escape(&table.columns[col])),
        Some(list) => format!("{list}[{}]", excel_escape(&table.columns[col])),
        None => {
            let letters = column_letters(col);
            let sheet = if own && cx.row.is_some() {
                String::new()
            } else {
                sheet_prefix(&table.sheet)
            };
            match cx.row {
                Some(row) if this_row => format!("{sheet}{letters}{row}"),
                _ => {
                    let first = if table.header { 2 } else { 1 };
                    let last = table.rows.max(first);
                    format!("{sheet}${letters}${first}:${letters}${last}")
                }
            }
        }
    }
}

/// Translates an Excel formula in file form, without its `=`, into OpenNote's stored form.
pub fn from_excel(formula: &str, cx: &Context<'_>) -> String {
    let mut w = Walker {
        toks: tokenize(formula, Dialect::Excel),
        cx: *cx,
        calls: Vec::new(),
    };
    let mut out = String::new();
    let mut qualified: Option<usize> = None;
    for at in 0..w.toks.len() {
        let target = qualified.take();
        let table = target.unwrap_or(cx.own);
        let tok = w.toks[at].clone();
        match tok {
            Tok::Name(name) if w.next_is(at, "(") => out.push_str(strip_prefixes(&name)),
            Tok::Name(name) | Tok::Quoted(name) if w.next_is(at, "!") => {
                let sheet = name
                    .strip_prefix('\'')
                    .and_then(|n| n.strip_suffix('\''))
                    .map_or_else(|| name.clone(), |n| n.replace("''", "'"));
                match w.table_on_sheet(&sheet) {
                    Some(t) => {
                        out.push_str(&cx.book[t].name);
                        qualified = Some(t);
                    }
                    None => out.push_str(&name),
                }
            }
            Tok::Text(t) if t == "!" => {
                out.push('!');
                qualified = target;
            }
            Tok::Name(name) if matches!(w.toks.get(at + 1), Some(Tok::Bracket(_))) => {
                match w.table_named(&name, true) {
                    Some(t) => qualified = Some(t),
                    None => out.push_str(&name),
                }
            }
            Tok::Bracket(raw) => out.push_str(&struct_from_excel(&w, &raw, table)),
            Tok::Name(name) => {
                if let Some(cell) = cell_of(&name) {
                    match moved(cell.row, w.shift(table, false)) {
                        Some(row) => out.push_str(&cell_text(&cell, row)),
                        None => out.push_str("#REF!"),
                    }
                } else if let Some((abs, row)) = row_number(&name).filter(|_| w.row_ref(at)) {
                    push_row(&mut out, abs, row, w.shift(table, false));
                } else {
                    out.push_str(strip_prefixes(&name));
                }
            }
            Tok::Num(n) if w.row_ref(at) => match row_number(&n) {
                Some((abs, row)) => push_row(&mut out, abs, row, w.shift(table, false)),
                None => out.push_str(&n),
            },
            Tok::Num(t) | Tok::Text(t) | Tok::Quoted(t) => out.push_str(&t),
        }
        w.track(at);
    }
    out
}

/// An Excel structured reference in table `t`, in OpenNote's form.
fn struct_from_excel(w: &Walker<'_>, raw: &str, t: usize) -> String {
    let table = &w.cx.book[t];
    let inner = raw.strip_prefix('[').and_then(|r| r.strip_suffix(']')).unwrap_or(raw);
    let this_row_prefix = "[#This Row],";
    let (this_row, column) = if let Some(rest) = inner.strip_prefix('@') {
        (
            true,
            rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')).unwrap_or(rest),
        )
    } else if inner.len() > this_row_prefix.len()
        && inner[..this_row_prefix.len()].eq_ignore_ascii_case(this_row_prefix)
    {
        let rest = &inner[this_row_prefix.len()..];
        (
            true,
            rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')).unwrap_or(rest),
        )
    } else if inner.starts_with('[') || inner.starts_with('#') {
        return format!("{}{raw}", table.name);
    } else {
        (false, inner)
    };
    let name = opennote_escape(&excel_unescape(column));
    let own = t == w.cx.own;
    let range = w.in_range_function();
    match (own, this_row) {
        (true, true) if range => format!("[@{name}]"),
        (true, true) => format!("[{name}]"),
        (true, false) if range => format!("[{name}]"),
        (_, true) => format!("{}[@{name}]", table.name),
        (_, false) => format!("{}[{name}]", table.name),
    }
}

#[cfg(test)]
mod tests;
