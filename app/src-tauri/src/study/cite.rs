//! Look-up of a source by its DOI or ISBN (Citation helper). It runs only when the person asks for one source, sends
//! only that DOI or ISBN, and only to the two sites that answer such questions: Crossref for a DOI and Open Library
//! for an ISBN, both over https and nothing else. The request has no cookies and no `Referer`, no proxy, and no
//! redirects, so the site sees this PC's network address and the identifier, and nothing more. Work offline blocks
//! it. The Privacy panel lists both hosts.

use std::{io::Read, time::Duration};

use serde::Serialize;
use serde_json::Value;
use ureq::Agent;

/// The only hosts a look-up talks to.
pub const HOSTS: [&str; 2] = ["api.crossref.org", "openlibrary.org"];

const TIMEOUT: Duration = Duration::from_secs(15);
/// The most of an answer that is read.
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Person {
    pub family: String,
    pub given: String,
}

/// What a look-up found, in the fields of the interface's `Source`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// `article` or `book`.
    pub kind: String,
    pub title: String,
    pub authors: Vec<Person>,
    pub year: String,
    pub month: String,
    pub day: String,
    pub container: String,
    pub publisher: String,
    pub place: String,
    pub edition: String,
    pub volume: String,
    pub issue: String,
    pub pages: String,
    pub url: String,
    pub doi: String,
}

/// A DOI as it is written after `10.`: the prefix, a slash, and a suffix, with no spaces or control characters.
pub fn clean_doi(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let lower = trimmed.to_ascii_lowercase();
    let start = ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"]
        .iter()
        .find(|prefix| lower.starts_with(**prefix))
        .map_or(0, |prefix| prefix.len());
    let doi = trimmed.get(start..)?.trim();
    let (prefix, suffix) = doi.split_once('/')?;
    let registrant = prefix.strip_prefix("10.")?;
    let valid = registrant.len() >= 4
        && registrant.starts_with(|c: char| c.is_ascii_digit())
        && registrant.chars().all(|c| c.is_ascii_digit() || c == '.')
        && !suffix.is_empty()
        && suffix.len() <= 200
        && suffix.chars().all(|c| !c.is_whitespace() && !c.is_control());
    valid.then(|| doi.to_owned())
}

/// An ISBN-10 or ISBN-13 with a good check digit, written without hyphens or spaces.
pub fn clean_isbn(text: &str) -> Option<String> {
    let digits: String = text
        .trim()
        .trim_start_matches(|c: char| c.is_ascii_alphabetic() || c == ':' || c == ' ')
        .chars()
        .filter(|c| *c != '-' && *c != ' ')
        .collect::<String>()
        .to_ascii_uppercase();
    let values: Vec<u32> = digits
        .chars()
        .enumerate()
        .map(|(at, c)| match c {
            'X' if digits.len() == 10 && at == 9 => Some(10),
            _ => c.to_digit(10),
        })
        .collect::<Option<_>>()?;
    let ok = match values.len() {
        10 => values.iter().enumerate().map(|(at, v)| (10 - at as u32) * v).sum::<u32>() % 11 == 0,
        13 => values.iter().enumerate().map(|(at, v)| if at % 2 == 0 { *v } else { 3 * v }).sum::<u32>() % 10 == 0,
        _ => false,
    };
    ok.then_some(digits)
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first(value: &Value) -> String {
    value.as_array().and_then(|list| list.first()).map(text).unwrap_or_default()
}

fn year_in(text: &str) -> String {
    let digits: Vec<char> = text.chars().collect();
    digits
        .windows(4)
        .find(|window| window.iter().all(char::is_ascii_digit) && matches!(window[0], '1' | '2'))
        .map(|window| window.iter().collect())
        .unwrap_or_default()
}

/// The first `[year, month, day]` of a Crossref date, with what is missing left empty.
fn date_parts(value: &Value) -> (String, String, String) {
    let parts = value["date-parts"][0].as_array().cloned().unwrap_or_default();
    let at = |index: usize| parts.get(index).and_then(Value::as_u64).map(|n| n.to_string()).unwrap_or_default();
    (at(0), at(1), at(2))
}

/// Reads Crossref's answer for a work (`api.crossref.org/works/<doi>`).
pub fn from_crossref(body: &str) -> Option<Found> {
    let data: Value = serde_json::from_str(body).ok()?;
    let work = data.get("message")?;
    let title = first(&work["title"]);
    if title.is_empty() {
        return None;
    }
    let authors = work["author"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|one| {
                    let family = text(&one["family"]);
                    let given = text(&one["given"]);
                    let family = if family.is_empty() { text(&one["name"]) } else { family };
                    (!family.is_empty()).then_some(Person { family, given })
                })
                .collect()
        })
        .unwrap_or_default();
    let (year, month, day) = ["issued", "published", "published-print", "published-online"]
        .iter()
        .map(|key| date_parts(&work[*key]))
        .find(|(year, ..)| !year.is_empty())
        .unwrap_or_default();
    let kind = match work["type"].as_str().unwrap_or("") {
        "book" | "monograph" | "edited-book" | "reference-book" | "book-set" => "book",
        _ => "article",
    };
    let doi = text(&work["DOI"]);
    Some(Found {
        kind: kind.to_owned(),
        title,
        authors,
        year,
        month,
        day,
        container: first(&work["container-title"]),
        publisher: text(&work["publisher"]),
        volume: text(&work["volume"]),
        issue: text(&work["issue"]),
        pages: text(&work["page"]).replace('-', "\u{2013}"),
        url: if doi.is_empty() { String::new() } else { format!("https://doi.org/{doi}") },
        doi,
        ..Found::default()
    })
}

/// Reads Open Library's answer for an ISBN (`openlibrary.org/api/books?bibkeys=ISBN:<isbn>&jscmd=data`).
pub fn from_open_library(body: &str, isbn: &str) -> Option<Found> {
    let data: Value = serde_json::from_str(body).ok()?;
    let book = data.get(format!("ISBN:{isbn}"))?;
    let title = text(&book["title"]);
    if title.is_empty() {
        return None;
    }
    let authors = book["authors"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|one| {
                    let name = text(&one["name"]);
                    if name.is_empty() {
                        return None;
                    }
                    Some(match name.rsplit_once(' ') {
                        Some((given, family)) => Person { family: family.to_owned(), given: given.to_owned() },
                        None => Person { family: name, given: String::new() },
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let named = |key: &str| {
        book[key]
            .as_array()
            .and_then(|list| list.first())
            .map(|one| text(&one["name"]))
            .unwrap_or_default()
    };
    let subtitle = text(&book["subtitle"]);
    Some(Found {
        kind: "book".to_owned(),
        title: if subtitle.is_empty() { title } else { format!("{title}: {subtitle}") },
        authors,
        year: year_in(&text(&book["publish_date"])),
        publisher: named("publishers"),
        place: named("publish_places"),
        ..Found::default()
    })
}

fn agent() -> Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    let config = Agent::config_builder()
        .tls_config(tls)
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .https_only(true)
        .timeout_global(Some(TIMEOUT))
        .user_agent(concat!("OpenNote/", env!("CARGO_PKG_VERSION")))
        .build();
    Agent::new_with_config(config)
}

/// The percent-encoding of a DOI for a path: letters, digits, and `-._~/` stay as they are.
fn encode_path(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => (byte as char).to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// The address a look-up asks, or `None` for something that is not a DOI or ISBN. Only the two hosts above appear.
pub fn address(kind: &str, id: &str) -> Option<(String, String)> {
    match kind {
        "doi" => {
            let doi = clean_doi(id)?;
            Some((format!("https://api.crossref.org/works/{}", encode_path(&doi)), doi))
        }
        "isbn" => {
            let isbn = clean_isbn(id)?;
            Some((
                format!("https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"),
                isbn,
            ))
        }
        _ => None,
    }
}

/// Asks the site. `Ok(None)` is a site that does not know the identifier.
pub fn lookup(kind: &str, id: &str) -> Result<Option<Found>, String> {
    let (url, clean) = address(kind, id).ok_or_else(|| "invalid".to_owned())?;
    let mut response = agent()
        .get(&url)
        .header("Accept", "application/json")
        .call()
        .map_err(|error| format!("unreachable: {error}"))?;
    match response.status().as_u16() {
        200 => {}
        404 => return Ok(None),
        other => return Err(format!("The site answered with status {other}.")),
    }
    let mut body = String::new();
    response
        .body_mut()
        .as_reader()
        .take(MAX_BYTES)
        .read_to_string(&mut body)
        .map_err(|error| error.to_string())?;
    Ok(if kind == "doi" { from_crossref(&body) } else { from_open_library(&body, &clean) })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CROSSREF: &str = r#"{"status":"ok","message":{"type":"journal-article","title":["Sleep and Memory in Students"],
        "author":[{"given":"Jane Q.","family":"Smith"},{"name":"The Sleep Group"}],
        "container-title":["Journal of Learning"],"volume":"12","issue":"3","page":"45-67","publisher":"Open Press",
        "DOI":"10.1000/xyz123","issued":{"date-parts":[[2020,5]]}}}"#;

    #[test]
    fn reads_a_crossref_article() {
        let found = from_crossref(CROSSREF).expect("a work");
        assert_eq!(found.kind, "article");
        assert_eq!(found.title, "Sleep and Memory in Students");
        assert_eq!(found.authors[0], Person { family: "Smith".into(), given: "Jane Q.".into() });
        assert_eq!(found.authors[1].family, "The Sleep Group");
        assert_eq!((found.year.as_str(), found.month.as_str(), found.day.as_str()), ("2020", "5", ""));
        assert_eq!((found.volume.as_str(), found.issue.as_str(), found.pages.as_str()), ("12", "3", "45\u{2013}67"));
        assert_eq!(found.url, "https://doi.org/10.1000/xyz123");
    }

    #[test]
    fn a_crossref_answer_with_no_title_is_nothing() {
        assert!(from_crossref(r#"{"message":{"title":[]}}"#).is_none());
        assert!(from_crossref("not json").is_none());
    }

    #[test]
    fn reads_an_open_library_book() {
        let body = r#"{"ISBN:9780306406157":{"title":"Notes on Notes","subtitle":"A guide",
            "authors":[{"name":"Maria Garcia"}],"publishers":[{"name":"Open Press"}],
            "publish_places":[{"name":"Austin"}],"publish_date":"May 2, 2018"}}"#;
        let found = from_open_library(body, "9780306406157").expect("a book");
        assert_eq!(found.kind, "book");
        assert_eq!(found.title, "Notes on Notes: A guide");
        assert_eq!(found.authors, vec![Person { family: "Garcia".into(), given: "Maria".into() }]);
        assert_eq!((found.year.as_str(), found.publisher.as_str(), found.place.as_str()), ("2018", "Open Press", "Austin"));
    }

    #[test]
    fn an_empty_open_library_answer_is_nothing() {
        assert!(from_open_library("{}", "9780306406157").is_none());
    }

    #[test]
    fn cleans_a_doi_written_as_a_web_address_or_with_a_label() {
        assert_eq!(clean_doi("https://doi.org/10.1000/xyz123").as_deref(), Some("10.1000/xyz123"));
        assert_eq!(clean_doi("  doi:10.1000/ABC.def-1 ").as_deref(), Some("10.1000/ABC.def-1"));
        assert_eq!(clean_doi("10.1000/xyz123").as_deref(), Some("10.1000/xyz123"));
    }

    #[test]
    fn refuses_what_is_not_a_doi() {
        for bad in ["", "hello", "10.1000", "10./x", "11.1000/x", "10.1000/has space", "https://example.org/10.1000/x"] {
            assert!(clean_doi(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn checks_isbn_digits() {
        assert_eq!(clean_isbn("978-0-306-40615-7").as_deref(), Some("9780306406157"));
        assert_eq!(clean_isbn("ISBN 0-306-40615-2").as_deref(), Some("0306406152"));
        assert_eq!(clean_isbn("080442957X").as_deref(), Some("080442957X"));
        assert!(clean_isbn("978-0-306-40615-8").is_none());
        assert!(clean_isbn("12345").is_none());
        assert!(clean_isbn("97803064061XX").is_none());
    }

    #[test]
    fn asks_only_the_two_known_hosts_over_https() {
        let (doi, _) = address("doi", "10.1000/xyz123").expect("an address");
        assert!(doi.starts_with("https://api.crossref.org/works/"));
        assert!(address("doi", "10.1000/a b").is_none());
        let (isbn, _) = address("isbn", "9780306406157").expect("an address");
        assert!(isbn.starts_with("https://openlibrary.org/"));
        assert!(address("url", "https://evil.example/").is_none());
        for host in HOSTS {
            assert!(["api.crossref.org", "openlibrary.org"].contains(&host));
        }
    }

    #[test]
    fn encodes_odd_characters_in_a_doi_path() {
        let (url, _) = address("doi", "10.1000/a(b)<c>").expect("an address");
        assert_eq!(url, "https://api.crossref.org/works/10.1000/a%28b%29%3Cc%3E");
    }
}
