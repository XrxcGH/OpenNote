//! Math for LaTeX: the page's TeX, checked so it cannot break the document or reach outside it.
//!
//! Page math is TeX (spec 7.6). A hostile page could put anything in it, so every equation is read once, token by
//! token. It is kept only when its braces and environments are balanced, it has no unescaped `$`, and it uses no
//! command that reads or writes files, defines commands, or changes how TeX reads the rest of the file. Math that
//! fails the check is written as plain text instead, and the report says so.

use super::escape::{math_command, Missing};
use super::scan::check;
use super::Engine;

/// Commands that read or write files, define or redefine commands, or change how TeX reads. None has a use in
/// an equation, so any of them rejects it. Names starting with `pdf`, `lua`, `directlua`, `latelua`, or `if` (but not
/// `iff`) are rejected too.
const DENIED: &[&str] = &[
    "input",
    "include",
    "includeonly",
    "import",
    "subimport",
    "write",
    "immediate",
    "openin",
    "openout",
    "closein",
    "closeout",
    "read",
    "readline",
    "catcode",
    "def",
    "gdef",
    "edef",
    "xdef",
    "let",
    "futurelet",
    "csname",
    "endcsname",
    "expandafter",
    "noexpand",
    "unexpanded",
    "scantokens",
    "detokenize",
    "string",
    "meaning",
    "the",
    "number",
    "romannumeral",
    "afterassignment",
    "aftergroup",
    "uppercase",
    "lowercase",
    "newcommand",
    "renewcommand",
    "providecommand",
    "declaremathoperator",
    "newenvironment",
    "renewenvironment",
    "newcounter",
    "usepackage",
    "requirepackage",
    "documentclass",
    "makeatletter",
    "makeatother",
    "special",
    "shipout",
    "batchmode",
    "nonstopmode",
    "scrollmode",
    "errorstopmode",
    "verb",
    "url",
    "href",
    "nolinkurl",
    "hyperlink",
    "hypertarget",
    "includegraphics",
    "lstinputlisting",
    "verbatiminput",
    "inputminted",
    "bibliography",
    "bibliographystyle",
    "nocite",
    "cite",
    "footnote",
    "section",
    "subsection",
    "subsubsection",
    "chapter",
    "part",
    "newpage",
    "clearpage",
    "par",
    "loop",
    "repeat",
    "iterate",
    "else",
    "fi",
    "or",
    "endinput",
    "end@document",
    "begingroup",
    "endgroup",
    "bgroup",
    "egroup",
    "global",
    "long",
    "outer",
    "protected",
    "errmessage",
    "message",
    "show",
    "showthe",
    "typeout",
    "pagestyle",
    "thispagestyle",
    "setlength",
    "addtolength",
];

/// Environments an equation may open. `document`, `verbatim`, and the other text environments are not here.
pub(super) const ENVIRONMENTS: &[&str] = &[
    "aligned",
    "alignedat",
    "array",
    "matrix",
    "pmatrix",
    "bmatrix",
    "Bmatrix",
    "vmatrix",
    "Vmatrix",
    "smallmatrix",
    "cases",
    "dcases",
    "rcases",
    "split",
    "gathered",
    "subarray",
    "align",
    "align*",
    "gather",
    "gather*",
    "multline",
    "multline*",
    "flalign",
    "flalign*",
    "equation",
    "equation*",
];

/// Environments that make a display equation by themselves, so the equation is not wrapped again.
pub(super) const DISPLAY_ENVIRONMENTS: &[&str] = &[
    "align",
    "align*",
    "gather",
    "gather*",
    "multline",
    "multline*",
    "flalign",
    "flalign*",
    "equation",
    "equation*",
];

pub(super) fn denied(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    DENIED.contains(&lower.as_str())
        || ["pdf", "lua", "directlua", "latelua"]
            .iter()
            .any(|p| lower.starts_with(p))
        || (lower.starts_with("if") && lower != "iff")
}

/// Replaces Unicode math characters with commands for pdfLaTeX. The Unicode engines read them as they are.
fn for_engine(tex: &str, engine: Engine, missing: &mut Missing) -> String {
    if engine == Engine::Unicode || tex.is_ascii() {
        return tex.to_owned();
    }
    let mut out = String::with_capacity(tex.len());
    for c in tex.chars() {
        if c.is_ascii() {
            out.push(c);
        } else if let Some(command) = math_command(c) {
            out.push_str(command);
            out.push(' ');
        } else if matches!(c, '\u{A0}' | '\u{2009}' | '\u{202F}') {
            out.push(' ');
        } else {
            missing.chars.insert(c);
            out.push('?');
        }
    }
    out
}

/// Inline math as `$...$`, or `None` when the equation is not kept.
pub fn inline(source: &str, engine: Engine, missing: &mut Missing) -> Option<String> {
    let checked = check(source, true)?;
    if checked.whole.is_some() || checked.labeled {
        return None;
    }
    Some(format!(
        "${}$",
        for_engine(&checked.tex.replace('\n', " "), engine, missing)
    ))
}

/// A display equation, with its environment, or `None` when the equation is not kept. An equation with a label is
/// numbered, so it is an `equation`; one without is not.
pub fn display(source: &str, engine: Engine, missing: &mut Missing) -> Option<String> {
    let checked = check(source, false)?;
    let tex = for_engine(&checked.tex, engine, missing);
    if checked.whole.is_some() {
        return Some(tex);
    }
    let body = if checked.rows {
        format!("\\begin{{aligned}}\n{tex}\n\\end{{aligned}}")
    } else {
        tex
    };
    Some(if checked.labeled {
        format!("\\begin{{equation}}\n{body}\n\\end{{equation}}")
    } else {
        format!("\\[\n{body}\n\\]")
    })
}

/// Whether a BibTeX entry holds nothing that could harm the document that prints it: balanced braces and dollar
/// signs, no comment character, and none of the commands that [`check`] refuses. BibTeX copies the text of an entry
/// into the document, where TeX reads it.
pub fn bib_safe(entry: &str) -> bool {
    let chars: Vec<char> = entry.chars().collect();
    let (mut depth, mut dollars, mut i) = (0i64, 0usize, 0usize);
    while i < chars.len() {
        match chars[i] {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            '$' => dollars += 1,
            '%' => return false,
            '^' if chars.get(i + 1) == Some(&'^') => return false,
            '\\' => {
                let Some(next) = chars.get(i + 1) else {
                    return false;
                };
                if next.is_ascii_alphabetic() {
                    let end = chars[i + 1..]
                        .iter()
                        .position(|c| !c.is_ascii_alphabetic())
                        .map_or(chars.len(), |p| i + 1 + p);
                    let word: String = chars[i + 1..end].iter().collect();
                    if denied(&word) {
                        return false;
                    }
                    i = end;
                    continue;
                }
                i += 2;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    depth == 0 && dollars % 2 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bibtex_entries_are_checked_before_they_are_printed() {
        assert!(bib_safe(
            "@book{Smith2020,\n  title = {R\\&D \\textbackslash{} \\$5},\n}"
        ));
        for bad in [
            "@book{a, title = {\\input{x}}}",
            "@book{a, title = {unbalanced}",
            "@book{a, title = {50% off}}",
            "@book{a, title = {$x}}",
            "@book{a, title = {\\write18{ls}}}",
        ] {
            assert!(!bib_safe(bad), "{bad}");
        }
    }

    fn keep(source: &str) -> Option<String> {
        check(source, false).map(|c| c.tex)
    }

    #[test]
    fn ordinary_math_is_kept_and_comments_and_blank_lines_go() {
        assert_eq!(
            keep("x^2 + \\frac{a}{b} % note\n\n= y").as_deref(),
            Some("x^2 + \\frac{a}{b}\n= y")
        );
        assert!(keep("\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}").is_some());
        assert!(keep("\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}").is_some());
        assert!(keep("\\left( x \\right) \\iff y \\{ z \\} 50\\% \\hspace{1em}").is_some());
    }

    #[test]
    fn dangerous_or_broken_math_is_refused() {
        for bad in [
            "\\input{/etc/passwd}",
            "\\write18{ls}",
            "\\immediate\\write",
            "\\def\\x{1}",
            "\\csname input\\endcsname",
            "\\catcode`\\^^M=12",
            "^^5cinput",
            "a $ b",
            "{a",
            "a}",
            "x \\",
            "\\begin{document}x\\end{document}",
            "\\begin{aligned} x \\end{pmatrix}",
            "\\left( x",
            "\\ifnum1=1 a\\fi",
            "\\pdfshellescape",
            "\\directlua{os.execute()}",
            "\\label{bad key}",
            "\\includegraphics{x}",
        ] {
            assert_eq!(keep(bad), None, "{bad}");
        }
    }

    #[test]
    fn inline_math_refuses_rows_and_display_wraps_what_it_needs() {
        let mut missing = Missing::default();
        assert_eq!(inline("a & b", Engine::Unicode, &mut missing), None);
        assert_eq!(inline("a \\\\ b", Engine::Unicode, &mut missing), None);
        assert_eq!(inline("x\ny", Engine::Unicode, &mut missing).as_deref(), Some("$x y$"));
        assert_eq!(
            display("a = b", Engine::Unicode, &mut missing).as_deref(),
            Some("\\[\na = b\n\\]")
        );
        assert_eq!(
            display("a &= b \\\\ c &= d", Engine::Unicode, &mut missing).as_deref(),
            Some("\\[\n\\begin{aligned}\na &= b \\\\ c &= d\n\\end{aligned}\n\\]")
        );
        assert_eq!(
            display("a = b \\label{p1:k}", Engine::Unicode, &mut missing).as_deref(),
            Some("\\begin{equation}\na = b \\label{p1:k}\n\\end{equation}")
        );
        assert_eq!(
            display(
                "\\begin{align} a &= b \\\\ c &= d \\end{align}",
                Engine::Unicode,
                &mut missing
            )
            .as_deref(),
            Some("\\begin{align} a &= b \\\\ c &= d \\end{align}")
        );
        assert_eq!(
            display("\\begin{pmatrix} 1 \\end{pmatrix}", Engine::Unicode, &mut missing).as_deref(),
            Some("\\[\n\\begin{pmatrix} 1 \\end{pmatrix}\n\\]")
        );
    }

    #[test]
    fn pdflatex_gets_commands_for_unicode_math() {
        let mut missing = Missing::default();
        assert_eq!(
            inline("α + ∑ x ≤ 日", Engine::Pdflatex, &mut missing).as_deref(),
            Some("$\\alpha  + \\sum  x \\leq  ?$")
        );
        assert!(missing.chars.contains(&'日'));
        assert_eq!(
            inline("α", Engine::Unicode, &mut Missing::default()).as_deref(),
            Some("$α$")
        );
    }
}
