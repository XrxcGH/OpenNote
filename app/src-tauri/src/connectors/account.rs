//! The account name for "Connected as": read from the ID token the token endpoint sent, from the token answer, or
//! from one call with the new access token, as the registry says for each service. The name is for display and for
//! naming the credential, so it is cleaned and cut short. A name that can't be found is empty, and the connection
//! still works.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::Value;

use super::{
    http::{HostPolicy, Http, HttpRequest},
    oauth::{Exchange, Tokens},
    registry::AccountFrom,
};

/// The longest account name kept, in characters.
const MAX_NAME: usize = 100;

/// Drops control characters and surrounding space, and cuts a long name.
pub fn clean(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_NAME)
        .collect()
}

/// A text value of a JSON answer, by pointer.
pub fn text_at(body: &Value, pointer: &str) -> Option<String> {
    let text = clean(body.pointer(pointer)?.as_str()?);
    (!text.is_empty()).then_some(text)
}

/// The sign-in name in an ID token's payload. The token came straight from the token endpoint over HTTPS, so its
/// signature isn't checked (OpenID Connect Core section 3.1.3.7); it is read for display only.
fn from_id_token(body: &Value) -> Option<String> {
    let token = body.get("id_token")?.as_str()?;
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    ["preferred_username", "email", "name"]
        .iter()
        .find_map(|claim| text_at(&claims, &format!("/{claim}")))
}

/// The account name for new tokens, or an empty string.
pub fn resolve(exchange: &Exchange, tokens: &Tokens) -> String {
    match exchange.oauth.account {
        AccountFrom::IdToken => from_id_token(&tokens.body),
        AccountFrom::TokenResponse(pointer) => text_at(&tokens.body, pointer),
        AccountFrom::Call { method, url, pointer } => {
            let request =
                HttpRequest::new(method, url).header("Authorization", format!("Bearer {}", tokens.access.expose()));
            call(exchange.http, exchange.policy, &request, pointer)
        }
    }
    .unwrap_or_default()
}

fn call(http: &dyn Http, policy: &HostPolicy, request: &HttpRequest, pointer: &str) -> Option<String> {
    let response = http.send(policy, request, 64 * 1024).ok()?;
    if !response.ok() {
        return None;
    }
    text_at(&response.json()?, pointer)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn token_with(claims: Value) -> Value {
        let part = |value: &Value| URL_SAFE_NO_PAD.encode(value.to_string());
        json!({ "id_token": format!("{}.{}.signature", part(&json!({ "alg": "none" })), part(&claims)) })
    }

    #[test]
    fn reads_the_name_from_the_id_token_in_order_of_preference() {
        let body = token_with(
            json!({ "name": "Sam Student", "email": "sam@example.com", "preferred_username": "sam@school.example" }),
        );
        assert_eq!(from_id_token(&body).as_deref(), Some("sam@school.example"));
        assert_eq!(
            from_id_token(&token_with(json!({ "name": "Sam", "email": "e@x.example" }))).as_deref(),
            Some("e@x.example")
        );
        assert_eq!(
            from_id_token(&token_with(json!({ "name": "Sam" }))).as_deref(),
            Some("Sam")
        );
        assert_eq!(from_id_token(&token_with(json!({ "sub": "1234" }))), None);
    }

    #[test]
    fn a_damaged_or_missing_id_token_gives_no_name() {
        for body in [
            json!({}),
            json!({ "id_token": "one-part" }),
            json!({ "id_token": "a.!!!.c" }),
            json!({ "id_token": 5 }),
        ] {
            assert_eq!(from_id_token(&body), None, "{body}");
        }
    }

    #[test]
    fn names_are_cleaned_and_cut() {
        assert_eq!(clean("  Sam\u{0}\n Student "), "Sam Student");
        assert_eq!(clean(&"é".repeat(300)).chars().count(), MAX_NAME);
        assert_eq!(text_at(&json!({ "a": { "b": "  " } }), "/a/b"), None);
        assert_eq!(text_at(&json!({ "a": { "b": "x" } }), "/a/b").as_deref(), Some("x"));
    }
}
