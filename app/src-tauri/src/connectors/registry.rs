//! The connector registry: every service OpenNote can sign in to, as data. One entry says what the service is
//! called, where its sign-in, token, and revoke endpoints are, which hosts OpenNote may talk to for it, the least
//! access each feature needs, and which OpenNote features use it. Nothing else in OpenNote names a service, and no
//! entry holds a client ID, a client secret, or a token (see `files.rs` for where a client ID comes from).

use serde::Serialize;

pub use super::catalog::CONNECTORS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Group {
    Microsoft,
    Google,
    Storage,
    Learning,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Method {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Patch => "PATCH",
            Self::Delete => "DELETE",
        }
    }

    pub fn parse(text: &str) -> Option<Method> {
        [Self::Get, Self::Post, Self::Put, Self::Patch, Self::Delete]
            .into_iter()
            .find(|method| method.as_str().eq_ignore_ascii_case(text))
    }
}

/// One permission OpenNote asks for. `capability` names a sentence in the interface's strings that says in plain
/// words what it lets OpenNote read or change, and `writes` is true when it lets OpenNote change something.
#[derive(Debug, Clone, Copy)]
pub struct Access {
    pub scope: &'static str,
    pub capability: &'static str,
    pub writes: bool,
}

/// How Disconnect tells the service to forget the sign-in.
#[derive(Debug, Clone, Copy)]
pub enum Revoke {
    /// The service has no revoke endpoint. The sign-in is removed from this computer only.
    None,
    /// A form post with the token, and with the client ID and secret when `with_client` is set.
    Form { url: &'static str, with_client: bool },
    /// A post with the access token as a bearer token, and no body.
    BearerPost { url: &'static str },
    /// A delete with the access token as a bearer token.
    BearerDelete { url: &'static str },
}

/// Whether the token endpoint wants a client secret. Desktop apps cannot keep one private, so a service that
/// takes PKCE alone is `Never`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretUse {
    Never,
    Optional,
    Required,
}

/// Where the sign-in comes back to. A service that lets the loopback port vary takes `AnyPort`, as RFC 8252
/// asks. One that matches the address exactly takes a fixed port, which the owner registers (docs/CONNECTORS.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Redirect {
    AnyPort,
    FixedPort(u16),
}

/// Where the account name for "Connected as" comes from.
#[derive(Debug, Clone, Copy)]
pub enum AccountFrom {
    /// The `preferred_username`, `email`, or `name` claim of the ID token the token endpoint sent.
    IdToken,
    /// A JSON pointer into the token response.
    TokenResponse(&'static str),
    /// A call made with the new access token, then a JSON pointer into its answer.
    Call {
        method: Method,
        url: &'static str,
        pointer: &'static str,
    },
}

/// JSON pointers to the parts of a token response.
#[derive(Debug, Clone, Copy)]
pub struct Pointers {
    pub access: &'static str,
    pub refresh: &'static str,
    pub expires_in: &'static str,
    pub scope: &'static str,
}

pub const STANDARD_RESPONSE: Pointers = Pointers {
    access: "/access_token",
    refresh: "/refresh_token",
    expires_in: "/expires_in",
    scope: "/scope",
};

/// OAuth 2.0 authorization code, with PKCE where the service takes it (RFC 6749, RFC 7636, RFC 8252).
#[derive(Debug, Clone, Copy)]
pub struct OAuthDef {
    pub authorize_url: &'static str,
    pub token_url: &'static str,
    pub revoke: Revoke,
    /// The query parameter that carries the scopes, or empty when the service sets them on the app instead.
    pub scope_param: &'static str,
    pub scope_separator: &'static str,
    pub extra_params: &'static [(&'static str, &'static str)],
    pub pkce: bool,
    pub secret: SecretUse,
    pub redirect: Redirect,
    pub account: AccountFrom,
    pub response: Pointers,
}

/// Where a pasted token goes on a request.
#[derive(Debug, Clone, Copy)]
pub enum Placement {
    /// `Authorization: <scheme> <token>`.
    Header(&'static str),
    /// A field of the form body.
    FormField(&'static str),
}

/// A personal token the person pastes. With `needs_base_url`, the person also gives the school's address, and
/// that address's host is the only host OpenNote talks to for it.
#[derive(Debug, Clone, Copy)]
pub struct TokenDef {
    pub needs_base_url: bool,
    pub placement: Placement,
    pub check_method: Method,
    /// A full address, or with `needs_base_url` a path that follows the school's address.
    pub check_url: &'static str,
    pub check_form: &'static [(&'static str, &'static str)],
    /// Where the account name is in the answer, or empty when the service doesn't say.
    pub account_pointer: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub enum Auth {
    OAuth(OAuthDef),
    Token(TokenDef),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthKind {
    Oauth,
    Token,
    TokenAndUrl,
}

#[derive(Debug, Clone, Copy)]
pub struct ConnectorDef {
    pub id: &'static str,
    pub name: &'static str,
    pub group: Group,
    /// The OpenNote features that use this connector, by feature ID. The interface names them in plain words.
    pub features: &'static [&'static str],
    /// The only hosts OpenNote talks to for this connector. A school address adds its own host (`TokenDef`).
    pub hosts: &'static [&'static str],
    pub access: &'static [Access],
    pub auth: Auth,
}

impl ConnectorDef {
    pub const fn kind(&self) -> AuthKind {
        match self.auth {
            Auth::OAuth(_) => AuthKind::Oauth,
            Auth::Token(TokenDef {
                needs_base_url: true, ..
            }) => AuthKind::TokenAndUrl,
            Auth::Token(_) => AuthKind::Token,
        }
    }

    /// The scopes to ask for: every non-empty scope of `access`, once.
    pub fn scopes(&self) -> Vec<&'static str> {
        let mut scopes: Vec<&'static str> = Vec::new();
        for access in self.access {
            if !access.scope.is_empty() && !scopes.contains(&access.scope) {
                scopes.push(access.scope);
            }
        }
        scopes
    }
}

/// Looks a connector up by ID.
pub fn find(id: &str) -> Option<&'static ConnectorDef> {
    CONNECTORS.iter().find(|def| def.id == id)
}

#[cfg(test)]
mod tests;
