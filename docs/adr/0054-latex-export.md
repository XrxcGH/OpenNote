# ADR 0054: LaTeX export writes escaped text, checked math, and typeset code, and never compiles

- Status: Proposed
- Date: 2026-10-29

## Context

People who write papers and problem sets want their notes in LaTeX, with headings, equations, tables, pictures, and citations in the form a TeX engine reads. A page is untrusted input to such a file. TeX can read any file the user can, write files, and redefine itself, so a page that an exporter copied into a `.tex` file as it was could read a private file the next time someone compiled it. The owner asked on 2026-10-28 for LaTeX export of a page, a section, or a notebook, with a `.tex` file plus an images folder, zipped when there is more than one file.

## Decision

- **One more export in the interop crate.** `export/latex` follows the other exporters: it plans pages with `plan::build`, converts each with `convert_page`, and writes a new file beside the others without overwriting. The result is one `.tex` file, or a `.zip` that holds `Name/Name.tex`, `Name/images/`, and `Name/references.bib` when a picture, handwriting, or a cited source exists.
### Structure

- **Headings are section levels.** A page's `#` is `\section` when a page is the whole document. A section adds one level and a notebook two, with the section names as `\section`. A heading inside a list or quote is bold text, because LaTeX cannot nest a section there.
- **Every text run is escaped.** The ten special characters, `<`, `>`, `|`, and the backtick are replaced by commands. Control characters are dropped. With the pdfLaTeX setting, Greek letters become commands, math signs become commands, and other characters become a question mark that the report counts. With the Unicode setting the text is kept as it is. One preamble serves all three engines through `iftex`.
### Math

- **Math is checked, then kept or written as text.** Page TeX is read token by token. It is kept when these hold:
  - braces, `\left` and `\right`, and environments balance;
  - there is no unescaped `$` or `^^`;
  - environments are on a list of math ones;
  - every control word is on a list of math commands.

  The list is an allowlist, so a command that nobody thought of is refused: file readers such as `InputIfFileExists` and the expl3 `file_input:n`, hooks such as `AtBeginDocument`, and every definition or declaration command. BibTeX entries use the same list plus font commands and accents. CI compiles a hostile page under restricted file access and fails if a canary file is read. Otherwise the equation is set as plain text and the report says so. Labels and references accept only plain keys.
- **Equations are numbered by LaTeX, in the page's order.** A display equation with `\label{key}` becomes an `equation`, one without becomes `\[ ... \]`, so only labeled ones get numbers, as on the page. Each label gets a per-page prefix (`p3:key`) so labels stay unique in a notebook, `$\eqref{key}$` becomes `\eqref{p3:key}`, and each page resets the equation counter. A reference with no label is written "(??)", as the other exports do.
### Code, links, and notes

- **Code is typeset line by line.** A code block is not a `verbatim` or `lstlisting` environment, because such an environment ends at its own end text, and a page could put that text in code to leave it. Each line is escaped, spaces are control spaces, and long lines can break after punctuation.
- **Links are limited.** Only web, mail, phone, and FTP addresses become `\href`, with characters TeX reads as syntax percent-encoded. Links to pages in the export become `\hyperref`. Other links keep their text.
- **Footnotes are taken out first.** The Markdown parser reads `[^1]: text` as a link reference and drops it, so `export/footnotes` removes the definitions from each page's text and puts a marker where a defined note is used. The LaTeX writer turns the markers into `\footnote`. A table cell cannot hold one, so a note in a cell is a `\footnotemark` that carries its own number (the counter before the table plus its place) and its text follows the table as `\footnotetext`. A heading with a note gets a short title without it, so the contents and the PDF outline stay clean. A note cited twice is written twice.
### Files and the dialog

- **Pictures and ink.** PNG and JPEG files whose bytes match their type go to `images/` under names of letters, digits, hyphens, and underscores. A page's handwriting is one vector PDF drawn from the same strokes as `ink.svg`, so it is sharp at any size and needs no SVG tools. Figures are not floats: they are centered with `\captionof`, so many in a row never overflow TeX's float queue.
- **Citations.** The host sends the citation library with its BibTeX keys and entries. A citation block becomes `\cite{key}`, a bibliography block becomes `\nocite`, `\bibliographystyle{plain}`, and `\bibliography{references}`, and `references.bib` holds the sources that are cited or listed. Each entry is checked like math before it is written. A block whose source is not in the library keeps the words saved with it.
- **The dialog shows the file.** The options (character set, paper, margins, title block, table of contents) have a live preview of the first pages of the real `.tex` text, made by the same code, through a host command that reads no picture files and writes nothing.
- **OpenNote never compiles.** A compiler would run the checked-but-untrusted file on the owner's machine, and a TeX distribution is a large dependency. The file starts with a comment that says how to compile it.

## Options considered

| Option | For | Against |
|---|---|---|
| Escape, check math, typeset code (chosen) | A page cannot read a file or end an environment; the file compiles with any engine | Math with an odd command is shown as text; code is not copyable as a `verbatim` block |
| Copy math as written | Every equation survives | A hostile page could read files when the file is compiled |
| An allowlist of every math command | The tightest rule | Hundreds of commands from amsmath, mathtools, and unicode-math to keep current |
| `lstlisting` or `minted` for code | Syntax colors | A page can end the environment; `minted` needs shell escape and Python |
| SVG for handwriting | One picture shared with other exports | `\includegraphics` of SVG needs Inkscape and shell escape |
| Compile to PDF in the app | One click to a PDF | Ships a TeX engine or runs one on untrusted text; PDF export already exists |

## Consequences

- Compiling a `.tex` file that OpenNote wrote needs no shell escape, and CI compiles the fixtures with Tectonic (`latex-export` job) so the preamble stays valid.
- An equation that fails the check appears as text in the file and in the summary. A person can fix the page and export again.
- Merged table cells are not written, because OpenNote tables have none. A cropped picture is written whole.
- pdfLaTeX shows Latin letters only. For other scripts the person sets a font in the preamble, which has a comment for it, and compiles with XeLaTeX or LuaLaTeX.
