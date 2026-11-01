//! Spell check on Linux through the `hunspell` program and the dictionaries installed for it (or for LibreOffice's
//! `myspell` folder). Each check is one run of `hunspell -d <language> -a`, which reads text on stdin and answers in
//! ispell's pipe format. This file holds the parts that need no Linux: reading that format, finding the words it
//! flagged in the text, and listing dictionaries. Ranges are UTF-16 units, which equal JavaScript string indices.

use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

use super::SpellError;

/// Where Linux distributions put Hunspell dictionaries.
pub const DICTIONARY_FOLDERS: [&str; 4] = [
    "/usr/share/hunspell",
    "/usr/share/myspell",
    "/usr/share/myspell/dicts",
    "/usr/local/share/hunspell",
];

/// The language tags with a dictionary (`en_US.dic` is `en-US`) in `folder`, sorted.
pub fn dictionaries_in(folder: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut tags: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stem = name.strip_suffix(".dic")?;
            (!stem.is_empty() && entry.path().with_extension("aff").exists()).then(|| stem.replace('_', "-"))
        })
        .collect();
    tags.sort();
    tags.dedup();
    tags
}

/// Every installed dictionary tag.
pub fn installed() -> Vec<String> {
    let mut all: Vec<String> = DICTIONARY_FOLDERS
        .iter()
        .flat_map(|folder| dictionaries_in(Path::new(folder)))
        .collect();
    all.sort();
    all.dedup();
    all
}

/// The word Hunspell flagged on one answer line, with its suggestions: `& word count offset: a, b` or
/// `? word 0 offset: a`, and `# word offset` when it has no suggestions.
pub fn flagged(line: &str) -> Option<(String, Vec<String>)> {
    let (kind, rest) = line.split_once(' ')?;
    match kind {
        "&" | "?" => {
            let (head, suggestions) = rest.split_once(": ").unwrap_or((rest, ""));
            let word = head.split(' ').next()?.to_owned();
            let suggestions = suggestions
                .split(", ")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect();
            Some((word, suggestions))
        }
        "#" => Some((rest.split(' ').next()?.to_owned(), Vec::new())),
        _ => None,
    }
}

/// The errors in `text` from Hunspell's answer to it. The flagged words come back in order, so each is looked for
/// after the last one found; that gives UTF-16 units however Hunspell counts its own offsets.
pub fn errors_in(text: &str, answer: &str) -> Vec<SpellError> {
    let mut errors = Vec::new();
    let (mut byte_cursor, mut unit_cursor) = (0usize, 0u32);
    for (word, _) in answer.lines().filter_map(flagged) {
        let Some(found) = text[byte_cursor..].find(&word) else {
            continue;
        };
        let start = byte_cursor + found;
        unit_cursor += text[byte_cursor..start].encode_utf16().count() as u32;
        let length = word.encode_utf16().count() as u32;
        errors.push(SpellError {
            start: unit_cursor,
            length,
        });
        unit_cursor += length;
        byte_cursor = start + word.len();
    }
    errors
}

/// The input for `hunspell -a`: every line starts with `^`, so a word like `*` or `@x` is text, not a command.
pub fn pipe_input(text: &str) -> String {
    text.lines().map(|line| format!("^{line}\n")).collect()
}

/// Runs `hunspell -a` for a language and returns its answer, or `None` when the program is missing or fails.
pub fn run(tag: &str, text: &str) -> Option<String> {
    let mut child = Command::new("hunspell")
        .args(["-d", &tag.replace('-', "_"), "-i", "utf-8", "-a"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let input = pipe_input(text);
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let output = child.wait_with_output().ok()?;
    let _ = writer.join();
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn check(tag: &str, text: &str) -> Vec<SpellError> {
    run(tag, text)
        .map(|answer| errors_in(text, &answer))
        .unwrap_or_default()
}

pub fn suggest(tag: &str, word: &str) -> Vec<String> {
    let Some(answer) = run(tag, word) else {
        return Vec::new();
    };
    answer
        .lines()
        .find_map(flagged)
        .map(|(_, list)| list)
        .unwrap_or_default()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const ANSWER: &str = "@(#) International Ispell Version 3.2.06 (but really Hunspell 1.7.0)\n\
        *\n& teh 3 4: the, tech, tea\n*\n\n# qzx 12\n\n";

    #[test]
    fn reads_suggestions_and_words_without_any() {
        let words: Vec<_> = ANSWER.lines().filter_map(flagged).collect();
        assert_eq!(
            words[0],
            ("teh".to_owned(), vec!["the".into(), "tech".into(), "tea".into()])
        );
        assert_eq!(words[1], ("qzx".to_owned(), Vec::new()));
        assert_eq!(words.len(), 2);
    }

    #[test]
    fn finds_each_flagged_word_in_utf16_units() {
        // The emoji is two UTF-16 units, and "e acute" one, so byte offsets would be wrong.
        let text = "Caf\u{e9} \u{1F600} teh and qzx";
        let errors = errors_in(text, ANSWER);
        let units: Vec<u16> = text.encode_utf16().collect();
        let word = |e: &SpellError| String::from_utf16_lossy(&units[e.start as usize..(e.start + e.length) as usize]);
        assert_eq!(errors.iter().map(word).collect::<Vec<_>>(), ["teh", "qzx"]);
    }

    #[test]
    fn a_repeated_misspelling_is_found_at_each_place() {
        let answer = "& teh 1 0: the\n& teh 1 4: the\n";
        assert_eq!(
            errors_in("teh teh", answer),
            vec![SpellError { start: 0, length: 3 }, SpellError { start: 4, length: 3 }]
        );
    }

    #[test]
    fn every_input_line_is_text_not_a_command() {
        assert_eq!(pipe_input("one\n*two"), "^one\n^*two\n");
    }

    #[test]
    fn lists_dictionaries_that_have_an_affix_file() {
        let folder = tempfile::tempdir().unwrap();
        for name in [
            "en_US.dic",
            "en_US.aff",
            "de_DE.dic",
            "de_DE.aff",
            "fr.dic",
            "notes.txt",
        ] {
            std::fs::write(folder.path().join(name), "").unwrap();
        }
        assert_eq!(dictionaries_in(folder.path()), ["de-DE", "en-US"]);
    }
}
