//! Locking a shared file with a password.
//!
//! Only audited RustCrypto crates do the cryptography: Argon2id (`argon2`) turns the password and a random salt
//! into a 256 bit key, and XChaCha20-Poly1305 (`chacha20poly1305`) encrypts and authenticates the archive under a
//! random 192 bit nonce from the operating system. The whole header is the associated data, so changing the cost
//! parameters, the salt, or the nonce breaks the tag just as changing the ciphertext does. A wrong password and a
//! damaged file give the same answer on purpose.
//!
//! Layout of a locked file: `ONSHARE2`, the Argon2id memory cost in KiB, time cost, and lanes (4 bytes each, big
//! endian), a 16 byte salt, a 24 byte nonce, then the ciphertext with its 16 byte Poly1305 tag at the end.
//!
//! `ONSHARE1` files, from the hand-built construction this replaced, were only ever written by unreleased betas, so
//! this code does not read them: the importer finds [`EARLY_BETA_MAGIC`] and says so instead of calling them damaged.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use crate::error::{InteropError, Result};

/// The first bytes of a locked file.
pub const MAGIC: &[u8; 8] = b"ONSHARE2";
/// The first bytes of a file locked by an unreleased beta, which this version does not open.
pub const EARLY_BETA_MAGIC: &[u8; 8] = b"ONSHARE1";

/// The Argon2id cost a new locked file uses: 64 MiB of memory, three passes, one lane (RFC 9106's second
/// recommended setting, with one lane so it costs the same on every machine).
pub const COST: Cost = Cost {
    memory_kib: 64 * 1024,
    passes: 3,
    lanes: 1,
};

/// The costs a file may ask for. A file that asks for more is hostile (it would make opening it take gigabytes or
/// minutes), and one that asks for less was not locked by this code.
const MIN_MEMORY_KIB: u32 = 8 * 1024;
const MAX_MEMORY_KIB: u32 = 256 * 1024;
const MAX_PASSES: u32 = 10;
const MAX_LANES: u32 = 4;

const SALT: usize = 16;
const NONCE: usize = 24;
const HEADER: usize = 8 + 4 * 3 + SALT + NONCE;
const TAG: usize = 16;

/// Argon2id's cost parameters, as stored in the header.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cost {
    /// Memory in KiB.
    pub memory_kib: u32,
    /// Passes over the memory.
    pub passes: u32,
    /// Lanes.
    pub lanes: u32,
}

impl Cost {
    fn allowed(self) -> bool {
        (MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&self.memory_kib)
            && (1..=MAX_PASSES).contains(&self.passes)
            && (1..=MAX_LANES).contains(&self.lanes)
    }
}

/// Whether bytes start like a locked file.
pub fn is_locked(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

fn key(password: &str, salt: &[u8], cost: Cost) -> Option<Zeroizing<[u8; 32]>> {
    let params = Params::new(cost.memory_kib, cost.passes, cost.lanes, Some(32)).ok()?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .ok()?;
    Some(key)
}

fn cipher(key: &[u8; 32]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new(key.into())
}

/// Locks `plain` with the password.
pub fn lock(password: &str, plain: &[u8]) -> Result<Vec<u8>> {
    lock_with(password, plain, COST)
}

fn lock_with(password: &str, plain: &[u8], cost: Cost) -> Result<Vec<u8>> {
    let failed = |why: &str| InteropError::format("the password lock", why.to_owned());
    let (mut salt, mut nonce) = ([0u8; SALT], [0u8; NONCE]);
    getrandom::fill(&mut salt).map_err(|e| failed(&e.to_string()))?;
    getrandom::fill(&mut nonce).map_err(|e| failed(&e.to_string()))?;
    let key = key(password, &salt, cost).ok_or_else(|| failed("the key could not be made"))?;
    let mut out = Vec::with_capacity(HEADER + plain.len() + TAG);
    out.extend_from_slice(MAGIC);
    for value in [cost.memory_kib, cost.passes, cost.lanes] {
        out.extend_from_slice(&value.to_be_bytes());
    }
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    let sealed = cipher(&key)
        .encrypt(&XNonce::from(nonce), Payload { msg: plain, aad: &out })
        .map_err(|_| failed("the file could not be encrypted"))?;
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Unlocks a locked file. A wrong password and damaged bytes give the same error.
pub fn unlock(password: &str, locked: &[u8]) -> Result<Vec<u8>> {
    let wrong = || InteropError::format("this file", "the password is wrong, or the file is damaged");
    if !is_locked(locked) {
        return Err(InteropError::format("this file", "it is not a locked OpenNote file"));
    }
    if locked.len() < HEADER + TAG {
        return Err(wrong());
    }
    let word = |at: usize| u32::from_be_bytes([locked[at], locked[at + 1], locked[at + 2], locked[at + 3]]);
    let cost = Cost {
        memory_kib: word(8),
        passes: word(12),
        lanes: word(16),
    };
    // Checked before any work, so a hostile header cannot make the key cost more than a file this code wrote.
    if !cost.allowed() {
        return Err(wrong());
    }
    let (header, sealed) = locked.split_at(HEADER);
    let salt = &header[20..20 + SALT];
    let nonce: [u8; NONCE] = header[20 + SALT..].try_into().map_err(|_| wrong())?;
    let key = key(password, salt, cost).ok_or_else(wrong)?;
    cipher(&key)
        .decrypt(
            &XNonce::from(nonce),
            Payload {
                msg: sealed,
                aad: header,
            },
        )
        .map_err(|_| wrong())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cheapest cost a file may ask for, so the tests run quickly.
    const QUICK: Cost = Cost {
        memory_kib: MIN_MEMORY_KIB,
        passes: 1,
        lanes: 1,
    };

    fn message(result: Result<Vec<u8>>) -> String {
        result.expect_err("should not open").to_string()
    }

    #[test]
    fn a_locked_file_opens_only_with_its_password_and_whole() {
        let plain = b"A notebook, a few pages, and a picture".repeat(40);
        let locked = lock_with("correct horse", &plain, QUICK).expect("locks");
        assert!(is_locked(&locked));
        assert_eq!(locked.len(), HEADER + plain.len() + TAG);
        assert!(
            !locked.windows(38).any(|w| w == &plain[..38]),
            "the text is not in the clear"
        );
        assert_eq!(unlock("correct horse", &locked).expect("unlocks"), plain);

        let wrong = message(unlock("battery staple", &locked));
        let mut damaged = locked.clone();
        damaged[HEADER + 3] ^= 1;
        assert_eq!(message(unlock("correct horse", &damaged)), wrong);
        let mut tag = locked.clone();
        *tag.last_mut().unwrap() ^= 1;
        assert_eq!(message(unlock("correct horse", &tag)), wrong);
        for at in [20, 20 + SALT, HEADER - 1] {
            let mut header = locked.clone();
            header[at] ^= 1;
            assert_eq!(
                message(unlock("correct horse", &header)),
                wrong,
                "byte {at} of the header is covered"
            );
        }
        assert_eq!(message(unlock("correct horse", &locked[..HEADER + TAG - 1])), wrong);
    }

    #[test]
    fn the_same_file_locks_differently_each_time() {
        let a = lock_with("pw", b"same", QUICK).expect("locks");
        let b = lock_with("pw", b"same", QUICK).expect("locks");
        assert_ne!(a[20..HEADER], b[20..HEADER], "fresh salt and nonce");
        assert_ne!(a[HEADER..], b[HEADER..]);
    }

    #[test]
    fn a_hostile_header_is_refused_before_any_work() {
        let locked = lock_with("pw", b"x", QUICK).expect("locks");
        let wrong = message(unlock("wrong", &locked));
        for (at, value) in [
            (8, u32::MAX),
            (8, MAX_MEMORY_KIB + 1),
            (8, MIN_MEMORY_KIB - 1),
            (12, 0),
            (12, MAX_PASSES + 1),
            (16, 0),
            (16, MAX_LANES + 1),
        ] {
            let mut hostile = locked.clone();
            hostile[at..at + 4].copy_from_slice(&value.to_be_bytes());
            assert_eq!(message(unlock("pw", &hostile)), wrong, "{value} at byte {at}");
        }
    }

    #[test]
    fn new_files_use_the_full_cost_and_other_files_are_not_locked_ones() {
        assert!(COST.allowed());
        assert!(QUICK.allowed());
        assert!(unlock("pw", b"PK\x03\x04").is_err());
        assert!(!is_locked(b"ONSHARE1 from an early beta"));
        assert!(unlock("pw", b"ONSHARE1 from an early beta").is_err());
    }
}
