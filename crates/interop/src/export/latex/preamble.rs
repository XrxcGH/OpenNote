//! The top and bottom of the `.tex` file: class, packages, helper commands, the title block, and the end.

use super::escape::{comment, pdf_info, text, Missing};
use super::{DateChoice, LatexOptions, Margin, Paper};

/// The packages and helper commands. One file compiles under pdfLaTeX, XeLaTeX, and LuaLaTeX: `iftex` picks the font
/// setup.
const PREAMBLE: &str = r"\usepackage{iftex}
\ifPDFTeX
  \usepackage[T1]{fontenc}
  \usepackage[utf8]{inputenc}
  \usepackage{lmodern}
  \usepackage{textcomp}
\else
  \usepackage{fontspec}
  % For scripts that Latin Modern lacks, name a font here, for example: \setmainfont{Noto Serif}
\fi
\usepackage{amsmath,mathtools}
\ifPDFTeX
  \usepackage{amssymb}
\else
  \usepackage{unicode-math}
  \providecommand{\square}{\mdlgwhtsquare}
\fi
\usepackage{graphicx}
\usepackage{adjustbox}
\usepackage[dvipsnames]{xcolor}
\usepackage[normalem]{ulem}
\usepackage{booktabs,longtable,tabularx,array}
\usepackage{enumitem}
\usepackage{caption}
\usepackage[unicode,colorlinks=true,linkcolor=NavyBlue,urlcolor=NavyBlue,citecolor=NavyBlue]{hyperref}
\usepackage{xurl}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.6em plus 0.2em}
\setlength{\emergencystretch}{3em}
\setcounter{tocdepth}{3}
\newcolumntype{Y}{>{\raggedright\arraybackslash}X}
\newcolumntype{P}[1]{>{\raggedright\arraybackslash}p{#1}}
\makeatletter
\def\maxwidth{\ifdim\Gin@nat@width>\linewidth\linewidth\else\Gin@nat@width\fi}
\def\maxheight{\ifdim\Gin@nat@height>0.55\textheight 0.55\textheight\else\Gin@nat@height\fi}
\makeatother
\setkeys{Gin}{width=\maxwidth,height=\maxheight,keepaspectratio}
\newcounter{opnfn}
% \ULon closes the group that \bgroup opens, so the group has no braces of its own here.
\newcommand{\opnhl}[2]{\bgroup\markoverwith{\textcolor{#1}{\rule[-.55ex]{2pt}{2.4ex}}}\ULon{#2}}
\newenvironment{opncode}
  {\par\medskip\begingroup\ttfamily\small\setlength{\parskip}{0pt}\raggedright}
  {\endgroup\par\medskip}
\newcommand{\opncodeline}[1]{\leavevmode\hangindent=1.5em\hangafter=1 #1\par}
";

fn paper(paper: Paper) -> &'static str {
    match paper {
        Paper::Letter => "letterpaper",
        Paper::A4 => "a4paper",
    }
}

fn margin(margin: Margin) -> &'static str {
    match margin {
        Margin::Narrow => "0.75in",
        Margin::Normal => "1in",
        Margin::Wide => "1.25in",
    }
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// A date in the form American English writes it, such as "March 4, 2026", from milliseconds since 1970.
pub(super) fn long_date(unix_ms: i64) -> String {
    let days = unix_ms.div_euclid(86_400_000);
    // Civil date from a day count (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{} {day}, {year}", MONTHS[usize::try_from(month - 1).unwrap_or(0) % 12])
}

/// What the document top needs.
pub(super) struct Top<'a> {
    pub options: &'a LatexOptions,
    pub title: &'a str,
    /// The stem of the file name, for the compile hint.
    pub stem: &'a str,
    /// Milliseconds since 1970 of the latest edit, for the "last edited" date.
    pub edited: Option<i64>,
    pub with_bibliography: bool,
}

/// Everything before the body.
pub(super) fn top(top: &Top<'_>, missing: &mut Missing) -> String {
    let options = top.options;
    let engine = options.engine;
    let stem = comment(top.stem);
    let mut out = String::new();
    out.push_str("% Made by OpenNote. Compile this file with XeLaTeX or LuaLaTeX, which show any language:\n");
    out.push_str(&format!("%     xelatex {stem}.tex\n"));
    if top.with_bibliography {
        out.push_str(
            "% It cites sources from references.bib. Run BibTeX between the runs (latexmk does this for you):\n",
        );
        out.push_str(&format!(
            "%     xelatex {stem}.tex && bibtex {stem} && xelatex {stem}.tex && xelatex {stem}.tex\n"
        ));
    }
    out.push_str(match engine {
        super::Engine::Unicode => "% Text is kept as Unicode. pdfLaTeX shows Latin letters only.\n",
        super::Engine::Pdflatex => {
            "% Text is limited to what pdfLaTeX can show. Other characters are question marks.\n"
        }
    });
    out.push_str(&format!(
        "\\documentclass[11pt,{}]{{article}}\n\\usepackage[{},margin={}]{{geometry}}\n",
        paper(options.paper),
        paper(options.paper),
        margin(options.margin)
    ));
    out.push_str(PREAMBLE);
    out.push_str(&format!(
        "\\hypersetup{{pdftitle={{{}}},pdfauthor={{{}}}}}\n",
        pdf_info(top.title, engine),
        pdf_info(&options.author, engine)
    ));
    if options.title_block {
        out.push_str(&format!("\\title{{{}}}\n", text(top.title, engine, missing)));
        out.push_str(&format!("\\author{{{}}}\n", text(&options.author, engine, missing)));
        let date = match options.date {
            DateChoice::None => String::new(),
            DateChoice::Today => "\\today".to_owned(),
            DateChoice::Edited => top.edited.map_or_else(String::new, long_date),
        };
        out.push_str(&format!("\\date{{{date}}}\n"));
    }
    out.push_str("\\begin{document}\n");
    if options.title_block {
        out.push_str("\\maketitle\n");
    }
    if options.toc {
        out.push_str("\\tableofcontents\n\\bigskip\n");
    }
    out
}

/// Everything after the body.
pub(super) fn bottom() -> &'static str {
    "\n\\end{document}\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_written_the_american_way() {
        assert_eq!(long_date(0), "January 1, 1970");
        assert_eq!(long_date(1_772_582_400_000), "March 4, 2026");
        assert_eq!(long_date(951_782_400_000), "February 29, 2000");
        assert_eq!(long_date(-86_400_000), "December 31, 1969");
    }
}
