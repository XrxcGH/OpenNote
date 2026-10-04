//! The OAuth 2.0 requests of a sign-in: the address the browser opens, the exchange of the returned code for tokens,
//! the refresh, and the revoke (RFC 6749, with PKCE from RFC 7636). Every request goes to the connector's own
//! endpoints through the host policy, and no error here says anything but the kind of failure.

use serde_json::Value;
use url::Url;

use super::{
    error::Failure,
    files::Client,
    http::{HostPolicy, Http, HttpRequest, HttpResponse},
    registry::{ConnectorDef, Method, OAuthDef, Revoke, SecretUse},
    secret::Secret,
};

/// The largest answer a token endpoint is read for.
const MAX_ANSWER: usize = 256 * 1024;

/// What the token endpoint gave. Not `Debug`, because it holds tokens.
pub struct Tokens {
    pub access: Secret,
    pub refresh: Option<Secret>,
    pub expires_in: Option<u64>,
    pub scopes: Option<Vec<String>>,
    /// The whole answer, for the ID token and the account name.
    pub body: Value,
}

/// A connector's OAuth settings, its client, and the way to reach it.
pub struct Exchange<'a> {
    pub http: &'a dyn Http,
    pub policy: &'a HostPolicy,
    pub def: &'a ConnectorDef,
    pub oauth: &'a OAuthDef,
    pub client: &'a Client,
}

impl Exchange<'_> {
    /// The address to open in the browser (RFC 6749 section 4.1.1, with the PKCE challenge of RFC 7636).
    pub fn authorize_url(&self, redirect_uri: &str, state: &str, challenge: Option<&str>) -> Option<String> {
        let mut url = Url::parse(self.oauth.authorize_url).ok()?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("response_type", "code");
            query.append_pair("client_id", &self.client.id);
            query.append_pair("redirect_uri", redirect_uri);
            query.append_pair("state", state);
            if !self.oauth.scope_param.is_empty() {
                query.append_pair(
                    self.oauth.scope_param,
                    &self.def.scopes().join(self.oauth.scope_separator),
                );
            }
            if let (true, Some(challenge)) = (self.oauth.pkce, challenge) {
                query.append_pair("code_challenge", challenge);
                query.append_pair("code_challenge_method", "S256");
            }
            for (name, value) in self.oauth.extra_params {
                query.append_pair(name, value);
            }
        }
        Some(url.into())
    }

    /// Trades the returned code for tokens (RFC 6749 section 4.1.3).
    pub fn exchange_code(&self, code: &Secret, verifier: Option<&str>, redirect_uri: &str) -> Result<Tokens, Failure> {
        let mut fields = vec![
            ("grant_type".to_owned(), "authorization_code".to_owned()),
            ("code".to_owned(), code.expose().to_owned()),
            ("redirect_uri".to_owned(), redirect_uri.to_owned()),
        ];
        if let (true, Some(verifier)) = (self.oauth.pkce, verifier) {
            fields.push(("code_verifier".to_owned(), verifier.to_owned()));
        }
        self.parse(self.token_call(fields)?, false)
    }

    /// Trades a refresh token for a new access token (RFC 6749 section 6).
    pub fn refresh(&self, refresh_token: &Secret) -> Result<Tokens, Failure> {
        let fields = vec![
            ("grant_type".to_owned(), "refresh_token".to_owned()),
            ("refresh_token".to_owned(), refresh_token.expose().to_owned()),
        ];
        self.parse(self.token_call(fields)?, true)
    }

    /// Tells the service to forget a sign-in. `token` is the refresh token for the form kind and the access
    /// token for the bearer kinds. Answers `Ok(false)` when the service has no revoke endpoint.
    pub fn revoke(&self, token: &Secret) -> Result<bool, Failure> {
        let request = match self.oauth.revoke {
            Revoke::None => return Ok(false),
            Revoke::Form { url, with_client } => {
                let mut fields = vec![("token".to_owned(), token.expose().to_owned())];
                if with_client {
                    fields.extend(self.client_fields());
                }
                HttpRequest::new(Method::Post, url).form(fields)
            }
            Revoke::BearerPost { url } => {
                HttpRequest::new(Method::Post, url).header("Authorization", format!("Bearer {}", token.expose()))
            }
            Revoke::BearerDelete { url } => {
                HttpRequest::new(Method::Delete, url).header("Authorization", format!("Bearer {}", token.expose()))
            }
        };
        let response = self.send(&request)?;
        // A token the service no longer knows (400 or 401, or Slack's 200 with "ok": false) is revoked enough.
        match response.status {
            200..=299 | 400 | 401 => Ok(true),
            500.. => Err(Failure::Network),
            _ => Err(Failure::Rejected),
        }
    }

    /// The client ID, and the secret when the service takes one and the registration has one.
    fn client_fields(&self) -> Vec<(String, String)> {
        let mut fields = vec![("client_id".to_owned(), self.client.id.clone())];
        if let (Some(secret), false) = (&self.client.secret, self.oauth.secret == SecretUse::Never) {
            fields.push(("client_secret".to_owned(), secret.expose().to_owned()));
        }
        fields
    }

    fn token_call(&self, mut fields: Vec<(String, String)>) -> Result<HttpResponse, Failure> {
        fields.extend(self.client_fields());
        let request = HttpRequest::new(Method::Post, self.oauth.token_url)
            .header("Accept", "application/json")
            .form(fields);
        self.send(&request)
    }

    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, Failure> {
        use super::http::HttpError;
        self.http
            .send(self.policy, request, MAX_ANSWER)
            .map_err(|error| match error {
                HttpError::ForeignHost => Failure::ForeignHost,
                HttpError::Network | HttpError::TooLarge => Failure::Network,
            })
    }

    fn parse(&self, response: HttpResponse, refreshing: bool) -> Result<Tokens, Failure> {
        let json = response.json();
        let error = json.as_ref().and_then(|body| body.get("error")).and_then(Value::as_str);
        let refused = !response.ok()
            || json
                .as_ref()
                .is_some_and(|body| body.get("ok") == Some(&Value::Bool(false)));
        if refused {
            if response.status >= 500 {
                return Err(Failure::Network);
            }
            let gone = matches!(error, Some("invalid_grant" | "invalid_refresh_token" | "invalid_token"));
            return Err(if refreshing && gone {
                Failure::Expired
            } else {
                Failure::Rejected
            });
        }
        let body = json.ok_or(Failure::Rejected)?;
        let pointers = self.oauth.response;
        let access = text_at(&body, pointers.access).ok_or(Failure::Rejected)?;
        Ok(Tokens {
            access: Secret::new(access),
            refresh: text_at(&body, pointers.refresh).map(Secret::new),
            expires_in: body.pointer(pointers.expires_in).and_then(number),
            scopes: text_at(&body, pointers.scope).map(|text| {
                text.split(|c: char| c.is_whitespace() || c == ',')
                    .filter(|scope| !scope.is_empty())
                    .map(str::to_owned)
                    .collect()
            }),
            body,
        })
    }
}

fn text_at(body: &Value, pointer: &str) -> Option<String> {
    body.pointer(pointer)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// A number the service may send as a JSON number or as a string.
fn number(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

#[cfg(test)]
mod tests;
