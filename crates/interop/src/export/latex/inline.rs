//! Runs of text with their marks, as LaTeX.

use super::escape::{self, href_target};
use super::math;
use super::writer::Writer;
use super::Engine;
use crate::doc::{Inline, Marks, Script};
use crate::export::footnotes::{split_markers, Piece};

/// The color of a highlighter name, written for the color package. The default highlight, `honey`, is yellow.
fn highlight_color(name: &str) -> &'static str {
    match name {
        "green" | "mint" | "lime" => "green!35",
        "blue" | "sky" | "cyan" => "cyan!35",
        "pink" | "rose" | "red" => "pink!60",
        "orange" | "peach" => "orange!45",
        "purple" | "lilac" | "violet" => "violet!30",
        _ => "yellow!60",
    }
}

fn hex_color(color: &str) -> Option<String> {
    crate::palette::color_hex(color)
}

/// The ulem command of an underline style: `\uline`, `\uuline` (double), `\uwave`, `\dashuline`, or `\dotuline`.
fn underline_command(line: Option<&str>) -> &'static str {
    match line {
        Some("double") => "uuline",
        Some("wave" | "wavyHeavy" | "wavyDouble") => "uwave",
        Some("dotted" | "dottedHeavy") => "dotuline",
        Some(
            "dash" | "dashedHeavy" | "dashLong" | "dashLongHeavy" | "dotDash" | "dashDotHeavy" | "dotDotDash"
            | "dashDotDotHeavy",
        ) => "dashuline",
        _ => "uline",
    }
}

/// Whether the path is one that this export wrote for a picture.
pub(super) fn picture_path(dest: &str) -> bool {
    let Some(name) = dest.strip_prefix("images/") else {
        return false;
    };
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        && matches!(extension, "png" | "jpg" | "pdf")
}

impl Writer<'_> {
    /// Inlines as LaTeX, without a break at either end.
    pub(super) fn inlines(&mut self, inlines: &[Inline]) -> String {
        let mut out = String::new();
        for inline in inlines {
            match inline {
                Inline::Text { text, marks } => out.push_str(&self.run(text, marks)),
                Inline::HardBreak if self.simple => out.push(' '),
                Inline::HardBreak => {
                    if !out.trim().is_empty() && !out.ends_with("\\newline{}") {
                        out.push_str("\\newline{}");
                    }
                }
                Inline::SoftBreak => out.push(' '),
                Inline::Image { dest, alt } => out.push_str(&self.picture(dest, alt)),
                Inline::Note { .. } => {}
            }
        }
        let trimmed = out.trim_end_matches("\\newline{}").trim();
        trimmed.to_owned()
    }

    /// The inlines as one line of plain text, with nothing that could break a PDF outline or a contents entry.
    pub(super) fn heading_pdf_text(&mut self, inlines: &[Inline]) -> String {
        let plain = crate::export::footnotes::strip_markers(&crate::doc::plain_text(inlines));
        super::escape::pdf_outline(&plain, self.engine)
    }

    fn picture(&mut self, dest: &str, alt: &str) -> String {
        if picture_path(dest) && !self.simple {
            return format!("\\includegraphics[height=1.2em]{{{dest}}}");
        }
        if !picture_path(dest) {
            self.stats.remote_images += 1;
        }
        let name = if alt.is_empty() { "image" } else { alt };
        self.esc(&format!("[{name}]"))
    }

    fn run(&mut self, text: &str, marks: &Marks) -> String {
        let base = if marks.math {
            match math::inline(text, self.engine, &mut self.missing) {
                Some(tex) => tex,
                None => {
                    self.stats.math_as_text += 1;
                    // The source as typed, with its dollar signs and backslashes.
                    format!("\\texttt{{{}}}", self.esc(&format!("${text}$")))
                }
            }
        } else if marks.code {
            format!("\\texttt{{{}}}", self.esc(text))
        } else {
            self.plain_run(text)
        };
        if base.is_empty() {
            return base;
        }
        self.mark(base, marks)
    }

    /// Text with its footnote markers turned into footnotes where one may stand.
    fn plain_run(&mut self, text: &str) -> String {
        if self.notes.is_empty() || !text.contains(crate::export::footnotes::OPEN) {
            return self.esc(text);
        }
        let mut out = String::new();
        for piece in split_markers(text, self.notes.len()) {
            match piece {
                Piece::Text(part) => out.push_str(&self.esc(part)),
                Piece::Note(index) => out.push_str(&self.note(index)),
            }
        }
        out
    }

    /// The note at a marker: `\footnote` where text may hold one, a `\footnotemark` in a table cell (the text follows
    /// the table), and nothing where no note may stand. A note cited twice is written twice, each time whole.
    fn note(&mut self, index: usize) -> String {
        if !self.allow_notes && self.table_notes.is_none() {
            return String::new();
        }
        let note = self.notes[index].clone();
        let table = self.table_notes.take();
        let was = std::mem::replace(&mut self.allow_notes, false);
        let body = self.inlines(&note);
        self.allow_notes = was;
        self.stats.footnotes += 1;
        match table {
            None => format!("\\footnote{{{body}}}"),
            Some(mut list) => {
                list.push(body);
                let number = list.len();
                self.table_notes = Some(list);
                format!("\\footnotemark[\\numexpr\\value{{opnfn}}+{number}\\relax]")
            }
        }
    }

    /// Wraps the text in its marks, innermost first, in the order of spec 7.7.
    fn mark(&mut self, base: String, marks: &Marks) -> String {
        let mut text = base;
        match marks.script {
            Some(Script::Sub) => text = format!("\\textsubscript{{{text}}}"),
            Some(Script::Sup) => text = format!("\\textsuperscript{{{text}}}"),
            None => {}
        }
        match marks.caps.as_deref() {
            Some("small") => text = format!("\\textsc{{{text}}}"),
            Some("all") => text = format!("\\MakeUppercase{{{text}}}"),
            _ => {}
        }
        match marks.size.as_deref() {
            Some("small") => text = format!("{{\\small {text}}}"),
            Some("large") => text = format!("{{\\large {text}}}"),
            Some("xlarge") => text = format!("{{\\Large {text}}}"),
            Some(size) => {
                if let Some(points) = crate::doc::size_points(size) {
                    let leading = (points * 12.0).round() / 10.0;
                    text = format!("{{\\fontsize{{{points}}}{{{leading}}}\\selectfont {text}}}");
                }
            }
            None => {}
        }
        // `\opnfont` does nothing under pdfLaTeX and for a font the machine lacks (see the preamble).
        if self.engine == Engine::Unicode && !self.simple {
            if let Some(font) = marks.font.as_deref().filter(|f| !f.starts_with('+')) {
                let name = escape::text(font, Engine::Unicode, &mut self.missing);
                text = format!("{{\\opnfont{{{name}}}{text}}}");
            }
            if let Some(name) = marks.lang.as_deref().and_then(polyglossia_name) {
                if !self.languages.contains(&name) {
                    self.languages.push(name);
                }
                text = format!("\\opnlang{{{name}}}{{{text}}}");
            }
        }
        if !self.simple {
            if let Some(hex) = marks.color.as_deref().and_then(hex_color) {
                text = format!("\\textcolor[HTML]{{{hex}}}{{{text}}}");
            }
            if let Some(hex) = marks.shade.as_deref().and_then(hex_color) {
                text = format!("\\opnhlx{{{hex}}}{{{text}}}");
            }
            if let Some(name) = &marks.highlight {
                text = match name.starts_with('#').then(|| hex_color(name)).flatten() {
                    Some(hex) => format!("\\opnhlx{{{hex}}}{{{text}}}"),
                    None => format!("\\opnhl{{{}}}{{{text}}}", highlight_color(name)),
                };
            }
            if marks.underline {
                text = format!("\\{}{{{text}}}", underline_command(marks.underline_line.as_deref()));
            }
            if marks.strike {
                text = if marks.strike_double {
                    format!("\\xout{{{text}}}")
                } else {
                    format!("\\sout{{{text}}}")
                };
            }
        }
        if marks.emphasis {
            text = format!("\\emph{{{text}}}");
        }
        if marks.strong {
            text = format!("\\textbf{{{text}}}");
        }
        match &marks.link {
            Some(dest) if !self.simple => self.link(dest, text),
            _ => text,
        }
    }

    fn link(&mut self, dest: &str, text: String) -> String {
        if let Some(page) = dest.strip_prefix("#page-").and_then(|n| n.parse::<usize>().ok()) {
            if (1..=self.pages).contains(&page) {
                return format!("\\hyperref[page:{page}]{{{text}}}");
            }
        }
        match href_target(dest) {
            Some(target) => format!("\\href{{{target}}}{{{text}}}"),
            None => {
                if !dest.starts_with('#') {
                    self.stats.links_as_text += 1;
                }
                text
            }
        }
    }
}

/// The polyglossia name of a language tag, for the languages it knows besides English (the main language).
pub(super) fn polyglossia_name(tag: &str) -> Option<&'static str> {
    Some(match tag.split('-').next()? {
        "es" => "spanish",
        "fr" => "french",
        "de" => "german",
        "it" => "italian",
        "pt" => "portuguese",
        "nl" => "dutch",
        "ru" => "russian",
        "pl" => "polish",
        "sv" => "swedish",
        "da" => "danish",
        "fi" => "finnish",
        "el" => "greek",
        "tr" => "turkish",
        "cs" => "czech",
        "la" => "latin",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::super::writer::Library;
    use super::super::Engine;
    use super::*;

    fn marked(text: &str, marks: Marks) -> Inline {
        Inline::marked(text, marks)
    }

    fn render(inlines: &[Inline]) -> String {
        let library = Library::new(Vec::new());
        let mut writer = Writer::new(Engine::Unicode, &library, 3);
        writer.inlines(inlines)
    }

    #[test]
    fn marks_nest_in_the_order_of_the_spec() {
        let marks = Marks {
            strong: true,
            emphasis: true,
            strike: true,
            underline: true,
            highlight: Some("honey".to_owned()),
            link: Some("https://example.org/a_b".to_owned()),
            ..Marks::default()
        };
        assert_eq!(
            render(&[marked("hi & bye", marks)]),
            "\\href{https://example.org/a\\%5Fb}{\\textbf{\\emph{\\sout{\\uline{\\opnhl{yellow!60}{hi \\& bye}}}}}}"
        );
    }

    #[test]
    fn version_two_marks_map_to_ulem_and_friends() {
        let run = |marks: Marks| render(&[marked("x", marks)]);
        let caps = Marks {
            caps: Some("small".to_owned()),
            ..Marks::default()
        };
        assert_eq!(run(caps), "\\textsc{x}");
        let double = Marks {
            underline: true,
            underline_line: Some("double".to_owned()),
            ..Marks::default()
        };
        assert_eq!(run(double), "\\uuline{x}");
        let wave = Marks {
            underline: true,
            underline_line: Some("wave".to_owned()),
            ..Marks::default()
        };
        assert_eq!(run(wave), "\\uwave{x}");
        let strike = Marks {
            strike: true,
            strike_double: true,
            ..Marks::default()
        };
        assert_eq!(run(strike), "\\xout{x}");
        let sized = Marks {
            size: Some("10.5".to_owned()),
            font: Some("Georgia".to_owned()),
            ..Marks::default()
        };
        assert_eq!(run(sized), "{\\opnfont{Georgia}{\\fontsize{10.5}{12.6}\\selectfont x}}");
        let shaded = Marks {
            shade: Some("#ffeecc".to_owned()),
            ..Marks::default()
        };
        assert_eq!(run(shaded), "\\opnhlx{FFEECC}{x}");
    }

    #[test]
    fn fonts_and_languages_go_through_the_helpers_with_an_escaped_name() {
        let font = Marks {
            font: Some("Fira_Sans".to_owned()),
            lang: Some("fr-CA".to_owned()),
            ..Marks::default()
        };
        let out = render(&[marked("x", font)]);
        assert_eq!(out, "\\opnlang{french}{{\\opnfont{Fira\\_Sans}x}}");
        assert!(!out.contains("fontspec"), "{out}");
        let english = Marks {
            lang: Some("en-US".to_owned()),
            ..Marks::default()
        };
        assert_eq!(render(&[marked("x", english)]), "x");
    }

    #[test]
    fn code_math_and_scripts() {
        let code = Marks {
            code: true,
            ..Marks::default()
        };
        let math = Marks {
            math: true,
            ..Marks::default()
        };
        let sup = Marks {
            script: Some(Script::Sup),
            ..Marks::default()
        };
        assert_eq!(
            render(&[
                marked("a_b", code),
                Inline::text(" "),
                marked("x^2", math),
                marked("th", sup)
            ]),
            "\\texttt{a\\_b} $x^2$\\textsuperscript{th}"
        );
    }

    #[test]
    fn unsafe_math_and_links_fall_back_to_text() {
        let math = Marks {
            math: true,
            ..Marks::default()
        };
        assert_eq!(
            render(&[marked("\\input{x}", math)]),
            "\\texttt{\\$\\textbackslash{}input\\{x\\}\\$}"
        );
        let link = Marks::link("javascript:alert(1)");
        assert_eq!(render(&[marked("click", link)]), "click");
        let page = Marks::link("#page-2");
        assert_eq!(render(&[marked("next", page)]), "\\hyperref[page:2]{next}");
        let gone = Marks::link("#page-9");
        assert_eq!(render(&[marked("lost", gone)]), "lost");
    }

    #[test]
    fn breaks_images_and_pictures() {
        assert_eq!(
            render(&[
                Inline::text("one"),
                Inline::HardBreak,
                Inline::HardBreak,
                Inline::text("two"),
                Inline::HardBreak
            ]),
            "one\\newline{}two"
        );
        assert_eq!(
            render(&[Inline::Image {
                dest: "images/leaf.png".to_owned(),
                alt: "Leaf".to_owned()
            }]),
            "\\includegraphics[height=1.2em]{images/leaf.png}"
        );
        assert_eq!(
            render(&[Inline::Image {
                dest: "https://example.org/x.png".to_owned(),
                alt: "Far".to_owned()
            }]),
            "[Far]"
        );
        assert!(!picture_path("images/../x.png") && !picture_path("images/a b.png") && !picture_path("x.png"));
    }
}
