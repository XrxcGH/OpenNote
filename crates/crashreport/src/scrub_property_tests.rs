//! Property tests of the scrubber: for any note text, in any of the shapes a message can carry it, the text
//! never survives. They complement the fixed cases in `scrub_tests.rs`, which pin the exact output.

use proptest::prelude::*;

use super::*;

/// A scrubber that knows a made-up person, computer, and notebook.
fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber.add_name("JANES-LAPTOP");
    scrubber.add_private("Taxes 2025");
    scrubber
}

/// Note text as people write it: letters of several scripts, digits, spaces, and punctuation, but nothing that
/// would end a quote or a path early. It starts with a marker no message contains, so a chance match with
/// the words around it is impossible.
fn note_text() -> impl Strategy<Value = String> {
    proptest::string::string_regex("[A-Za-z0-9À-ſぁ-ん一-亀][A-Za-z0-9À-ſぁ-ん一-亀 ,.;!#()_-]{3,40}")
        .expect("a valid pattern")
        .prop_map(|s| format!("Zx7 {}", s.trim_end()))
}

/// A folder or file name in a path, with spaces and accents, and the same marker.
fn name() -> impl Strategy<Value = String> {
    proptest::string::string_regex("[A-Za-zÀ-ſ0-9][A-Za-zÀ-ſ0-9 _.()-]{3,24}")
        .expect("a valid pattern")
        .prop_map(|s| format!("Zx7 {}", s.trim_end()))
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Text inside any pair of quote marks is gone, whatever the surrounding message says.
    #[test]
    fn quoted_text_never_survives(title in note_text(), mark in 0usize..6) {
        let marks = [
            ('"', '"'),
            ('\u{201C}', '\u{201D}'),
            ('\u{2018}', '\u{2019}'),
            ('\u{AB}', '\u{BB}'),
            ('\'', '\''),
            ('"', '"'),
        ];
        let (open, close) = marks[mark];
        let input = format!("could not save {open}{title}{close} (code 7)");
        let out = scrubber().text(&input);
        prop_assert!(!out.contains(&title), "{title:?} survived in {out:?}");
    }

    /// A path keeps nothing of its folders or its file, whichever way it is written.
    #[test]
    fn paths_never_survive(folder in name(), file in name(), shape in 0usize..6) {
        let input = match shape {
            0 => format!(r"failed to open C:\Users\jdoe\{folder}\{file}.json: access denied"),
            1 => format!("failed to open c:/users/jdoe/{folder}/{file}.json"),
            2 => format!(r"failed to open \\FILESERVER\share\{folder}\{file}.json"),
            3 => format!(r"failed to open \\?\C:\Data\{folder}\{file}.json"),
            4 => format!("failed to open /home/jdoe/{folder}/{file}.json"),
            _ => format!("failed to open file:///C:/Data/{folder}/{file}.json"),
        };
        let out = scrubber().text(&input);
        prop_assert!(!out.contains(&folder), "{folder:?} survived in {out:?}");
        prop_assert!(!out.contains(&file), "{file:?} survived in {out:?}");
        prop_assert!(out.starts_with("failed to open <path>"), "{out:?}");
    }

    /// A registered name is removed as a word in any letter case, and the text around it stays.
    #[test]
    fn registered_names_never_survive(prefix in "[a-z]{1,8}", suffix in "[a-z]{1,8}", upper in any::<bool>()) {
        let name = if upper { "TAXES 2025" } else { "taxes 2025" };
        let (prefix, suffix) = (format!("zq{prefix}"), format!("{suffix}zq"));
        let input = format!("{prefix} {name} {suffix}");
        let out = scrubber().text(&input);
        prop_assert!(!out.to_lowercase().contains("taxes"), "{out:?}");
        prop_assert!(out.starts_with(&prefix) && out.ends_with(&suffix), "{out:?}");
    }

    /// Scrubbing is idempotent for every input, so a report scrubbed on load never changes again.
    #[test]
    fn scrubbing_twice_changes_nothing(input in "\\PC{0,120}") {
        let s = scrubber();
        let once = s.text(&input);
        prop_assert_eq!(s.text(&once), once);
    }

    /// Whatever the input, the output holds no character that would break a report line. It never grows past a
    /// few times the input, because every placeholder replaces something about as long, bar short quotes.
    #[test]
    fn output_stays_plain_and_bounded(input in "\\PC{0,200}") {
        let out = scrubber().text(&input);
        prop_assert!(out.chars().all(|c| !c.is_control()), "{out:?}");
        prop_assert!(out.len() <= input.len() * 8 + 16, "{} -> {}", input.len(), out.len());
    }

    /// An identifier of a device or account is replaced wherever it stands.
    #[test]
    fn identifiers_never_survive(
        a in any::<u128>(),
        octets in any::<[u8; 4]>(),
        mac in any::<[u8; 6]>(),
        rid in 1000u32..9999,
    ) {
        let guid = format!(
            "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
            (a >> 96) as u32,
            (a >> 80) as u16,
            (a >> 64) as u16,
            (a >> 48) as u16,
            a & 0xFFFF_FFFF_FFFF
        );
        let ip = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], octets[3]);
        let mac_text = mac.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":");
        let sid = format!("S-1-5-21-1004336348-1177238915-682003330-{rid}");
        for secret in [&guid, &ip, &mac_text, &sid] {
            let out = scrubber().text(&format!("device {secret} refused"));
            prop_assert!(!out.contains(secret.as_str()), "{secret:?} survived in {out:?}");
            prop_assert!(out.contains("<id>"), "{out:?}");
        }
    }
}

/// Registered names are matched as whole words, so they do not eat the text around them.
#[test]
fn registered_names_leave_longer_words_alone() {
    let out = scrubber().text("jdoes and ajdoe and jdoe");
    assert_eq!(out, "jdoes and ajdoe and <user>");
}

/// Reports built from hostile text stay clean in the places text can go: the source location, the backtrace's
/// source lines and symbols, and the operating system line.
#[test]
fn reports_built_from_hostile_text_stay_clean() {
    use crate::report::{Capture, Environment, Kind, Report};

    let secret = "Mum's diagnosis plan";
    let source = format!("             at C:\\Users\\jdoe\\Documents\\{secret}\\a.rs:12:5");
    let backtrace = format!("   0: opennote::notes::save\n{source}\n   1: core::fmt::\"{secret}\"\n");
    let capture = Capture {
        kind: Kind::Panic,
        message: Some("a static message"),
        location: Some(format!("C:\\Users\\jdoe\\{secret}\\store.rs:7:9")),
        exception_code: None,
        frames: Vec::new(),
        backtrace,
    };
    let environment = Environment {
        app_version: "1.0.0".to_owned(),
        os: format!("Windows 10.0.26200 x86_64 \"{secret}\""),
        time_unix: 1,
    };
    let report = Report::build(capture, &environment, &scrubber());
    let json = report.to_json();
    for word in ["Mum", "diagnosis", "plan", "jdoe"] {
        assert!(
            !json.to_lowercase().contains(&word.to_lowercase()),
            "{word} survived in {json}"
        );
    }
    assert!(json.contains("a static message"));
}
