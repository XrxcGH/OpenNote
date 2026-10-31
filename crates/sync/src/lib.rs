//! OpenNote's optional end-to-end-encrypted sync (ADR 0049).
//!
//! The notes folder syncs through "dumb" storage that only stores, lists, reads, and deletes named blobs: a folder
//! (including one that OneDrive, Dropbox, iCloud Drive, or Syncthing syncs) or a WebDAV server. Storage sees only
//! sealed blobs with random or keyed-hash names. Nothing needs a server that the project hosts.
//!
//! - [`vault`]: the vault key, and the passphrase, recovery key, device, and pairing slots that unlock it.
//! - [`engine`]: a round of sync, with its preview, crash safety, and tamper and rollback checks.
//! - [`merge`]: the deterministic rules that make every device converge without dropping text.
//! - [`backend`]: the storage: [`FolderBackend`], [`WebDavBackend`], and the in-memory [`MemoryBackend`].
//!
//! Protected sections (ADR 0042) sync as the sealed files they already are; sync never opens them.

pub mod backend;
pub mod crypto;
pub mod engine;
pub mod error;
pub mod local;
pub mod manifest;
pub mod merge;
pub mod vault;

pub use backend::{Backend, FolderBackend, MemoryBackend, WebDavBackend, WebDavConfig};
pub use engine::{last_published, Engine, LocalState, Plan, Report, Summary};
pub use error::{Result, SyncError};
pub use merge::Conflict;
pub use vault::{DeviceInfo, DeviceSecret, PairingCode, RecoveryKey, VaultKeys};
