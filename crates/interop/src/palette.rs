//! The brand pen and highlighter colors, for formats that cannot name them (`brand/tokens.json`, light theme).

/// The color of a pen name, or of a `#rrggbb` color, as six hexadecimal digits without the `#`.
pub fn pen_hex(color: &str) -> Option<String> {
    if let Some(hex) = color.strip_prefix('#') {
        let ok = hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit());
        return ok.then(|| hex.to_ascii_uppercase());
    }
    let hex = match color {
        "ink" => "2B2521",
        "indigo" => "2F4F9A",
        "brick" => "B0342A",
        "fern" => "2E7048",
        "plum" => "6A4A9C",
        "amber" => "B8620F",
        "walnut" => "6E4B2E",
        _ => return None,
    };
    Some(hex.to_owned())
}

/// The pen name of a color given as six hexadecimal digits, or `#rrggbb` when no pen has that color.
pub fn pen_name(hex: &str) -> String {
    let upper = hex.trim_start_matches('#').to_ascii_uppercase();
    for name in ["ink", "indigo", "brick", "fern", "plum", "amber", "walnut"] {
        if pen_hex(name).as_deref() == Some(upper.as_str()) {
            return name.to_owned();
        }
    }
    format!("#{}", upper.to_ascii_lowercase())
}

/// The highlighter that gives this fill color, if the color is one of the brand highlighters.
pub fn highlight_name(hex: &str) -> Option<&'static str> {
    let upper = hex.trim_start_matches('#').to_ascii_uppercase();
    ["honey", "mint", "rose", "apricot", "lilac"]
        .into_iter()
        .find(|name| highlight_hex(name) == upper)
}

/// The color a highlighter gives a white page: the brand color at its 40 percent opacity, as opaque hex digits.
pub fn highlight_hex(name: &str) -> &'static str {
    match name {
        "mint" => "D2EFDB",
        "rose" => "F9D9E3",
        "apricot" => "FBE2CA",
        "lilac" => "E8E0F9",
        _ => "FAECB7",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_hex_colors_resolve() {
        assert_eq!(pen_hex("brick").as_deref(), Some("B0342A"));
        assert_eq!(pen_hex("#12abEF").as_deref(), Some("12ABEF"));
        assert_eq!(pen_hex("chartreuse"), None);
        assert_eq!(highlight_hex("honey"), "FAECB7");
        assert_eq!(pen_name("2f4f9a"), "indigo");
        assert_eq!(pen_name("#123ABC"), "#123abc");
        assert_eq!(highlight_name("d2efdb"), Some("mint"));
        assert_eq!(highlight_name("FFFFFF"), None);
    }
}
