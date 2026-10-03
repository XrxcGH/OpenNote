//! Locking a shared file with a password.
//!
//! The construction is the standard one built from SHA-256 alone: PBKDF2-HMAC-SHA256 turns the password into two
//! keys, HMAC-SHA256 in counter mode makes the keystream that is XORed with the data, and HMAC-SHA256 over the
//! header and the ciphertext is the tag that proves the password was right and the bytes are whole (encrypt, then
//! authenticate). A wrong password and a damaged file give the same answer on purpose.
//!
//! Layout of a locked file: `ONSHARE1`, the PBKDF2 iteration count (4 bytes, big endian), a 16 byte salt, a 16 byte
//! nonce, the ciphertext, and the 32 byte tag.

use sha2::{Digest, Sha256};

use crate::error::{InteropError, Result};

/// The first bytes of a locked file.
pub const MAGIC: &[u8; 8] = b"ONSHARE1";

/// How many PBKDF2 rounds a new locked file uses.
pub const ITERATIONS: u32 = 200_000;

const HEADER: usize = 8 + 4 + 16 + 16;
const TAG: usize = 32;
/// The fewest and most rounds a file may ask for. A file that asks for more is hostile, and one that asks for fewer
/// was not locked by this code.
const MIN_ITERATIONS: u32 = 1_000;
const MAX_ITERATIONS: u32 = 5_000_000;

/// HMAC-SHA256 with the key schedule done once, so each message costs two compressions.
#[derive(Clone)]
struct Hmac {
    inner: Sha256,
    outer: Sha256,
}

impl Hmac {
    fn new(key: &[u8]) -> Hmac {
        let mut block = [0u8; 64];
        if key.len() > 64 {
            block[..32].copy_from_slice(&Sha256::digest(key));
        } else {
            block[..key.len()].copy_from_slice(key);
        }
        let mut inner = Sha256::new();
        let mut outer = Sha256::new();
        inner.update(block.map(|b| b ^ 0x36));
        outer.update(block.map(|b| b ^ 0x5c));
        Hmac { inner, outer }
    }

    fn mac(&self, parts: &[&[u8]]) -> [u8; 32] {
        let mut inner = self.inner.clone();
        for part in parts {
            inner.update(part);
        }
        let mut outer = self.outer.clone();
        outer.update(inner.finalize());
        outer.finalize().into()
    }
}

/// HMAC-SHA256.
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    Hmac::new(key).mac(&[data])
}

/// PBKDF2-HMAC-SHA256 (RFC 8018), filling `out`.
pub fn pbkdf2_sha256(password: &[u8], salt: &[u8], iterations: u32, out: &mut [u8]) {
    let hmac = Hmac::new(password);
    for (index, chunk) in out.chunks_mut(32).enumerate() {
        let counter = (index as u32 + 1).to_be_bytes();
        let mut block = hmac.mac(&[salt, &counter]);
        let mut sum = block;
        for _ in 1..iterations {
            block = hmac.mac(&[&block]);
            for (s, b) in sum.iter_mut().zip(block) {
                *s ^= b;
            }
        }
        chunk.copy_from_slice(&sum[..chunk.len()]);
    }
}

fn keys(password: &str, salt: &[u8], iterations: u32) -> ([u8; 32], [u8; 32]) {
    let mut both = [0u8; 64];
    pbkdf2_sha256(password.as_bytes(), salt, iterations, &mut both);
    let (mut enc, mut mac) = ([0u8; 32], [0u8; 32]);
    enc.copy_from_slice(&both[..32]);
    mac.copy_from_slice(&both[32..]);
    (enc, mac)
}

/// XORs the keystream into `data`.
fn apply_keystream(enc_key: &[u8; 32], nonce: &[u8], data: &mut [u8]) {
    let hmac = Hmac::new(enc_key);
    for (index, chunk) in data.chunks_mut(32).enumerate() {
        let block = hmac.mac(&[nonce, &(index as u64).to_be_bytes()]);
        for (byte, key) in chunk.iter_mut().zip(block) {
            *byte ^= key;
        }
    }
}

/// Whether bytes start like a locked file.
pub fn is_locked(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

/// Locks `plain` with the password.
pub fn lock(password: &str, plain: &[u8]) -> Result<Vec<u8>> {
    lock_with(password, plain, ITERATIONS)
}

fn lock_with(password: &str, plain: &[u8], iterations: u32) -> Result<Vec<u8>> {
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|e| InteropError::format("the password lock", e.to_string()))?;
    let (salt, nonce) = random.split_at(16);
    let (enc_key, mac_key) = keys(password, salt, iterations);
    let mut out = Vec::with_capacity(HEADER + plain.len() + TAG);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&iterations.to_be_bytes());
    out.extend_from_slice(salt);
    out.extend_from_slice(nonce);
    out.extend_from_slice(plain);
    apply_keystream(&enc_key, nonce, &mut out[HEADER..]);
    let tag = Hmac::new(&mac_key).mac(&[&out]);
    out.extend_from_slice(&tag);
    Ok(out)
}

/// Unlocks a locked file. A wrong password and damaged bytes give the same error.
pub fn unlock(password: &str, locked: &[u8]) -> Result<Vec<u8>> {
    let wrong = || InteropError::format("this file", "the password is wrong, or the file is damaged");
    if !is_locked(locked) || locked.len() < HEADER + TAG {
        return Err(InteropError::format("this file", "it is not a locked OpenNote file"));
    }
    let iterations = u32::from_be_bytes([locked[8], locked[9], locked[10], locked[11]]);
    if !(MIN_ITERATIONS..=MAX_ITERATIONS).contains(&iterations) {
        return Err(wrong());
    }
    let (salt, nonce) = (&locked[12..28], &locked[28..44]);
    let (body, tag) = locked.split_at(locked.len() - TAG);
    let (enc_key, mac_key) = keys(password, salt, iterations);
    let expected = Hmac::new(&mac_key).mac(&[body]);
    // Compares every byte, so how long the check takes says nothing about where the tags differ.
    let differs = expected.iter().zip(tag).fold(0u8, |acc, (a, b)| acc | (a ^ b));
    if differs != 0 {
        return Err(wrong());
    }
    let mut plain = body[HEADER..].to_vec();
    apply_keystream(&enc_key, nonce, &mut plain);
    Ok(plain)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn hmac_matches_the_rfc_4231_vector() {
        let mac = hmac_sha256(&[0x0b; 20], b"Hi There");
        assert_eq!(
            hex(&mac),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn pbkdf2_matches_the_rfc_7914_vector() {
        let mut out = [0u8; 64];
        pbkdf2_sha256(b"passwd", b"salt", 1, &mut out);
        assert_eq!(
            hex(&out),
            "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc\
             49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783"
        );
    }

    #[test]
    fn a_locked_file_opens_only_with_its_password_and_whole() {
        let plain = b"A notebook, a few pages, and a picture".repeat(40);
        let locked = lock_with("correct horse", &plain, 2_000).expect("locks");
        assert!(is_locked(&locked));
        assert_ne!(&locked[HEADER..HEADER + 38], &plain[..38]);
        assert_eq!(unlock("correct horse", &locked).expect("unlocks"), plain);
        assert!(unlock("battery staple", &locked).is_err());
        let mut damaged = locked.clone();
        damaged[HEADER + 3] ^= 1;
        assert!(unlock("correct horse", &damaged).is_err());
        let mut hostile = locked.clone();
        hostile[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(unlock("correct horse", &hostile).is_err());
        assert!(unlock("correct horse", b"ONSHARE1").is_err());
    }
}
