//! Connecting: an OAuth connector signs in through the person's own browser (RFC 8252), and the others check a
//! pasted token with one request. Nothing is stored until the service has accepted the code or the token.

use std::{
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

use url::{Host, Url};

use super::{
    account,
    error::{ConnectorError, Failure, Result},
    files::{self, Holds},
    http::{HostPolicy, HttpError, HttpRequest},
    loopback::{Callback, Ended, Listener},
    oauth::{Exchange, Tokens},
    pkce,
    registry::{Auth, ConnectorDef, Method, OAuthDef, Redirect, SecretUse, TokenDef},
    secret::Secret,
    service::{Cached, Connectors},
    session::{with_token, DEFAULT_LIFETIME},
    store::target_name,
    view::{ConnectInput, ConnectorView},
};

/// The answer of a token check is read up to this size.
const MAX_CHECK: usize = 64 * 1024;

/// A sign-in that is waiting. It leaves the list of waiting sign-ins when it ends, however it ends.
pub(super) struct Pending {
    owner: Connectors,
    id: String,
    pub flag: Arc<AtomicBool>,
}

impl Drop for Pending {
    fn drop(&mut self) {
        self.owner.lock().pending.remove(&self.id);
    }
}

/// What a successful sign-in or token check hands to [`Connectors::finish`].
struct NewConnection {
    account: String,
    /// The refresh token, or an access token that doesn't expire. This is what the credential store keeps.
    secret: Secret,
    holds: Holds,
    scopes: Vec<String>,
    base_url: Option<String>,
    /// A current access token to keep in memory, and when it ends.
    access: Option<Cached>,
}

impl Connectors {
    /// Connects the person's account. For an OAuth connector this opens the browser and waits, up to five
    /// minutes, until the person finishes or [`Connectors::cancel`] is called.
    pub fn connect(&self, id: &str, input: ConnectInput) -> Result<ConnectorView> {
        let def = self.def(id)?;
        if self.offline() {
            return Err(ConnectorError::new(Failure::Offline, id));
        }
        match def.auth {
            Auth::OAuth(oauth) => self.connect_oauth(def, &oauth)?,
            Auth::Token(token) => self.connect_token(def, &token, input)?,
        }
        self.view(id)
    }

    fn begin(&self, id: &str) -> Result<Pending> {
        let mut state = self.lock();
        if state.pending.contains_key(id) {
            return Err(ConnectorError::new(Failure::Busy, id));
        }
        let flag = Arc::new(AtomicBool::new(false));
        state.pending.insert(id.to_owned(), Arc::clone(&flag));
        Ok(Pending {
            owner: self.clone(),
            id: id.to_owned(),
            flag,
        })
    }

    fn connect_oauth(&self, def: &'static ConnectorDef, oauth: &OAuthDef) -> Result<()> {
        let fail = |failure| ConnectorError::new(failure, def.id);
        let client = files::load_client(&self.0.config_file, def.id)
            .filter(|client| oauth.secret != SecretUse::Required || client.secret.is_some())
            .ok_or_else(|| fail(Failure::NotConfigured))?;
        let pending = self.begin(def.id)?;
        let port = match oauth.redirect {
            Redirect::AnyPort => 0,
            Redirect::FixedPort(default) => client.redirect_port.unwrap_or(default),
        };
        let listener = Listener::bind(port).map_err(|_| fail(Failure::PortInUse))?;
        let redirect_uri = listener.redirect_uri();
        let state = pkce::new_state().ok_or_else(|| fail(Failure::Unknown))?;
        let verifier = if oauth.pkce {
            Some(pkce::new_verifier().ok_or_else(|| fail(Failure::Unknown))?)
        } else {
            None
        };

        let policy = self.policy(def, None);
        let exchange = Exchange {
            http: &*self.0.http,
            policy: &policy,
            def,
            oauth,
            client: &client,
        };
        let challenge = verifier.as_deref().map(pkce::challenge);
        let url = exchange
            .authorize_url(&redirect_uri, &state, challenge.as_deref())
            .ok_or_else(|| fail(Failure::Unknown))?;
        // The sign-in page must be on one of the service's own hosts before the browser is sent there.
        if !policy.allows(&url) {
            return Err(fail(Failure::ForeignHost));
        }
        if !self.0.opener.open(&url) {
            return Err(fail(Failure::BrowserFailed));
        }
        let code = wait_for_code(listener, &state, self.0.wait, &pending.flag).map_err(fail)?;
        // Work offline may have been turned on while the browser was open.
        if self.offline() {
            return Err(fail(Failure::Offline));
        }
        let tokens = exchange
            .exchange_code(&code, verifier.as_deref(), &redirect_uri)
            .map_err(fail)?;
        let account = account::resolve(&exchange, &tokens);
        self.finish(def, self.new_from_tokens(def, tokens, account))
    }

    fn new_from_tokens(&self, def: &ConnectorDef, tokens: Tokens, account: String) -> NewConnection {
        let scopes = tokens
            .scopes
            .unwrap_or_else(|| def.scopes().into_iter().map(str::to_owned).collect());
        // A token that comes with a refresh token is renewed by it, so it always gets an end.
        let lifetime = tokens
            .expires_in
            .or_else(|| tokens.refresh.is_some().then_some(DEFAULT_LIFETIME));
        let expires_unix = lifetime.map(|seconds| self.now() + seconds);
        let (secret, holds) = match tokens.refresh {
            Some(refresh) => (refresh, Holds::Refresh),
            None => (tokens.access.clone(), Holds::Access),
        };
        NewConnection {
            account,
            secret,
            holds,
            scopes,
            base_url: None,
            access: Some(Cached {
                token: tokens.access,
                expires_unix,
            }),
        }
    }

    fn connect_token(&self, def: &'static ConnectorDef, token_def: &TokenDef, input: ConnectInput) -> Result<()> {
        let fail = |failure| ConnectorError::new(failure, def.id);
        let token = clean_token(input.token.as_deref().unwrap_or_default()).ok_or_else(|| fail(Failure::BadInput))?;
        let base = if token_def.needs_base_url {
            Some(
                normalize_base_url(input.base_url.as_deref().unwrap_or_default())
                    .ok_or_else(|| fail(Failure::BadInput))?,
            )
        } else {
            None
        };
        let policy = self.policy(def, base.as_deref());
        let url = match &base {
            Some(base) => format!("{base}{}", token_def.check_url),
            None => token_def.check_url.to_owned(),
        };
        let account = self.check_token(def, token_def, &policy, &url, &token)?;
        self.finish(
            def,
            NewConnection {
                account,
                secret: token,
                holds: Holds::Access,
                scopes: Vec::new(),
                base_url: base,
                access: None,
            },
        )
    }

    /// Sends the token to the service once and returns the account name from the answer.
    fn check_token(
        &self,
        def: &ConnectorDef,
        token_def: &TokenDef,
        policy: &HostPolicy,
        url: &str,
        token: &Secret,
    ) -> Result<String> {
        let fail = |failure| ConnectorError::new(failure, def.id);
        let mut request = HttpRequest::new(token_def.check_method, url);
        if !token_def.check_form.is_empty() {
            request = request.form(
                token_def
                    .check_form
                    .iter()
                    .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                    .collect(),
            );
        }
        // A folder listing asks for the folder alone, which servers answer and a listing of everything they refuse.
        if token_def.check_method == Method::Propfind {
            request = request.header("Depth", "0");
        }
        let request = with_token(request, token_def.placement, token).ok_or_else(|| fail(Failure::BadInput))?;
        let response = self.0.http.send(policy, &request, MAX_CHECK).map_err(|error| {
            fail(match error {
                HttpError::ForeignHost => Failure::ForeignHost,
                HttpError::Network | HttpError::TooLarge => Failure::Network,
            })
        })?;
        if response.status >= 500 {
            return Err(fail(Failure::Network));
        }
        if !response.ok() {
            return Err(fail(Failure::Rejected));
        }
        if token_def.account_pointer.is_empty() {
            return Ok(String::new());
        }
        // A service that answers 200 for a bad token, as Moodle does, has no name in the answer.
        let body = response.json().ok_or_else(|| fail(Failure::Rejected))?;
        account::text_at(&body, token_def.account_pointer).ok_or_else(|| fail(Failure::Rejected))
    }

    /// Keeps a new connection: the secret in the credential store, the metadata in the connections file.
    fn finish(&self, def: &ConnectorDef, new: NewConnection) -> Result<()> {
        let storage = || ConnectorError::new(Failure::Storage, def.id);
        self.0
            .store
            .put(&target_name(def.id, &new.account), &new.secret)
            .map_err(|_| storage())?;
        let mut state = self.lock();
        // Connecting as another account replaces the old one, and the old credential goes with it.
        let replaced = state
            .connections
            .get(def.id)
            .filter(|old| old.account != new.account)
            .map(|old| old.account.clone());
        if let Some(old) = replaced {
            let _ = self.0.store.delete(&target_name(def.id, &old));
        }
        state.connections.insert(
            def.id.to_owned(),
            files::Connection {
                account: new.account,
                scopes: new.scopes,
                connected_unix: self.now(),
                holds: new.holds,
                base_url: new.base_url,
                expired: false,
                last_used_unix: None,
            },
        );
        state.access.remove(def.id);
        if let Some(cached) = new.access {
            state.access.insert(def.id.to_owned(), cached);
        }
        self.save(&state, def.id)
    }
}

/// Waits for the browser's return and turns how it ended into a failure or the code.
fn wait_for_code(
    listener: Listener,
    state: &str,
    wait: Duration,
    cancel: &AtomicBool,
) -> std::result::Result<Secret, Failure> {
    match listener.wait(state, wait, cancel) {
        Ok(Callback::Code(code)) => Ok(code),
        Ok(Callback::Refused(reason)) if reason == "access_denied" => Err(Failure::Denied),
        Ok(Callback::Refused(_)) => Err(Failure::Rejected),
        Err(Ended::Canceled) => Err(Failure::Canceled),
        Err(Ended::TimedOut) => Err(Failure::TimedOut),
        Err(Ended::Mismatch) => Err(Failure::Mismatch),
        Err(Ended::Io) => Err(Failure::Network),
    }
}

/// A pasted token: printable ASCII with no spaces, of a plausible length.
fn clean_token(text: &str) -> Option<Secret> {
    let text = text.trim();
    let plausible = (8..=4096).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_graphic());
    plausible.then(|| Secret::new(text))
}

/// A school's address as `https://host` or `https://host/path`: HTTPS only, a real domain name (never an IP
/// address, `localhost`, or a name with a user name, port, query, or fragment). Anything else is refused, so
/// a pasted token can only go to the school's own server.
pub fn normalize_base_url(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() || text.len() > 200 || text.contains('\\') {
        return None;
    }
    let with_scheme = if text.contains("://") {
        text.to_owned()
    } else {
        format!("https://{text}")
    };
    let url = Url::parse(&with_scheme).ok()?;
    let Some(Host::Domain(host)) = url.host() else {
        return None;
    };
    let plain = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && host.contains('.')
        && !host.ends_with(".localhost")
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if !plain {
        return None;
    }
    let path = url.path().trim_end_matches('/');
    Some(format!("https://{}{path}", host.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn school_addresses_are_normalized() {
        for (input, expected) in [
            ("https://school.instructure.com", "https://school.instructure.com"),
            ("school.instructure.com/", "https://school.instructure.com"),
            (
                "  HTTPS://Moodle.School.EDU/moodle/  ",
                "https://moodle.school.edu/moodle",
            ),
        ] {
            assert_eq!(normalize_base_url(input).as_deref(), Some(expected), "{input}");
        }
    }

    #[test]
    fn school_addresses_that_could_send_a_token_elsewhere_are_refused() {
        for input in [
            "",
            "http://school.edu",
            "https://localhost",
            "https://127.0.0.1",
            "https://[::1]/",
            "https://192.168.1.5",
            "https://school.edu:8443",
            "https://user:pass@school.edu",
            "https://school.edu@evil.example",
            "https://school.edu?x=1",
            "https://school.edu/#frag",
            "https://school",
            "ftp://school.edu",
            "https://school.edu\\@evil.example",
            "https://sch ool.edu",
            "https://xn--",
        ] {
            assert_eq!(normalize_base_url(input), None, "{input}");
        }
    }

    #[test]
    fn pasted_tokens_are_trimmed_and_must_be_plain() {
        assert_eq!(clean_token("  abc12345  "), Some(Secret::new("abc12345")));
        for bad in ["", "short", "has space inside", "line\nbreak1234", "unicodé-token-1234"] {
            assert_eq!(clean_token(bad), None, "{bad:?}");
        }
        assert_eq!(clean_token(&"a".repeat(5000)), None);
    }
}
