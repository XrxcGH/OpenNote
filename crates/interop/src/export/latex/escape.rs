//! Escaping text for LaTeX: the special characters, Unicode for each engine, and the addresses of links.

use std::collections::BTreeSet;

use super::Engine;

/// What escaping could not keep, for the report.
#[derive(Debug, Default)]
pub struct Missing {
    /// Characters that pdfLaTeX has no way to show, and that were replaced by a question mark.
    pub chars: BTreeSet<char>,
}

/// The LaTeX for `c` in running text, or `None` when the character needs no escape.
fn special(c: char) -> Option<&'static str> {
    Some(match c {
        '\\' => "\\textbackslash{}",
        '{' => "\\{",
        '}' => "\\}",
        '$' => "\\$",
        '&' => "\\&",
        '#' => "\\#",
        '_' => "\\_",
        '%' => "\\%",
        '~' => "\\textasciitilde{}",
        '^' => "\\textasciicircum{}",
        '<' => "\\textless{}",
        '>' => "\\textgreater{}",
        '|' => "\\textbar{}",
        '`' => "\\textasciigrave{}",
        '\u{A0}' | '\u{202F}' => "~",
        '\u{AD}' => "\\-",
        _ => return None,
    })
}

/// Whether the character is dropped from text: controls, the byte order mark, and the footnote markers.
fn dropped(c: char) -> bool {
    (c.is_control() && !c.is_whitespace())
        || matches!(c, '\u{FEFF}' | '\u{FFFE}' | '\u{FFFF}')
        || c == crate::export::footnotes::OPEN
        || c == crate::export::footnotes::CLOSE
}

/// Text as LaTeX: every special character escaped, line breaks and tabs as spaces. With pdfLaTeX, characters it
/// cannot show become a question mark and are noted in `missing`.
pub fn text(input: &str, engine: Engine, missing: &mut Missing) -> String {
    let mut out = String::with_capacity(input.len() + input.len() / 8);
    for c in input.chars() {
        if dropped(c) {
            continue;
        }
        if let Some(escaped) = special(c) {
            out.push_str(escaped);
        } else if c.is_whitespace() {
            out.push(' ');
        } else if c.is_ascii() || engine == Engine::Unicode {
            out.push(c);
        } else if let Some(command) = pdftex_text(c) {
            out.push_str(command);
        } else if pdftex_passes(c) {
            out.push(c);
        } else if let Some(command) = math_command(c) {
            out.push_str("\\ensuremath{");
            out.push_str(command);
            out.push('}');
        } else {
            missing.chars.insert(c);
            out.push('?');
        }
    }
    out
}

/// A comment line: the text on one line, with nothing that could end the comment early.
pub fn comment(input: &str) -> String {
    input
        .chars()
        .filter(|c| !dropped(*c))
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .take(300)
        .collect()
}

/// Text for the PDF's own title and author fields: letters, digits, spaces, and plain punctuation only.
pub fn pdf_info(input: &str, engine: Engine) -> String {
    let kept: String = input
        .chars()
        .map(|c| {
            let fine = c.is_ascii_alphanumeric()
                || matches!(c, ' ' | '.' | ',' | ':' | ';' | '-' | '\'' | '(' | ')' | '!' | '?')
                || (c.is_alphanumeric() && (engine == Engine::Unicode || pdftex_passes(c)));
            if fine {
                c
            } else {
                ' '
            }
        })
        .collect();
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Latin-1 and Latin Extended-A letters, and the punctuation that `inputenc` with `utf8` and the T1 font encoding
/// show.
fn pdftex_passes(c: char) -> bool {
    matches!(c,
        '\u{A1}'..='\u{FF}'
        | '\u{100}'..='\u{17F}'
        | '\u{2013}' | '\u{2014}' | '\u{2018}' | '\u{2019}' | '\u{201C}' | '\u{201D}'
        | '\u{2020}' | '\u{2021}' | '\u{2022}' | '\u{2026}' | '\u{20AC}' | '\u{2122}')
        && !matches!(c, '\u{A0}' | '\u{AD}')
}

/// Greek letters, arrows, and the common math signs, for text, as pdfLaTeX needs them.
fn pdftex_text(c: char) -> Option<&'static str> {
    Some(match c {
        '\u{2002}' | '\u{2003}' => "\\ ",
        '\u{2009}' | '\u{200A}' => "\\,",
        '\u{200B}' | '\u{200C}' | '\u{200D}' => "",
        '\u{2212}' => "\\textminus{}",
        '\u{2032}' => "'",
        '\u{2033}' => "''",
        '\u{2713}' => "\\ensuremath{\\checkmark}",
        _ => return None,
    })
}

/// The math command for a Unicode character, for pdfLaTeX. The letters that look like Latin ones have none.
pub fn math_command(c: char) -> Option<&'static str> {
    Some(match c {
        '\u{3B1}' => "\\alpha",
        '\u{3B2}' => "\\beta",
        '\u{3B3}' => "\\gamma",
        '\u{3B4}' => "\\delta",
        '\u{3B5}' => "\\epsilon",
        '\u{3F5}' => "\\varepsilon",
        '\u{3B6}' => "\\zeta",
        '\u{3B7}' => "\\eta",
        '\u{3B8}' => "\\theta",
        '\u{3B9}' => "\\iota",
        '\u{3BA}' => "\\kappa",
        '\u{3BB}' => "\\lambda",
        '\u{3BC}' => "\\mu",
        '\u{3BD}' => "\\nu",
        '\u{3BE}' => "\\xi",
        '\u{3C0}' => "\\pi",
        '\u{3C1}' => "\\rho",
        '\u{3C2}' => "\\varsigma",
        '\u{3C3}' => "\\sigma",
        '\u{3C4}' => "\\tau",
        '\u{3C5}' => "\\upsilon",
        '\u{3C6}' => "\\phi",
        '\u{3D5}' => "\\varphi",
        '\u{3C7}' => "\\chi",
        '\u{3C8}' => "\\psi",
        '\u{3C9}' => "\\omega",
        '\u{393}' => "\\Gamma",
        '\u{394}' => "\\Delta",
        '\u{398}' => "\\Theta",
        '\u{39B}' => "\\Lambda",
        '\u{39E}' => "\\Xi",
        '\u{3A0}' => "\\Pi",
        '\u{3A3}' => "\\Sigma",
        '\u{3A5}' => "\\Upsilon",
        '\u{3A6}' => "\\Phi",
        '\u{3A8}' => "\\Psi",
        '\u{3A9}' => "\\Omega",
        '\u{2264}' => "\\leq",
        '\u{2265}' => "\\geq",
        '\u{2260}' => "\\neq",
        '\u{2248}' => "\\approx",
        '\u{2261}' => "\\equiv",
        '\u{221E}' => "\\infty",
        '\u{2211}' => "\\sum",
        '\u{220F}' => "\\prod",
        '\u{222B}' => "\\int",
        '\u{221A}' => "\\surd",
        '\u{2202}' => "\\partial",
        '\u{2207}' => "\\nabla",
        '\u{2208}' => "\\in",
        '\u{2209}' => "\\notin",
        '\u{2282}' => "\\subset",
        '\u{2286}' => "\\subseteq",
        '\u{222A}' => "\\cup",
        '\u{2229}' => "\\cap",
        '\u{2200}' => "\\forall",
        '\u{2203}' => "\\exists",
        '\u{2205}' => "\\emptyset",
        '\u{2227}' => "\\wedge",
        '\u{2228}' => "\\vee",
        '\u{00AC}' => "\\neg",
        '\u{221D}' => "\\propto",
        '\u{223C}' => "\\sim",
        '\u{226A}' => "\\ll",
        '\u{226B}' => "\\gg",
        '\u{22C5}' | '\u{00B7}' => "\\cdot",
        '\u{2218}' => "\\circ",
        '\u{2295}' => "\\oplus",
        '\u{2297}' => "\\otimes",
        '\u{2220}' => "\\angle",
        '\u{211D}' => "\\mathbb{R}",
        '\u{2115}' => "\\mathbb{N}",
        '\u{2124}' => "\\mathbb{Z}",
        '\u{211A}' => "\\mathbb{Q}",
        '\u{2102}' => "\\mathbb{C}",
        '\u{2212}' => "-",
        '\u{00D7}' => "\\times",
        '\u{00F7}' => "\\div",
        '\u{00B1}' => "\\pm",
        '\u{2213}' => "\\mp",
        '\u{2190}' => "\\leftarrow",
        '\u{2192}' => "\\rightarrow",
        '\u{2194}' => "\\leftrightarrow",
        '\u{21D0}' => "\\Leftarrow",
        '\u{21D2}' => "\\Rightarrow",
        '\u{21D4}' => "\\Leftrightarrow",
        '\u{2191}' => "\\uparrow",
        '\u{2193}' => "\\downarrow",
        '\u{21A6}' => "\\mapsto",
        '\u{2026}' => "\\ldots",
        '\u{22EF}' => "\\cdots",
        '\u{2032}' => "'",
        '\u{00B0}' => "^{\\circ}",
        _ => return None,
    })
}

/// The address of a link for `\href`, or `None` when the address is not one that a document should link to.
/// Only web, mail, and phone addresses are kept. The characters that LaTeX reads as syntax are percent-encoded,
/// which names the same address, or escaped where the address would change.
pub fn href_target(url: &str) -> Option<String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let known = ["http://", "https://", "mailto:", "ftp://", "tel:"];
    if url.len() > 2048 || !known.iter().any(|scheme| lower.starts_with(scheme)) {
        return None;
    }
    let mut out = String::with_capacity(url.len() + 8);
    for c in url.chars() {
        match c {
            '%' => out.push_str("\\%"),
            '#' => out.push_str("\\#"),
            '&' => out.push_str("\\&"),
            c if c.is_ascii_alphanumeric() || "-.:/?=+;,@!*'()[]".contains(c) => out.push(c),
            c => {
                let mut buffer = [0u8; 4];
                for byte in c.encode_utf8(&mut buffer).bytes() {
                    out.push_str(&format!("\\%{byte:02X}"));
                }
            }
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn escaped(text_in: &str, engine: Engine) -> (String, Missing) {
        let mut missing = Missing::default();
        let out = text(text_in, engine, &mut missing);
        (out, missing)
    }

    #[test]
    fn every_special_character_is_escaped() {
        let (out, _) = escaped("a\\b {c} $5 & 10% #1 x_y ~ ^ < > | `q`", Engine::Unicode);
        assert_eq!(
            out,
            "a\\textbackslash{}b \\{c\\} \\$5 \\& 10\\% \\#1 x\\_y \\textasciitilde{} \\textasciicircum{} \
             \\textless{} \\textgreater{} \\textbar{} \\textasciigrave{}q\\textasciigrave{}"
        );
    }

    #[test]
    fn controls_are_dropped_and_breaks_become_spaces() {
        let (out, _) = escaped("one\u{0}two\nthree\tfour\u{FEFF}\u{E000}", Engine::Unicode);
        assert_eq!(out, "onetwo three four");
    }

    #[test]
    fn unicode_engines_pass_text_through_and_pdflatex_maps_what_it_can() {
        assert_eq!(escaped("café Ω → 日本", Engine::Unicode).0, "café Ω → 日本");
        let (out, missing) = escaped("café Ω → 日", Engine::Pdflatex);
        assert_eq!(out, "café \\ensuremath{\\Omega} \\ensuremath{\\rightarrow} ?");
        assert_eq!(missing.chars.into_iter().collect::<String>(), "日");
    }

    #[test]
    fn links_keep_only_web_style_addresses_and_encode_the_syntax() {
        assert_eq!(href_target("javascript:alert(1)"), None);
        assert_eq!(href_target("file:///etc/passwd"), None);
        assert_eq!(
            href_target("https://a.org/x_y~z?q=1&r=50%#top").as_deref(),
            Some("https://a.org/x\\%5Fy\\%7Ez?q=1\\&r=50\\%\\#top")
        );
        assert_eq!(
            href_target("https://a.org/{b}\\c d").as_deref(),
            Some("https://a.org/\\%7Bb\\%7D\\%5Cc\\%20d")
        );
    }

    #[test]
    fn pdf_info_keeps_plain_text() {
        assert_eq!(pdf_info("Notes: \\a{b} 50% 日本", Engine::Pdflatex), "Notes: a b 50");
    }
}
