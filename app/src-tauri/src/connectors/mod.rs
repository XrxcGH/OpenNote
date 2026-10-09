//! Connectors: the accounts OpenNote can sign in to, such as Microsoft, Google, Dropbox, and a school's Canvas.
//! Settings, then Connectors, lists them. Features that need an account use the small API below. Everything is
//! off until the person connects.
//!
//! - **Registry** (`registry.rs`, `catalog.rs`): every service as data, with its endpoints, its hosts, and the
//!   least access each feature needs.
//! - **Sign-in** (`connect.rs`, `loopback.rs`, `oauth.rs`, `pkce.rs`): RFC 8252 for native apps. The person's own
//!   browser opens the service's page. The code comes back on `127.0.0.1` with a random port and an exact path,
//!   and it is traded over HTTPS for tokens with PKCE. A pasted personal token is checked with one request.
//! - **Secrets** (`store.rs`): tokens live only in Windows Credential Manager, as `OpenNote/<connector>/<account>`.
//!   Settings learns the account name, the granted access, and the connection time, never a token.
//! - **Client IDs** (`files.rs`): OpenNote ships with none. An OAuth connector reads its client ID from
//!   `connectors.json` in this device's folder or from the build. Without one it shows "Needs setup", and
//!   docs/CONNECTORS.md says how to add it.
//! - **Work offline**: no sign-in, renewal, or request happens while it is on.
//!
//! The API for features is on [`Connectors`], a managed Tauri state that is cheap to clone:
//!
//! - `is_connected(id)` says whether the person connected it and the sign-in still works.
//! - `access_token(id, access)` gives a fresh access token for a capability such as `calendarRead`, or a scope.
//! - `request(id, access, request, max_bytes)` sends a request with the token added, to an allowed host only.
//!
//! The interface can call `connectors_request` for the last one. It never gets the token.

mod account;
mod catalog;
mod commands;
mod connect;
mod error;
mod files;
mod http;
mod loopback;
#[cfg(test)]
mod mock;
mod oauth;
mod pkce;
mod registry;
mod secret;
mod service;
mod session;
mod store;
#[cfg(test)]
mod tests;
mod view;

// The glob also carries the items Tauri generates for each command, which lib.rs needs by path.
pub use commands::*;
pub use connect::normalize_base_url;
pub use error::{ConnectorError, Failure};
pub use http::{Body, HostPolicy, HttpRequest, HttpResponse};
pub use registry::{find, Method, CONNECTORS};
pub use secret::Secret;
pub use service::{Connectors, Opener, Parts};
pub use session::DEFAULT_MAX_BYTES;
pub use store::{platform_store, MemoryStore, SecretStore};
pub use view::{ConnectInput, ConnectorView, Disconnected, RevokeOutcome, StateView};
