//! LaTeX export: a page, a section, or a notebook becomes a `.tex` file, with a `.zip` when there are pictures or sources.
//!
//! No TeX engine is needed here. `check_tex` is a structural validator: it reads the file the way TeX would at the
//! level of braces and environments, and refuses any command that could read a file or redefine the document. CI also
//! compiles the exports (`.github/workflows`, "LaTeX export").

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use opennote_core::model::{Block, BlockData, NotebookFile, OtherData, Page, TextData};
use opennote_core::testing::sample::{sample_asset_id, sample_page};
use opennote_core::NotebookId;
use opennote_interop::testing::{at, png_bytes, sample_notebook, unzip, TestEnv};
use opennote_interop::tree::{section_orders, SectionBuilder};
use opennote_interop::{
    export_latex, export_latex_with, latex_preview, CancelToken, Control, ImportedPage, InteropError, LatexCitation,
    LatexEngine, LatexOptions, MemorySource, NoteSource, Scope,
};

/// Every control word the exporter writes into the body, listed here by hand. A word outside this list and
/// [`MATH_COMMANDS`] fails `check_tex`, so a command that slips through from a page (a file read, a definition, a hook)
/// is caught however unusual its name.
const BODY_COMMANDS: &[&str] = &[
    "begin",
    "end",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
    "texorpdfstring",
    "textbf",
    "emph",
    "texttt",
    "uline",
    "sout",
    "textsuperscript",
    "textsubscript",
    "opnhl",
    "href",
    "hyperref",
    "ref",
    "label",
    "eqref",
    "cite",
    "footnote",
    "item",
    "noindent",
    "par",
    "newline",
    "relax",
    "medskip",
    "bigskip",
    "midrule",
    "toprule",
    "bottomrule",
    "endhead",
    "endfirsthead",
    "captionof",
    "includegraphics",
    "maketitle",
    "tableofcontents",
    "textbackslash",
    "textasciitilde",
    "textasciicircum",
    "textasciigrave",
    "textless",
    "textgreater",
    "textbar",
    "textquotedbl",
    "textunderscore",
    "allowbreak",
    "opncodeline",
    "ensuremath",
    "boxtimes",
    "square",
    "raggedright",
    "small",
    "setcounter",
    "renewcommand",
    "arraystretch",
    "ttfamily",
    "bibliography",
    "bibliographystyle",
    "nocite",
    "rule",
    "linewidth",
    "today",
];

/// Math commands the tests put in equations; the exporter keeps only the ones it knows (see `export::latex::math`).
const MATH_COMMANDS: &[&str] = &[
    "alpha",
    "beta",
    "gamma",
    "Omega",
    "sum",
    "frac",
    "sqrt",
    "leq",
    "rightarrow",
    "pmatrix",
    "left",
    "right",
    "cdot",
    "times",
    "mathbb",
    "mathrm",
    "text",
    "partial",
    "infty",
    "in",
    "pm",
    "sin",
    "cos",
    "log",
    "int",
    "prod",
    "lim",
    "xi",
    "zeta",
    "circ",
    "iff",
];

/// Reads a `.tex` file the way TeX would at the level of braces and environments, and panics at the first thing that
/// would stop a compile or reach outside the document. Returns the text after `\begin{document}`.
fn check_tex(tex: &str) -> String {
    let body_at = tex.find("\\begin{document}").expect("a document");
    let body = &tex[body_at..];
    let mut stack: Vec<String> = Vec::new();
    let mut unknown: Vec<String> = Vec::new();
    let mut depth = 0i64;
    let mut chars = body.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '%' => while chars.next_if(|(_, c)| *c != '\n').is_some() {},
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                assert!(
                    depth >= 0,
                    "an extra closing brace near {:?}",
                    &body[i.saturating_sub(40)..i]
                );
            }
            '\\' => {
                let rest = &body[i + 1..];
                let word: String = rest.chars().take_while(char::is_ascii_alphabetic).collect();
                if word.is_empty() {
                    chars.next();
                    continue;
                }
                for _ in 0..word.len() {
                    chars.next();
                }
                match word.as_str() {
                    "begin" | "end" => {
                        let after = &rest[word.len()..];
                        let name = after
                            .strip_prefix('{')
                            .and_then(|a| a.split_once('}'))
                            .map(|(n, _)| n.to_owned())
                            .expect("an environment name");
                        if word == "begin" {
                            stack.push(name);
                        } else {
                            assert_eq!(stack.pop(), Some(name.clone()), "\\end{{{name}}} does not match");
                        }
                    }
                    other => {
                        if !(BODY_COMMANDS.contains(&other) || MATH_COMMANDS.contains(&other))
                            && !unknown.contains(&other.to_owned())
                        {
                            unknown.push(other.to_owned());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    assert!(
        unknown.is_empty(),
        "the body uses control words that the exporter does not emit and math may not use: {unknown:?}"
    );
    assert_eq!(depth, 0, "unbalanced braces");
    assert!(stack.is_empty(), "environments left open: {stack:?}");
    assert!(
        body.trim_end().ends_with("\\end{document}"),
        "the file ends the document"
    );
    body.to_owned()
}

fn page_of(source: &MemorySource, title: &str) -> Page {
    source
        .pages()
        .into_iter()
        .find(|p| p.title == title)
        .expect("the page")
        .clone()
}

/// Gives the first text block of the page this Markdown.
fn set_markdown(page: &mut Page, markdown: &str) {
    let first = page
        .blocks
        .iter()
        .find(|b| matches!(b.data, BlockData::Text(_)))
        .expect("a text block")
        .clone();
    let BlockData::Text(text) = &first.data else {
        unreachable!()
    };
    let data = TextData {
        markdown: Arc::from(markdown),
        ..text.clone()
    };
    let mut block: Block = (*first).clone();
    block.data = BlockData::Text(data);
    page.blocks.replace(Arc::new(block)).expect("replaces");
}

/// A notebook of one page with this Markdown in its text block, and the core's sample picture and stroke.
fn notebook_with(env: &opennote_interop::ImportEnv<'_>, markdown: &str) -> MemorySource {
    let created = at("2026-03-04T10:00:00Z");
    let mut source = MemorySource::new(NotebookFile::new(NotebookId::generate(env.clock), "Chemistry", created));
    let mut page = sample_page();
    set_markdown(&mut page, markdown);
    let mut section = SectionBuilder::new(env, "Notes", created);
    section.add_page(&page, None);
    let asset_bytes = BTreeMap::from([(sample_asset_id(), png_bytes())]);
    source.add_page(ImportedPage { page, asset_bytes });
    let order = section_orders(1).expect("a key").remove(0);
    source.add_section(section.finish(order).expect("the section builds"));
    source
}

fn tex_of(source: &MemorySource, scope: Scope, options: &LatexOptions) -> String {
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_latex(source, scope, options, out.path()).expect("exports");
    let path = &exported.files[0];
    if path.extension().is_some_and(|e| e == "zip") {
        let files = unzip(&fs::read(path).expect("reads"));
        let tex = files.iter().find(|(n, _)| n.ends_with(".tex")).expect("a tex file");
        String::from_utf8(tex.1.clone()).expect("UTF-8")
    } else {
        fs::read_to_string(path).expect("reads")
    }
}

fn first_page_scope(source: &MemorySource) -> Scope {
    Scope::Page(source.pages()[0].id)
}

#[test]
fn a_page_with_a_picture_is_a_zip_with_the_tex_file_and_its_images() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let options = LatexOptions {
        author: "Eric & Co".to_owned(),
        ..LatexOptions::default()
    };
    let exported = export_latex(&sample.source, Scope::Page(sample.photo), &options, out.path()).expect("exports");
    assert_eq!(
        exported.files[0].file_name().and_then(|n| n.to_str()),
        Some("Photosynthesis.zip")
    );
    let files = unzip(&fs::read(&exported.files[0]).expect("reads"));
    let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        [
            "Photosynthesis/Photosynthesis.tex",
            "Photosynthesis/images/Leaf-section.png"
        ]
    );
    assert_eq!(files[1].1, png_bytes());
    let tex = String::from_utf8(files[0].1.clone()).expect("UTF-8");
    let body = check_tex(&tex);
    assert!(tex.contains("\\documentclass[11pt,letterpaper]{article}"));
    assert!(
        tex.contains("\\title{Photosynthesis}\n\\author{Eric \\& Co}\n\\date{\\today}"),
        "{tex}"
    );
    assert!(
        body.contains("\\section{\\texorpdfstring{Light reactions}{Light reactions}}"),
        "{body}"
    );
    assert!(
        body.contains("The \\textbf{thylakoid} membrane holds \\emph{water}"),
        "{body}"
    );
    assert!(body.contains("\\opnhl{yellow!60}{key terms}"), "{body}");
    assert!(body.contains("\\href{https://example.org/a\\%5Fb}{the web}"), "{body}");
    assert!(body.contains("\\item[$\\boxtimes$] Read chapter 8") && body.contains("\\item[$\\square$] Lab write-up"));
    assert!(
        body.contains("\\begin{quote}\n\\noindent\\textbf{Tip: Exam hint}"),
        "{body}"
    );
    assert!(
        body.contains("\\begin{opncode}\n\\opncodeline{let\\ x\\ =\\allowbreak{}"),
        "{body}"
    );
    assert!(
        body.contains("\\includegraphics{images/Leaf-section.png}")
            && body.contains("\\captionof{figure}{Leaf section}")
    );
    assert!(body.contains("\\includegraphics[height=1.2em]{images/Leaf-section.png}"));
    assert!(body.contains("5 \\* 3 = 15") || body.contains("5 * 3 = 15"), "{body}");
    assert!(body.contains("\\begin{tabular}{ll}") && body.contains("\\textbf{Stage} & \\textbf{Where it happens}"));
    assert!(body.contains("\\midrule") && body.contains("\\bottomrule"));
    let report = exported.report.to_markdown();
    assert!(report.contains("names of attachments"), "{report}");
}

#[test]
fn a_page_with_only_text_is_one_tex_file() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_latex(
        &sample.source,
        Scope::Page(sample.cells),
        &LatexOptions::default(),
        out.path(),
    )
    .expect("exports");
    assert_eq!(
        exported.files[0].file_name().and_then(|n| n.to_str()),
        Some("Cells--the-basics.tex")
    );
    let tex = fs::read_to_string(&exported.files[0]).expect("reads");
    let body = check_tex(&tex);
    assert!(
        body.contains("Back to Photosynthesis."),
        "a link to a page outside the export keeps its text: {body}"
    );
    assert!(body.contains("\\begin{enumerate}[start=1]\n\\item\\relax First\n\\item\\relax Second\n\\end{enumerate}"));
    // A second export beside the first does not overwrite it.
    let again = export_latex(
        &sample.source,
        Scope::Page(sample.cells),
        &LatexOptions::default(),
        out.path(),
    )
    .expect("exports");
    assert_eq!(
        again.files[0].file_name().and_then(|n| n.to_str()),
        Some("Cells--the-basics (2).tex")
    );
}

#[test]
fn a_notebook_has_sections_pages_labels_and_a_table_of_contents() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let options = LatexOptions {
        toc: true,
        date: opennote_interop::LatexDate::Edited,
        paper: opennote_interop::LatexPaper::A4,
        margin: opennote_interop::LatexMargin::Wide,
        ..LatexOptions::default()
    };
    let tex = tex_of(&sample.source, Scope::Notebook, &options);
    let body = check_tex(&tex);
    assert!(tex.contains("\\documentclass[11pt,a4paper]{article}\n\\usepackage[a4paper,margin=1.25in]{geometry}"));
    assert!(tex.contains("\\date{February 10, 2026}"), "{tex}");
    assert!(body.contains("\\maketitle\n\\tableofcontents"));
    let at = |needle: &str| {
        body.find(needle)
            .unwrap_or_else(|| panic!("missing {needle} in {body}"))
    };
    assert!(at("\\section{\\texorpdfstring{Semester 1}") < at("\\subsection{\\texorpdfstring{Photosynthesis}"));
    assert!(
        at("\\subsection{\\texorpdfstring{Photosynthesis}") < at("\\subsection{\\texorpdfstring{Cells: the basics}")
    );
    assert!(at("\\subsection{\\texorpdfstring{Cells: the basics}") < at("\\section{\\texorpdfstring{Lab}"));
    // Headings inside the first page sit below its subsection.
    assert!(
        body.contains("\\subsubsection{\\texorpdfstring{Light reactions}"),
        "{body}"
    );
    assert!(body.contains("\\label{page:1}") && body.contains("\\label{page:3}"));
    // The link from the second page to the first jumps within the document.
    assert!(body.contains("\\hyperref[page:1]{"), "{body}");
}

#[test]
fn labeled_equations_keep_their_labels_and_references_become_eqref() {
    let world = TestEnv::new();
    let markdown = "Energy is $E = mc^2$, see $\\eqref{mass}$ and $\\eqref{nope}$.\n\n\
        $$\nE = mc^2 \\label{mass}\n$$\n\n$$\n\\int_0^1 x\\,dx = \\frac12\n$$\n\n\
        $$\n\\begin{align} a &= b \\\\ c &= d \\label{abcd} \\end{align}\n$$";
    let source = notebook_with(&world.env(), markdown);
    let tex = tex_of(&source, first_page_scope(&source), &LatexOptions::default());
    let body = check_tex(&tex);
    assert!(body.contains("$E = mc^2$, see $\\eqref{p1:mass}$ and (??)."), "{body}");
    assert!(
        body.contains("\\begin{equation}\nE = mc^2 \\label{p1:mass}\n\\end{equation}"),
        "{body}"
    );
    assert!(body.contains("\\[\n\\int_0^1 x\\,dx = \\frac12\n\\]"), "{body}");
    assert!(
        body.contains("\\begin{align} a &= b \\\\ c &= d \\label{p1:abcd} \\end{align}"),
        "{body}"
    );
    assert!(body.contains("\\setcounter{equation}{0}"));
}

#[test]
fn footnotes_become_footnote_commands() {
    let world = TestEnv::new();
    let markdown =
        "A claim[^1] with a **bold** note[^b].\n\n[^1]: The *first* note.\n[^b]: See [the site](https://example.org).";
    let source = notebook_with(&world.env(), markdown);
    let tex = tex_of(&source, first_page_scope(&source), &LatexOptions::default());
    let body = check_tex(&tex);
    assert!(body.contains("A claim\\footnote{The \\emph{first} note.} with a \\textbf{bold} note\\footnote{See \\href{https://example.org}{the site}.}."), "{body}");
    assert!(!body.contains("[^"), "{body}");
}

#[test]
fn hostile_text_is_escaped_and_cannot_reach_the_document() {
    let world = TestEnv::new();
    let markdown = "\\input{/etc/passwd} \\write18{x} $\\immediate\\write16{x}$ [bad](javascript:alert(1)) \
        {{{ }}} & % # _ ^ ~ \\\n\n$$\n\\def\\x{y}\n$$\n\n```\n\\end{opncode}\\input{/etc/passwd}\n```\n\n\
        > \\begin{document} \\end{document}";
    let source = notebook_with(&world.env(), markdown);
    let tex = tex_of(&source, first_page_scope(&source), &LatexOptions::default());
    let body = check_tex(&tex);
    assert!(body.contains("\\textbackslash{}input\\{/etc/passwd\\}"), "{body}");
    assert!(!body.contains("href{javascript"), "{body}");
    assert_eq!(body.matches("\\end{document}").count(), 1, "{body}");
    assert_eq!(body.matches("\\begin{document}").count(), 1, "{body}");
}

#[test]
fn math_with_commands_nobody_listed_never_reaches_the_tex() {
    let world = TestEnv::new();
    let markdown = [
        r"Inline $\InputIfFileExists{/etc/passwd}{}{}$ and $\AtBeginDocument{\InputIfFileExists{x}{}{}}$.",
        "",
        "$$",
        r"\ExplSyntaxOn \file_input:n{/etc/passwd} \ExplSyntaxOff",
        "$$",
        "",
        "$$",
        r"\DeclareRobustCommand\textbf[1]{#1}",
        "$$",
        "",
        r"Fine: $\alpha + \frac{1}{2}$.",
    ]
    .join("\n");
    let source = notebook_with(&world.env(), &markdown);
    let tex = tex_of(&source, first_page_scope(&source), &LatexOptions::default());
    let body = check_tex(&tex);
    for word in [
        "InputIfFileExists",
        "AtBeginDocument",
        "ExplSyntaxOn",
        "file_input",
        "DeclareRobustCommand",
    ] {
        assert!(!body.contains(&format!(r"\{word}")), "{word} reached the file: {body}");
    }
    assert!(body.contains(r"$\alpha + \frac{1}{2}$"), "{body}");
}

#[test]
fn engines_decide_what_happens_to_characters_pdflatex_cannot_show() {
    let world = TestEnv::new();
    let source = notebook_with(&world.env(), "Greek α → β, Ω and 日本語, math $\\alpha + ∑ x$.");
    let unicode = tex_of(&source, first_page_scope(&source), &LatexOptions::default());
    assert!(
        unicode.contains("Greek α → β, Ω and 日本語, math $\\alpha + ∑ x$."),
        "{unicode}"
    );
    let options = LatexOptions {
        engine: LatexEngine::Pdflatex,
        ..LatexOptions::default()
    };
    let pdftex = tex_of(&source, first_page_scope(&source), &options);
    let body = check_tex(&pdftex);
    assert!(
        body.contains("Greek \\ensuremath{\\alpha} \\ensuremath{\\rightarrow} \\ensuremath{\\beta}, \\ensuremath{\\Omega} and ???"),
        "{body}"
    );
    assert!(body.contains("$\\alpha + \\sum  x$"), "{body}");
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_latex(&source, first_page_scope(&source), &options, out.path()).expect("exports");
    assert!(exported.report.to_markdown().contains("pdfLaTeX cannot show"));
}

#[test]
fn handwriting_is_a_vector_pdf_in_the_images_folder() {
    let world = TestEnv::new();
    let source = notebook_with(&world.env(), "Text.");
    let out = tempfile::tempdir().expect("a temp folder");
    let exported =
        export_latex(&source, first_page_scope(&source), &LatexOptions::default(), out.path()).expect("exports");
    let files = unzip(&fs::read(&exported.files[0]).expect("reads"));
    let ink = files
        .iter()
        .find(|(n, _)| n.ends_with("handwriting-1.pdf"))
        .expect("the handwriting picture");
    assert!(ink.1.starts_with(b"%PDF-1.4\n") && ink.1.ends_with(b"%%EOF\n"));
    let tex = String::from_utf8(files[0].1.clone()).expect("UTF-8");
    assert!(tex.contains("\\includegraphics{images/handwriting-1.pdf}"), "{tex}");
}

#[test]
fn citations_become_cite_and_a_bibtex_file() {
    let world = TestEnv::new();
    let mut source = notebook_with(&world.env(), "As shown before.");
    // The sample page's file block stands in for a citation block.
    let mut page = page_of(&source, "Photosynthesis");
    let file = page
        .blocks
        .iter()
        .find(|b| matches!(b.data, BlockData::File(_)))
        .cloned()
        .or_else(|| {
            page.blocks
                .iter()
                .find(|b| matches!(b.data, BlockData::Image(_)))
                .cloned()
        })
        .expect("a block to turn into a citation");
    let mut block: Block = (*file).clone();
    block.data = BlockData::Other(OtherData {
        type_name: "ext:org.opennote/citation".into(),
        data: serde_json::from_str(r#"{"notebook":"nb1","source":"s1"}"#).expect("JSON"),
        unreadable: None,
    });
    block.fallback = Some(opennote_core::model::Fallback {
        markdown: "(Smith 2020)".to_owned(),
        ..Default::default()
    });
    page.blocks.replace(Arc::new(block)).expect("replaces");
    let bytes = BTreeMap::from([(sample_asset_id(), png_bytes())]);
    source.add_page(ImportedPage {
        page,
        asset_bytes: bytes,
    });
    let options = LatexOptions {
        citations: vec![
            LatexCitation {
                notebook: "nb1".to_owned(),
                id: "s1".to_owned(),
                key: "Smith2020".to_owned(),
                entry: "@book{Smith2020,\n  author = {Smith, Ann},\n  title = {Plants \\& Light},\n  year = {2020}\n}"
                    .to_owned(),
            },
            LatexCitation {
                notebook: "nb1".to_owned(),
                id: "s2".to_owned(),
                key: "Evil".to_owned(),
                entry: "@book{Evil, title = {\\input{secret}}}".to_owned(),
            },
        ],
        ..LatexOptions::default()
    };
    let out = tempfile::tempdir().expect("a temp folder");
    let scope = first_page_scope(&source);
    let exported = export_latex(&source, scope, &options, out.path()).expect("exports");
    let files = unzip(&fs::read(&exported.files[0]).expect("reads"));
    let bib = files
        .iter()
        .find(|(n, _)| n.ends_with("references.bib"))
        .expect("a bib file");
    let bib = String::from_utf8(bib.1.clone()).expect("UTF-8");
    assert!(bib.contains("@book{Smith2020,") && !bib.contains("Evil"), "{bib}");
    let tex = String::from_utf8(files[0].1.clone()).expect("UTF-8");
    let body = check_tex(&tex);
    assert!(body.contains("\\cite{Smith2020}"), "{body}");
    assert!(
        body.contains("\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}"),
        "{body}"
    );
    assert!(tex.contains("bibtex"), "the header says to run BibTeX");
}

#[test]
fn the_preview_shows_the_start_of_the_file_and_reads_no_pictures() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let tex = latex_preview(&sample.source, Scope::Notebook, &LatexOptions::default(), 1_500).expect("previews");
    assert!(tex.starts_with("% Made by OpenNote."));
    assert!(
        tex.ends_with("% ... The rest of the file is not shown in this preview.\n"),
        "{tex}"
    );
    assert!(tex.chars().count() < 1_700);
    let whole = latex_preview(&sample.source, Scope::Notebook, &LatexOptions::default(), 1_000_000).expect("previews");
    check_tex(&whole);
}

#[test]
fn a_canceled_export_writes_nothing() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let token = CancelToken::new();
    token.cancel();
    let control = Control::with_cancel(token);
    let result = export_latex_with(
        &sample.source,
        Scope::Notebook,
        &LatexOptions::default(),
        out.path(),
        &control,
    );
    assert!(matches!(result, Err(InteropError::Canceled)));
    assert_eq!(fs::read_dir(out.path()).expect("lists").count(), 0);
}

#[test]
fn a_missing_page_is_an_error_that_says_so() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let gone = opennote_core::PageId::generate(world.env().clock);
    let result = export_latex(
        &sample.source,
        Scope::Page(gone),
        &LatexOptions::default(),
        Path::new("."),
    );
    assert!(matches!(result, Err(InteropError::Missing(_))));
    let _ = NoteSource::notebook(&sample.source);
}

mod hostile {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(48))]

        /// Whatever the page holds, the export finishes, and what it writes is well formed LaTeX in which nothing
        /// outside the preamble reads a file or defines a command.
        #[test]
        fn any_markdown_exports_to_well_formed_tex(markdown in "[ -~\n\t\u{3b1}\u{2211}\u{65e5}\u{e000}\u{e001}]{0,240}") {
            let world = TestEnv::new();
            let source = notebook_with(&world.env(), &markdown);
            for engine in [LatexEngine::Unicode, LatexEngine::Pdflatex] {
                let options = LatexOptions { engine, ..LatexOptions::default() };
                let tex = tex_of(&source, first_page_scope(&source), &options);
                check_tex(&tex);
            }
        }
    }
}
