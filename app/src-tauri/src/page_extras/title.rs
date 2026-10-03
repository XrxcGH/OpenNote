//! Link titles on paste: the page title of a pasted web address, fetched only when the person turned the feature
//! on. The request is a plain GET for the address, with no cookies and no `Referer`, so the site sees this PC's
//! network address and the request, and nothing else. It never runs while Work offline is on, and it never reaches
//! an address on the local network (the same guard as saving a web image).

use crate::{
    images::{import::on_blocking, web::fetch_html_head},
    ipc::IpcResult,
};

/// The longest title shown as link text.
const MAX_TITLE_CHARS: usize = 200;

/// The text between the first `<tag ...>` and `</tag>`, case-insensitively.
fn element_text<'a>(html: &'a str, lower: &str, tag: &str) -> Option<&'a str> {
    let open = lower.find(&format!("<{tag}"))?;
    let start = open + lower[open..].find('>')? + 1;
    let end = start + lower[start..].find(&format!("</{tag}"))?;
    html.get(start..end)
}

/// The `content` of the first `<meta property="og:title">`.
fn open_graph_title(html: &str, lower: &str) -> Option<String> {
    let mut from = 0;
    while let Some(found) = lower[from..].find("<meta") {
        let start = from + found;
        let end = start + lower[start..].find('>')?;
        let tag = &html[start..end];
        let tag_lower = &lower[start..end];
        if tag_lower.contains("og:title") {
            let at = tag_lower.find("content=")? + "content=".len();
            let rest = &tag[at..];
            let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
            let value = &rest[1..];
            return value.split(quote).next().map(str::to_owned);
        }
        from = end;
    }
    None
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';').filter(|end| *end <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let name = &rest[1..end];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => name
                .strip_prefix('#')
                .and_then(|number| match number.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => number.parse().ok(),
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The title of an HTML page: its `<title>`, else its Open Graph title. Whitespace is collapsed, and a title
/// that is empty or has control characters is no title at all.
pub fn title_from_html(bytes: &[u8]) -> Option<String> {
    let html = String::from_utf8_lossy(bytes);
    // Lowercasing can change byte lengths for a few letters, so work only where it keeps them.
    let lower = if html.to_lowercase().len() == html.len() {
        html.to_lowercase()
    } else {
        html.to_ascii_lowercase()
    };
    let raw = element_text(&html, &lower, "title")
        .map(str::to_owned)
        .or_else(|| open_graph_title(&html, &lower))?;
    let decoded = decode_entities(&raw);
    let title = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() || title.chars().any(char::is_control) {
        return None;
    }
    Some(title.chars().take(MAX_TITLE_CHARS).collect())
}

#[tauri::command]
pub async fn page_extras_link_title(url: String) -> IpcResult<Option<String>> {
    // Work offline blocks every network use, including this one (docs/FEATURES.md, Privacy panel).
    if crate::hardening::offline() {
        return Ok(None);
    }
    on_blocking(move || {
        let head = fetch_html_head(&url, false)?;
        Ok(title_from_html(&head))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_title_and_cleans_it() {
        let html = b"<html><head><TITLE lang=en>\n  Mitosis &amp; meiosis &#8211; Biology\n</TITLE></head>";
        assert_eq!(title_from_html(html).as_deref(), Some("Mitosis & meiosis \u{2013} Biology"));
    }

    #[test]
    fn falls_back_to_the_open_graph_title() {
        let html = br#"<head><meta name="x" content="y"><meta property="og:title" content="A &quot;quoted&quot; page"></head>"#;
        assert_eq!(title_from_html(html).as_deref(), Some("A \"quoted\" page"));
    }

    #[test]
    fn no_title_is_none() {
        assert_eq!(title_from_html(b"<html><body>hi</body></html>"), None);
        assert_eq!(title_from_html(b"<title>   </title>"), None);
    }

    #[test]
    fn a_long_title_is_cut() {
        let html = format!("<title>{}</title>", "a".repeat(500));
        assert_eq!(title_from_html(html.as_bytes()).unwrap().chars().count(), MAX_TITLE_CHARS);
    }
}
