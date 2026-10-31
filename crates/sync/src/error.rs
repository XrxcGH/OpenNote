//! What can go wrong while syncing.
//!
//! The interface matches on [`SyncError::code`] and shows the words for it from `app/src/strings/en/sync.ts`, so
//! they are reviewed and translated with the rest; it gets [`SyncError::detail`] only for diagnostics. The
//! messages here are for logs and tests. None of them holds a key, a passphrase, a note's text, or a file name from
//! inside a notebook, so they are safe to log.

use thiserror::Error;

/// A sync error.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SyncError {
    /// The passphrase, recovery key, or pairing code didn't unlock the vault. A damaged vault looks the same, on
    /// purpose, as `lock.rs` does for a locked file.
    #[error("That didn't unlock sync. Check the passphrase or key and try again.")]
    WrongSecret,
    /// The storage has no sync vault yet.
    #[error("There is no OpenNote sync in this place yet. Set sync up first, or choose the place you used before.")]
    NoVault,
    /// The storage already holds a vault, so setting up again would replace it.
    #[error("This place already holds OpenNote sync. Join it with your passphrase or a pairing code instead.")]
    VaultExists,
    /// A blob failed its check: someone or something changed it.
    #[error("A file in the sync storage was changed outside OpenNote, so sync is paused to keep your notes safe. {0}")]
    Tampered(String),
    /// The storage holds older changes than this device already saw.
    #[error(
        "The sync storage holds older changes than this device has already seen, so sync is paused. If you restored \
         it from a backup on purpose, choose Trust the storage as it is."
    )]
    Rollback,
    /// Files another device wrote haven't arrived yet, as happens while a sync tool is still copying them.
    #[error("Some changes from another device haven't arrived yet. OpenNote tries again shortly.")]
    Incomplete,
    /// This device was removed from sync on another device.
    #[error("This device was removed from sync. Your notes here are kept. To sync again, join with your passphrase.")]
    Removed,
    /// The pairing code is unknown, used, or expired.
    #[error("That pairing code didn't work. Check it for typos, or make a new code on your other device.")]
    PairingExpired,
    /// The pairing code is past its day only by the time on another device's newest change, which is well ahead
    /// of this device's clock: one of the two clocks is wrong.
    #[error(
        "That pairing code has expired by another device's clock, which is ahead of this one. Check the date and \
         time on each device, then make a new code."
    )]
    ClockAhead,
    /// The storage couldn't be reached or refused a request.
    #[error("The sync storage couldn't be reached: {0}. Check the folder or server, then choose Sync now.")]
    Storage(String),
    /// A local file couldn't be read or written.
    #[error(
        "A file in your notes folder couldn't be read or written: {0}. Close other apps using it, then try again."
    )]
    Local(String),
    /// The passphrase is too short to be safe.
    #[error("Choose a passphrase of at least {0} characters. A few unrelated words work well.")]
    WeakPassphrase(usize),
    /// Something this version can't read, such as a vault made by a newer OpenNote.
    #[error("This sync was set up by a newer OpenNote. Update OpenNote on this device, then try again.")]
    Newer,
    /// The work stopped on purpose (a fault-injection point, or a cancel).
    #[error("Sync stopped before it finished. Nothing was lost; it continues next time.")]
    Interrupted,
}

/// Results in this crate.
pub type Result<T> = std::result::Result<T, SyncError>;

impl SyncError {
    /// A short code the interface can match on.
    pub fn code(&self) -> &'static str {
        match self {
            SyncError::WrongSecret => "wrongSecret",
            SyncError::NoVault => "noVault",
            SyncError::VaultExists => "vaultExists",
            SyncError::Tampered(_) => "tampered",
            SyncError::Rollback => "rollback",
            SyncError::Incomplete => "incomplete",
            SyncError::Removed => "removed",
            SyncError::PairingExpired => "pairingExpired",
            SyncError::ClockAhead => "clockAhead",
            SyncError::Storage(_) => "storage",
            SyncError::Local(_) => "local",
            SyncError::WeakPassphrase(_) => "weakPassphrase",
            SyncError::Newer => "newer",
            SyncError::Interrupted => "interrupted",
        }
    }

    /// What the variant carries, for diagnostics: the storage's or the system's reason, which part of storage
    /// failed its check, or the shortest passphrase. Empty for the rest. Never words to show a person.
    pub fn detail(&self) -> String {
        match self {
            SyncError::Tampered(detail) | SyncError::Storage(detail) | SyncError::Local(detail) => detail.clone(),
            SyncError::WeakPassphrase(least) => least.to_string(),
            _ => String::new(),
        }
    }

    pub(crate) fn local(error: std::io::Error) -> SyncError {
        SyncError::Local(error.kind().to_string())
    }
}
