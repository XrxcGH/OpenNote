//! The cryptography of protected sections (ADR 0042). Only audited RustCrypto crates do it.
//!
//! Argon2id (`argon2`) turns a password into a key. It does the same for the signature Windows Hello makes over a
//! fixed challenge. That key wraps the section's random content key.
//!
//! XChaCha20-Poly1305 (`chacha20poly1305`) seals every file of the section under the content key. Each file gets a
//! fresh random 192 bit nonce from the operating system. Its associated data names the section and the file, so
//! files can't be swapped. Keys live in [`Zeroizing`] buffers, which are wiped when dropped.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde_json::{json, Value};
use zeroize::Zeroizing;

/// A 256 bit key, wiped when dropped.
pub type Key = Zeroizing<[u8; 32]>;

const NONCE: usize = 24;
const TAG: usize = 16;
/// The salt of each key slot.
pub const SALT: usize = 16;

/// What unlocks a section: its password, or the signature Windows Hello made over the slot's challenge.
#[derive(Clone, Copy, Debug)]
pub enum Secret<'a> {
    /// The section's password.
    Password(&'a str),
    /// Windows Hello's signature over the challenge of the Hello slot.
    Hello(&'a [u8]),
}

impl Secret<'_> {
    /// The slot kind this secret opens.
    pub fn kind(&self) -> &'static str {
        match self {
            Secret::Password(_) => "password",
            Secret::Hello(_) => "hello",
        }
    }

    fn bytes(&self) -> &[u8] {
        match self {
            Secret::Password(p) => p.as_bytes(),
            Secret::Hello(s) => s,
        }
    }
}

/// Argon2id's cost for one key slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cost {
    /// Memory in KiB.
    pub memory_kib: u32,
    /// Passes.
    pub passes: u32,
}

/// A password's cost: 64 MiB and three passes, RFC 9106's second recommended setting with one lane.
pub const PASSWORD_COST: Cost = Cost {
    memory_kib: 64 * 1024,
    passes: 3,
};
/// A Hello signature already has 2048 bits of entropy, so its key needs no stretching beyond the minimum.
pub const HELLO_COST: Cost = Cost {
    memory_kib: 8 * 1024,
    passes: 1,
};
/// Costs a header may ask for. More is hostile (gigabytes or minutes to unlock), less was not written here.
const MIN_MEMORY_KIB: u32 = 8 * 1024;
const MAX_MEMORY_KIB: u32 = 256 * 1024;
const MAX_PASSES: u32 = 10;

/// Why a section didn't unlock. A wrong secret and a damaged header give the same answer on purpose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SealError {
    /// The secret is wrong, or the key slot is damaged.
    Wrong,
    /// The section has no slot of that kind.
    NoSlot,
    /// The header or a sealed file isn't one this version reads.
    Damaged,
    /// The operating system gave no random bytes.
    Random,
}

/// Random bytes from the operating system.
pub fn random<const N: usize>() -> Result<[u8; N], SealError> {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).map_err(|_| SealError::Random)?;
    Ok(out)
}

/// A new random content key.
pub fn new_key() -> Result<Key, SealError> {
    let mut key = Zeroizing::new([0u8; 32]);
    getrandom::fill(key.as_mut()).map_err(|_| SealError::Random)?;
    Ok(key)
}

fn derive(secret: &[u8], salt: &[u8], cost: Cost) -> Result<Key, SealError> {
    if !(MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&cost.memory_kib) || !(1..=MAX_PASSES).contains(&cost.passes) {
        return Err(SealError::Damaged);
    }
    let params = argon2::Params::new(cost.memory_kib, cost.passes, 1, Some(32)).map_err(|_| SealError::Damaged)?;
    let mut key = Zeroizing::new([0u8; 32]);
    argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params)
        .hash_password_into(secret, salt, key.as_mut())
        .map_err(|_| SealError::Wrong)?;
    Ok(key)
}

/// Seals `plain` under `key`: a random nonce, then the ciphertext with its tag.
pub fn seal(key: &[u8; 32], aad: &[u8], plain: &[u8]) -> Result<Vec<u8>, SealError> {
    let nonce: [u8; NONCE] = random()?;
    let sealed = XChaCha20Poly1305::new(key.into())
        .encrypt(&XNonce::from(nonce), Payload { msg: plain, aad })
        .map_err(|_| SealError::Damaged)?;
    let mut out = Vec::with_capacity(NONCE.saturating_add(sealed.len()));
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens what [`seal`] made. Damage and the wrong key give the same error.
pub fn open(key: &[u8; 32], aad: &[u8], sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>, SealError> {
    if sealed.len() < NONCE.saturating_add(TAG) {
        return Err(SealError::Damaged);
    }
    let (nonce, body) = sealed.split_at(NONCE);
    let nonce: [u8; NONCE] = nonce.try_into().map_err(|_| SealError::Damaged)?;
    XChaCha20Poly1305::new(key.into())
        .decrypt(&XNonce::from(nonce), Payload { msg: body, aad })
        .map(Zeroizing::new)
        .map_err(|_| SealError::Damaged)
}

/// The associated data of a sealed file or key slot of a section.
pub fn aad(section: &str, name: &str) -> Vec<u8> {
    format!("opennote-section-v1|{section}|{name}").into_bytes()
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i.saturating_add(2))?, 16).ok())
        .collect()
}

/// A key slot: the content key wrapped under a key made from a password or a Hello signature.
pub fn make_slot(
    section: &str,
    content: &Key,
    secret: Secret<'_>,
    salt: Option<[u8; SALT]>,
) -> Result<Value, SealError> {
    let cost = match secret {
        Secret::Password(_) => PASSWORD_COST,
        Secret::Hello(_) => HELLO_COST,
    };
    let salt = match salt {
        Some(salt) => salt,
        None => random()?,
    };
    let kek = derive(secret.bytes(), &salt, cost)?;
    let wrapped = seal(&kek, &aad(section, secret.kind()), content.as_ref())?;
    Ok(json!({
        "kind": secret.kind(),
        "kdf": "argon2id",
        "m": cost.memory_kib,
        "t": cost.passes,
        "p": 1,
        "salt": hex(&salt),
        "key": hex(&wrapped),
    }))
}

/// The salt of the section's Hello slot, which is also the challenge Windows Hello signs.
pub fn hello_challenge(header: &Value) -> Option<Vec<u8>> {
    slots(header)
        .find(|slot| slot["kind"] == "hello")
        .and_then(|slot| unhex(slot["salt"].as_str()?))
}

fn slots(header: &Value) -> impl Iterator<Item = &Value> {
    header["keys"].as_array().into_iter().flatten()
}

/// Opens the content key with a secret, from the first slot of its kind that it fits.
pub fn open_slot(section: &str, header: &Value, secret: Secret<'_>) -> Result<Key, SealError> {
    if header["v"] != 1 || header["cipher"] != "xchacha20poly1305" {
        return Err(SealError::Damaged);
    }
    let mut found = false;
    for slot in slots(header).filter(|s| s["kind"] == secret.kind()) {
        found = true;
        let field = |name: &str| slot[name].as_u64().and_then(|n| u32::try_from(n).ok());
        let (Some(memory_kib), Some(passes)) = (field("m"), field("t")) else {
            continue;
        };
        let (Some(salt), Some(wrapped)) = (
            slot["salt"].as_str().and_then(unhex),
            slot["key"].as_str().and_then(unhex),
        ) else {
            continue;
        };
        if slot["kdf"] != "argon2id" || field("p") != Some(1) {
            continue;
        }
        let Ok(kek) = derive(secret.bytes(), &salt, Cost { memory_kib, passes }) else {
            continue;
        };
        if let Ok(plain) = open(&kek, &aad(section, secret.kind()), &wrapped) {
            let bytes: [u8; 32] = plain.as_slice().try_into().map_err(|_| SealError::Damaged)?;
            return Ok(Zeroizing::new(bytes));
        }
    }
    Err(if found { SealError::Wrong } else { SealError::NoSlot })
}

/// A new header with one password slot.
pub fn new_header(section: &str, content: &Key, password: &str) -> Result<Value, SealError> {
    Ok(json!({
        "v": 1,
        "cipher": "xchacha20poly1305",
        "keys": [make_slot(section, content, Secret::Password(password), None)?],
    }))
}

/// The header with the slots of `kind` replaced by `slot`.
pub fn with_slot(header: &Value, slot: Value) -> Value {
    let kind = slot.get("kind").cloned();
    let mut keys: Vec<Value> = slots(header).filter(|s| s.get("kind") != kind.as_ref()).cloned().collect();
    keys.push(slot);
    with_keys(header, keys)
}

/// The header without the slots of `kind`.
pub fn without_slot(header: &Value, kind: &str) -> Value {
    let keys = slots(header).filter(|s| s.get("kind").and_then(Value::as_str) != Some(kind)).cloned().collect();
    with_keys(header, keys)
}

fn with_keys(header: &Value, keys: Vec<Value>) -> Value {
    let mut out = header.clone();
    if let Some(map) = out.as_object_mut() {
        map.insert("keys".into(), Value::Array(keys));
    }
    out
}

/// Whether the header has a slot of `kind`.
pub fn has_slot(header: &Value, kind: &str) -> bool {
    slots(header).any(|s| s["kind"] == kind)
}
