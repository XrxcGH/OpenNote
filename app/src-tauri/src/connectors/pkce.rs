//! The random values of a sign-in: the PKCE verifier and its S256 challenge (RFC 7636), and the state value that
//! the browser must bring back (RFC 6749 section 10.12). All of them come from the operating system's generator.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

/// 32 random bytes as 43 URL-safe characters, the shortest verifier RFC 7636 allows with full strength.
pub fn new_verifier() -> Option<String> {
    random_text::<32>()
}

/// 24 random bytes as 32 URL-safe characters.
pub fn new_state() -> Option<String> {
    random_text::<24>()
}

fn random_text<const N: usize>() -> Option<String> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).ok()?;
    Some(URL_SAFE_NO_PAD.encode(bytes))
}

/// The S256 challenge of a verifier: the unpadded URL-safe base64 of its SHA-256.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Compares two values without stopping at the first difference, so the time taken tells nothing about how much
/// of a guessed state value was right.
pub fn same(left: &str, right: &str) -> bool {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    let mut difference = left.len() ^ right.len();
    for (index, byte) in left.iter().enumerate() {
        difference |= usize::from(byte ^ right.get(index).copied().unwrap_or(0));
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_matches_the_example_in_rfc_7636() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifiers_follow_the_rfc_and_never_repeat() {
        let first = new_verifier().expect("the generator works");
        let second = new_verifier().expect("the generator works");
        assert_ne!(first, second);
        // RFC 7636 section 4.1: 43 to 128 characters from the unreserved set.
        assert_eq!(first.len(), 43);
        assert!(first.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn state_values_are_long_and_fresh() {
        let first = new_state().expect("the generator works");
        let second = new_state().expect("the generator works");
        assert_ne!(first, second);
        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn comparison_sees_every_kind_of_difference() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "ab"));
        assert!(!same("ab", "abc"));
        assert!(same("", ""));
        assert!(!same("", "a"));
    }
}
