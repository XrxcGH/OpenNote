//! The shared value grammars of version 2 (spec Appendix D and `R-NUM-1`): numbers with a range and a step,
//! colors, language tags, font names, and IDs. Marks, paragraph formatting, and styles check their values here.

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

/// The pen colors (spec 2.7).
pub const PENS: [&str; 7] = ["ink", "indigo", "brick", "fern", "plum", "amber", "walnut"];
/// The highlighter colors (spec 2.7).
pub const HIGHLIGHTERS: [&str; 5] = ["honey", "mint", "rose", "apricot", "lilac"];
/// The highlighter names a version 1 `<mark data-color>` tag holds. Honey is `==` (spec 7.4).
pub const HIGHLIGHTERS_V1: [&str; 4] = ["mint", "rose", "apricot", "lilac"];
/// The theme colors that `theme:NAME` names (`R-THM-1`).
pub const THEME_COLORS: [&str; 8] = [
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "text",
    "background",
];
/// The theme font tokens (Appendix D.2).
pub const THEME_FONTS: [&str; 3] = ["+body", "+heading", "+mono"];

/// The steps of typographic values, as thousandths.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// 0.01.
    Hundredth,
    /// 0.05.
    Twentieth,
    /// 0.125.
    Eighth,
    /// 0.5.
    Half,
    /// 1.
    One,
    /// 100.
    Hundred,
}

impl Step {
    fn milli(self) -> i128 {
        match self {
            Step::Hundredth => 10,
            Step::Twentieth => 50,
            Step::Eighth => 125,
            Step::Half => 500,
            Step::One => 1_000,
            Step::Hundred => 100_000,
        }
    }
}

/// A number in the shortest decimal form of `R-NUM-1`, as thousandths: an optional `-`, no leading zeros, no
/// trailing zeros after the point, and not `-0`. `None` for another form, or for more than three decimals,
/// which no step of version 2 allows.
fn milli(text: &str) -> Option<i128> {
    let (negative, body) = match text.strip_prefix('-') {
        Some(body) => (true, body),
        None => (false, text),
    };
    let (whole, fraction) = body.split_once('.').unwrap_or((body, ""));
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(whole) || (whole.len() > 1 && whole.starts_with('0')) || whole.len() > 30 {
        return None;
    }
    if body.contains('.') && (!digits(fraction) || fraction.ends_with('0')) {
        return None;
    }
    if fraction.len() > 3 || text == "-0" {
        return None;
    }
    // The fraction has at most three digits, so padding it to three gives thousandths.
    let thousandths: i128 = format!("{fraction:0<3}").parse().ok()?;
    let value = whole
        .parse::<i128>()
        .ok()?
        .checked_mul(1_000)?
        .checked_add(thousandths)?;
    if negative {
        value.checked_neg()
    } else {
        Some(value)
    }
}

fn in_range(value: i128, low: f64, high: f64, step: Step) -> bool {
    // The bounds of version 2 are whole thousandths, so this conversion is exact.
    let bound = |b: f64| (b * 1_000.0).round() as i128;
    (bound(low)..=bound(high)).contains(&value) && value.checked_rem(step.milli()) == Some(0)
}

/// Whether `text`, a number written inside a tag, lies in the range, and on the step (`R-NUM-1`).
pub fn is_number_text(text: &str, low: f64, high: f64, step: Step) -> bool {
    milli(text).is_some_and(|v| in_range(v, low, high, step))
}

/// Whether a JSON number lies in the range and on the step, computed on its shortest decimal form.
pub fn is_number(value: f64, low: f64, high: f64, step: Step) -> bool {
    if !value.is_finite() {
        return false;
    }
    let text = if value == 0.0 {
        "0".to_owned()
    } else {
        value.to_string()
    };
    milli(&text).is_some_and(|v| in_range(v, low, high, step))
}

/// `#rrggbb` in lowercase.
pub fn is_hex(text: &str) -> bool {
    text.strip_prefix('#')
        .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// A color of Appendix D.7: a pen or highlighter name, `#rrggbb`, or `theme:NAME`.
pub fn is_color(text: &str) -> bool {
    PENS.contains(&text)
        || HIGHLIGHTERS.contains(&text)
        || is_hex(text)
        || text
            .strip_prefix("theme:")
            .is_some_and(|name| THEME_COLORS.contains(&name))
}

/// A color that a version 1 field can hold (`R-COL-1`): a pen or highlighter name, or `#rrggbb`.
pub fn is_v1_color(text: &str) -> bool {
    PENS.contains(&text) || HIGHLIGHTERS.contains(&text) || is_hex(text)
}

/// A language tag of Appendix D.8, or `zxx`.
pub fn is_lang(text: &str) -> bool {
    if text == "zxx" {
        return true;
    }
    let mut parts = text.split('-');
    let primary = parts.next().unwrap_or_default();
    if !(2..=3).contains(&primary.len()) || !primary.bytes().all(|b| b.is_ascii_lowercase()) {
        return false;
    }
    let mut rest: Vec<&str> = parts.collect();
    let is_script = |s: &str| {
        let b = s.as_bytes();
        b.len() == 4
            && b.split_first()
                .is_some_and(|(first, rest)| first.is_ascii_uppercase() && rest.iter().all(u8::is_ascii_lowercase))
    };
    if rest.first().is_some_and(|s| is_script(s)) {
        rest.remove(0);
    }
    match rest.as_slice() {
        [] => true,
        [region] => {
            let b = region.as_bytes();
            (b.len() == 2 && b.iter().all(u8::is_ascii_uppercase)) || (b.len() == 3 && b.iter().all(u8::is_ascii_digit))
        }
        _ => false,
    }
}

/// A font name or theme token of Appendix D.2: 1 to 63 characters, starting with a letter or digit, then letters,
/// digits, spaces, and `._+-`, and not ending with a space.
pub fn is_font_name(text: &str) -> bool {
    if THEME_FONTS.contains(&text) {
        return true;
    }
    let letter_or_digit = |c: char| {
        matches!(
            c.general_category_group(),
            GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number
        )
    };
    let mut chars = text.chars();
    let count = text.chars().count();
    (1..=63).contains(&count)
        && !text.ends_with(' ')
        && chars.next().is_some_and(letter_or_digit)
        && chars.all(|c| letter_or_digit(c) || matches!(c, ' ' | '.' | '_' | '+' | '-'))
}

/// An ID of spec 2.4: 26 characters of Crockford base 32 in lowercase, the first from 0 to 7.
pub fn is_id(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 26
        && b.split_first().is_some_and(|(first, rest)| {
            (b'0'..=b'7').contains(first)
                && rest
                    .iter()
                    .all(|c| c.is_ascii_digit() || (c.is_ascii_lowercase() && !matches!(c, b'i' | b'l' | b'o' | b'u')))
        })
}

/// The style names of version 1 and 2 (`R-STY-3`), and user styles `u-` plus 1 to 32 of `a-z0-9-`.
pub fn is_style_name(text: &str) -> bool {
    const BUILT_IN: [&str; 16] = [
        "normal", "h1", "h2", "h3", "h4", "h5", "h6", "title", "quote", "code", "subtitle", "citation", "h7", "h8",
        "h9", "quote2",
    ];
    BUILT_IN.contains(&text)
        || text.strip_prefix("u-").is_some_and(|rest| {
            (1..=32).contains(&rest.len())
                && rest
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_take_only_the_shortest_form_in_range_and_on_the_step() {
        assert!(is_number_text("10.5", 1.0, 1638.0, Step::Half));
        assert!(is_number_text("1638", 1.0, 1638.0, Step::Half));
        for bad in [
            "10.25", "1639", "0.5", "10.50", "010", "+1", "1e2", "-0", ".5", "5.", "",
        ] {
            assert!(!is_number_text(bad, 1.0, 1638.0, Step::Half), "{bad}");
        }
        assert!(is_number_text("-0.75", -1584.0, 1584.0, Step::Twentieth));
        assert!(!is_number_text("0.123", 0.0, 10.0, Step::Hundredth));
        assert!(is_number(36.0, 0.0, 1584.0, Step::Twentieth));
        assert!(is_number(0.06, 0.06, 132.0, Step::Hundredth));
        assert!(!is_number(0.07, 0.0, 1.0, Step::Twentieth));
        assert!(is_number(0.375, 0.25, 6.0, Step::Eighth));
        assert!(!is_number(f64::NAN, 0.0, 1.0, Step::One));
    }

    #[test]
    fn colors_languages_fonts_and_names() {
        assert!(is_color("theme:accent2") && is_color("#a0b1c2") && is_color("mint") && is_color("ink"));
        assert!(!is_color("#A0B1C2") && !is_color("theme:accent7") && !is_color("red"));
        assert!(is_v1_color("honey") && !is_v1_color("theme:text"));
        assert!(is_lang("fr-CA") && is_lang("zh-Hant-TW") && is_lang("es-419") && is_lang("zxx"));
        assert!(!is_lang("FR") && !is_lang("fr-ca") && !is_lang("fr-CA-x"));
        assert!(is_font_name("Times New Roman") && is_font_name("+mono") && !is_font_name(" Arial"));
        assert!(!is_font_name("Arial ") && !is_font_name("A\"B"));
        assert!(is_id("01m3sbcmt0000000000000c001") && !is_id("81m3sbcmt0000000000000c001"));
        assert!(is_style_name("u-key-term") && is_style_name("quote2") && !is_style_name("u-"));
    }
}
