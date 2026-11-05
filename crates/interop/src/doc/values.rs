//! The value grammars of format version 2 that text marks, paragraph formatting, styles, and cell styles share
//! (spec Appendix D). Each check takes the value as it is written and says whether it is in the grammar.

/// The pen names (spec 2.7).
pub const PENS: [&str; 7] = ["ink", "indigo", "brick", "fern", "plum", "amber", "walnut"];
/// The highlighter names.
pub const HIGHLIGHTERS: [&str; 5] = ["honey", "mint", "rose", "apricot", "lilac"];
/// The theme colors, written after `theme:` (R-THM-2).
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
/// The theme font tokens (R-VAL-2).
pub const THEME_FONTS: [&str; 3] = ["+body", "+heading", "+mono"];
/// The 17 underline styles (R-VAL-5), `single` first.
pub const UNDERLINES: [&str; 17] = [
    "single",
    "double",
    "words",
    "thick",
    "dotted",
    "dottedHeavy",
    "dash",
    "dashedHeavy",
    "dashLong",
    "dashLongHeavy",
    "dotDash",
    "dashDotHeavy",
    "dotDotDash",
    "dashDotDotHeavy",
    "wave",
    "wavyHeavy",
    "wavyDouble",
];
/// The OpenType feature tokens of the `otf` mark (R-MRK-11), without `ss01` to `ss20`.
const OTF: [&str; 9] = [
    "clig-none",
    "dlig",
    "hlig",
    "liga-none",
    "lnum",
    "onum",
    "pnum",
    "tnum",
    "zero",
];
/// The tokens of the `effect` mark (R-MRK-12).
const EFFECTS: [&str; 4] = ["emboss", "engrave", "outline", "shadow"];
/// The styles of the `box` mark (R-MRK-13).
pub const BOXES: [&str; 5] = ["single", "double", "dotted", "dashed", "thick"];
/// The `textSize` names of version 1.
pub const SIZE_NAMES: [&str; 3] = ["small", "large", "xlarge"];
/// The style names of version 1 and those version 2 adds (R-STY-3).
const STYLE_NAMES: [&str; 16] = [
    "normal", "h1", "h2", "h3", "h4", "h5", "h6", "title", "quote", "code", "subtitle", "citation", "h7", "h8", "h9",
    "quote2",
];

/// A number written as text (R-VAL-1), in hundredths: the shortest decimal form, such as `10.5`, never `10.50`,
/// `010`, `+10.5`, or `-0`. Every step of the text grammars is a whole number of hundredths, so a value with more
/// decimals is never on a step.
pub fn hundredths(text: &str) -> Option<i64> {
    let (negative, digits) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (whole, fraction) = digits.split_once('.').unwrap_or((digits, ""));
    let whole_ok = whole == "0" || (!whole.is_empty() && !whole.starts_with('0') && whole.len() <= 12);
    let fraction_ok = (digits.contains('.') && !fraction.is_empty() && !fraction.ends_with('0') && fraction.len() <= 2)
        || !digits.contains('.');
    let ascii = whole.bytes().chain(fraction.bytes()).all(|b| b.is_ascii_digit());
    if !(whole_ok && fraction_ok && ascii) || text == "-0" {
        return None;
    }
    let mut value: i64 = whole.parse().ok()?;
    value *= 100;
    if !fraction.is_empty() {
        let padded = format!("{fraction:0<2}");
        value += padded.parse::<i64>().ok()?;
    }
    Some(if negative { -value } else { value })
}

/// Whether text is a number from `lo` to `hi` hundredths, on a step of `step` hundredths, and not one of
/// `except` (all in hundredths).
pub fn number_text(text: &str, lo: i64, hi: i64, step: i64, except: &[i64]) -> bool {
    hundredths(text).is_some_and(|v| (lo..=hi).contains(&v) && v % step == 0 && !except.contains(&v))
}

/// A size in points, 1 to 1638, step 0.5 (R-VAL-3).
pub fn size_points_text(text: &str) -> bool {
    number_text(text, 100, 163_800, 50, &[])
}

/// A font name or a theme token (R-VAL-2).
pub fn font_name(text: &str) -> bool {
    if THEME_FONTS.contains(&text) {
        return true;
    }
    let count = text.chars().count();
    let letter_or_digit = |c: char| c.is_alphabetic() || c.is_numeric();
    let mut chars = text.chars();
    (1..=63).contains(&count)
        && !text.ends_with(' ')
        && chars.next().is_some_and(letter_or_digit)
        && chars.all(|c| letter_or_digit(c) || matches!(c, ' ' | '.' | '_' | '+' | '-'))
}

/// A `#rrggbb` color in lowercase.
pub fn hex_color(text: &str) -> bool {
    text.strip_prefix('#')
        .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// A color of any of the four kinds (R-VAL-7): a pen or highlighter name, `#rrggbb`, or `theme:NAME`.
pub fn color(text: &str) -> bool {
    PENS.contains(&text)
        || HIGHLIGHTERS.contains(&text)
        || hex_color(text)
        || text
            .strip_prefix("theme:")
            .is_some_and(|name| THEME_COLORS.contains(&name))
}

/// A color that a version 1 reader reads as a text color: a pen name or `#rrggbb`.
pub fn v1_text_color(text: &str) -> bool {
    PENS.contains(&text) || hex_color(text)
}

/// A language tag (R-VAL-9): `en`, `en-US`, `zh-Hant-TW`, `es-419`, or `zxx`.
pub fn lang(text: &str) -> bool {
    let mut parts = text.split('-');
    let language = parts.next().unwrap_or("");
    if !(2..=3).contains(&language.len()) || !language.bytes().all(|b| b.is_ascii_lowercase()) {
        return false;
    }
    let mut rest: Vec<&str> = parts.collect();
    let is_script = |s: &str| {
        let b = s.as_bytes();
        b.len() == 4 && b[0].is_ascii_uppercase() && b[1..].iter().all(u8::is_ascii_lowercase)
    };
    if rest.first().is_some_and(|s| is_script(s)) {
        rest.remove(0);
    }
    let is_region = |s: &str| {
        (s.len() == 2 && s.bytes().all(|b| b.is_ascii_uppercase()))
            || (s.len() == 3 && s.bytes().all(|b| b.is_ascii_digit()))
    };
    match rest.as_slice() {
        [] => true,
        [region] => is_region(region),
        _ => false,
    }
}

/// An ID as spec 2.4 writes it (R-VAL-10): 26 characters of lowercase Crockford base 32, the first `0` to `7`.
pub fn id(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 26
        && (b'0'..=b'7').contains(&b[0])
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_digit() || (c.is_ascii_lowercase() && !matches!(c, b'i' | b'l' | b'o' | b'u')))
}

/// A style name (R-STY-3): a built-in name, or `u-` and 1 to 32 characters from `a-z`, `0-9`, and `-`.
pub fn style_name(text: &str) -> bool {
    STYLE_NAMES.contains(&text)
        || text.strip_prefix("u-").is_some_and(|rest| {
            (1..=32).contains(&rest.len())
                && rest
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// Space-separated tokens, each once, in code point order, at least one, all allowed.
fn tokens(text: &str, allowed: impl Fn(&str) -> bool) -> bool {
    let parts: Vec<&str> = text.split(' ').collect();
    parts.iter().all(|p| allowed(p)) && parts.windows(2).all(|w| w[0] < w[1])
}

/// The tokens of the `otf` mark (R-MRK-11).
pub fn otf(text: &str) -> bool {
    tokens(text, |t| {
        OTF.contains(&t)
            || t.strip_prefix("ss").is_some_and(|n| {
                // Two ASCII digits only: `parse` alone would also take `+1`.
                n.len() == 2
                    && n.bytes().all(|b| b.is_ascii_digit())
                    && n.parse::<u8>().is_ok_and(|n| (1..=20).contains(&n))
            })
    })
}

/// The tokens of the `effect` mark (R-MRK-12), where `emboss` and `engrave` exclude each other.
pub fn effect(text: &str) -> bool {
    tokens(text, |t| EFFECTS.contains(&t)) && !(text.contains("emboss") && text.contains("engrave"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_read_in_their_shortest_form() {
        assert_eq!(hundredths("10.5"), Some(1050));
        assert_eq!(hundredths("-0.05"), Some(-5));
        assert_eq!(hundredths("1638"), Some(163_800));
        for bad in ["10.50", "010", "+10.5", "-0", "1.", ".5", "1e3", "", "0.125", "1,5"] {
            assert_eq!(hundredths(bad), None, "{bad}");
        }
        assert!(size_points_text("10.5"));
        assert!(!size_points_text("0.5"));
        assert!(!size_points_text("10.25"));
        assert!(number_text("-1584", -158_400, 158_400, 5, &[0]));
        assert!(!number_text("0", -158_400, 158_400, 5, &[0]));
    }

    #[test]
    fn names_tags_and_tokens_follow_appendix_d() {
        assert!(font_name("Noto Sans JP 2") && font_name("+mono") && font_name("Mincho 明朝"));
        assert!(!font_name("+serif") && !font_name("Arial ") && !font_name(" Arial") && !font_name(""));
        assert!(color("theme:accent1") && color("#a1b2c3") && color("honey") && !color("#A1B2C3"));
        assert!(lang("en") && lang("en-US") && lang("zh-Hant-TW") && lang("es-419") && lang("zxx"));
        assert!(!lang("EN") && !lang("en-us") && !lang("en-US-x") && !lang("e"));
        assert!(
            id("01m3sbcmt0000000000000c001") && !id("01M3SBCMT0000000000000C001") && !id("81m3sbcmt0000000000000c001")
        );
        assert!(style_name("u-term") && style_name("quote2") && !style_name("u-") && !style_name("Heading1"));
        assert!(otf("dlig onum ss01") && !otf("onum dlig") && !otf("ss21") && !otf("dlig dlig"));
        assert!(!otf("ss+1") && !otf("ss 1") && !otf("ss-1") && otf("ss20"));
        assert!(effect("outline shadow") && !effect("emboss engrave"));
    }
}
