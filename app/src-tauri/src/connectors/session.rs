//! Using a connection: a fresh access token for the access a feature needs, an authorized request to an allowed
//! host, and Disconnect. These are the calls the features of OpenNote make later. The token a feature gets
//! stays in Rust, and the interface can only ask for [`Connectors::request`], which adds the token itself.

use super::{
    error::{ConnectorError, Failure, Result},
    files::{Connection, Holds},
    http::{Body, HttpError, HttpRequest, HttpResponse},
    oauth::Exchange,
    registry::{Auth, ConnectorDef, Placement, Revoke},
    secret::Secret,
    service::{Cached, Connectors},
    store::target_name,
    view::{Disconnected, RevokeOutcome},
};

/// An access token is renewed this many seconds before it ends.
const RENEW_BEFORE: u64 = 120;
/// With no stated lifetime, an access token that has a refresh token behind it is renewed after this many seconds.
pub(super) const DEFAULT_LIFETIME: u64 = 3300;
/// The largest answer `request` reads, unless the caller asks for more.
pub const DEFAULT_MAX_BYTES: usize = 8 * 1024 * 1024;

/// Headers the caller can never set: the token is the connector's to add, and the rest name the server.
const FORBIDDEN_HEADERS: [&str; 5] = [
    "authorization",
    "proxy-authorization",
    "cookie",
    "host",
    "content-length",
];

/// Puts the token where the service wants it.
pub(super) fn with_token(mut request: HttpRequest, placement: Placement, token: &Secret) -> Option<HttpRequest> {
    match placement {
        Placement::Header(scheme) => Some(request.header("Authorization", format!("{scheme} {}", token.expose()))),
        Placement::FormField(name) => {
            let mut fields = match request.body.take() {
                None => Vec::new(),
                Some(Body::Form(fields)) => fields,
                Some(Body::Bytes { .. }) => return None,
            };
            fields.push((name.to_owned(), token.expose().to_owned()));
            request.body = Some(Body::Form(fields));
            Some(request)
        }
    }
}

fn placement_of(def: &ConnectorDef) -> Placement {
    match def.auth {
        Auth::OAuth(_) => Placement::Header("Bearer"),
        Auth::Token(token) => token.placement,
    }
}

/// Whether the connection was granted `wanted`. Services spell a granted scope in different ways, such as
/// Microsoft's `https://graph.microsoft.com/Notes.Read` for `Notes.Read`, and in any case.
///
/// The sign-in scopes (`openid`, `email`, `profile`, `offline_access`) count as granted on any connection: the
/// sign-in itself proves them, and services leave them out of the token answer (Microsoft) or spell them as
/// URLs such as `https://www.googleapis.com/auth/userinfo.email` (Google).
fn granted(connection: &Connection, wanted: &str) -> bool {
    let short = |scope: &str| scope.rsplit('/').next().unwrap_or(scope).to_lowercase();
    if matches!(short(wanted).as_str(), "openid" | "email" | "profile" | "offline_access") {
        return true;
    }
    connection
        .scopes
        .iter()
        .any(|have| have == wanted || short(have) == short(wanted))
}

/// The scopes a feature means: a capability name (such as `calendarRead`) stands for the scopes the registry lists
/// for it, and anything else is a scope as the service spells it.
fn expand(def: &ConnectorDef, wanted: &[&str]) -> Vec<String> {
    let mut scopes: Vec<String> = Vec::new();
    for want in wanted {
        let matching: Vec<&str> = def
            .access
            .iter()
            .filter(|a| a.capability == *want && !a.scope.is_empty())
            .map(|a| a.scope)
            .collect();
        if matching.is_empty() {
            scopes.push((*want).to_owned());
        } else {
            scopes.extend(matching.into_iter().map(str::to_owned));
        }
    }
    scopes
}

impl Connectors {
    /// A fresh access token for the given access. It is renewed first when it is about to end. This fails with
    /// `Offline` while Work offline is on, `NotConnected` or `Expired` when the person needs to connect, and
    /// `MissingAccess` when the connection was made without what is asked for.
    pub fn access_token(&self, id: &str, wanted: &[&str]) -> Result<Secret> {
        let def = self.def(id)?;
        if self.offline() {
            return Err(ConnectorError::new(Failure::Offline, id));
        }
        self.token_for(def, wanted)
    }

    fn token_for(&self, def: &'static ConnectorDef, wanted: &[&str]) -> Result<Secret> {
        let fail = |failure| ConnectorError::new(failure, def.id);
        let connection = self
            .lock()
            .connections
            .get(def.id)
            .cloned()
            .ok_or_else(|| fail(Failure::NotConnected))?;
        if connection.expired {
            return Err(fail(Failure::Expired));
        }
        if expand(def, wanted).iter().any(|scope| !granted(&connection, scope)) {
            return Err(fail(Failure::MissingAccess));
        }
        let token = match connection.holds {
            Holds::Access => self.stored(def, &connection)?,
            Holds::Refresh => self.renewed(def, &connection)?,
        };
        if let Some(entry) = self.lock().connections.get_mut(def.id) {
            entry.last_used_unix = Some(self.now());
        }
        Ok(token)
    }

    fn stored(&self, def: &ConnectorDef, connection: &Connection) -> Result<Secret> {
        match self.0.store.get(&target_name(def.id, &connection.account)) {
            Ok(Some(secret)) => Ok(secret),
            // The credential is gone, so the person has to connect again.
            Ok(None) => Err(self.expire(def, Failure::Expired)),
            Err(_) => Err(ConnectorError::new(Failure::Storage, def.id)),
        }
    }

    /// The cached access token while it is good, or a new one from the refresh token.
    fn renewed(&self, def: &'static ConnectorDef, connection: &Connection) -> Result<Secret> {
        let fresh = |cached: &Cached| cached.expires_unix.is_none_or(|end| end > self.now() + RENEW_BEFORE);
        if let Some(cached) = self.lock().access.get(def.id).filter(|cached| fresh(cached)) {
            return Ok(cached.token.clone());
        }
        let _one_at_a_time = self
            .0
            .refreshing
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Another call may have renewed it while this one waited.
        if let Some(cached) = self.lock().access.get(def.id).filter(|cached| fresh(cached)) {
            return Ok(cached.token.clone());
        }
        self.refresh_now(def, connection)
    }

    /// Trades the stored refresh token for a new access token and keeps what comes back.
    fn refresh_now(&self, def: &'static ConnectorDef, connection: &Connection) -> Result<Secret> {
        let fail = |failure| ConnectorError::new(failure, def.id);
        let Auth::OAuth(oauth) = def.auth else {
            return Err(fail(Failure::Unknown));
        };
        let refresh = self.stored(def, connection)?;
        let client =
            super::files::load_client(&self.0.config_file, def.id).ok_or_else(|| fail(Failure::NotConfigured))?;
        let policy = self.policy(def, None);
        let exchange = Exchange {
            http: &*self.0.http,
            policy: &policy,
            def,
            oauth: &oauth,
            client: &client,
        };
        let tokens = match exchange.refresh(&refresh) {
            Ok(tokens) => tokens,
            Err(Failure::Expired) => return Err(self.expire(def, Failure::Expired)),
            Err(failure) => return Err(fail(failure)),
        };
        // A service that rotates refresh tokens sends a new one, and the old one stops working.
        if let Some(rotated) = &tokens.refresh {
            self.0
                .store
                .put(&target_name(def.id, &connection.account), rotated)
                .map_err(|_| fail(Failure::Storage))?;
        }
        let expires_unix = Some(self.now() + tokens.expires_in.unwrap_or(DEFAULT_LIFETIME));
        let token = tokens.access.clone();
        self.lock().access.insert(
            def.id.to_owned(),
            Cached {
                token: tokens.access,
                expires_unix,
            },
        );
        Ok(token)
    }

    /// Marks the connection as needing a new sign-in, and forgets its access token.
    fn expire(&self, def: &ConnectorDef, failure: Failure) -> ConnectorError {
        let mut state = self.lock();
        state.access.remove(def.id);
        if let Some(connection) = state.connections.get_mut(def.id) {
            connection.expired = true;
        }
        // Failing to save the mark is not worth hiding the real reason for.
        let _ = self.save(&state, def.id);
        ConnectorError::new(failure, def.id)
    }

    /// Runs a request with the connection's token added. The address must be HTTPS on one of the connector's
    /// hosts, and the caller can't set the `Authorization` header. A 401 renews the token and tries once more.
    pub fn request(&self, id: &str, wanted: &[&str], request: HttpRequest, max_bytes: usize) -> Result<HttpResponse> {
        let def = self.def(id)?;
        if self.offline() {
            return Err(ConnectorError::new(Failure::Offline, id));
        }
        let fail = |failure| ConnectorError::new(failure, id);
        if request.headers.iter().any(|(name, value)| !header_ok(name, value)) {
            return Err(fail(Failure::BadInput));
        }
        let base = self
            .lock()
            .connections
            .get(id)
            .and_then(|connection| connection.base_url.clone());
        let policy = self.policy(def, base.as_deref());
        if !policy.allows(&request.url) {
            return Err(fail(Failure::ForeignHost));
        }
        let mut retried = false;
        loop {
            let token = self.token_for(def, wanted)?;
            let signed = with_token(clone_request(&request), placement_of(def), &token)
                .ok_or_else(|| fail(Failure::BadInput))?;
            let response = self.0.http.send(&policy, &signed, max_bytes).map_err(|error| {
                fail(match error {
                    HttpError::ForeignHost => Failure::ForeignHost,
                    HttpError::Network | HttpError::TooLarge => Failure::Network,
                })
            })?;
            if response.status != 401 {
                return Ok(response);
            }
            if retried || !matches!(def.auth, Auth::OAuth(_)) || self.holds_access_only(id) {
                return Err(self.expire(def, Failure::Expired));
            }
            retried = true;
            self.lock().access.remove(id);
        }
    }

    fn holds_access_only(&self, id: &str) -> bool {
        self.lock()
            .connections
            .get(id)
            .is_some_and(|connection| connection.holds == Holds::Access)
    }

    /// Removes the connection from this computer, and tells the service to forget it where the service allows.
    /// The person is disconnected here even when the service can't be reached.
    pub fn disconnect(&self, id: &str) -> Result<Disconnected> {
        let def = self.def(id)?;
        let Some(connection) = self.lock().connections.get(id).cloned() else {
            return Ok(Disconnected {
                view: self.view(id)?,
                revoke: RevokeOutcome::Nothing,
            });
        };
        let revoke = self.revoke(def, &connection);
        self.0
            .store
            .delete(&target_name(id, &connection.account))
            .map_err(|_| ConnectorError::new(Failure::Storage, id))?;
        {
            let mut state = self.lock();
            state.connections.remove(id);
            state.access.remove(id);
            self.save(&state, id)?;
        }
        Ok(Disconnected {
            view: self.view(id)?,
            revoke,
        })
    }

    fn revoke(&self, def: &'static ConnectorDef, connection: &Connection) -> RevokeOutcome {
        let Auth::OAuth(oauth) = def.auth else {
            return RevokeOutcome::NotSupported;
        };
        if matches!(oauth.revoke, Revoke::None) {
            return RevokeOutcome::NotSupported;
        }
        if self.offline() {
            return RevokeOutcome::SkippedOffline;
        }
        let Some(client) = super::files::load_client(&self.0.config_file, def.id) else {
            return RevokeOutcome::Failed;
        };
        // The bearer kinds need a working access token, and the form kind takes the refresh token itself.
        let token = match (oauth.revoke, connection.holds) {
            (Revoke::Form { .. }, _) => self.stored(def, connection),
            _ if connection.expired => return RevokeOutcome::Failed,
            _ => self.token_for(def, &[]),
        };
        let Ok(token) = token else { return RevokeOutcome::Failed };
        let policy = self.policy(def, None);
        let exchange = Exchange {
            http: &*self.0.http,
            policy: &policy,
            def,
            oauth: &oauth,
            client: &client,
        };
        match exchange.revoke(&token) {
            Ok(true) => RevokeOutcome::Revoked,
            Ok(false) => RevokeOutcome::NotSupported,
            Err(_) => RevokeOutcome::Failed,
        }
    }
}

fn header_ok(name: &str, value: &str) -> bool {
    let name_ok = !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    let value_ok = value.bytes().all(|b| b == b'\t' || (0x20..0x7f).contains(&b));
    name_ok && value_ok && !FORBIDDEN_HEADERS.contains(&name.to_ascii_lowercase().as_str())
}

fn clone_request(request: &HttpRequest) -> HttpRequest {
    HttpRequest {
        method: request.method,
        url: request.url.clone(),
        headers: request.headers.clone(),
        body: request.body.as_ref().map(|body| match body {
            Body::Form(fields) => Body::Form(fields.clone()),
            Body::Bytes { content_type, data } => Body::Bytes {
                content_type: content_type.clone(),
                data: data.clone(),
            },
        }),
    }
}

#[cfg(test)]
mod tests;
