//! Key presses sent through the Chrome DevTools Protocol (CDP). They reach only the spike's page, never another
//! window, and skip the Windows keyboard stack.

use std::sync::mpsc::{channel, Receiver};

use serde_json::{json, Value};
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;
use wry::WebViewExtWindows;

use crate::common::webview::Controller;
use crate::common::{clock, Result};

/// The text typed in every condition, repeated. Spaces make words wrap as they would in real typing.
pub const TYPED_TEXT: &str = "the quick brown fox jumps over the lazy dog ";

/// The `n`th character of the typed text, wrapping around.
pub fn typed_char(n: usize) -> char {
    let chars: Vec<char> = TYPED_TEXT.chars().collect();
    chars[n % chars.len()]
}

/// The CDP `Input.dispatchKeyEvent` parameters for pressing and releasing `ch`, a lowercase letter or a space.
/// The press carries `text`, so the page gets keydown, keypress, beforeinput, and input, as with a real key.
pub fn key_events(ch: char) -> Option<(Value, Value)> {
    let (code, virtual_key) = match ch {
        'a'..='z' => (
            format!("Key{}", ch.to_ascii_uppercase()),
            ch.to_ascii_uppercase() as u32,
        ),
        ' ' => ("Space".to_string(), 0x20),
        _ => return None,
    };
    let text = ch.to_string();
    let press = json!({
        "type": "keyDown",
        "key": text,
        "code": code,
        "text": text,
        "unmodifiedText": text,
        "windowsVirtualKeyCode": virtual_key,
        "nativeVirtualKeyCode": virtual_key,
    });
    let release = json!({
        "type": "keyUp",
        "key": text,
        "code": code,
        "windowsVirtualKeyCode": virtual_key,
        "nativeVirtualKeyCode": virtual_key,
    });
    Some((press, release))
}

/// A key event on its way to the page: when it was sent, and a channel that gets the time the browser
/// acknowledged it (after the page handled the event).
pub struct Sent {
    pub at: i64,
    pub acknowledged: Receiver<i64>,
}

/// Sends a CDP key event without waiting for the answer, so the caller can watch the screen at once.
/// The send time is read on the UI thread just before the call, in performance counter ticks.
pub fn send_key(controller: &Controller, params: &Value) -> Result<Sent> {
    let params = params.to_string();
    let (done, acknowledged) = channel();
    let at = controller.on_ui(move |webview, _| {
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |_, _| {
            let _ = done.send(clock::now());
            Ok(())
        }));
        let at = clock::now();
        let method = HSTRING::from("Input.dispatchKeyEvent");
        let started = unsafe {
            webview
                .webview()
                .CallDevToolsProtocolMethod(&method, &HSTRING::from(&params), &handler)
        };
        started.map(|()| at).map_err(|error| error.to_string())
    })?;
    Ok(Sent {
        at: at.map_err(|error| format!("Input.dispatchKeyEvent failed: {error}"))?,
        acknowledged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_key_events_for_letters_and_spaces() {
        let (press, release) = key_events('q').unwrap();
        assert_eq!(press["type"], "keyDown");
        assert_eq!(press["text"], "q");
        assert_eq!(press["code"], "KeyQ");
        assert_eq!(press["windowsVirtualKeyCode"], 0x51);
        assert_eq!(release["type"], "keyUp");
        assert!(release.get("text").is_none());
        let (space, _) = key_events(' ').unwrap();
        assert_eq!(space["code"], "Space");
        assert_eq!(space["windowsVirtualKeyCode"], 0x20);
        assert!(key_events('Q').is_none());
        assert!(key_events('.').is_none());
    }

    #[test]
    fn every_typed_character_has_key_events() {
        assert!(TYPED_TEXT.chars().all(|ch| key_events(ch).is_some()));
        assert_eq!(typed_char(0), 't');
        assert_eq!(typed_char(TYPED_TEXT.len()), 't');
    }
}
