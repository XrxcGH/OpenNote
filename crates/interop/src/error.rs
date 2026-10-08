//! The errors of import and export.

use std::path::PathBuf;

use thiserror::Error;

/// Why an import or an export stopped.
#[derive(Debug, Error)]
pub enum InteropError {
    /// A file or folder could not be read or written.
    #[error("could not use {path}: {source}")]
    Io {
        /// The file or folder.
        path: PathBuf,
        /// What went wrong.
        #[source]
        source: std::io::Error,
    },
    /// The input is not in the format it claims to be.
    #[error("{what} is not readable: {detail}")]
    Format {
        /// The file or part that failed.
        what: String,
        /// What is wrong with it.
        detail: String,
    },
    /// The source has no page, section, or asset with this ID.
    #[error("the source has no {0}")]
    Missing(String),
    /// The destination refused a page or section.
    #[error("the destination refused the import: {0}")]
    Sink(String),
    /// Something is too big for the format, such as a Word file over 4 GiB.
    #[error("{0} is too big")]
    TooBig(String),
    /// The person canceled the job.
    #[error("canceled")]
    Canceled,
    /// The source is a format that this version cannot read.
    #[error("{what} cannot be imported yet: {why}")]
    Unsupported {
        /// The file or format.
        what: String,
        /// What is missing.
        why: String,
    },
}

impl InteropError {
    /// An input/output error for a path.
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> InteropError {
        InteropError::Io {
            path: path.into(),
            source,
        }
    }

    /// An unsupported format.
    pub fn unsupported(what: impl Into<String>, why: impl Into<String>) -> InteropError {
        InteropError::Unsupported {
            what: what.into(),
            why: why.into(),
        }
    }

    /// A format error.
    pub fn format(what: impl Into<String>, detail: impl Into<String>) -> InteropError {
        InteropError::Format {
            what: what.into(),
            detail: detail.into(),
        }
    }
}

/// The result of an import or export.
pub type Result<T> = std::result::Result<T, InteropError>;
