//! The LaTeX exports that CI compiles with real TeX engines (the `latex-export` job).
//!
//! The test writes one folder for each fixture into the folder named by `OPENNOTE_LATEX_FIXTURES`. Without the
//! variable it checks nothing, because compiling needs a TeX engine, which the build machines for this crate do not
//! all have.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use opennote_core::model::{BlockData, Fallback, NotebookFile, OtherData, Page, TextData};
use opennote_core::testing::sample::{sample_asset_id, sample_page};
use opennote_core::NotebookId;
use opennote_interop::testing::{at, png_bytes, sample_notebook, unzip, TestEnv};
use opennote_interop::tree::{section_orders, SectionBuilder};
use opennote_interop::{
    export_latex, ImportedPage, LatexCitation, LatexDate, LatexEngine, LatexMargin, LatexOptions, LatexPaper,
    MemorySource, Scope,
};

/// A page with a bit of everything, including text that tries to read a file.
const EVERYTHING: &str = "# Title with **bold**, `code`, and $x^2$\n\n\
    Plain, *italic*, ==highlight==, ~~strike~~, <u>under</u>, H<sub>2</sub>O, and 5 \\% of $\\alpha + \\beta \\leq \\sum_{i=1}^{n} x_i$. \
    A link to [the site](https://example.org/a_b?c=1&d=2#top)[^n] and a note[^m].\n\n\
    [^n]: The *first* note, with `code` and a [link](https://example.org).\n\
    [^m]: The second note.\n\n\
    ## Lists\n\n- one\n  - nested **two**\n    1. deeper\n    2. deeper still\n- [x] done\n- [ ] to do\n\n\
    3. third\n4. fourth\n\n> A quote\n>\n> > nested\n\n> [!warning] Careful\n> Watch the units.\n\n\
    ```python\ndef f(x):\n    return {'a': x} # \\end{opncode} & % $ #\n```\n\n\
    ---\n\nSee equation $\\eqref{energy}$ and $\\eqref{sum}$.\n\n\
    $$\nE = mc^2 \\label{energy}\n$$\n\n$$\n\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2} \\label{sum}\n$$\n\n\
    $$\n\\begin{aligned} a &= b + c \\\\ &= d \\end{aligned}\n$$\n\n\
    $$\n\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}\n$$\n\n\
    Unicode: caf\u{e9}, na\u{ef}ve, \u{3a9}mega \u{2192} \u{3b1}, 100\u{b0}.\n\n\
    $$\n\\input{/etc/passwd}\n$$\n\n\\input{/etc/passwd} \\write18{ls} {{{ \\\\ \\end{document}";

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
    let mut block = (*first).clone();
    block.data = BlockData::Text(TextData {
        markdown: Arc::from(markdown),
        ..text.clone()
    });
    page.blocks.replace(Arc::new(block)).expect("replaces");
}

/// A notebook of one page: the core's sample page, with a picture and a stroke, and this Markdown.
fn notebook_with(env: &opennote_interop::ImportEnv<'_>, markdown: &str) -> MemorySource {
    let created = at("2026-03-04T10:00:00Z");
    let mut source = MemorySource::new(NotebookFile::new(NotebookId::generate(env.clock), "Chemistry", created));
    let mut page: Page = sample_page();
    set_markdown(&mut page, markdown);
    let mut section = SectionBuilder::new(env, "Notes", created);
    section.add_page(&page, None);
    let asset_bytes = BTreeMap::from([(sample_asset_id(), png_bytes())]);
    source.add_page(ImportedPage { page, asset_bytes });
    let order = section_orders(1).expect("a key").remove(0);
    source.add_section(section.finish(order).expect("the section builds"));
    source
}

/// The sample notebook, with its first page rewritten: this Markdown, and a citation block and a bibliography block
/// where the attachment and the table were.
fn cited_sample(world: &TestEnv, markdown: &str) -> (MemorySource, Scope) {
    let mut sample = sample_notebook(&world.env());
    let mut page = sample
        .source
        .pages()
        .into_iter()
        .find(|p| p.title == "Photosynthesis")
        .expect("the page")
        .clone();
    set_markdown(&mut page, markdown);
    let live = |block: &opennote_core::model::Block, kind: &str, data: &str| {
        let mut changed = block.clone();
        changed.data = BlockData::Other(OtherData {
            type_name: kind.into(),
            data: serde_json::from_str(data).expect("JSON"),
            unreadable: None,
        });
        changed.fallback = Some(Fallback {
            markdown: "(Smith 2020)".to_owned(),
            ..Fallback::default()
        });
        Arc::new(changed)
    };
    let file = page
        .blocks
        .iter()
        .find(|b| matches!(b.data, BlockData::File(_)))
        .cloned();
    let table = page
        .blocks
        .iter()
        .find(|b| matches!(b.data, BlockData::Table(_)))
        .cloned();
    if let (Some(file), Some(table)) = (file, table) {
        let cite = live(
            &file,
            "ext:org.opennote/citation",
            r#"{"notebook":"nb1","source":"s1"}"#,
        );
        let list = live(
            &table,
            "ext:org.opennote/bibliography",
            r#"{"notebook":"nb1","sources":null}"#,
        );
        page.blocks.replace(cite).expect("replaces");
        page.blocks.replace(list).expect("replaces");
    }
    let asset_bytes = page
        .assets
        .values()
        .map(|a| {
            let bytes = if a.mime.starts_with("image/") {
                png_bytes()
            } else {
                b"attached notes".to_vec()
            };
            (a.id, bytes)
        })
        .collect();
    let scope = Scope::Page(page.id);
    sample.source.add_page(ImportedPage { page, asset_bytes });
    (sample.source, scope)
}

#[test]
fn fixtures_for_the_ci_compile_job() {
    let Some(root) = std::env::var_os("OPENNOTE_LATEX_FIXTURES") else {
        return;
    };
    let root = Path::new(&root);
    let world = TestEnv::new();
    let source = notebook_with(&world.env(), EVERYTHING);
    let page = Scope::Page(source.pages()[0].id);
    let (cited, cited_page) = cited_sample(&world, EVERYTHING);
    let citation = LatexCitation {
        notebook: "nb1".to_owned(),
        id: "s1".to_owned(),
        key: "Smith2020".to_owned(),
        entry: "@book{Smith2020,\n  author = {Smith, Ann and M{\\\"u}ller, Jo},\n  title = {Plants \\& Light},\n  year = {2020}\n}"
            .to_owned(),
    };
    let sample = sample_notebook(&world.env());
    let cases: Vec<(&str, &MemorySource, Scope, LatexOptions)> = vec![
        (
            "unicode",
            &cited,
            cited_page,
            LatexOptions {
                toc: true,
                author: "Ann & Jo".to_owned(),
                citations: vec![citation],
                ..LatexOptions::default()
            },
        ),
        (
            "pdflatex",
            &source,
            page,
            LatexOptions {
                engine: LatexEngine::Pdflatex,
                ..LatexOptions::default()
            },
        ),
        ("notebook", &sample.source, Scope::Notebook, LatexOptions::default()),
        (
            "bare",
            &source,
            page,
            LatexOptions {
                title_block: false,
                date: LatexDate::None,
                paper: LatexPaper::A4,
                margin: LatexMargin::Narrow,
                ..LatexOptions::default()
            },
        ),
    ];
    for (name, notebook, scope, options) in cases {
        let out = tempfile::tempdir().expect("a temp folder");
        let exported = export_latex(notebook, scope, &options, out.path()).expect("exports");
        let target = root.join(name);
        fs::create_dir_all(&target).expect("a fixture folder");
        let path = &exported.files[0];
        if path.extension().is_some_and(|e| e == "zip") {
            for (entry, bytes) in unzip(&fs::read(path).expect("reads")) {
                let relative = entry.split_once('/').map_or(entry.as_str(), |(_, rest)| rest);
                let file = target.join(relative);
                fs::create_dir_all(file.parent().expect("a parent")).expect("a folder");
                fs::write(file, bytes).expect("writes");
            }
        } else {
            fs::write(target.join("main.tex"), fs::read(path).expect("reads")).expect("writes");
        }
    }
}
