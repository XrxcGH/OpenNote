//! Blocks as LaTeX: headings, paragraphs, lists, quotes, callouts, code, and equations.

use super::math;
use super::writer::{Writer, MAX_LISTS, MAX_NEST};
use crate::doc::{Block, Inline, Item};

/// The sectioning command for a heading level, from 1. Levels past five are bold run-in text.
fn section_command(level: usize) -> Option<&'static str> {
    match level {
        0 | 1 => Some("section"),
        2 => Some("subsection"),
        3 => Some("subsubsection"),
        4 => Some("paragraph"),
        5 => Some("subparagraph"),
        _ => None,
    }
}

impl Writer<'_> {
    /// A heading at the given level: `\section{...}` and so on, with a plain version for the outline.
    pub(super) fn heading(&mut self, level: usize, content: &[Inline]) -> String {
        let was = std::mem::replace(&mut self.simple, true);
        let noted = self.stats.footnotes;
        let shown = self.inlines(content);
        // A footnote does not belong in the table of contents or the outline, so a heading that holds one gets a
        // short title without it, and the footnote stays in the heading itself.
        let short = if self.stats.footnotes > noted {
            let saved = self.stats.clone();
            let notes = std::mem::replace(&mut self.allow_notes, false);
            let short = self.inlines(content);
            self.allow_notes = notes;
            self.stats = saved;
            Some(short)
        } else {
            None
        };
        self.simple = was;
        let plain = self.heading_pdf_text(content);
        if shown.is_empty() {
            return String::new();
        }
        match section_command(level) {
            Some(command) => match short {
                Some(short) => format!(
                    "\\{command}[\\texorpdfstring{{{short}}}{{{plain}}}]{{\\texorpdfstring{{{shown}}}{{{plain}}}}}"
                ),
                None => format!("\\{command}{{\\texorpdfstring{{{shown}}}{{{plain}}}}}"),
            },
            None => format!("\\medskip\\noindent\\textbf{{{shown}}}\\par\\nopagebreak"),
        }
    }

    /// Blocks joined by blank lines.
    pub(super) fn blocks(&mut self, blocks: &[Block], nest: usize) -> String {
        let mut parts = Vec::new();
        for block in blocks {
            let text = self.block(block, nest);
            if !text.trim().is_empty() {
                parts.push(text);
            }
        }
        parts.join("\n\n")
    }

    pub(super) fn block(&mut self, block: &Block, nest: usize) -> String {
        if nest > MAX_NEST {
            self.stats.too_deep += 1;
            return String::new();
        }
        match block {
            Block::Paragraph(content) => self.paragraph(content),
            Block::Heading { level, content } => {
                // A heading inside a list or a quote cannot be a section, so it is bold text.
                let level = if nest > 0 {
                    usize::MAX
                } else {
                    self.base + usize::from(*level)
                };
                self.heading(level, content)
            }
            Block::List { ordered, start, items } => self.list(*ordered, *start, items, nest),
            Block::Quote(blocks) => self.quote(blocks, nest, None),
            Block::Callout {
                kind, title, blocks, ..
            } => {
                let label = self.callout_label(kind, title);
                self.quote(blocks, nest, Some(label))
            }
            Block::Code { language, text } => self.code(language, text),
            Block::Break => "\\par\\medskip\\noindent\\rule{\\linewidth}{0.4pt}\\par\\medskip".to_owned(),
            Block::Table { header, rows } => self.table(*header, rows),
        }
    }

    fn paragraph(&mut self, content: &[Inline]) -> String {
        if let [Inline::Text { text, marks }] = content {
            if marks.math {
                return self.display(text);
            }
        }
        self.inlines(content)
    }

    /// A display equation, or its source as text when it cannot be set safely.
    pub(super) fn display(&mut self, source: &str) -> String {
        match math::display(source, self.engine, &mut self.missing) {
            Some(tex) => {
                self.stats.equations += 1;
                tex
            }
            None => {
                self.stats.math_as_text += 1;
                let lines: Vec<String> = source.lines().map(|line| self.esc(line)).collect();
                format!(
                    "\\begin{{quote}}\\ttfamily\\raggedright {}\\end{{quote}}",
                    lines.join("\\newline{} ")
                )
            }
        }
    }

    fn list(&mut self, ordered: bool, start: u64, items: &[Item], nest: usize) -> String {
        if items.is_empty() {
            return String::new();
        }
        let deep = nest >= MAX_LISTS;
        let mut out = Vec::new();
        for (index, item) in items.iter().enumerate() {
            let body = self.blocks(&item.blocks, nest + 1);
            let line = if deep {
                let number = start.saturating_add(index as u64);
                let mark = match (ordered, item.task) {
                    (_, Some(true)) => "$\\boxtimes$".to_owned(),
                    (_, Some(false)) => "$\\square$".to_owned(),
                    (true, None) => format!("{number}."),
                    (false, None) => "\\textbullet{}".to_owned(),
                };
                format!("\\par\\hangindent=1.5em\\hangafter=1 {mark}~{body}\\par")
            } else {
                match item.task {
                    Some(true) => format!("\\item[$\\boxtimes$] {body}"),
                    Some(false) => format!("\\item[$\\square$] {body}"),
                    None => format!("\\item\\relax {body}"),
                }
            };
            out.push(line);
        }
        if deep {
            return out.join("\n");
        }
        let (name, options) = if ordered {
            ("enumerate", format!("[start={}]", start.min(2_000_000_000)))
        } else {
            ("itemize", String::new())
        };
        format!("\\begin{{{name}}}{options}\n{}\n\\end{{{name}}}", out.join("\n"))
    }

    fn quote(&mut self, blocks: &[Block], nest: usize, label: Option<String>) -> String {
        let body = self.blocks(blocks, nest + 1);
        let content = match label {
            Some(label) if body.is_empty() => label,
            Some(label) => format!("{label}\\par\n{body}"),
            None => body,
        };
        if content.trim().is_empty() {
            return String::new();
        }
        if nest >= MAX_LISTS {
            return content;
        }
        format!("\\begin{{quote}}\n{content}\n\\end{{quote}}")
    }

    /// The bold first line of a callout: its type, and its title when it has one.
    fn callout_label(&mut self, kind: &str, title: &[Inline]) -> String {
        let mut name = kind.to_owned();
        if let Some(first) = name.get_mut(..1) {
            first.make_ascii_uppercase();
        }
        let kind = self.esc(&name);
        let was = std::mem::replace(&mut self.allow_notes, false);
        let title = self.inlines(title);
        self.allow_notes = was;
        if title.is_empty() {
            format!("\\noindent\\textbf{{{kind}}}")
        } else {
            format!("\\noindent\\textbf{{{kind}: {title}}}")
        }
    }

    /// Code, one line at a time. It is typeset, not set in a verbatim environment, because nothing in a code block
    /// can then end the environment early and let its text be read as TeX.
    fn code(&mut self, language: &str, text: &str) -> String {
        let mut lines = Vec::new();
        for line in text.lines() {
            lines.push(format!("\\opncodeline{{{}}}", self.code_line(line)));
        }
        if lines.is_empty() {
            return String::new();
        }
        let note = if language.is_empty() {
            String::new()
        } else {
            format!("% language: {}\n", super::escape::comment(language))
        };
        format!("{note}\\begin{{opncode}}\n{}\n\\end{{opncode}}", lines.join("\n"))
    }

    fn code_line(&mut self, line: &str) -> String {
        let mut out = String::new();
        for c in line.chars() {
            match c {
                ' ' => out.push_str("\\ "),
                '\t' => out.push_str("\\ \\ \\ \\ "),
                c => {
                    let piece = self.esc(&c.to_string());
                    let breakable = "/.,;:-_=()[]{}&?@+*#%|<>\\".contains(c);
                    out.push_str(&piece);
                    if breakable {
                        out.push_str("\\allowbreak{}");
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::super::writer::Library;
    use super::super::Engine;
    use super::*;
    use crate::doc::parse::{parse, SoftBreaks};

    fn render(markdown: &str) -> String {
        let library = Library::new(Vec::new());
        let mut writer = Writer::new(Engine::Unicode, &library, 1);
        let blocks = parse(markdown, SoftBreaks::Space).blocks;
        writer.blocks(&blocks, 0)
    }

    #[test]
    fn headings_paragraphs_and_quotes() {
        let out = render("# A *big* idea\n\nSome text.\n\n> quoted\n\n---");
        assert_eq!(
            out,
            "\\section{\\texorpdfstring{A \\emph{big} idea}{A big idea}}\n\nSome text.\n\n\
             \\begin{quote}\nquoted\n\\end{quote}\n\n\\par\\medskip\\noindent\\rule{\\linewidth}{0.4pt}\\par\\medskip"
        );
    }

    #[test]
    fn lists_nest_and_tasks_and_numbers_keep_their_marks() {
        let out = render("- one\n  - inner\n- [x] done\n- [ ] todo\n\n3. third\n4. fourth");
        assert!(out.starts_with("\\begin{itemize}\n\\item\\relax one"), "{out}");
        assert!(
            out.contains("\\begin{itemize}\n\\item\\relax inner\n\\end{itemize}"),
            "{out}"
        );
        assert!(
            out.contains("\\item[$\\boxtimes$] done") && out.contains("\\item[$\\square$] todo"),
            "{out}"
        );
        assert!(
            out.contains("\\begin{enumerate}[start=3]\n\\item\\relax third\n\\item\\relax fourth"),
            "{out}"
        );
    }

    #[test]
    fn code_cannot_end_its_own_environment() {
        let out = render("```rust\nfn main() {\n\\end{opncode}\\input{x}\n}\n```");
        assert!(out.starts_with("% language: rust\n\\begin{opncode}\n"), "{out}");
        assert_eq!(out.matches("\\end{opncode}").count(), 1, "{out}");
        assert!(out.contains("\\textbackslash{}\\allowbreak{}end"), "{out}");
    }

    #[test]
    fn equations_are_display_math_or_text() {
        let out = render("$$\nE = mc^2\n$$\n\n$$\n\\input{x}\n$$");
        assert!(out.starts_with("\\[\nE = mc^2\n\\]"), "{out}");
        assert!(
            out.contains("\\begin{quote}\\ttfamily\\raggedright \\textbackslash{}input\\{x\\}\\end{quote}"),
            "{out}"
        );
    }

    #[test]
    fn deep_nesting_is_cut_instead_of_overflowing() {
        let markdown = format!("{}x", "> ".repeat(60));
        let out = render(&markdown);
        assert!(out.matches("\\begin{quote}").count() <= MAX_LISTS, "{out}");
    }
}
