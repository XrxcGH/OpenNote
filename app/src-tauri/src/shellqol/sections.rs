//! Protected sections (A1-39, A2-16, A4-47; ADR 0042): protect, unlock, lock, and remove protection, with a
//! password or Windows Hello, and the watcher that locks every protected section when Windows locks or sleeps.
//!
//! The core seals the files (crates/core/src/store/sealed.rs). This module checks each argument, keeps passwords
//! in wiped buffers, never logs them, and runs on a blocking thread, as Argon2id and the Hello prompt take time.
//! Windows Hello signs a fixed random challenge with a key that never leaves the PC's TPM; the signature, not the
//! key, opens the section's Hello slot.

use std::path::PathBuf;
use std::time::Duration;

use opennote_core::id::SectionId;
use opennote_core::session::notebook::NodeRef;
use opennote_core::session::notes::Protection;
use opennote_core::store::sealed::{ProtectError, Secret};
use opennote_core::PageId;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use super::{arg, emit, opt, storage::node_id};
use crate::{
    core_bridge::{run_notes, Bridge, CoreBridge},
    ipc::{IpcError, IpcResult},
    notes::from_core,
    notes::tree::Found,
};

/// The longest password the calls take, in bytes.
const MAX_PASSWORD: usize = 1024;
/// The shortest password protecting a section takes.
const MIN_PASSWORD: usize = 8;

fn error_of(error: ProtectError) -> IpcError {
    match error {
        ProtectError::Wrong => IpcError::new("wrongPassword", "The password isn't right."),
        ProtectError::NoSlot => IpcError::new("noHello", "Windows Hello isn't set up for this section."),
        ProtectError::Already => IpcError::new("alreadyProtected", "The section is already protected."),
        ProtectError::NotProtected => IpcError::new("notProtected", "The section isn't protected."),
        ProtectError::Locked => IpcError::new("locked", "Unlock the section first."),
        ProtectError::Damaged => IpcError::new("damaged", "The protected section's files are damaged."),
        ProtectError::Fs(e) => IpcError::new("io", format!("{:?}", e.kind)),
        ProtectError::Core(e) => from_core(e),
    }
}

fn password(args: &Value, name: &str) -> IpcResult<Zeroizing<String>> {
    let text = Zeroizing::new(arg::<String>(args, name)?);
    if text.len() > MAX_PASSWORD || text.is_empty() {
        return Err(IpcError::invalid(name, "isn't a password this app takes"));
    }
    Ok(text)
}

/// The notebook folder and the section a node ID names.
fn section_of(b: &Bridge, id: &str) -> IpcResult<(PathBuf, SectionId)> {
    match b.find(id)? {
        Found::Node(notebook, NodeRef::Section(section)) => Ok((notebook.path().to_path_buf(), section)),
        _ => Err(IpcError::invalid("id", "isn't a section")),
    }
}

/// Runs a call that closes and opens the section's notebook, then tells the interface which pages to open again.
fn reopening(
    app: &AppHandle,
    bridge: &CoreBridge,
    id: &str,
    op: impl FnOnce(&Bridge, &std::path::Path, SectionId) -> Result<(), ProtectError>,
) -> IpcResult<Value> {
    let pages = run_notes(app, bridge, |b| {
        let (root, section) = section_of(b, id)?;
        let book = b.core.find_open(&root).map(|n| n.id());
        op(b, &root, section).map_err(error_of)?;
        Ok(book.map(|book| b.forget_notebook_pages(book)).unwrap_or_default())
    })?;
    reopen(app, &pages);
    Ok(json!({ "ok": true }))
}

fn reopen(app: &AppHandle, pages: &[PageId]) {
    if !pages.is_empty() {
        let pages: Vec<String> = pages.iter().map(ToString::to_string).collect();
        emit(app, "reopenPages", json!({ "pages": pages }));
    }
}

/// Runs one `protect.*` call. It blocks: run it off the async runtime's threads.
pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    let bridge = app.state::<CoreBridge>();
    let bridge = bridge.inner();
    match name {
        "protect.status" => status(app, bridge, args),
        "protect.protect" => {
            let id = node_id(args, "id")?;
            let secret = new_password(args)?;
            reopening(app, bridge, &id, |b, root, section| {
                b.core.protect_section(root, section, &secret)
            })
        }
        "protect.unlock" => unlock(app, bridge, args),
        "protect.lock" => {
            let id = node_id(args, "id")?;
            reopening(app, bridge, &id, |b, root, section| {
                b.core.lock_section(root, section).map(|_| ())
            })
        }
        "protect.lockAll" => lock_all(app, bridge).map(|n| json!({ "ok": true, "notebooks": n })),
        "protect.unprotect" => {
            let id = node_id(args, "id")?;
            reopening(app, bridge, &id, |b, root, section| {
                b.core.unprotect_section(root, section)
            })
        }
        "protect.changePassword" => {
            let id = node_id(args, "id")?;
            let secret = new_password(args)?;
            on_section(app, bridge, &id, |b, root, section| {
                b.core.change_section_password(root, section, &secret)
            })
        }
        "protect.hello" => hello_slot(app, bridge, args),
        "protect.deletePages" => delete_pages(app, bridge, args),
        _ => Err(IpcError::invalid("name", &format!("{name} isn't a protection call"))),
    }
}

/// A new password: at least 8 characters.
fn new_password(args: &Value) -> IpcResult<Zeroizing<String>> {
    let secret = password(args, "password")?;
    if secret.chars().count() < MIN_PASSWORD {
        return Err(IpcError::new("tooShort", "The password needs at least 8 characters."));
    }
    Ok(secret)
}

/// Runs a call on a section that leaves its notebook open.
fn on_section(
    app: &AppHandle,
    bridge: &CoreBridge,
    id: &str,
    op: impl FnOnce(&Bridge, &std::path::Path, SectionId) -> Result<(), ProtectError>,
) -> IpcResult<Value> {
    run_notes(app, bridge, |b| {
        let (root, section) = section_of(b, id)?;
        op(b, &root, section).map_err(error_of)
    })?;
    Ok(json!({ "ok": true }))
}

fn status(app: &AppHandle, bridge: &CoreBridge, args: &Value) -> IpcResult<Value> {
    let id = node_id(args, "id")?;
    let (protection, hello) = run_notes(app, bridge, |b| {
        let (root, section) = section_of(b, &id)?;
        let protection = b.core.section_protection(&root, section).map_err(from_core)?;
        let hello = b.core.section_hello_challenge(&root, section).map_err(from_core)?;
        Ok((protection, hello.is_some()))
    })?;
    Ok(json!({
        "protection": protection_name(protection),
        "hello": hello,
        "helloAvailable": hello::available(),
    }))
}

/// Unlocks with the password, or with Windows Hello's signature over the section's challenge.
fn unlock(app: &AppHandle, bridge: &CoreBridge, args: &Value) -> IpcResult<Value> {
    let id = node_id(args, "id")?;
    if !opt::<bool>(args, "hello")?.unwrap_or(false) {
        let secret = password(args, "password")?;
        return reopening(app, bridge, &id, |b, root, section| {
            b.core.unlock_section(root, section, Secret::Password(&secret))
        });
    }
    let challenge = run_notes(app, bridge, |b| {
        let (root, section) = section_of(b, &id)?;
        b.core.section_hello_challenge(&root, section).map_err(from_core)
    })?
    .ok_or_else(|| error_of(ProtectError::NoSlot))?;
    let signature = Zeroizing::new(hello::sign(&challenge, false)?);
    reopening(app, bridge, &id, |b, root, section| {
        b.core.unlock_section(root, section, Secret::Hello(&signature))
    })
}

/// Lets Windows Hello unlock the section, which asks the person to confirm, or stops it.
fn hello_slot(app: &AppHandle, bridge: &CoreBridge, args: &Value) -> IpcResult<Value> {
    let id = node_id(args, "id")?;
    if !arg::<bool>(args, "on")? {
        return on_section(app, bridge, &id, |b, root, section| {
            b.core.remove_section_hello(root, section)
        });
    }
    let challenge = opennote_core::session::core::Core::new_hello_challenge().map_err(error_of)?;
    let signature = Zeroizing::new(hello::sign(&challenge, true)?);
    on_section(app, bridge, &id, |b, root, section| {
        b.core.set_section_hello(root, section, challenge, &signature)
    })
}

/// Deletes pages of an unlocked protected section for good.
fn delete_pages(app: &AppHandle, bridge: &CoreBridge, args: &Value) -> IpcResult<Value> {
    let ids: Vec<String> = arg(args, "ids")?;
    if ids.is_empty() || ids.len() > 1000 {
        return Err(IpcError::invalid("ids", "lists no pages, or too many"));
    }
    let pages = ids
        .iter()
        .map(|id| PageId::parse(id).map_err(|_| IpcError::invalid("ids", "isn't a list of page IDs")))
        .collect::<IpcResult<Vec<PageId>>>()?;
    let gone = run_notes(app, bridge, |b| {
        let found = b.find(&pages[0].to_string())?;
        found.notebook().delete_sealed_pages(&pages).map_err(from_core)
    })?;
    bridge.forget_pages(&gone);
    Ok(json!({ "ok": true, "pages": gone.len() }))
}

/// Locks every protected section. Returns how many notebooks closed and opened again.
fn lock_all(app: &AppHandle, bridge: &CoreBridge) -> IpcResult<usize> {
    let pages = run_notes(app, bridge, |b| {
        let reopened = b.core.lock_all_sections().map_err(from_core)?;
        let mut pages = Vec::new();
        for root in &reopened {
            if let Some(book) = b.core.find_open(root).map(|n| n.id()) {
                pages.extend(b.forget_notebook_pages(book));
            }
        }
        Ok((reopened.len(), pages))
    })?;
    reopen(app, &pages.1);
    Ok(pages.0)
}

/// How often the watcher looks at the session and the clock.
const WATCH: Duration = Duration::from_secs(2);

/// Starts the thread that locks every protected section when Windows locks the session, or after the PC slept.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("protected-sections".into())
        .spawn(move || {
            let mut was_locked = session::locked();
            let mut clock = session::Clock::now();
            loop {
                std::thread::sleep(WATCH);
                let locked = session::locked();
                let slept = clock.slept_since();
                clock = session::Clock::now();
                let reason = if locked && !was_locked {
                    Some("windowsLocked")
                } else if slept {
                    Some("slept")
                } else {
                    None
                };
                was_locked = locked;
                if let Some(reason) = reason {
                    let bridge = app.state::<CoreBridge>();
                    if let Ok(n) = lock_all(&app, bridge.inner()) {
                        if n > 0 {
                            emit(&app, "sectionsLocked", json!({ "reason": reason }));
                        }
                    }
                }
            }
        });
    if let Err(error) = spawned {
        ::log::warn!("The protected sections watcher didn't start: {error}");
    }
}

/// Whether the protection of a section is shown as locked, for a status answer.
pub fn protection_name(protection: Protection) -> &'static str {
    match protection {
        Protection::None => "none",
        Protection::Locked => "locked",
        Protection::Unlocked => "unlocked",
    }
}

#[cfg(windows)]
mod session {
    use windows::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE,
        WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
    };
    use windows::Win32::System::WindowsProgramming::{QueryInterruptTime, QueryUnbiasedInterruptTime};

    /// Whether Windows shows the lock screen for this session.
    pub fn locked() -> bool {
        let mut buffer = windows::core::PWSTR::null();
        let mut bytes = 0u32;
        // SAFETY: the call fills `buffer` with a WTSINFOEXW that WTSFreeMemory frees; both out pointers are valid.
        let ok = unsafe {
            WTSQuerySessionInformationW(
                Some(WTS_CURRENT_SERVER_HANDLE),
                WTS_CURRENT_SESSION,
                WTSSessionInfoEx,
                &mut buffer,
                &mut bytes,
            )
        }
        .is_ok();
        if !ok || buffer.is_null() || (bytes as usize) < std::mem::size_of::<WTSINFOEXW>() {
            return false;
        }
        // SAFETY: the buffer holds at least one WTSINFOEXW, as `bytes` says, and level 1 is the only level.
        let flags = unsafe {
            let info = &*(buffer.0 as *const WTSINFOEXW);
            info.Data.WTSInfoExLevel1.SessionFlags
        };
        // SAFETY: the buffer came from WTSQuerySessionInformationW.
        unsafe { WTSFreeMemory(buffer.0.cast()) };
        flags == WTS_SESSIONSTATE_LOCK as i32
    }

    /// Two clocks: one counts time asleep and one doesn't, so a gap between them is time the PC slept.
    pub struct Clock {
        with_sleep: u64,
        awake: u64,
    }

    impl Clock {
        pub fn now() -> Clock {
            let mut awake = 0u64;
            // SAFETY: QueryInterruptTime takes no arguments, and the other writes one u64 to a valid pointer.
            let with_sleep = unsafe {
                let _ = QueryUnbiasedInterruptTime(&mut awake);
                QueryInterruptTime()
            };
            Clock { with_sleep, awake }
        }

        /// Whether the PC slept for more than five seconds since `self`. The clocks count 100 ns units.
        pub fn slept_since(&self) -> bool {
            let later = Clock::now();
            let total = later.with_sleep.saturating_sub(self.with_sleep);
            let awake = later.awake.saturating_sub(self.awake);
            total.saturating_sub(awake) > 50_000_000
        }
    }
}

#[cfg(not(windows))]
mod session {
    pub fn locked() -> bool {
        false
    }

    pub struct Clock(std::time::SystemTime, std::time::Instant);

    impl Clock {
        pub fn now() -> Clock {
            Clock(std::time::SystemTime::now(), std::time::Instant::now())
        }

        /// Whether the wall clock jumped ahead of the monotonic one by more than five seconds.
        pub fn slept_since(&self) -> bool {
            let wall = self.0.elapsed().unwrap_or_default();
            wall.saturating_sub(self.1.elapsed()) > std::time::Duration::from_secs(5)
        }
    }
}

#[cfg(windows)]
mod hello {
    use windows::core::HSTRING;
    use windows::Security::Credentials::{KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus};
    use windows::Security::Cryptography::CryptographicBuffer;

    use crate::ipc::{IpcError, IpcResult};

    /// The one Windows Hello key of OpenNote's protected sections. Each section's slot signs its own challenge.
    const NAME: &str = "OpenNote protected sections";

    fn failed(why: &str) -> IpcError {
        IpcError::new("hello", why.to_owned())
    }

    /// Whether Windows Hello is set up on this PC.
    pub fn available() -> bool {
        KeyCredentialManager::IsSupportedAsync()
            .and_then(|op| op.join())
            .unwrap_or(false)
    }

    /// Asks Windows Hello to sign `challenge`. With `create`, makes OpenNote's Hello key first when there is none.
    pub fn sign(challenge: &[u8], create: bool) -> IpcResult<Vec<u8>> {
        let name = HSTRING::from(NAME);
        let opened = KeyCredentialManager::OpenAsync(&name)
            .and_then(|op| op.join())
            .map_err(|_| failed("Windows Hello isn't available."))?;
        let credential = if opened.Status().ok() == Some(KeyCredentialStatus::Success) {
            opened
                .Credential()
                .map_err(|_| failed("Windows Hello isn't available."))?
        } else if create {
            let made = KeyCredentialManager::RequestCreateAsync(&name, KeyCredentialCreationOption::FailIfExists)
                .and_then(|op| op.join())
                .map_err(|_| failed("Windows Hello isn't available."))?;
            if made.Status().ok() != Some(KeyCredentialStatus::Success) {
                return Err(IpcError::new("helloCanceled", "Windows Hello wasn't set up."));
            }
            made.Credential()
                .map_err(|_| failed("Windows Hello isn't available."))?
        } else {
            return Err(IpcError::new("noHello", "Windows Hello isn't set up for this section."));
        };
        let buffer = CryptographicBuffer::CreateFromByteArray(challenge).map_err(|_| failed("No challenge."))?;
        let signed = credential
            .RequestSignAsync(&buffer)
            .and_then(|op| op.join())
            .map_err(|_| failed("Windows Hello didn't answer."))?;
        if signed.Status().ok() != Some(KeyCredentialStatus::Success) {
            return Err(IpcError::new("helloCanceled", "Windows Hello didn't confirm it's you."));
        }
        let result = signed.Result().map_err(|_| failed("Windows Hello didn't answer."))?;
        let mut bytes = windows::core::Array::<u8>::new();
        CryptographicBuffer::CopyToByteArray(&result, &mut bytes)
            .map_err(|_| failed("Windows Hello didn't answer."))?;
        Ok(bytes.to_vec())
    }
}

#[cfg(not(windows))]
mod hello {
    use crate::ipc::{IpcError, IpcResult};

    pub fn available() -> bool {
        false
    }

    pub fn sign(_challenge: &[u8], _create: bool) -> IpcResult<Vec<u8>> {
        Err(IpcError::new("noHello", "Windows Hello is only on Windows."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwords_are_checked_and_never_echoed() {
        assert!(password(&json!({ "password": "" }), "password").is_err());
        assert!(password(&json!({ "password": "x".repeat(MAX_PASSWORD + 1) }), "password").is_err());
        assert!(password(&json!({ "password": 5 }), "password").is_err());
        assert_eq!(
            *password(&json!({ "password": "correct horse" }), "password").unwrap(),
            "correct horse"
        );
    }

    #[test]
    fn wrong_passwords_map_to_their_own_code() {
        assert_eq!(error_of(ProtectError::Wrong).code, "wrongPassword");
        assert_eq!(error_of(ProtectError::Locked).code, "locked");
        assert_eq!(protection_name(Protection::Unlocked), "unlocked");
    }
}
