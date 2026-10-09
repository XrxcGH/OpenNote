//! The `opennote` command-line tool (docs/help/command-line.md) and its MCP server (docs/help/local-api.md). Both
//! work only through OpenNote's local API, so they can do no more than the person allowed in App permissions.

#![deny(unsafe_op_in_unsafe_fn)]

pub mod commands;
pub mod mcp;
pub mod session;
pub mod store;

pub use commands::{run, HELP};
pub use session::{CliError, Env, Identity, Session};
