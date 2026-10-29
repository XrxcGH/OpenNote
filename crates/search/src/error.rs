//! Errors of the search index.

use thiserror::Error;

/// Anything that can go wrong while building, reading, or querying the index.
#[derive(Debug, Error)]
pub enum SearchError {
    /// SQLite failed.
    #[error("the search index failed: {0}")]
    Database(#[from] rusqlite::Error),
    /// The index file could not be removed or prepared.
    #[error("the search index file failed: {0}")]
    Io(#[from] std::io::Error),
    /// A saved search could not be read or written as JSON.
    #[error("the saved searches are not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// A saved search name is empty or already used.
    #[error("the saved search name {0:?} is empty or already used")]
    SavedName(String),
    /// The text of a regular expression search is not a valid pattern, or it is too large to run.
    #[error("the regular expression is not valid: {0}")]
    Pattern(String),
    /// An ID in the index does not parse. The index is damaged, so it should be rebuilt.
    #[error("the index holds the bad ID {0:?}")]
    BadId(String),
    /// The index file failed a check. It should be rebuilt.
    #[error("the search index file is damaged: {0}")]
    Damaged(String),
}

impl SearchError {
    /// Whether the error means the index file is damaged, so the caller should rebuild it instead of retrying.
    ///
    /// A table or column that is missing counts too. The app's own queries name only what the schema makes, so
    /// the file lost it or was never the app's.
    pub fn is_corrupt(&self) -> bool {
        match self {
            SearchError::Database(rusqlite::Error::SqliteFailure(error, message)) => {
                matches!(
                    error.code,
                    rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase
                ) || message.as_deref().is_some_and(names_missing_schema)
            }
            SearchError::Database(rusqlite::Error::SqlInputError { msg, .. }) => names_missing_schema(msg),
            SearchError::BadId(_) | SearchError::Damaged(_) => true,
            _ => false,
        }
    }
}

/// Whether SQLite's message says a table or column of the schema is missing.
fn names_missing_schema(message: &str) -> bool {
    message.starts_with("no such table") || message.starts_with("no such column")
}

/// The result type of this crate.
pub type Result<T> = std::result::Result<T, SearchError>;
