//! What each RTF control word does, for the reader in `rtf.rs`.

use encoding_rs::Encoding;

use super::flow::{hyperlink, ListProps, Losses, ParaProps};
use super::rtf::{Capture, Group, Reader};
use crate::doc::{Marks, Script};

/// Something a skipped destination held, for the report.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Loss {
    Picture,
    Drawing,
    Note,
    Comment,
}

/// What a control word does to its group.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Destination {
    /// Nothing: it is not a destination.
    None,
    /// The group holds no shown text.
    Skip(Option<Loss>),
    /// The group's text is kept for the reader, not shown.
    Capture(Capture),
}

/// The destination a control word starts.
pub(super) fn destination(word: &str) -> Destination {
    match word {
        "pict" => Destination::Skip(Some(Loss::Picture)),
        "object" | "shp" | "do" => Destination::Skip(Some(Loss::Drawing)),
        "footnote" => Destination::Skip(Some(Loss::Note)),
        "annotation" => Destination::Skip(Some(Loss::Comment)),
        "fldinst" => Destination::Capture(Capture::Instruction),
        "listtext" | "pntext" => Destination::Capture(Capture::ListText),
        "fonttbl" | "colortbl" | "stylesheet" | "info" | "header" | "headerl" | "headerr" | "headerf" | "footer"
        | "footerl" | "footerr" | "footerf" | "listtable" | "listoverridetable" | "rsidtbl" | "generator"
        | "themedata" | "colorschememapping" | "latentstyles" | "datastore" | "pgdsctbl" | "nonshppict" | "filetbl"
        | "revtbl" | "userprops" | "docvar" | "xmlnstbl" | "mmathPr" | "bkmkstart" | "bkmkend" | "pntxta"
        | "pntxtb" | "atnid" | "atnauthor" | "fldtype" | "datafield" | "formfield" | "template" | "nesttableprops"
        | "ftnsep" | "ftnsepc" | "ftncn" | "aftnsep" | "aftnsepc" | "aftncn" | "pn" => Destination::Skip(None),
        _ => Destination::None,
    }
}

/// Whether a word after `\*` names a destination this reader does not read, so its group is skipped. Only the
/// picture wrapper, whose picture is counted, is read.
pub(super) fn is_unknown(word: &str) -> bool {
    word != "shppict"
}

/// The count in the report that a loss adds to.
pub(super) fn loss_counter(losses: &mut Losses, loss: Loss) -> &mut usize {
    match loss {
        Loss::Picture => &mut losses.pictures,
        Loss::Drawing => &mut losses.drawings,
        Loss::Note => &mut losses.notes,
        Loss::Comment => &mut losses.comments,
    }
}

/// Applies a control word that is not a destination.
pub(super) fn apply(reader: &mut Reader, word: &str, param: Option<i32>) {
    if character_word(reader, word, param) || structure_word(reader, word) {
        return;
    }
    if word == "ansicpg" {
        if let Some(encoding) = param.and_then(code_page) {
            reader.encoding = encoding;
        }
        return;
    }
    if !mark_word(&mut reader.state.marks, word, param) {
        group_word(&mut reader.state, word, param);
    }
}

/// Paragraph, cell, and row marks. Returns whether the word was one.
fn structure_word(reader: &mut Reader, word: &str) -> bool {
    match word {
        "par" | "sect" | "page" => paragraph_end(reader),
        "line" => {
            reader.flush();
            reader.flow.line_break();
        }
        "cell" => {
            reader.flush();
            reader.nested = false;
            reader.flow.end_cell();
        }
        "row" => {
            reader.flush();
            reader.flow.end_row();
        }
        "nestcell" => {
            reader.flush();
            if !reader.nested {
                reader.flow.losses.nested_tables += 1;
                reader.nested = true;
            }
            reader.flow.end_paragraph(&ParaProps {
                in_table: true,
                ..ParaProps::default()
            });
        }
        _ => return false,
    }
    true
}

/// Paragraph and field properties, which belong to the group.
fn group_word(state: &mut Group, word: &str, param: Option<i32>) {
    match word {
        "pard" => {
            state.para = ParaProps::default();
            state.list = None;
            state.level = 0;
            state.depth = 0;
        }
        "intbl" => state.para.in_table = true,
        "itap" => {
            state.depth = param.unwrap_or(1);
            state.para.in_table = state.depth > 0;
        }
        "outlinelevel" => {
            state.para.heading = param.filter(|p| (0..6).contains(p)).map(|p| p as u8 + 1);
        }
        "ls" => state.list = Some(param.unwrap_or(1)),
        "ilvl" => state.level = param.unwrap_or(0).clamp(0, 8) as u8,
        "uc" => state.uc = param.unwrap_or(1).clamp(0, 10) as usize,
        "field" => state.instruction = None,
        "fldrslt" => state.link = state.instruction.as_deref().and_then(hyperlink),
        _ => {}
    }
}

/// Character formatting. Returns whether the word was one.
fn mark_word(marks: &mut Marks, word: &str, param: Option<i32>) -> bool {
    let on = param != Some(0);
    match word {
        "plain" => *marks = Marks::none(),
        "b" => marks.strong = on,
        "i" => marks.emphasis = on,
        "strike" | "striked" => marks.strike = on,
        "ulnone" => marks.underline = false,
        "super" => marks.script = Some(Script::Sup),
        "sub" => marks.script = Some(Script::Sub),
        "nosupersub" => marks.script = None,
        // Every underline style starts with "ul", except the underline color.
        w if w.starts_with("ul") && w != "ulc" => marks.underline = on,
        _ => return false,
    }
    true
}

/// Words that stand for a character. Returns whether the word was one.
fn character_word(reader: &mut Reader, word: &str, param: Option<i32>) -> bool {
    let c = match word {
        "tab" => '\t',
        "emdash" => '\u{2014}',
        "endash" => '\u{2013}',
        "bullet" => '\u{2022}',
        "lquote" => '\u{2018}',
        "rquote" => '\u{2019}',
        "ldblquote" => '\u{201C}',
        "rdblquote" => '\u{201D}',
        "emspace" | "enspace" | "qmspace" => ' ',
        "u" => {
            unicode(reader, param.unwrap_or(0));
            return true;
        }
        _ => return false,
    };
    reader.text_char(c);
    true
}

/// A `\u` character. Its parameter is a signed 16-bit unit, and two in a row may form a surrogate pair. The
/// characters after it are a fallback for older readers, which this reader skips.
fn unicode(reader: &mut Reader, param: i32) {
    let unit = param.rem_euclid(65_536) as u16;
    if (0xD800..0xDC00).contains(&unit) {
        reader.surrogate = Some(unit);
        return;
    }
    let units = match reader.surrogate.take() {
        Some(high) if (0xDC00..0xE000).contains(&unit) => vec![high, unit],
        _ => vec![unit],
    };
    for c in char::decode_utf16(units) {
        reader.text_char(c.unwrap_or(char::REPLACEMENT_CHARACTER));
    }
    reader.skip_fallback = reader.state.uc;
}

fn paragraph_end(reader: &mut Reader) {
    reader.flush();
    let mut props = reader.state.para.clone();
    let list_text = reader.list_text.take();
    if props.heading.is_none() && (reader.state.list.is_some() || list_text.is_some()) {
        props.list = Some(ListProps {
            ordered: list_text.as_deref().is_some_and(is_numbered),
            level: reader.state.level,
            start: 1,
        });
    }
    if reader.state.depth >= 2 {
        props.in_table = true;
    }
    reader.flow.end_paragraph(&props);
}

/// Whether a list paragraph's number text is a number or letter, such as `3.` or `b)`, rather than a bullet.
fn is_numbered(text: &str) -> bool {
    let text = text.trim();
    let body = text.trim_end_matches(['.', ')']);
    !body.is_empty() && body.len() <= 6 && body.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The encoding of a Windows code page, for `\ansicpg`.
fn code_page(page: i32) -> Option<&'static Encoding> {
    let label = match page {
        874 => "windows-874".to_owned(),
        932 => "shift_jis".to_owned(),
        936 => "gbk".to_owned(),
        949 => "euc-kr".to_owned(),
        950 => "big5".to_owned(),
        1250..=1258 => format!("windows-{page}"),
        10000 => "macintosh".to_owned(),
        65001 => "utf-8".to_owned(),
        _ => return None,
    };
    Encoding::for_label(label.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_texts_and_code_pages() {
        assert!(is_numbered("1.\t"));
        assert!(is_numbered("iv)"));
        assert!(!is_numbered("\u{b7}\t"));
        assert!(!is_numbered(""));
        assert_eq!(code_page(1251).map(Encoding::name), Some("windows-1251"));
        assert_eq!(code_page(437), None);
    }
}
