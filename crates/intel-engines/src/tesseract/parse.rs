//! The plain Rust half of the Tesseract engine, which every platform builds and tests: Tesseract's TSV output
//! into lines and words, its language codes to and from language tags, and pixels to the gray bytes it reads.

use opennote_intel::geometry::{Language, Rect};
use opennote_intel::ocr::{OcrImage, OcrLine, OcrWord, PixelFormat};

/// Tesseract's language codes and the tags OpenNote uses, for the languages whose code is not already a tag.
const CODES: &[(&str, &str)] = &[
    ("eng", "en"),
    ("fra", "fr"),
    ("deu", "de"),
    ("spa", "es"),
    ("ita", "it"),
    ("por", "pt"),
    ("nld", "nl"),
    ("swe", "sv"),
    ("dan", "da"),
    ("nor", "nb"),
    ("fin", "fi"),
    ("pol", "pl"),
    ("ces", "cs"),
    ("slk", "sk"),
    ("hun", "hu"),
    ("ron", "ro"),
    ("rus", "ru"),
    ("ukr", "uk"),
    ("bul", "bg"),
    ("ell", "el"),
    ("tur", "tr"),
    ("ara", "ar"),
    ("heb", "he"),
    ("hin", "hi"),
    ("jpn", "ja"),
    ("kor", "ko"),
    ("chi_sim", "zh-Hans"),
    ("chi_tra", "zh-Hant"),
    ("vie", "vi"),
    ("tha", "th"),
    ("ind", "id"),
    ("cat", "ca"),
];

/// Files in the language folder that are not languages.
const NOT_LANGUAGES: &[&str] = &["osd", "equ", "snum"];

/// The tag for one of Tesseract's language codes, or None for a file that is not a language or a code that is not
/// a tag, such as a script model (`script/Latin`).
pub fn bcp47_for(code: &str) -> Option<Language> {
    if NOT_LANGUAGES.contains(&code) {
        return None;
    }
    let tag = CODES
        .iter()
        .find(|(known, _)| *known == code)
        .map_or(code, |(_, tag)| tag);
    Language::new(tag).ok()
}

/// The code among `installed` that reads `language`: the same tag first, then the same language without its
/// region, so `en-US` is read with `eng`.
pub fn code_for<'a>(language: &Language, installed: &'a [String]) -> Option<&'a str> {
    let tag = language.as_str();
    let primary = language.primary();
    let same = |code: &&'a String| bcp47_for(code).is_some_and(|known| known.as_str().eq_ignore_ascii_case(tag));
    let near = |code: &&'a String| bcp47_for(code).is_some_and(|known| known.primary() == primary);
    installed
        .iter()
        .find(same)
        .or_else(|| installed.iter().find(near))
        .map(String::as_str)
}

/// One byte of brightness per pixel. Color is weighed as the eye sees it, over white where it is transparent, so
/// dark text on a clear background stays dark.
pub fn gray_pixels(image: &OcrImage) -> Vec<u8> {
    match image.format() {
        PixelFormat::Gray8 => image.pixels().to_vec(),
        PixelFormat::Rgba8 => image
            .pixels()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|p| {
                let luma = (299 * u32::from(p[0]) + 587 * u32::from(p[1]) + 114 * u32::from(p[2])) / 1000;
                let alpha = u32::from(p[3]);
                ((luma * alpha + 255 * (255 - alpha)) / 255) as u8
            })
            .collect(),
    }
}

/// Lines and words from the TSV that `TessBaseAPIGetTsvText` returns: one row per page, block, paragraph, line,
/// and word, with the level first and the box in pixels. A header row, short rows, and words with no text are
/// skipped.
pub fn parse_tsv(tsv: &str) -> Vec<OcrLine> {
    struct Row<'a> {
        level: u32,
        key: [u32; 4],
        bounds: Rect,
        text: &'a str,
    }
    let rows = tsv.lines().filter_map(|line| {
        let cells: Vec<&str> = line.split('\t').collect();
        if cells.len() < 11 {
            return None;
        }
        let number = |at: usize| cells[at].trim().parse::<i64>().ok();
        let level = u32::try_from(number(0)?).ok()?;
        let id = |at: usize| number(at).and_then(|n| u32::try_from(n).ok());
        let key = [id(1)?, id(2)?, id(3)?, id(4)?];
        let [x, y, width, height] = [number(6)?, number(7)?, number(8)?, number(9)?].map(|n| n.max(0) as f32);
        let text = cells.get(11).map_or("", |text| text.trim());
        Some(Row {
            level,
            key,
            bounds: Rect { x, y, width, height },
            text,
        })
    });
    let mut lines: Vec<([u32; 4], OcrLine)> = Vec::new();
    for row in rows {
        match row.level {
            4 => lines.push((
                row.key,
                OcrLine {
                    text: String::new(),
                    bounds: row.bounds,
                    words: Vec::new(),
                },
            )),
            5 if !row.text.is_empty() => {
                if lines.last().is_none_or(|(key, _)| *key != row.key) {
                    lines.push((
                        row.key,
                        OcrLine {
                            text: String::new(),
                            bounds: row.bounds,
                            words: Vec::new(),
                        },
                    ));
                }
                if let Some((_, line)) = lines.last_mut() {
                    line.words.push(OcrWord {
                        text: row.text.to_owned(),
                        bounds: row.bounds,
                    });
                }
            }
            _ => {}
        }
    }
    lines
        .into_iter()
        .map(|(_, mut line)| {
            line.text = line
                .words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            line
        })
        .filter(|line| !line.words.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tsv_rows_become_lines_of_words() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
            1\t1\t0\t0\t0\t0\t0\t0\t400\t120\t-1\t\n\
            2\t1\t1\t0\t0\t0\t10\t10\t300\t90\t-1\t\n\
            3\t1\t1\t1\t0\t0\t10\t10\t300\t90\t-1\t\n\
            4\t1\t1\t1\t1\t0\t10\t10\t200\t30\t-1\t\n\
            5\t1\t1\t1\t1\t1\t10\t12\t80\t28\t96.5\tPhotosynthesis\n\
            5\t1\t1\t1\t1\t2\t100\t12\t40\t28\t91.0\tneeds\n\
            4\t1\t1\t1\t2\t0\t10\t60\t150\t30\t-1\t\n\
            5\t1\t1\t1\t2\t1\t10\t62\t60\t28\t90.1\tlight.\n\
            5\t1\t1\t1\t2\t2\t80\t62\t10\t28\t-1\t \n\
            4\t1\t1\t1\t3\t0\t10\t100\t50\t10\t-1\t\n";
        let lines = parse_tsv(tsv);
        assert_eq!(lines.len(), 2, "the empty third line is dropped");
        assert_eq!(lines[0].text, "Photosynthesis needs");
        assert_eq!(
            lines[0].bounds,
            Rect {
                x: 10.0,
                y: 10.0,
                width: 200.0,
                height: 30.0
            }
        );
        assert_eq!(lines[0].words[1].bounds.x, 100.0);
        assert_eq!(lines[1].text, "light.");
        assert_eq!(lines[1].words.len(), 1, "a word with no text is skipped");
        assert!(parse_tsv("").is_empty());
        assert!(parse_tsv("garbage\tline\n5\tx").is_empty());
    }

    #[test]
    fn language_codes_map_to_tags_and_back() {
        assert_eq!(bcp47_for("eng").map(|l| l.as_str().to_owned()), Some("en".to_owned()));
        assert_eq!(
            bcp47_for("chi_sim").map(|l| l.as_str().to_owned()),
            Some("zh-Hans".to_owned())
        );
        assert_eq!(bcp47_for("osd"), None);
        assert_eq!(bcp47_for("script/Latin"), None);
        let installed: Vec<String> = ["osd", "eng", "deu", "chi_tra"].map(str::to_owned).to_vec();
        let code = |tag: &str| code_for(&Language::new(tag).unwrap(), &installed);
        assert_eq!(code("en-US"), Some("eng"));
        assert_eq!(code("de"), Some("deu"));
        assert_eq!(code("zh-Hant"), Some("chi_tra"));
        assert_eq!(code("fr-FR"), None);
    }

    #[test]
    fn colour_and_clear_pixels_become_gray_over_white() {
        let image = OcrImage::new(
            3,
            1,
            PixelFormat::Rgba8,
            vec![0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0],
        )
        .unwrap();
        assert_eq!(gray_pixels(&image), vec![0, 255, 255]);
        let gray = OcrImage::new(2, 1, PixelFormat::Gray8, vec![7, 9]).unwrap();
        assert_eq!(gray_pixels(&gray), vec![7, 9]);
    }
}
