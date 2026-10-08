//! Quick capture: a global shortcut that opens a small note window from anywhere in Windows. A thread owns the
//! hot key (Windows delivers it to the thread that registered it) and opens the window when it fires. The choice
//! lives in `qol.json` as `quickCapture: { enabled, key }`; it is on by default with Ctrl+Alt+Q, and a key another
//! program already holds simply doesn't register, which the interface learns from `quick.status`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{arg, opt, out, prefs, windows_ops};
use crate::{
    core_bridge::CoreBridge,
    ipc::{IpcError, IpcResult},
};

pub const DEFAULT_KEY: &str = "Ctrl+Alt+Q";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Choice {
    pub enabled: bool,
    pub key: String,
}

impl Default for Choice {
    fn default() -> Choice {
        Choice {
            enabled: true,
            key: DEFAULT_KEY.to_owned(),
        }
    }
}

/// Windows modifier bits.
pub const MOD_ALT: u32 = 0x1;
pub const MOD_CONTROL: u32 = 0x2;
pub const MOD_SHIFT: u32 = 0x4;
pub const MOD_WIN: u32 = 0x8;

/// A shortcut such as `Ctrl+Alt+Q` as Windows modifier bits and a virtual-key code. A global shortcut needs Ctrl,
/// Alt, or the Windows key, so a plain letter can't take over typing everywhere.
pub fn parse_key(text: &str) -> Option<(u32, u32)> {
    let mut modifiers = 0;
    let mut key = None;
    for part in text.split('+').map(str::trim) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= MOD_CONTROL,
            "alt" => modifiers |= MOD_ALT,
            "shift" => modifiers |= MOD_SHIFT,
            "win" | "meta" => modifiers |= MOD_WIN,
            other => {
                if key.is_some() {
                    return None;
                }
                key = virtual_key(other);
            }
        }
    }
    let strong = modifiers & (MOD_CONTROL | MOD_ALT | MOD_WIN) != 0;
    key.filter(|_| strong).map(|code| (modifiers, code))
}

fn virtual_key(name: &str) -> Option<u32> {
    let mut chars = name.chars();
    let first = chars.next()?;
    if chars.next().is_none() && first.is_ascii_alphanumeric() {
        return Some(u32::from(first.to_ascii_uppercase()));
    }
    let number: u32 = name.strip_prefix('f')?.parse().ok()?;
    (1..=24).contains(&number).then_some(0x6F + number)
}

fn choice(app: &AppHandle) -> Choice {
    prefs::read(app)
        .get("quickCapture")
        .and_then(|value| serde_json::from_value::<Choice>(value.clone()).ok())
        .unwrap_or_default()
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

    use tauri::AppHandle;
    use windows::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::{
            Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT},
            WindowsAndMessaging::{GetMessageW, PostThreadMessageW, MSG, WM_HOTKEY, WM_QUIT},
        },
    };

    static THREAD: AtomicU32 = AtomicU32::new(0);
    static REGISTERED: AtomicBool = AtomicBool::new(false);

    pub fn registered() -> bool {
        REGISTERED.load(Ordering::SeqCst)
    }

    /// Registers the hot key on a thread of its own. Returns once Windows has answered.
    pub fn register(app: &AppHandle, modifiers: u32, key: u32) -> bool {
        unregister();
        let app = app.clone();
        let (sender, receiver) = std::sync::mpsc::channel::<bool>();
        let spawned = std::thread::Builder::new()
            .name("opennote-hotkey".into())
            .spawn(move || {
                // SAFETY: the hot key belongs to this thread, which also pumps its messages and removes the key
                // before it ends.
                unsafe {
                    let ok = RegisterHotKey(None, 1, HOT_KEY_MODIFIERS(modifiers) | MOD_NOREPEAT, key).is_ok();
                    if ok {
                        THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
                        REGISTERED.store(true, Ordering::SeqCst);
                    }
                    let _ = sender.send(ok);
                    if !ok {
                        return;
                    }
                    let mut message = MSG::default();
                    while GetMessageW(&mut message, None, 0, 0).as_bool() {
                        if message.message == WM_HOTKEY {
                            if let Err(error) = super::windows_ops::open_capture(&app) {
                                ::log::warn!("Couldn't open quick capture: {error}");
                            }
                        }
                    }
                    let _ = UnregisterHotKey(None, 1);
                    REGISTERED.store(false, Ordering::SeqCst);
                }
            });
        spawned.is_ok() && receiver.recv().unwrap_or(false)
    }

    pub fn unregister() {
        let thread = THREAD.swap(0, Ordering::SeqCst);
        if thread != 0 {
            // SAFETY: posting WM_QUIT to a thread this module started.
            unsafe {
                let _ = PostThreadMessageW(thread, WM_QUIT, Default::default(), Default::default());
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::AppHandle;

    pub fn registered() -> bool {
        false
    }

    pub fn register(_app: &AppHandle, _modifiers: u32, _key: u32) -> bool {
        false
    }

    pub fn unregister() {}
}

/// Registers or removes the hot key to match the choice.
pub fn apply(app: &AppHandle) -> bool {
    let choice = choice(app);
    if !choice.enabled {
        imp::unregister();
        return false;
    }
    match parse_key(&choice.key) {
        Some((modifiers, key)) => imp::register(app, modifiers, key),
        None => {
            imp::unregister();
            false
        }
    }
}

pub fn start(app: &AppHandle) {
    apply(app);
}

pub fn call(app: &AppHandle, _bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "quick.status" => Ok(json!({ "choice": choice(app), "registered": imp::registered() })),
        "quick.set" => {
            let next = Choice {
                enabled: arg(args, "enabled")?,
                key: opt::<String>(args, "key")?.unwrap_or_else(|| DEFAULT_KEY.to_owned()),
            };
            if parse_key(&next.key).is_none() {
                return Err(IpcError::invalid(
                    "key",
                    "Use Ctrl, Alt, or the Windows key with a letter, digit, or F key.",
                ));
            }
            let mut patch = serde_json::Map::new();
            patch.insert("quickCapture".to_owned(), out(&next)?);
            prefs::write(app, &patch)?;
            let registered = apply(app);
            Ok(json!({ "choice": next, "registered": registered }))
        }
        "quick.open" => {
            windows_ops::open_capture(app)?;
            Ok(json!({ "ok": true }))
        }
        _ => Err(IpcError::invalid("name", "isn't a quick capture call")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modifiers_and_a_key() {
        assert_eq!(parse_key("Ctrl+Alt+Q"), Some((MOD_CONTROL | MOD_ALT, u32::from(b'Q'))));
        assert_eq!(
            parse_key("ctrl + shift + 7"),
            Some((MOD_CONTROL | MOD_SHIFT, u32::from(b'7')))
        );
        assert_eq!(parse_key("Win+F12"), Some((MOD_WIN, 0x7B)));
    }

    #[test]
    fn refuses_shortcuts_that_would_take_over_typing() {
        assert_eq!(parse_key("Q"), None);
        assert_eq!(parse_key("Shift+Q"), None);
        assert_eq!(parse_key("Ctrl+"), None);
        assert_eq!(parse_key("Ctrl+Q+W"), None);
        assert_eq!(parse_key("Ctrl+F25"), None);
        assert_eq!(parse_key(""), None);
    }

    #[test]
    fn the_default_key_parses() {
        assert!(parse_key(DEFAULT_KEY).is_some());
        assert!(Choice::default().enabled);
    }
}
