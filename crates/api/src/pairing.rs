//! How an app gets its grant. There are two ways, and the person starts or approves both in the app.
//!
//! - **Ask.** A program such as the `opennote` tool or the MCP server sends `POST /v1/pair` with its name. OpenNote
//!   shows a dialog, and the request waits for the answer. Only one request waits at a time.
//!   At most five arrive in ten minutes, so no program can flood the person with dialogs.
//!
//! - **Code.** For the browser clipper and the mail add-ins, which can't wait on a dialog, the person chooses
//!   "Pair a browser extension" in App permissions and picks what it may do. OpenNote shows a code; the person types
//!   it in the extension, which sends it with `POST /v1/pair/code`. A code works once, for five minutes, and five
//!   wrong tries end it.

use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::grants::{lock, random_bytes, same, Access, Scope};

/// How long a pairing code lasts.
pub const CODE_LIFETIME: Duration = Duration::from_secs(5 * 60);

/// Wrong tries before a code stops working.
pub const CODE_TRIES: u32 = 5;

/// The most connection requests in [`ASK_WINDOW`].
pub const ASK_LIMIT: usize = 5;
pub const ASK_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Letters and digits that can't be mistaken for each other.
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// A code the person made, and what it gives.
#[derive(Debug, Clone)]
struct Code {
    code: String,
    access: Access,
    notebooks: Scope,
    expires: Instant,
    tries_left: u32,
}

/// What a redeemed code gives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeGrant {
    pub access: Access,
    pub notebooks: Scope,
}

/// Why a code was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeRefusal {
    /// There is no code, it expired, or it was used.
    NoCode,
    Wrong,
}

/// Pairing state: the one active code, and the recent connection requests.
#[derive(Default)]
pub struct Pairing {
    code: Mutex<Option<Code>>,
    asks: Mutex<VecDeque<Instant>>,
    asking: Mutex<bool>,
}

/// A new code: eight characters, shown as `XXXX-XXXX`.
fn new_code() -> String {
    let bytes = random_bytes(8);
    let chars: String = bytes
        .iter()
        .map(|byte| char::from(ALPHABET[usize::from(*byte) % ALPHABET.len()]))
        .collect();
    format!("{}-{}", &chars[..4], &chars[4..])
}

/// A code as the person typed it: case and spaces don't matter, and the dash is optional.
fn normalize(code: &str) -> String {
    let plain: String = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if plain.len() == 8 {
        format!("{}-{}", &plain[..4], &plain[4..])
    } else {
        plain
    }
}

impl Pairing {
    /// Makes a new code, replacing any earlier one.
    pub fn new_code(&self, access: Access, notebooks: Scope, now: Instant) -> (String, Instant) {
        let code = new_code();
        let expires = now + CODE_LIFETIME;
        *lock(&self.code) = Some(Code {
            code: code.clone(),
            access,
            notebooks,
            expires,
            tries_left: CODE_TRIES,
        });
        (code, expires)
    }

    /// Ends the code, when the person closes the dialog.
    pub fn cancel_code(&self) {
        *lock(&self.code) = None;
    }

    /// Uses the code. It works once.
    pub fn redeem(&self, typed: &str, now: Instant) -> Result<CodeGrant, CodeRefusal> {
        let mut slot = lock(&self.code);
        let Some(code) = slot.as_mut() else {
            return Err(CodeRefusal::NoCode);
        };
        if now >= code.expires || code.tries_left == 0 {
            *slot = None;
            return Err(CodeRefusal::NoCode);
        }
        if same(&normalize(typed), &code.code) {
            let grant = CodeGrant {
                access: code.access,
                notebooks: code.notebooks.clone(),
            };
            *slot = None;
            return Ok(grant);
        }
        code.tries_left -= 1;
        if code.tries_left == 0 {
            *slot = None;
        }
        Err(CodeRefusal::Wrong)
    }

    /// Takes the one place for a connection request, or says why not: another is waiting, or there were too many.
    pub fn start_ask(&self, now: Instant) -> Result<AskTicket<'_>, &'static str> {
        let mut asking = lock(&self.asking);
        if *asking {
            return Err("another app is waiting for an answer");
        }
        let mut asks = lock(&self.asks);
        while asks.front().is_some_and(|at| now.duration_since(*at) >= ASK_WINDOW) {
            asks.pop_front();
        }
        if asks.len() >= ASK_LIMIT {
            return Err("too many requests to connect");
        }
        asks.push_back(now);
        *asking = true;
        Ok(AskTicket { pairing: self })
    }
}

/// Holds the one place for a connection request until it is dropped.
pub struct AskTicket<'a> {
    pairing: &'a Pairing,
}

impl Drop for AskTicket<'_> {
    fn drop(&mut self) {
        *lock(&self.pairing.asking) = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_works_once_and_only_in_time() {
        let pairing = Pairing::default();
        let now = Instant::now();
        let (code, expires) = pairing.new_code(Access::AddPages, Scope::All, now);
        assert_eq!(code.len(), 9);
        assert_eq!(expires, now + CODE_LIFETIME);
        let typed = code.replace('-', " ").to_lowercase();
        assert_eq!(
            pairing.redeem(&typed, now),
            Ok(CodeGrant {
                access: Access::AddPages,
                notebooks: Scope::All
            })
        );
        assert_eq!(pairing.redeem(&code, now), Err(CodeRefusal::NoCode));

        let (late, _) = pairing.new_code(Access::Read, Scope::All, now);
        assert_eq!(pairing.redeem(&late, now + CODE_LIFETIME), Err(CodeRefusal::NoCode));
    }

    #[test]
    fn five_wrong_tries_end_a_code() {
        let pairing = Pairing::default();
        let now = Instant::now();
        let (code, _) = pairing.new_code(Access::Read, Scope::All, now);
        for _ in 0..CODE_TRIES {
            assert_eq!(pairing.redeem("AAAA-AAAA", now), Err(CodeRefusal::Wrong));
        }
        assert_eq!(pairing.redeem(&code, now), Err(CodeRefusal::NoCode));
    }

    #[test]
    fn one_request_waits_at_a_time_and_a_flood_is_refused() {
        let pairing = Pairing::default();
        let now = Instant::now();
        let first = pairing.start_ask(now).expect("the first");
        assert!(pairing.start_ask(now).is_err(), "a second waits for the first");
        drop(first);
        for _ in 1..ASK_LIMIT {
            drop(pairing.start_ask(now).expect("within the limit"));
        }
        assert!(pairing.start_ask(now).is_err(), "too many");
        assert!(pairing.start_ask(now + ASK_WINDOW).is_ok(), "the window moved on");
    }
}
