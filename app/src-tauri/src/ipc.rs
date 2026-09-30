//! The error every command returns to the interface (ARCHITECTURE.md section 6.4). The interface turns the code
//! into a message from its strings; `message` is for logs only.

use std::fmt;

use serde::Serialize;

/// Error codes the interface understands. Other modules may add codes; the interface treats unknown ones as
/// a general failure.
pub mod codes {
    /// A command whose Phase 2 implementation hasn't landed yet.
    pub const NOT_IMPLEMENTED: &str = "notImplemented";
    /// The arguments failed validation. `field` names the argument or settings path.
    pub const INVALID: &str = "invalid";
    /// Reading or writing a file failed.
    pub const IO: &str = "io";
    /// Tauri or Windows reported an error.
    pub const INTERNAL: &str = "internal";
}

/// Serialized as `{ code, message, field? }`, matching `IpcError` in the interface's platform types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

/// What every command returns.
pub type IpcResult<T> = Result<T, IpcError>;

impl IpcError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            field: None,
        }
    }

    /// For a command or feature that a later work package implements.
    pub fn not_implemented(what: &str) -> Self {
        Self::new(codes::NOT_IMPLEMENTED, format!("{what} isn't implemented yet."))
    }

    /// For an argument that failed validation. `field` is the argument name or the settings path.
    pub fn invalid(field: &str, message: &str) -> Self {
        Self {
            field: Some(field.to_owned()),
            ..Self::new(codes::INVALID, message)
        }
    }
}

impl fmt::Display for IpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.field {
            Some(field) => write!(f, "{} ({field}): {}", self.code, self.message),
            None => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for IpcError {}

impl From<std::io::Error> for IpcError {
    fn from(error: std::io::Error) -> Self {
        Self::new(codes::IO, error.to_string())
    }
}

impl From<tauri::Error> for IpcError {
    fn from(error: tauri::Error) -> Self {
        Self::new(codes::INTERNAL, error.to_string())
    }
}

#[cfg(windows)]
impl From<windows::core::Error> for IpcError {
    fn from(error: windows::core::Error) -> Self {
        Self::new(codes::INTERNAL, error.message())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn serializes_without_a_field_unless_one_is_set() {
        let error = IpcError::not_implemented("settings_update");
        assert_eq!(
            serde_json::to_value(&error).expect("serializes"),
            json!({ "code": "notImplemented", "message": "settings_update isn't implemented yet." })
        );
        let error = IpcError::invalid("appearance.textSize", "Choose one of the listed text sizes.");
        assert_eq!(
            serde_json::to_value(&error).expect("serializes"),
            json!({
                "code": "invalid",
                "message": "Choose one of the listed text sizes.",
                "field": "appearance.textSize",
            })
        );
    }

    #[test]
    fn io_errors_keep_their_message() {
        let error = IpcError::from(std::io::Error::other("disk on fire"));
        assert_eq!(error.code, codes::IO);
        assert_eq!(error.to_string(), "io: disk on fire");
    }
}
