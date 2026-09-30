//! Field checks that serde can't express: ranges, lengths, chords, language tags, and ink colors. [`Check`]
//! keeps the first failure with its field path, which becomes the `IpcError`'s `field`.

use crate::ipc::{IpcError, IpcResult};

/// Collects the first failed check.
#[derive(Debug, Default)]
pub struct Check {
    failed: Option<IpcError>,
}

impl Check {
    /// Records a failure at `path` unless `ok`.
    pub fn that(&mut self, path: &str, ok: bool, message: &str) {
        if !ok && self.failed.is_none() {
            self.failed = Some(IpcError::invalid(path, message));
        }
    }

    /// Checks that `value` is within `min..=max` and finite.
    pub fn range(&mut self, path: &str, value: f64, (min, max): (f64, f64)) {
        let ok = value.is_finite() && (min..=max).contains(&value);
        self.that(path, ok, "The value is out of range.");
    }

    /// Checks that a text has `min..=max` characters.
    pub fn chars(&mut self, path: &str, text: &str, (min, max): (usize, usize)) {
        let count = text.chars().count();
        self.that(path, (min..=max).contains(&count), "The text is too short or too long.");
    }

    pub fn finish(self) -> IpcResult<()> {
        self.failed.map_or(Ok(()), Err)
    }
}

const MODIFIERS: [&str; 3] = ["Ctrl", "Alt", "Shift"];
/// Keys with names, in the stored form, separated by spaces.
const NAMED_KEYS: &str = concat!(
    "Up Down Left Right Home End PageUp PageDown ",
    "Delete Backspace Enter Escape Space Tab Insert Menu"
);
const PUNCTUATION: &str = "/\\,.;'`=[]-";

/// Chords that keyboard navigation or Windows owns (ARCHITECTURE.md section 14.4), separated by spaces.
const RESERVED: &str = concat!(
    "Tab Shift+Tab F6 Shift+F6 Escape Enter Space Shift+F10 Menu ",
    "Up Down Left Right Home End PageUp PageDown Alt+Space Alt+F4"
);

/// A command id: `<domain>.<name>`, letters, digits, and dots.
pub fn command_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    id.len() <= 100
        && parts.len() >= 2
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(char::is_alphanumeric))
}

/// A chord in the stored form ("Ctrl+Shift+D") that a person may assign. Modifiers come in the order Ctrl, Alt,
/// Shift, then one key. It isn't reserved, and a printable key needs Ctrl or Alt (WCAG 2.1.4).
pub fn chord(text: &str) -> bool {
    let mut parts: Vec<&str> = text.split('+').collect();
    let Some(key) = parts.pop() else {
        return false;
    };
    let ordered = parts
        .windows(2)
        .all(|pair| modifier_rank(pair[0]) < modifier_rank(pair[1]));
    let modifiers_ok = ordered && parts.iter().all(|part| modifier_rank(part).is_some());
    let printable = key.len() == 1
        && key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || PUNCTUATION.contains(c));
    let function = key
        .strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=24).contains(&n));
    let named = NAMED_KEYS.split(' ').any(|name| name == key);
    let needs_ctrl_or_alt = printable && !parts.iter().any(|part| *part == "Ctrl" || *part == "Alt");
    let reserved = RESERVED.split(' ').any(|reserved| reserved == text);
    modifiers_ok && (printable || function || named) && !needs_ctrl_or_alt && !reserved
}

fn modifier_rank(part: &str) -> Option<usize> {
    MODIFIERS.iter().position(|modifier| *modifier == part)
}

/// A BCP 47 language tag in its common shape, such as `en-US` or `sr-Latn-RS`.
pub fn language_tag(tag: &str) -> bool {
    let mut parts = tag.split('-');
    let primary = parts.next().unwrap_or_default();
    let primary_ok = (2..=8).contains(&primary.len()) && primary.chars().all(|c| c.is_ascii_alphabetic());
    primary_ok && parts.all(|part| (1..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// An ink color (spec section 2.7): a palette name, including names from newer versions, or lowercase
/// `#rrggbb`, or `#rrggbbaa` where alpha is allowed.
pub fn ink_color(color: &str, alpha: bool) -> bool {
    if let Some(hex) = color.strip_prefix('#') {
        let digits_ok = hex.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
        return digits_ok && (hex.len() == 6 || (alpha && hex.len() == 8));
    }
    (1..=24).contains(&color.len()) && color.chars().all(|c| c.is_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_assignable_chords() {
        let good = "Ctrl+Shift+D Ctrl+K Alt+Left F2 Ctrl+Alt+Shift+/ Delete Ctrl+0 F24";
        for chord_text in good.split(' ') {
            assert!(chord(chord_text), "{chord_text}");
        }
        let bad = concat!(
            "Shift+Ctrl+D Ctrl+Ctrl+D D Shift+D Ctrl+d Win+D Tab ",
            "Alt+Space Escape F25 Ctrl+ Alt+F4 Ctrl+Shift Shift+F10"
        );
        assert!(!chord(""), "an empty chord");
        for chord_text in bad.split(' ') {
            assert!(!chord(chord_text), "{chord_text}");
        }
    }

    #[test]
    fn reads_command_ids_and_language_tags() {
        assert!(command_id("theme.toggle") && command_id("notes.newSubpage") && !command_id("toggle"));
        assert!(!command_id("theme..toggle") && !command_id("theme.toggle!"));
        assert!(language_tag("en-US") && language_tag("sr-Latn-RS") && language_tag("de"));
        assert!(!language_tag("e") && !language_tag("en_US") && !language_tag(""));
    }

    #[test]
    fn reads_ink_colors_as_spec_2_7_writes_them() {
        assert!(ink_color("indigo", false) && ink_color("#2f4f9a", false) && ink_color("#f2cf4a66", true));
        assert!(ink_color("teal", false), "a palette name from a newer version is kept");
        assert!(!ink_color("#2F4F9A", false) && !ink_color("#f2cf4a66", false) && !ink_color("#fff", true));
        assert!(!ink_color("", false) && !ink_color("Indigo", false));
    }

    #[test]
    fn keeps_the_first_failure() {
        let mut check = Check::default();
        check.that("a", true, "fine");
        check.range("b", 3.0, (0.0, 2.0));
        check.chars("c", "", (1, 2));
        assert_eq!(check.finish().map_err(|e| e.field), Err(Some("b".to_owned())));
    }
}
