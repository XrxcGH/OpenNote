//! The vault: the key that seals everything, and the slots that unlock it (ADR 0049, "Keys").
//!
//! `vault` holds the vault's ID, the Argon2id cost and salt, and the vault key wrapped twice: under the passphrase
//! and under the recovery key. Each device adds its own slot, `k/<tag>`, wrapped under a secret that only that
//! device keeps, so background sync never needs the passphrase. A pairing slot, `j/<tag>`, wraps the key under a
//! one-time code for a day, so a new device can join by QR code or by typing the code.
//!
//! After the slots, the header carries a generation and the list of device tags, under its MAC. Every change to
//! the passphrase or to the devices counts the generation up, and each device remembers the highest it saw. A
//! storage writer may put back an older `vault`, to bring an old passphrase back, or an old `k/<tag>`, to let a
//! removed device in again. The first shows as a rollback, and the second as a removed device.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::backend::Backend;
use crate::crypto::{
    base32, derive, from_base32, hex, mac, open, passphrase_key, random, random_key, same, seal, Cost, Key, COST,
    OVERHEAD,
};
use crate::error::{Result, SyncError};

const MAGIC: &[u8; 8] = b"ONSYNC01";
const PREFIX: usize = 8 + 4 + 16 + 12 + 16;
const SLOT: usize = 32 + OVERHEAD;
/// The header ends with a BLAKE2b MAC of everything before it under a key derived from the vault key, so a change to
/// any slot shows on every unlock, not only on the one that reads it.
const SEAL_MAC: usize = 32;
/// The prefix and the two slots, which a change to the devices leaves as they are.
const SLOTS: usize = PREFIX + 2 * SLOT;
/// Then the generation (8 bytes) and the number of devices (2).
const FIXED: usize = SLOTS + 8 + 2;
/// The most devices a vault lists.
pub const MAX_DEVICES: usize = 256;
/// The longest device tag.
const MAX_TAG: usize = 64;
/// The largest header there can be, so storage can refuse a longer `vault` before reading it.
pub const MAX_HEADER: usize = FIXED + MAX_DEVICES * (1 + MAX_TAG) + SEAL_MAC;
/// How often a header change is tried again when another device rewrote the header at the same moment.
const REWRITE_TRIES: usize = 4;
/// The shortest passphrase accepted.
pub const MIN_PASSPHRASE: usize = 10;
/// How long a pairing code works.
pub const PAIRING_MS: i64 = 24 * 60 * 60 * 1000;

/// The vault's keys, wiped when dropped.
pub struct VaultKeys {
    /// The vault's ID, which every sealed object is bound to.
    pub id: [u8; 16],
    root: Key,
    /// Seals heads, chunks, and device names.
    pub(crate) seal: Key,
    /// Names chunks.
    pub(crate) chunk: Key,
    /// Names whole files.
    pub(crate) content: Key,
    /// The header's generation when it was unlocked.
    generation: u64,
}

impl VaultKeys {
    fn from_root(id: [u8; 16], root: Key, generation: u64) -> VaultKeys {
        VaultKeys {
            id,
            generation,
            seal: derive(root.as_ref(), "seal", &id),
            chunk: derive(root.as_ref(), "chunk-name", &id),
            content: derive(root.as_ref(), "content-name", &id),
            root,
        }
    }

    /// A short, non-secret fingerprint of the vault, to show that two devices joined the same one.
    pub fn fingerprint(&self) -> String {
        base32(&mac(self.root.as_ref(), &[b"fingerprint", &self.id])[..5], 4)
    }

    /// The header's generation when these keys were unlocked.
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

/// The vault header as the keys see it now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VaultStatus {
    /// Counts up on every change to the passphrase or the devices.
    pub generation: u64,
    /// The tags of the devices that may sync.
    pub devices: BTreeSet<String>,
}

impl std::fmt::Debug for VaultKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VaultKeys")
            .field("id", &hex(&self.id))
            .finish_non_exhaustive()
    }
}

/// The recovery key, shown once.
pub struct RecoveryKey(Zeroizing<String>);

impl RecoveryKey {
    /// The 13 groups of 4 characters.
    pub fn text(&self) -> &str {
        &self.0
    }
}

macro_rules! redacted {
    ($($name:ident),*) => {$(
        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(concat!(stringify!($name), "(hidden)"))
            }
        }
    )*};
}

redacted!(RecoveryKey, DeviceSecret, PairingCode);

/// A device's own secret, which the shell keeps in the operating system's credential store.
pub struct DeviceSecret(pub Key);

/// A device as the list shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// The device's tag in storage.
    pub tag: String,
    /// The name the person gave it.
    pub name: String,
    /// When it joined, in Unix milliseconds.
    pub added: i64,
}

fn slot_name(prefix: &[u8]) -> String {
    hex(prefix)
}

fn kek_recovery(recovery: &[u8], id: &[u8; 16]) -> Key {
    derive(recovery, "recovery", id)
}

fn kek_device(secret: &[u8; 32], id: &[u8; 16], tag: &str) -> Key {
    derive(secret, "device", &[&id[..], tag.as_bytes()].concat())
}

fn kek_pairing(code: &[u8], id: &[u8; 16]) -> Key {
    derive(code, "pairing", id)
}

fn pairing_tag(code: &[u8], id: &[u8; 16]) -> String {
    hex(&mac(code, &[b"pairing-tag", id])[..8])
}

struct Header {
    id: [u8; 16],
    cost: Cost,
    salt: [u8; 16],
    prefix: Vec<u8>,
    pass_slot: Vec<u8>,
    recovery_slot: Vec<u8>,
    /// The prefix and both slots.
    slots: Vec<u8>,
    generation: u64,
    devices: BTreeSet<String>,
    body: Vec<u8>,
    tag: Vec<u8>,
}

/// Whether `tag` can name a device: 1 to 64 lower-case letters and digits, as storage names allow.
fn valid_tag(tag: &str) -> bool {
    (1..=MAX_TAG).contains(&tag.len()) && tag.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn header_mac(root: &Key, body: &[u8]) -> [u8; 32] {
    mac(derive(root.as_ref(), "vault-header", b"").as_ref(), &[body])
}

impl Header {
    /// Checks the whole header under the key a slot gave, so a change to any slot or to the cost shows on every
    /// unlock. `wrong` is the error when it doesn't match. For a passphrase, a wrong one and a damaged vault look
    /// the same. A device or pairing slot that opened proves the key, so there a mismatch is a changed header.
    fn verified(&self, root: Key, wrong: SyncError) -> Result<VaultKeys> {
        if !same(&header_mac(&root, &self.body), &self.tag) {
            return Err(wrong);
        }
        Ok(VaultKeys::from_root(self.id, root, self.generation))
    }

    /// Whether the header is this vault's and its MAC holds under the vault key.
    fn genuine(&self, keys: &VaultKeys) -> bool {
        self.id == keys.id && same(&header_mac(&keys.root, &self.body), &self.tag)
    }
}

/// The header's tail after the slots: the generation, the device list, and the MAC over everything.
fn finish_header(root: &Key, slots: &[u8], generation: u64, devices: &BTreeSet<String>) -> Vec<u8> {
    let mut body = Vec::with_capacity(FIXED + devices.len() * (1 + MAX_TAG));
    body.extend_from_slice(slots);
    body.extend_from_slice(&generation.to_be_bytes());
    body.extend_from_slice(&(devices.len() as u16).to_be_bytes());
    for tag in devices {
        body.push(tag.len() as u8);
        body.extend_from_slice(tag.as_bytes());
    }
    let tag = header_mac(root, &body);
    [body, tag.to_vec()].concat()
}

fn prefix(id: &[u8; 16], cost: Cost, salt: &[u8; 16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(PREFIX);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend_from_slice(id);
    for value in [cost.memory_kib, cost.passes, cost.lanes] {
        out.extend_from_slice(&value.to_be_bytes());
    }
    out.extend_from_slice(salt);
    out
}

/// `N` bytes of the header from `at`, or the calm "didn't unlock" when the header is too short to hold them.
fn fixed<const N: usize>(bytes: &[u8], at: usize) -> Result<[u8; N]> {
    bytes
        .get(at..at.saturating_add(N))
        .and_then(|part| part.try_into().ok())
        .ok_or(SyncError::WrongSecret)
}

fn read_header(bytes: &[u8]) -> Result<Header> {
    if !bytes.starts_with(MAGIC) {
        return Err(SyncError::WrongSecret);
    }
    if bytes.len() < 12 {
        return Err(SyncError::WrongSecret);
    }
    let word = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    if word(8) != 1 {
        return Err(SyncError::Newer);
    }
    if bytes.len() < FIXED + SEAL_MAC || bytes.len() > MAX_HEADER {
        return Err(SyncError::WrongSecret);
    }
    let id: [u8; 16] = fixed(bytes, 12)?;
    let cost = Cost {
        memory_kib: word(28),
        passes: word(32),
        lanes: word(36),
    };
    if !cost.allowed() {
        return Err(SyncError::WrongSecret);
    }
    let salt: [u8; 16] = fixed(bytes, 40)?;
    let generation = u64::from_be_bytes(fixed(bytes, SLOTS)?);
    let count = usize::from(u16::from_be_bytes([bytes[SLOTS + 8], bytes[SLOTS + 9]]));
    let end = bytes.len() - SEAL_MAC;
    let mut at = FIXED;
    let mut devices = BTreeSet::new();
    for _ in 0..count {
        let len = usize::from(*bytes.get(at).filter(|_| at < end).ok_or(SyncError::WrongSecret)?);
        let tag = bytes
            .get(at + 1..at + 1 + len)
            .filter(|_| at + 1 + len <= end)
            .and_then(|b| std::str::from_utf8(b).ok())
            .filter(|t| valid_tag(t))
            .ok_or(SyncError::WrongSecret)?;
        devices.insert(tag.to_owned());
        at += 1 + len;
    }
    if at != end || devices.len() != count {
        return Err(SyncError::WrongSecret);
    }
    Ok(Header {
        id,
        cost,
        salt,
        prefix: bytes[..PREFIX].to_vec(),
        pass_slot: bytes[PREFIX..PREFIX + SLOT].to_vec(),
        recovery_slot: bytes[PREFIX + SLOT..SLOTS].to_vec(),
        slots: bytes[..SLOTS].to_vec(),
        generation,
        devices,
        body: bytes[..end].to_vec(),
        tag: bytes[end..].to_vec(),
    })
}

fn unwrap_key(kek: &Key, id: &[u8; 16], kind: &str, name: &str, slot: &[u8]) -> Result<Key> {
    let plain = open(kek, id, kind, name, slot).ok_or(SyncError::WrongSecret)?;
    let key: [u8; 32] = plain.as_slice().try_into().map_err(|_| SyncError::WrongSecret)?;
    Ok(Zeroizing::new(key))
}

fn read_vault(backend: &dyn Backend) -> Result<Header> {
    read_header(&backend.get("vault")?.ok_or(SyncError::NoVault)?)
}

/// Whether the storage holds a vault.
pub fn has_vault(backend: &dyn Backend) -> Result<bool> {
    backend.exists("vault")
}

/// Makes a new vault. Refuses if one exists, so a second setup never replaces the first.
pub fn create(backend: &dyn Backend, passphrase: &str) -> Result<(VaultKeys, RecoveryKey)> {
    create_with(backend, passphrase, COST)
}

/// [`create`] with a chosen cost, for tests.
pub fn create_with(backend: &dyn Backend, passphrase: &str, cost: Cost) -> Result<(VaultKeys, RecoveryKey)> {
    if passphrase.chars().count() < MIN_PASSPHRASE {
        return Err(SyncError::WeakPassphrase(MIN_PASSPHRASE));
    }
    if has_vault(backend)? {
        return Err(SyncError::VaultExists);
    }
    let id = random::<16>()?;
    let root = random_key()?;
    let recovery = Zeroizing::new(random::<32>()?);
    let slots = slot_bytes(&id, &root, passphrase, cost, &recovery)?;
    backend.put("vault", &finish_header(&root, &slots, 1, &BTreeSet::new()))?;
    let text = Zeroizing::new(base32(recovery.as_ref(), 4));
    Ok((VaultKeys::from_root(id, root, 1), RecoveryKey(text)))
}

/// The prefix and both slots, under a new salt.
fn slot_bytes(id: &[u8; 16], root: &Key, passphrase: &str, cost: Cost, recovery: &[u8; 32]) -> Result<Vec<u8>> {
    let salt = random::<16>()?;
    let head = prefix(id, cost, &salt);
    let name = slot_name(&head);
    let pass = seal(
        &*passphrase_key(passphrase, &salt, cost)?,
        id,
        "passphrase-slot",
        &name,
        root.as_ref(),
    )?;
    let rec = seal(&kek_recovery(recovery, id), id, "recovery-slot", &name, root.as_ref())?;
    Ok([head, pass, rec].concat())
}

/// The header as `keys` see it: `Tampered` if it isn't this vault's or its MAC doesn't hold.
fn genuine_header(backend: &dyn Backend, keys: &VaultKeys) -> Result<Header> {
    let header = read_vault(backend).map_err(|error| match error {
        SyncError::WrongSecret => tampered_header(),
        other => other,
    })?;
    if !header.genuine(keys) {
        return Err(tampered_header());
    }
    Ok(header)
}

/// The vault's generation and devices now, checked under its key.
pub fn status(backend: &dyn Backend, keys: &VaultKeys) -> Result<VaultStatus> {
    let header = genuine_header(backend, keys)?;
    Ok(VaultStatus {
        generation: header.generation,
        devices: header.devices,
    })
}

/// Rewrites the header with the next generation. Storage has no compare-and-swap, so another device may rewrite it
/// at the same moment; the header is read back, and the change made again until `held` says it stayed.
fn rewrite(
    backend: &dyn Backend,
    keys: &VaultKeys,
    build: impl Fn(&Header) -> Result<Vec<u8>>,
    held: impl Fn(&Header, &Header) -> bool,
) -> Result<()> {
    for _ in 0..REWRITE_TRIES {
        let header = genuine_header(backend, keys)?;
        let bytes = build(&header)?;
        let written = read_header(&bytes)?;
        backend.put("vault", &bytes)?;
        if held(&written, &genuine_header(backend, keys)?) {
            return Ok(());
        }
    }
    Err(SyncError::Storage(
        "the vault kept changing while this device updated it".into(),
    ))
}

/// The header with the same slots, the next generation, and the devices `change` leaves.
fn next_devices(keys: &VaultKeys, header: &Header, change: impl Fn(&mut BTreeSet<String>)) -> Vec<u8> {
    let mut devices = header.devices.clone();
    change(&mut devices);
    finish_header(&keys.root, &header.slots, header.generation + 1, &devices)
}

/// Unlocks with the passphrase. A wrong passphrase and a damaged vault give the same error.
pub fn unlock_passphrase(backend: &dyn Backend, passphrase: &str) -> Result<VaultKeys> {
    unlock_passphrase_at(backend, passphrase, cfg!(any(test, feature = "testing")))
}

fn unlock_passphrase_at(backend: &dyn Backend, passphrase: &str, quick: bool) -> Result<VaultKeys> {
    let header = read_vault(backend)?;
    if !header.cost.checkable(quick) {
        return Err(SyncError::Tampered(
            "The vault asks for a different passphrase check than this app uses.".into(),
        ));
    }
    let kek = passphrase_key(passphrase, &header.salt, header.cost)?;
    let root = unwrap_key(
        &kek,
        &header.id,
        "passphrase-slot",
        &slot_name(&header.prefix),
        &header.pass_slot,
    )?;
    header.verified(root, SyncError::WrongSecret)
}

/// Unlocks with the recovery key, typed in any case, with or without hyphens.
pub fn unlock_recovery(backend: &dyn Backend, recovery: &str) -> Result<VaultKeys> {
    let header = read_vault(backend)?;
    let bytes = Zeroizing::new(from_base32(recovery, 32).ok_or(SyncError::WrongSecret)?);
    let kek = kek_recovery(&bytes, &header.id);
    let root = unwrap_key(
        &kek,
        &header.id,
        "recovery-slot",
        &slot_name(&header.prefix),
        &header.recovery_slot,
    )?;
    header.verified(root, SyncError::WrongSecret)
}

/// Sets a new passphrase. The recovery key stays the same. The generation counts up, so a device that sees the old
/// header again reports a rollback.
pub fn change_passphrase(backend: &dyn Backend, keys: &VaultKeys, recovery: &str, new: &str) -> Result<()> {
    if new.chars().count() < MIN_PASSPHRASE {
        return Err(SyncError::WeakPassphrase(MIN_PASSPHRASE));
    }
    let header = read_vault(backend)?;
    let rec = Zeroizing::new(from_base32(recovery, 32).ok_or(SyncError::WrongSecret)?);
    // The recovery key must open this vault, so a typo can't leave it without one.
    let check = unwrap_key(
        &kek_recovery(&rec, &header.id),
        &header.id,
        "recovery-slot",
        &slot_name(&header.prefix),
        &header.recovery_slot,
    )?;
    if !same(check.as_ref(), keys.root.as_ref()) {
        return Err(SyncError::WrongSecret);
    }
    let rec: &[u8; 32] = rec.as_slice().try_into().map_err(|_| SyncError::WrongSecret)?;
    rewrite(
        backend,
        keys,
        |now| {
            let slots = slot_bytes(&now.id, &keys.root, new, now.cost, rec)?;
            Ok(finish_header(&keys.root, &slots, now.generation + 1, &now.devices))
        },
        |written, now| written.slots == now.slots,
    )
}

#[derive(Serialize, Deserialize)]
struct SlotFile {
    key: String,
    info: String,
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

/// A new device identity: a random tag and secret.
pub fn new_device() -> Result<(String, DeviceSecret)> {
    Ok((hex(&random::<8>()?), DeviceSecret(random_key()?)))
}

/// Adds this device's slot, so it can unlock with its own secret from now on.
pub fn add_device(
    backend: &dyn Backend,
    keys: &VaultKeys,
    tag: &str,
    secret: &DeviceSecret,
    name: &str,
    now: i64,
) -> Result<()> {
    if !valid_tag(tag) {
        return Err(SyncError::Local(
            "a device tag must be lower-case letters and digits".into(),
        ));
    }
    let slot = format!("k/{tag}");
    let wrapped = seal(
        &kek_device(&secret.0, &keys.id, tag),
        &keys.id,
        "device-slot",
        &slot,
        keys.root.as_ref(),
    )?;
    let info = DeviceInfo {
        tag: tag.to_owned(),
        name: name.chars().take(80).collect(),
        added: now,
    };
    let info =
        serde_json::to_vec(&info).map_err(|_| SyncError::Local("the device name could not be written".into()))?;
    let info = seal(&keys.seal, &keys.id, "device-info", &slot, &info)?;
    let file = SlotFile {
        key: hex(&wrapped),
        info: hex(&info),
    };
    let header = genuine_header(backend, keys)?;
    if !header.devices.contains(tag) && header.devices.len() >= MAX_DEVICES {
        return Err(SyncError::Local(format!(
            "this sync already has {MAX_DEVICES} devices; remove one first"
        )));
    }
    // The slot first, so the list never names a slot that isn't there.
    let file =
        serde_json::to_vec(&file).map_err(|_| SyncError::Local("the device slot could not be written".into()))?;
    backend.put(&slot, &file)?;
    rewrite(
        backend,
        keys,
        |now| {
            Ok(next_devices(keys, now, |d| {
                d.insert(tag.to_owned());
            }))
        },
        |_, now| now.devices.contains(tag),
    )?;
    backend.delete(&format!("x/{tag}"))
}

fn read_slot(backend: &dyn Backend, tag: &str) -> Result<Option<(Vec<u8>, Vec<u8>)>> {
    let Some(bytes) = backend.get(&format!("k/{tag}"))? else {
        return Ok(None);
    };
    let file: SlotFile =
        serde_json::from_slice(&bytes).map_err(|_| SyncError::Tampered("A device entry doesn't read.".into()))?;
    match (unhex(&file.key), unhex(&file.info)) {
        (Some(key), Some(info)) => Ok(Some((key, info))),
        _ => Err(SyncError::Tampered("A device entry doesn't read.".into())),
    }
}

/// Unlocks with this device's own secret. `Removed` when another device took it out of sync.
pub fn unlock_device(backend: &dyn Backend, tag: &str, secret: &DeviceSecret) -> Result<VaultKeys> {
    let header = read_vault(backend)?;
    let Some((wrapped, _)) = read_slot(backend, tag)? else {
        return Err(SyncError::Removed);
    };
    let root = unwrap_key(
        &kek_device(&secret.0, &header.id, tag),
        &header.id,
        "device-slot",
        &format!("k/{tag}"),
        &wrapped,
    )?;
    let listed = header.devices.contains(tag);
    let keys = header.verified(root, tampered_header())?;
    // A slot the header doesn't list was put back after its device was removed.
    if !listed {
        return Err(SyncError::Removed);
    }
    Ok(keys)
}

fn tampered_header() -> SyncError {
    SyncError::Tampered("The vault's settings were changed by someone without its key.".into())
}

/// Every device with a slot, oldest first. Entries that don't open are skipped.
pub fn list_devices(backend: &dyn Backend, keys: &VaultKeys) -> Result<Vec<DeviceInfo>> {
    let listed = status(backend, keys)?.devices;
    let mut out = Vec::new();
    for name in backend.list("k/")? {
        let Some(tag) = name
            .strip_prefix("k/")
            .filter(|t| !t.contains('/') && listed.contains(*t))
        else {
            continue;
        };
        let Ok(Some((_, info))) = read_slot(backend, tag) else {
            continue;
        };
        let Some(plain) = open(&keys.seal, &keys.id, "device-info", &name, &info) else {
            continue;
        };
        if let Ok(info) = serde_json::from_slice::<DeviceInfo>(&plain) {
            if info.tag == tag {
                out.push(info);
            }
        }
    }
    out.sort_by(|a, b| (a.added, &a.tag).cmp(&(b.added, &b.tag)));
    Ok(out)
}

/// Removes a device: it leaves the header's list, its slot goes, and a sealed note says it was removed.
///
/// Against a storage writer who keeps old copies this is advisory until a re-key exists (ADR 0049): putting back
/// an old header lets the device in again, which every other device then reports as a rollback.
pub fn remove_device(backend: &dyn Backend, keys: &VaultKeys, tag: &str, now: i64) -> Result<()> {
    let name = format!("x/{tag}");
    let note = seal(&keys.seal, &keys.id, "revoked", &name, &now.to_le_bytes())?;
    backend.put(&name, &note)?;
    rewrite(
        backend,
        keys,
        |header| {
            Ok(next_devices(keys, header, |d| {
                d.remove(tag);
            }))
        },
        |_, now| !now.devices.contains(tag),
    )?;
    backend.delete(&format!("k/{tag}"))
}

/// Whether a device was removed.
pub fn is_removed(backend: &dyn Backend, keys: &VaultKeys, tag: &str) -> Result<bool> {
    let name = format!("x/{tag}");
    Ok(match backend.get(&name)? {
        Some(bytes) => open(&keys.seal, &keys.id, "revoked", &name, &bytes).is_some(),
        None => false,
    })
}

/// A one-time pairing code, to type or scan on the new device.
pub struct PairingCode(Zeroizing<String>, String);

impl PairingCode {
    /// Six groups of four characters.
    pub fn text(&self) -> &str {
        &self.0
    }

    /// The code as a QR code: rows of `1` (dark) and `0`, as the phone dialog draws them.
    pub fn qr_rows(&self) -> Vec<String> {
        let Ok(code) =
            qrcodegen::QrCode::encode_text(&format!("OPENNOTE-SYNC:{}", self.text()), qrcodegen::QrCodeEcc::Medium)
        else {
            return Vec::new();
        };
        (0..code.size())
            .map(|y| {
                (0..code.size())
                    .map(|x| if code.get_module(x, y) { '1' } else { '0' })
                    .collect()
            })
            .collect()
    }
}

/// The plain start of a pairing slot: when it was made, then a keyed hash of that under the vault key. Any device
/// can tell when a slot it can't open is past its day. A joining device can't be told the code is newer.
const MADE: usize = 8 + 32;

fn made_mac(keys: &VaultKeys, name: &str, made: i64) -> [u8; 32] {
    mac(&keys.root[..], &[b"pairing-made", name.as_bytes(), &made.to_le_bytes()])
}

/// When the slot `name` was made, if its start is genuine.
fn slot_made(keys: &VaultKeys, name: &str, bytes: &[u8]) -> Option<i64> {
    let made = i64::from_le_bytes(bytes.get(..8)?.try_into().ok()?);
    same(&made_mac(keys, name, made), bytes.get(8..MADE)?).then_some(made)
}

/// Makes a pairing code that works once, for a day.
pub fn create_pairing(backend: &dyn Backend, keys: &VaultKeys, now: i64) -> Result<PairingCode> {
    let code = Zeroizing::new(random::<15>()?);
    let name = format!("j/{}", pairing_tag(code.as_ref(), &keys.id));
    let sealed = seal(
        &kek_pairing(code.as_ref(), &keys.id),
        &keys.id,
        "pairing",
        &name,
        keys.root.as_ref(),
    )?;
    let mut slot = Vec::with_capacity(MADE + sealed.len());
    slot.extend_from_slice(&now.to_le_bytes());
    slot.extend_from_slice(&made_mac(keys, &name, now));
    slot.extend_from_slice(&sealed);
    backend.put(&name, &slot)?;
    Ok(PairingCode(Zeroizing::new(base32(code.as_ref(), 4)), name))
}

/// Unlocks with a pairing code, which may carry the `OPENNOTE-SYNC:` prefix of the QR code. The code is used up:
/// its slot is deleted, so call [`add_device`] next. A code works for [`PAIRING_MS`] after it was made, by this
/// device's clock and by the time on the newest head in storage, so a device whose clock is behind can't use an
/// old code that was never cleared.
pub fn join_with_code(backend: &dyn Backend, code: &str, now: i64) -> Result<VaultKeys> {
    let header = read_vault(backend)?;
    let code = code.trim();
    let code = code
        .strip_prefix("OPENNOTE-SYNC:")
        .or_else(|| code.strip_prefix("opennote-sync:"))
        .unwrap_or(code);
    let bytes = Zeroizing::new(from_base32(code, 15).ok_or(SyncError::WrongSecret)?);
    let name = format!("j/{}", pairing_tag(&bytes, &header.id));
    let slot = backend.get(&name)?.ok_or(SyncError::PairingExpired)?;
    let plain = slot
        .get(MADE..)
        .and_then(|sealed| open(&kek_pairing(&bytes, &header.id), &header.id, "pairing", &name, sealed))
        .ok_or(SyncError::WrongSecret)?;
    let root: [u8; 32] = plain.as_slice().try_into().map_err(|_| SyncError::WrongSecret)?;
    backend.delete(&name)?;
    let keys = header.verified(Zeroizing::new(root), tampered_header())?;
    let made = slot_made(&keys, &name, &slot).ok_or_else(tampered_header)?;
    let until = made.saturating_add(PAIRING_MS);
    // Best effort: storage that doesn't read here stops the first round instead.
    let newest = crate::engine::last_published(backend, &keys)
        .map(|at| at.into_values().max().unwrap_or(i64::MIN))
        .unwrap_or(i64::MIN);
    if now > until || newest > until {
        return Err(SyncError::PairingExpired);
    }
    Ok(keys)
}

/// Deletes the pairing slots more than a day old by `now`, as a round does, so a code that was shown and never
/// used or withdrawn doesn't stay in storage. A slot that isn't this vault's stays. Returns how many went.
pub fn clear_stale_pairings(backend: &dyn Backend, keys: &VaultKeys, now: i64) -> Result<usize> {
    let mut cleared = 0;
    for name in backend.list("j/")? {
        let stale = backend
            .get(&name)?
            .and_then(|slot| slot_made(keys, &name, &slot))
            .is_some_and(|made| now > made.saturating_add(PAIRING_MS));
        if stale {
            backend.delete(&name)?;
            cleared += 1;
        }
    }
    Ok(cleared)
}

/// Withdraws a pairing code that wasn't used.
pub fn cancel_pairing(backend: &dyn Backend, code: &PairingCode) -> Result<()> {
    backend.delete(&code.1)
}

#[cfg(test)]
mod tests;
