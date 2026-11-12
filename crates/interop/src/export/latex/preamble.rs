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
  \providecommand{\blacksquare}{\mdlgblksquare}
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
% A shade or hex highlight breaks across lines, unlike \colorbox. The color is an HTML hex.
\newcommand{\opnhlx}[2]{\bgroup\markoverwith{\textcolor[HTML]{#1}{\rule[-.55ex]{2pt}{2.4ex}}}\ULon{#2}}
\newenvironment{opncode}
  {\par\medskip\begingroup\ttfamily\small\setlength{\parskip}{0pt}\raggedright}
  {\endgroup\par\medskip}
\newcommand{\opncodeline}[1]{\leavevmode\hangindent=1.5em\hangafter=1 #1\par}
";

/// `\opnfont` and `\opnlang`, which the body uses for a run font and a run language. Under pdfLaTeX, and where the font
/// or polyglossia is missing, they leave the text as it is, so one file compiles everywhere.
fn font_and_language_commands(languages: &[&str]) -> String {
    let others: String = languages.iter().map(|l| format!("\\setotherlanguage{{{l}}}")).collect();
    let none = "\\newcommand{\\opnlang}[2]{#2}";
    format!(
        concat!(
            // \IfFileExists keeps its branches in a macro definition, where a # is an error, so it only sets a switch.
            // The switch is defined before \ifPDFTeX so that a skipped branch still counts its \ifopnpoly and \fi.
            "\\newif\\ifopnpoly\n",
            "\\IfFileExists{{polyglossia.sty}}{{\\opnpolytrue}}{{}}\n",
            "\\ifPDFTeX\n",
            "  \\newcommand{{\\opnfont}}[1]{{}}\n",
            "  {none}\n",
            "\\else\n",
            // \detokenize keeps an underscore or an ampersand in a font name from becoming a command.
            "  \\newcommand{{\\opnfont}}[1]{{%\n",
            "    \\IfFontExistsTF{{\\detokenize{{#1}}}}{{\\fontspec{{\\detokenize{{#1}}}}}}{{}}}}\n",
            "  \\ifopnpoly\n",
            "    \\usepackage{{polyglossia}}\\setmainlanguage{{english}}{others}\n",
            "    \\newcommand{{\\opnlang}}[2]{{\\csname text#1\\endcsname{{#2}}}}\n",
            "  \\else\n",
            "    {none}\n",
            "  \\fi\n",
            "\\fi\n"
        ),
        none = none,
        others = others
    )
}

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
    /// The polyglossia names of the languages the body marks.
    pub languages: &'a [&'static str],
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
    out.push_str(&font_and_language_commands(top.languages));
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
            // The day in the person's time zone, as the page shows it, not the UTC day (full walk B2-B13-8).
            DateChoice::Edited => top.edited.map_or_else(String::new, |ms| {
                long_date(ms + i64::from(options.utc_offset_minutes) * 60_000)
            }),
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

    #[test]
    fn the_edited_date_is_the_local_day() {
        // 01:30 UTC on November 2 is still November 1 at UTC-5.
        let options = LatexOptions {
            date: DateChoice::Edited,
            utc_offset_minutes: -300,
            ..LatexOptions::default()
        };
        let page = Top {
            options: &options,
            title: "Notes",
            stem: "notes",
            edited: Some(1_793_583_000_000),
            with_bibliography: false,
            languages: &[],
        };
        assert!(top(&page, &mut Missing::default()).contains(r"\date{November 1, 2026}"));
    }

    #[test]
    fn the_only_fontspec_call_is_inside_the_guarded_helper() {
        let options = LatexOptions::default();
        let page = Top {
            options: &options,
            title: "Notes",
            stem: "notes",
            edited: None,
            with_bibliography: false,
            languages: &["spanish"],
        };
        let out = top(&page, &mut Missing::default());
        assert_eq!(out.matches(r"\fontspec{").count(), 1, "{out}");
        assert!(
            out.contains(r"\IfFontExistsTF{\detokenize{#1}}{\fontspec{\detokenize{#1}}}{}"),
            "{out}"
        );
        assert!(
            out.contains(r"\ifPDFTeX") && out.contains(r"\newcommand{\opnfont}[1]{}"),
            "{out}"
        );
        assert!(out.contains(r"\setotherlanguage{spanish}"), "{out}");
    }
}
