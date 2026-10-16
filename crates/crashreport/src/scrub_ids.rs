//! The scrubber's rules for identifiers and keys: GUIDs, account SIDs, MAC, IPv4, and IPv6 addresses, the values
//! of named secrets, and long key-like strings. They are separate from the rules for text, quotes, and paths in
//! [`crate::scrub`] to keep each file small.

use crate::scrub::replace_spans;

/// What replaces an identifier that names a device, an account, or a network address.
pub(crate) const ID: &str = "<id>";
/// What replaces a long opaque string, such as a key or a token.
pub(crate) const TOKEN: &str = "<token>";

/// The shortest run of key-like characters that is taken for a key or token.
const MIN_TOKEN: usize = 32;
/// The shortest part of a dotted token, such as a JSON Web Token's header, payload, or signature.
const MIN_TOKEN_PART: usize = 8;

/// Words after which a value is a secret, as in `password=hunter2` and `Authorization: Bearer abc`. A longer
/// name that ends in one counts too, such as `api_key`, `X-Api-Key`, and `accessToken`.
const SECRET_NAMES: [&str; 9] = [
    "token",
    "key",
    "secret",
    "password",
    "passwd",
    "authorization",
    "bearer",
    "cookie",
    "apikey",
];
/// Words that name how a secret is sent. The secret follows them, as in `Authorization: Basic abc`.
const SCHEMES: [&str; 5] = ["bearer", "basic", "digest", "token", "negotiate"];

/// Replaces identifiers that name a device, an account, or a network address: GUIDs, account SIDs, MAC
/// addresses, and IPv4 and IPv6 addresses.
pub(crate) fn replace_ids(text: &str) -> String {
    replace_spans(text, |rest, previous| {
        if previous.is_some_and(|p| p.is_alphanumeric() || p == '-' || p == '.') {
            return None;
        }
        let len = guid_len(rest)
            .or_else(|| sid_len(rest))
            .or_else(|| mac_len(rest))
            .or_else(|| ipv4_len(rest))
            .or_else(|| ipv6_len(rest))?;
        // The identifier must end where a word ends, so a longer number or name is left to the other rules. A
        // dot that goes on with a digit is part of a longer dotted number, such as a version.
        let mut after = rest[len..].chars();
        let ends = match after.next() {
            None => true,
            Some('.') => !after.next().is_some_and(|c| c.is_ascii_digit()),
            Some(a) => !(a.is_alphanumeric() || a == '-'),
        };
        ends.then_some((len, ID))
    })
}

/// `8-4-4-4-12` hexadecimal digits, optionally in braces. Returns the length in bytes.
fn guid_len(rest: &str) -> Option<usize> {
    let braced = rest.starts_with('{');
    let bytes = rest.as_bytes();
    let mut at = usize::from(braced);
    for (i, group) in [8, 4, 4, 4, 12].into_iter().enumerate() {
        if i > 0 {
            if bytes.get(at) != Some(&b'-') {
                return None;
            }
            at += 1;
        }
        let digits = bytes.get(at..at + group)?;
        if !digits.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        at += group;
    }
    if braced {
        if bytes.get(at) != Some(&b'}') {
            return None;
        }
        at += 1;
    }
    Some(at)
}

/// `S-1-5-21-...`: a Windows account identifier. Returns the length in bytes.
fn sid_len(rest: &str) -> Option<usize> {
    let prefix = rest.get(..4).filter(|p| p.eq_ignore_ascii_case("S-1-"))?;
    let bytes = rest.as_bytes();
    let mut len = prefix.len();
    let mut numbers = 0;
    loop {
        let digits = bytes[len..].iter().take_while(|b| b.is_ascii_digit()).count();
        if digits == 0 {
            break;
        }
        len += digits;
        numbers += 1;
        // Another number follows only after a dash that a digit follows.
        if bytes.get(len) == Some(&b'-') && bytes.get(len + 1).is_some_and(u8::is_ascii_digit) {
            len += 1;
        } else {
            break;
        }
    }
    // `S-1-5-18` is a well known account, not the person's. A person's has at least four numbers.
    (numbers >= 4).then_some(len)
}

/// Six pairs of hexadecimal digits joined by colons or by dashes. Returns the length in bytes.
fn mac_len(rest: &str) -> Option<usize> {
    let bytes = rest.as_bytes();
    let separator = *bytes.get(2).filter(|&&b| b == b':' || b == b'-')?;
    for pair in 0..6 {
        let at = pair * 3;
        if !bytes.get(at..at + 2)?.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        if pair < 5 && bytes.get(at + 2) != Some(&separator) {
            return None;
        }
    }
    Some(17)
}

/// Four numbers from 0 to 255 joined by dots. Returns the length in bytes.
fn ipv4_len(rest: &str) -> Option<usize> {
    let bytes = rest.as_bytes();
    let mut len = 0;
    for part in 0..4 {
        if part > 0 {
            if bytes.get(len) != Some(&b'.') {
                return None;
            }
            len += 1;
        }
        let digits = bytes[len..].iter().take_while(|b| b.is_ascii_digit()).count();
        if digits == 0 || digits > 3 || rest[len..len + digits].parse::<u16>().ok()? > 255 {
            return None;
        }
        len += digits;
    }
    Some(len)
}

/// Hexadecimal groups joined by colons, with at most one `::`, and an optional zone such as `%12`. A full
/// address has eight groups. A shortened one needs three groups and a digit, so `Add::add` and a time such as
/// `12:30:45` stay. Returns the length in bytes.
fn ipv6_len(rest: &str) -> Option<usize> {
    let bytes = rest.as_bytes();
    let hex_at = |at: usize| bytes.get(at).is_some_and(u8::is_ascii_hexdigit);
    let (mut len, mut shortened) = if rest.starts_with("::") { (2, true) } else { (0, false) };
    let (mut groups, mut digit) = (0, false);
    loop {
        let hex = bytes[len..].iter().take_while(|b| b.is_ascii_hexdigit()).count();
        if hex > 4 {
            return None;
        }
        if hex == 0 {
            break;
        }
        digit |= bytes[len..len + hex].iter().any(u8::is_ascii_digit);
        groups += 1;
        len += hex;
        if !shortened && bytes.get(len..len + 2) == Some(b"::".as_slice()) {
            shortened = true;
            len += 2;
        } else if bytes.get(len) == Some(&b':') && hex_at(len + 1) {
            len += 1;
        } else {
            break;
        }
    }
    let full = groups == 8 && !shortened;
    if !full && !(shortened && (3..=7).contains(&groups) && digit) {
        return None;
    }
    if bytes.get(len) == Some(&b'%') {
        let zone = bytes[len + 1..]
            .iter()
            .take_while(|b| b.is_ascii_alphanumeric())
            .count();
        if zone > 0 {
            len += 1 + zone;
        }
    }
    Some(len)
}

/// Whether a character can be part of a word that names a secret.
fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// Whether `word` names a secret: one of [`SECRET_NAMES`], or a longer name that ends in one after `_`, `-`, or a
/// change to upper case.
fn names_secret(word: &str) -> bool {
    SECRET_NAMES.iter().any(|name| {
        let Some(start) = word.len().checked_sub(name.len()) else {
            return false;
        };
        if !word.is_char_boundary(start) || !word[start..].eq_ignore_ascii_case(name) {
            return false;
        }
        let upper = word[start..].starts_with(|c: char| c.is_ascii_uppercase());
        word[..start]
            .chars()
            .next_back()
            .is_none_or(|b| b == '_' || b == '-' || (upper && b.is_ascii_lowercase()))
    })
}

/// When `text` starts with a word that names a secret and then its value, how many bytes to keep and how long
/// the value is. A value after `=` or `:`, or after a scheme such as `Bearer`, is a secret whatever it holds.
/// After a space alone it must hold a digit or be long, so `the key to` and `token in` stay.
fn secret_at(text: &str) -> Option<(usize, usize)> {
    let word = text.find(|c: char| !is_name_char(c)).unwrap_or(text.len());
    if !names_secret(&text[..word]) {
        return None;
    }
    let mut at = word;
    let mut sure = text[..word].eq_ignore_ascii_case("bearer");
    loop {
        let gap = text[at..]
            .find(|c: char| !matches!(c, '=' | ':' | ' '))
            .unwrap_or(text.len() - at);
        // `::` joins the parts of a code path such as `Token::parse`, which is no secret.
        if gap == 0 || text[at..at + gap].contains("::") {
            return None;
        }
        sure |= text[at..at + gap].contains(['=', ':']);
        at += gap;
        let len = text[at..]
            .find(|c: char| c.is_whitespace() || ",;&\"'`<>()[]{}".contains(c))
            .unwrap_or(text.len() - at);
        let value = &text[at..at + len];
        if value.is_empty() {
            return None;
        }
        if SCHEMES.iter().any(|scheme| value.eq_ignore_ascii_case(scheme)) {
            at += len;
            sure = true;
            continue;
        }
        let secret = sure || value.bytes().any(|b| b.is_ascii_digit()) || value.chars().count() >= 16;
        return secret.then_some((at, len));
    }
}

/// Replaces the value that follows a word naming a secret, such as `password=hunter2` or `Authorization: Bearer
/// abc`, whatever its length. The word itself stays, so the reader can tell what was removed.
pub(crate) fn replace_secrets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous: Option<char> = None;
    let mut rest = text;
    while let Some(c) = rest.chars().next() {
        let found = if previous.is_none_or(|p| !is_name_char(p)) {
            secret_at(rest)
        } else {
            None
        };
        if let Some((keep, len)) = found {
            out.push_str(&rest[..keep]);
            out.push_str(TOKEN);
            previous = rest[..keep + len].chars().next_back();
            rest = &rest[keep + len..];
        } else {
            out.push(c);
            previous = Some(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

/// Three or more runs of base64url characters joined by dots, as a JSON Web Token is, when each run is long and
/// together they mix letters and digits. Returns the length in bytes.
fn dotted_token_len(rest: &str) -> Option<usize> {
    let part = |text: &str| {
        text.find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
            .unwrap_or(text.len())
    };
    let (mut len, mut parts) = (0, 0);
    loop {
        let run = part(&rest[len..]);
        if run < MIN_TOKEN_PART {
            break;
        }
        len += run;
        parts += 1;
        if rest[len..].starts_with('.') && part(&rest[len + 1..]) >= MIN_TOKEN_PART {
            len += 1;
        } else {
            break;
        }
    }
    let run = &rest.as_bytes()[..len];
    let mixed = run.iter().any(u8::is_ascii_digit) && run.iter().any(u8::is_ascii_alphabetic);
    (parts >= 3 && len >= MIN_TOKEN && mixed).then_some(len)
}

/// Whether a character can be part of a key or token.
fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "+/_=-".contains(c)
}

/// Replaces long strings that look like keys, tokens, or digests: at least [`MIN_TOKEN`] key-like characters
/// with at least one letter and one digit. They may come in dotted parts, as a JSON Web Token does.
pub(crate) fn replace_tokens(text: &str) -> String {
    replace_spans(text, |rest, previous| {
        if previous.is_some_and(is_token_char) {
            return None;
        }
        if previous != Some('.') {
            if let Some(len) = dotted_token_len(rest) {
                return Some((len, TOKEN));
            }
        }
        let len = rest.find(|c: char| !is_token_char(c)).unwrap_or(rest.len());
        let run = &rest.as_bytes()[..len];
        let mixed = run.iter().any(u8::is_ascii_digit) && run.iter().any(u8::is_ascii_alphabetic);
        (len >= MIN_TOKEN && mixed).then_some((len, TOKEN))
    })
}

#[cfg(test)]
#[path = "scrub_ids_tests.rs"]
mod tests;
