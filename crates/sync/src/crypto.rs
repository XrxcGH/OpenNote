//! The cryptography of sync, built only from audited RustCrypto crates, with the patterns of
//! `crates/interop/src/lock.rs`: Argon2id turns a passphrase into a key, XChaCha20-Poly1305 seals every object under
//! a random 192 bit nonce, and keys live in `zeroize` buffers. Keyed BLAKE2b derives subkeys and names chunks.
//!
//! Every sealed object carries associated data that names the vault, the object's kind, and its name in storage,
//! so a blob can't be moved to another name, another kind, or another vault without failing its tag.

use argon2::{Algorithm, Argon2, Params, Version};
use blake2::digest::consts::U32;
use blake2::digest::{KeyInit as MacInit, Mac};
use blake2::Blake2bMac;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use crate::error::{Result, SyncError};

/// The bytes of a 256 bit key, wiped when dropped.
pub type Key = Zeroizing<[u8; 32]>;

const NONCE: usize = 24;
const TAG: usize = 16;
/// The bytes a sealed object adds: the nonce and the tag.
pub const OVERHEAD: usize = NONCE + TAG;
const AAD_PREFIX: &[u8] = b"opennote-sync/1";

/// Argon2id's cost, stored in the vault header (the same bounds as lock.rs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cost {
    /// Memory in KiB.
    pub memory_kib: u32,
    /// Passes over the memory.
    pub passes: u32,
    /// Lanes.
    pub lanes: u32,
}

/// The cost of a new vault: 64 MiB, three passes, one lane, as lock.rs uses.
pub const COST: Cost = Cost {
    memory_kib: 64 * 1024,
    passes: 3,
    lanes: 1,
};

/// The cheapest allowed cost, for tests.
pub const QUICK: Cost = Cost {
    memory_kib: MIN_MEMORY_KIB,
    passes: 1,
    lanes: 1,
};

const MIN_MEMORY_KIB: u32 = 8 * 1024;
const MAX_MEMORY_KIB: u32 = 256 * 1024;
const MAX_PASSES: u32 = 10;
const MAX_LANES: u32 = 4;

impl Cost {
    /// Whether a header may ask for this cost. A higher one is hostile, a lower one was not written here.
    pub fn allowed(self) -> bool {
        (MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&self.memory_kib)
            && (1..=MAX_PASSES).contains(&self.passes)
            && (1..=MAX_LANES).contains(&self.lanes)
    }

    /// Whether a passphrase may be checked at this cost: exactly [`COST`], the only one this app writes. A cheaper
    /// one would make the passphrase quicker to guess. A dearer one is a tampered header: each unlock would burn
    /// seconds of CPU and up to 256 MiB before its MAC says so. [`Cost::allowed`] keeps a wider range for reading,
    /// for when a header version says a newer app wrote another cost. In tests, `quick` also allows cheaper costs
    /// such as [`QUICK`], but nothing dearer than [`COST`].
    pub fn checkable(self, quick: bool) -> bool {
        self == COST
            || (quick
                && self.allowed()
                && self.memory_kib <= COST.memory_kib
                && self.passes <= COST.passes
                && self.lanes <= COST.lanes)
    }
}

/// Whether two MACs, tags, or keys are equal, in time that doesn't depend on where they differ.
pub fn same(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    a.ct_eq(b).into()
}

/// Fills a buffer from the operating system's random source.
pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| SyncError::Local("the random source failed".into()))?;
    Ok(bytes)
}

/// A random key.
pub fn random_key() -> Result<Key> {
    Ok(Zeroizing::new(random::<32>()?))
}

/// Argon2id of a passphrase.
pub fn passphrase_key(passphrase: &str, salt: &[u8], cost: Cost) -> Result<Key> {
    if !cost.allowed() {
        return Err(SyncError::WrongSecret);
    }
    let params = Params::new(cost.memory_kib, cost.passes, cost.lanes, Some(32)).map_err(|_| SyncError::WrongSecret)?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| SyncError::WrongSecret)?;
    Ok(key)
}

/// Keyed BLAKE2b-256 of the parts, each prefixed with its length so parts can't run together.
pub fn mac(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut state = <Blake2bMac<U32> as MacInit>::new_from_slice(key).expect("keys of 1 to 64 bytes are valid");
    for part in parts {
        state.update(&(part.len() as u64).to_le_bytes());
        state.update(part);
    }
    state.finalize().into_bytes().into()
}

/// A subkey of `key` for one purpose.
pub fn derive(key: &[u8], label: &str, context: &[u8]) -> Key {
    Zeroizing::new(mac(key, &[b"opennote-sync derive", label.as_bytes(), context]))
}

/// The associated data of an object.
fn aad(vault: &[u8; 16], kind: &str, name: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(AAD_PREFIX.len() + 16 + kind.len() + name.len() + 2);
    out.extend_from_slice(AAD_PREFIX);
    out.extend_from_slice(vault);
    out.extend_from_slice(kind.as_bytes());
    out.push(0);
    out.extend_from_slice(name.as_bytes());
    out
}

/// Seals `plain` under `key`, bound to the vault, kind, and name. Layout: nonce, then ciphertext and tag.
pub fn seal(key: &[u8; 32], vault: &[u8; 16], kind: &str, name: &str, plain: &[u8]) -> Result<Vec<u8>> {
    let nonce = random::<NONCE>()?;
    let sealed = XChaCha20Poly1305::new(key.into())
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plain,
                aad: &aad(vault, kind, name),
            },
        )
        .map_err(|_| SyncError::Local("encryption failed".into()))?;
    let mut out = Vec::with_capacity(NONCE + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens a sealed object. Any change to it, or to the name it is read under, gives `None`.
pub fn open(key: &[u8; 32], vault: &[u8; 16], kind: &str, name: &str, sealed: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    if sealed.len() < OVERHEAD {
        return None;
    }
    let (nonce, body) = sealed.split_at(NONCE);
    let nonce: [u8; NONCE] = nonce.try_into().ok()?;
    XChaCha20Poly1305::new(key.into())
        .decrypt(
            &XNonce::from(nonce),
            Payload {
                msg: body,
                aad: &aad(vault, kind, name),
            },
        )
        .ok()
        .map(Zeroizing::new)
}

/// Pads `plain` to a size bucket, so storage sees only rough sizes: a power of two from 512 bytes up to 64 KiB,
/// then whole 64 KiB steps. The first 4 bytes hold the real length.
pub fn pad(plain: &[u8]) -> Vec<u8> {
    let size = padded_len(plain.len());
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(&(plain.len() as u32).to_le_bytes());
    out.extend_from_slice(plain);
    out.resize(size, 0);
    out
}

/// How long [`pad`] makes `len` bytes.
pub fn padded_len(len: usize) -> usize {
    let need = len + 4;
    if need <= 64 * 1024 {
        need.next_power_of_two().max(512)
    } else {
        need.div_ceil(64 * 1024) * 64 * 1024
    }
}

/// Removes the padding. `None` when the length doesn't fit.
pub fn unpad(padded: &[u8]) -> Option<&[u8]> {
    let len = u32::from_le_bytes(padded.get(..4)?.try_into().ok()?) as usize;
    padded.get(4..4 + len)
}

/// Crockford's base32 alphabet, which leaves out I, L, O, and U so codes are easy to read aloud and type.
const BASE32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Bytes as Crockford base32, in groups of `group` characters joined by hyphens.
pub fn base32(bytes: &[u8], group: usize) -> String {
    let mut chars = Vec::new();
    let (mut buffer, mut bits) = (0u32, 0u32);
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            chars.push(BASE32[((buffer >> bits) & 31) as usize]);
        }
    }
    if bits > 0 {
        chars.push(BASE32[((buffer << (5 - bits)) & 31) as usize]);
    }
    chars
        .chunks(group.max(1))
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect::<Vec<_>>()
        .join("-")
}

/// Reads base32 typed by a person: case, spaces, and hyphens don't matter, and O, I, and L read as 0, 1, and 1.
/// `None` for any other character or a length that isn't `len` bytes.
pub fn from_base32(text: &str, len: usize) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(len);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for ch in text.chars() {
        let ch = match ch.to_ascii_uppercase() {
            ' ' | '-' | '\t' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        };
        let value = BASE32.iter().position(|&c| c as char == ch)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    (out.len() == len && buffer == 0).then_some(out)
}

/// Lower-case hex.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VAULT: [u8; 16] = [7; 16];

    #[test]
    fn equal_bytes_compare_equal_and_others_do_not() {
        assert!(same(b"tag of sixteen b", b"tag of sixteen b"));
        assert!(!same(b"tag of sixteen b", b"tag of sixteen c"));
        assert!(!same(b"Tag of sixteen b", b"tag of sixteen b"));
        assert!(!same(b"short", b"shorter"));
        assert!(same(b"", b""));
    }

    #[test]
    fn sealed_objects_open_only_whole_and_under_their_own_name() {
        let key = [3u8; 32];
        let sealed = seal(&key, &VAULT, "chunk", "c/ab/cd", b"a page of notes").expect("seals");
        assert_eq!(sealed.len(), 15 + OVERHEAD);
        assert_eq!(
            &open(&key, &VAULT, "chunk", "c/ab/cd", &sealed).expect("opens")[..],
            b"a page of notes"
        );
        assert!(open(&key, &VAULT, "chunk", "c/ab/ce", &sealed).is_none(), "renamed");
        assert!(open(&key, &VAULT, "head", "c/ab/cd", &sealed).is_none(), "other kind");
        assert!(
            open(&key, &[8; 16], "chunk", "c/ab/cd", &sealed).is_none(),
            "other vault"
        );
        assert!(
            open(&[4; 32], &VAULT, "chunk", "c/ab/cd", &sealed).is_none(),
            "other key"
        );
        for at in 0..sealed.len() {
            let mut bad = sealed.clone();
            bad[at] ^= 0x10;
            assert!(open(&key, &VAULT, "chunk", "c/ab/cd", &bad).is_none(), "byte {at}");
        }
        assert!(open(&key, &VAULT, "chunk", "c/ab/cd", &sealed[..OVERHEAD - 1]).is_none());
    }

    #[test]
    fn padding_hides_exact_sizes_and_round_trips() {
        assert_eq!(pad(b"").len(), 512);
        assert_eq!(pad(&[1; 508]).len(), 512);
        assert_eq!(pad(&[1; 509]).len(), 1024);
        assert_eq!(pad(&[1; 70_000]).len(), 131_072);
        assert_eq!(pad(&[1; 1 << 20]).len(), (1 << 20) + 64 * 1024);
        for size in [0usize, 1, 508, 509, 4000, 70_000] {
            let plain: Vec<u8> = (0..size).map(|i| i as u8).collect();
            assert_eq!(unpad(&pad(&plain)).expect("unpads"), &plain[..]);
        }
        assert!(unpad(&[255, 255, 0, 0, 1]).is_none());
        assert!(unpad(&[1]).is_none());
    }

    #[test]
    fn base32_codes_survive_how_people_type_them() {
        // RFC 4648's test bytes "f" and "fo", in Crockford's alphabet:
        // 0x66 = 01100 110(00), and 0x666f = 01100 11001 10111 1(0000).
        assert_eq!(base32(b"f", 4), "CR");
        assert_eq!(base32(b"fo", 4), "CSQG");
        let bytes: Vec<u8> = (0..32).map(|i| (i * 37 + 11) as u8).collect();
        let code = base32(&bytes, 4);
        assert_eq!(code.split('-').count(), 13);
        assert_eq!(from_base32(&code, 32).expect("reads"), bytes);
        let typed = code
            .to_lowercase()
            .replace('-', " ")
            .replace('0', "o")
            .replace('1', "l");
        assert_eq!(from_base32(&typed, 32).expect("reads typed"), bytes);
        assert!(from_base32(&code, 31).is_none());
        assert!(from_base32("U", 1).is_none(), "U is not in the alphabet");
    }

    #[test]
    fn macs_and_subkeys_differ_by_key_label_and_part_boundaries() {
        assert_ne!(mac(&[1; 32], &[b"ab", b"c"]), mac(&[1; 32], &[b"a", b"bc"]));
        assert_ne!(mac(&[1; 32], &[b"x"]), mac(&[2; 32], &[b"x"]));
        assert_ne!(*derive(&[1; 32], "chunk", b""), *derive(&[1; 32], "head", b""));
        assert_eq!(hex(&[0, 15, 255]), "000fff");
    }

    #[test]
    fn hostile_costs_are_refused_before_any_work() {
        assert!(COST.allowed() && QUICK.allowed());
        for cost in [
            Cost {
                memory_kib: u32::MAX,
                ..COST
            },
            Cost {
                memory_kib: MIN_MEMORY_KIB - 1,
                ..COST
            },
            Cost { passes: 0, ..COST },
            Cost {
                passes: MAX_PASSES + 1,
                ..COST
            },
            Cost {
                lanes: MAX_LANES + 1,
                ..COST
            },
        ] {
            assert_eq!(passphrase_key("pw", &[0; 16], cost), Err(SyncError::WrongSecret));
        }
        let a = passphrase_key("correct horse", &[1; 16], QUICK).expect("derives");
        let b = passphrase_key("correct horse", &[2; 16], QUICK).expect("derives");
        assert_ne!(*a, *b, "the salt matters");
    }
}
