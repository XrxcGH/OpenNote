//! A value that must never reach a log, a file, a crash report, or the interface: an access token, a refresh token,
//! a pasted personal token, or a client secret. It has no `Display`, no `Serialize`, and a `Debug` that hides it, so
//! the only way to read it is to call [`Secret::expose`] on purpose, at the one place that sends it to its service.

use std::fmt;

#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Secret {
        Secret(value.into())
    }

    /// The text, for the request that needs it and for the credential store. Nothing else should call this.
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<hidden>)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_never_holds_the_value() {
        let secret = Secret::new("not-a-real-token");
        assert_eq!(format!("{secret:?}"), "Secret(<hidden>)");
        assert_eq!(format!("{:?}", Some(secret.clone())), "Some(Secret(<hidden>))");
        assert_eq!(secret.expose(), "not-a-real-token");
    }
}
