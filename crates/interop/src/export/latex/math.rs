//! Math for LaTeX: the page's TeX, checked so it cannot break the document or reach outside it.
//!
//! Page math is TeX (spec 7.6). A hostile page could put anything in it, so every equation is read once, token by
//! token. It is kept only when its braces and environments are balanced, it has no unescaped `$`, and it uses only
//! control words from a list of math commands (an allowlist, so a command nobody thought of is refused). Math that
//! fails the check is written as plain text instead, and the report says so.

use super::escape::{math_command, Missing};
use super::scan::check;
use super::Engine;

/// The control words an equation may use. Everything else is refused: a list of what is known to be harmful always
/// misses a command (`\InputIfFileExists`, `\file_input:n` after `\ExplSyntaxOn`, `\AtBeginDocument`), while a
/// list of what math needs fails closed. Every word here draws or arranges a symbol and none of them reads a
/// file, defines a command, or changes how TeX reads. `begin`, `end`, `label`, `ref`, `eqref`, `left`, and `right`
/// are handled by the scan itself. The words are matched exactly, with their case, as TeX does.
#[rustfmt::skip]
const MATH: &[&str] = &[
    // Greek and other letters.
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa",
    "varkappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon",
    "phi", "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon",
    "Phi", "Psi", "Omega", "digamma", "aleph", "beth", "gimel", "daleth",
    // Binary operators and relations.
    "pm", "mp", "times", "div", "cdot", "ast", "star", "circ", "bullet", "cap", "cup", "uplus", "sqcap", "sqcup",
    "vee", "wedge", "setminus", "wr", "diamond", "bigtriangleup", "bigtriangledown", "triangleleft", "triangleright",
    "oplus", "ominus", "otimes", "oslash", "odot", "bigcirc", "dagger", "ddagger", "amalg", "leq", "le", "geq", "ge",
    "neq", "ne", "equiv", "sim", "simeq", "approx", "cong", "propto", "ll", "gg", "prec", "succ", "preceq", "succeq",
    "subset", "supset", "subseteq", "supseteq", "subsetneq", "supsetneq", "nsubseteq", "in", "ni", "notin", "vdash",
    "dashv", "models", "perp", "parallel", "mid", "nmid", "asymp", "doteq", "bowtie", "smile", "frown", "sqsubset",
    "sqsupset", "sqsubseteq", "sqsupseteq", "lesssim", "gtrsim", "leqslant", "geqslant", "nleq", "ngeq", "nless",
    "ngtr", "lneq", "gneq", "ncong", "nsim", "not", "coloneqq", "eqqcolon", "mathbin", "mathrel", "mathop", "mathord",
    "mathopen", "mathclose", "mathpunct", "mathinner",
    // Arrows.
    "leftarrow", "rightarrow", "leftrightarrow", "Leftarrow", "Rightarrow", "Leftrightarrow", "to", "gets", "mapsto",
    "longmapsto", "longrightarrow", "longleftarrow", "longleftrightarrow", "Longrightarrow", "Longleftarrow",
    "Longleftrightarrow", "iff", "implies", "impliedby", "uparrow", "downarrow", "updownarrow", "Uparrow",
    "Downarrow", "Updownarrow", "nearrow", "searrow", "swarrow", "nwarrow", "hookrightarrow", "hookleftarrow",
    "rightleftharpoons", "leftrightharpoons", "rightharpoonup", "rightharpoondown", "leftharpoonup",
    "leftharpoondown", "xrightarrow", "xleftarrow", "rightsquigarrow", "twoheadrightarrow", "rightrightarrows",
    "leftleftarrows",
    // Symbols.
    "infty", "partial", "nabla", "forall", "exists", "nexists", "neg", "lnot", "emptyset", "varnothing", "hbar",
    "ell", "Re", "Im", "wp", "prime", "backprime", "angle", "measuredangle", "triangle", "top", "bot", "surd",
    "sharp", "flat", "natural", "clubsuit", "diamondsuit", "heartsuit", "spadesuit", "imath", "jmath", "ldots",
    "cdots", "vdots", "ddots", "dots", "dotsb", "dotsc", "dotsi", "dotsm", "dotso", "therefore", "because", "square",
    "blacksquare", "checkmark", "complement", "mho",
    // Large operators and functions.
    "sum", "prod", "coprod", "int", "iint", "iiint", "oint", "bigcup", "bigcap", "bigvee", "bigwedge", "bigoplus",
    "bigotimes", "bigodot", "biguplus", "bigsqcup", "lim", "limsup", "liminf", "max", "min", "sup", "inf", "arg",
    "det", "dim", "gcd", "hom", "ker", "deg", "exp", "log", "ln", "lg", "sin", "cos", "tan", "cot", "sec", "csc",
    "sinh", "cosh", "tanh", "coth", "arcsin", "arccos", "arctan", "Pr", "mod", "bmod", "pmod", "pod", "operatorname",
    "injlim", "projlim", "varinjlim", "varprojlim", "varlimsup", "varliminf", "limits", "nolimits",
    // Structure, delimiters, and size.
    "frac", "dfrac", "tfrac", "cfrac", "binom", "dbinom", "tbinom", "sqrt", "overline", "underline", "overbrace",
    "underbrace", "overset", "underset", "stackrel", "substack", "sideset", "boxed", "over", "atop", "choose", "big",
    "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr", "middle", "langle",
    "rangle", "lceil", "rceil", "lfloor", "rfloor", "lbrace", "rbrace", "lbrack", "rbrack", "vert", "Vert", "lvert",
    "rvert", "lVert", "rVert", "backslash", "hline", "cline", "multicolumn", "hdotsfor",
    // Accents.
    "hat", "widehat", "check", "tilde", "widetilde", "acute", "grave", "dot", "ddot", "dddot", "breve", "bar", "vec",
    "overrightarrow", "overleftarrow", "overleftrightarrow", "underrightarrow", "underleftarrow", "mathring",
    // Fonts and styles.
    "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb", "mathfrak", "boldsymbol", "mathnormal",
    "text", "textrm", "textbf", "textit", "textsf", "texttt", "textnormal", "emph", "mbox", "displaystyle",
    "textstyle", "scriptstyle", "scriptscriptstyle", "color", "textcolor",
    // Spacing, numbering, and boxes.
    "quad", "qquad", "hspace", "hfill", "phantom", "hphantom", "vphantom", "smash", "mathstrut", "enspace",
    "thinspace", "medspace", "thickspace", "negthinspace", "negmedspace", "negthickspace", "tag", "notag", "nonumber",
    "intertext", "shortintertext",
];

/// The control words text may use besides [`MATH`]: BibTeX entries hold titles and names, so they need font
/// commands, accents, and the letters and signs of other languages. None reads a file or changes how TeX reads.
#[rustfmt::skip]
const TEXT: &[&str] = &[
    "textsc", "textsl", "textup", "textmd", "textsuperscript", "textsubscript", "textbackslash", "textasciitilde",
    "textasciicircum", "textbar", "textless", "textgreater", "textunderscore", "textbraceleft", "textbraceright",
    "textquotedbl", "textquoteleft", "textquoteright", "textquotedblleft", "textquotedblright", "textendash",
    "textemdash", "textellipsis", "textdegree", "textregistered", "texttrademark", "textcopyright", "ldots", "ss",
    "ae", "AE", "oe", "OE", "aa", "AA", "o", "O", "l", "L", "i", "j", "c", "d", "b", "k", "r", "t", "u", "v", "H",
    "copyright", "pounds", "S", "P", "dag", "ddag", "LaTeX", "TeX", "relax",
];

/// Whether an equation may use this control word.
pub(super) fn allowed_math(word: &str) -> bool {
    MATH.contains(&word)
}

/// Whether the text of a BibTeX entry may use this control word.
pub(super) fn allowed_text(word: &str) -> bool {
    TEXT.contains(&word) || MATH.contains(&word)
}

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
/// signs, no comment character, and only the commands of [`allowed_text`]. BibTeX copies the text of an entry
/// into the document, where TeX reads it.
pub fn bib_safe(entry: &str) -> bool {
    if entry.contains("^^") {
        return false;
    }
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
                    if !allowed_text(&word) {
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

    /// Commands that read files, define commands, or hook into the document, none of them on the denylist the first
    /// version had. Each is refused because it is not a math command.
    #[test]
    fn commands_that_are_not_math_are_refused_even_when_nobody_listed_them() {
        for bad in [
            r"\InputIfFileExists{/etc/passwd}{}{}",
            r"\AtBeginDocument{\InputIfFileExists{x}{}{}}",
            r"\AtEndDocument{x}",
            r"\ExplSyntaxOn \file_input:n{/etc/passwd} \ExplSyntaxOff",
            r"\ExplSyntaxOn x",
            r"\DeclareRobustCommand\textbf[1]{#1}",
            r"\DeclareMathOperator{\foo}{foo}",
            r"\NewDocumentCommand\x{}{y}",
            r"\RenewDocumentCommand\x{}{y}",
            r"\ProvideDocumentCommand\x{}{y}",
            r"\NewCommandCopy\x\y",
            r"\newlength\x",
            r"\renewcommand{\x}{y}",
            r"\providecommand{\x}{y}",
            r"\setcounter{page}{3}",
            r"\addtocounter{page}{3}",
            r"\ProcessOptions",
            r"\PassOptionsToPackage{a}{b}",
            r"\Input{x}",
            r"\INPUT{x}",
            r"\openin1=x",
            r"\lstinputlisting{x}",
            r"\x",
            r"\alphaX",
        ] {
            assert_eq!(keep(bad), None, "{bad}");
        }
    }

    #[test]
    fn characters_that_change_how_tex_reads_are_refused() {
        for bad in ["a ^^5c b", r"\^^5cinput", "x ^^M", "#1", "\\u{e9}", "\\u{3b1}"] {
            assert_eq!(keep(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_allowlists_hold_only_plain_names_and_none_of_the_dangerous_ones() {
        // Written apart from the lists, from what TeX and LaTeX do, so the check does not agree with itself.
        let dangerous = [
            "input",
            "include",
            "write",
            "immediate",
            "openin",
            "openout",
            "read",
            "readline",
            "def",
            "gdef",
            "edef",
            "xdef",
            "let",
            "csname",
            "expandafter",
            "scantokens",
            "catcode",
            "newcommand",
            "renewcommand",
            "providecommand",
            "usepackage",
            "documentclass",
            "verb",
            "url",
            "href",
            "special",
            "shipout",
            "loop",
            "else",
            "fi",
            "jobname",
            "string",
            "meaning",
            "the",
            "makeatletter",
            "begingroup",
            "endgroup",
            "global",
            "ExplSyntaxOn",
            "InputIfFileExists",
            "AtBeginDocument",
            "directlua",
            "includegraphics",
        ];
        let prefixes = [
            "pdf", "lua", "if", "new", "renew", "provide", "declare", "set", "add", "process", "pass",
        ];
        for word in MATH.iter().chain(TEXT) {
            assert!(word.bytes().all(|b| b.is_ascii_alphabetic()), "{word}");
            assert!(!dangerous.contains(word), "{word}");
            let lower = word.to_ascii_lowercase();
            assert!(
                !prefixes.iter().any(|p| lower.starts_with(p)) || matches!(*word, "iff" | "setminus"),
                "{word}"
            );
        }
        assert!(allowed_math("alpha") && !allowed_math("Alpha") && !allowed_math("input"));
        assert!(allowed_text("textbf") && allowed_text("alpha") && !allowed_text("url"));
    }

    #[test]
    fn bibtex_refuses_what_math_refuses() {
        for bad in [
            r"@book{a, title = {\InputIfFileExists{x}{}{}}}",
            r"@book{a, title = {\ExplSyntaxOn}}",
            r"@book{a, title = {\DeclareRobustCommand\x{y}}}",
            r"@book{a, title = {^^5cinput}}",
            r"@book{a, title = {\url{https://example.org}}}",
        ] {
            assert!(!bib_safe(bad), "{bad}");
        }
        assert!(bib_safe(
            r#"@book{a, author = {M{\"u}ller, J\'{e}r\^ome and \c{C}elik}, title = {\textit{On} $\alpha$}}"#
        ));
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
