//! OpenNote's local API (docs/help/local-api.md): a way for programs on this PC to read and add notes.
//! They are scripts, the `opennote` command-line tool, an AI assistant through the MCP server, the browser clipper,
//! and the mail add-ins. Each gets only as much as the person allows.
//!
//! - [`server`] listens on `127.0.0.1` and a named pipe, and nowhere else.
//!
//! - [`guard`] refuses requests with a foreign `Host` or a web page's `Origin`.
//!
//! - [`grants`] gives each app its own token and its own access: read-only by default, on the notebooks the person
//!   picked, never in locked sections. The credential store keeps only hashes of the tokens.
//!
//! - [`pairing`] is how an app gets a grant: the person approves it in a dialog, or types a code they made.
//!
//! - [`routes`] checks each request against its grant, asks the person before each change, and logs every access
//!   in [`access_log`].
//!
//! - [`client`] is the client the `opennote` tool and the tests use.
//!
//! The crate knows nothing of how notes are stored: the app implements [`backend::Backend`] over its core, and
//! [`testing`] has one in memory.

#![deny(unsafe_op_in_unsafe_fn)]

pub mod access_log;
pub mod backend;
pub mod client;
pub mod grants;
pub mod guard;
pub mod hmac;
pub mod http;
pub mod pairing;
pub mod routes;
pub mod server;
pub mod testing;
pub mod webhooks;

pub use access_log::{AccessLog, Entry, Outcome};
pub use backend::{Approver, Backend, BackendError, Decision, Question};
pub use grants::{Access, AppGrant, AppKind, ConfigFile, Grants, Scope, SecretStore};
pub use routes::{Api, Changed};
pub use server::Server;

/// Unix seconds now.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Unix milliseconds now.
pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
