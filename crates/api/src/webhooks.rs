//! Outgoing webhooks (docs/help/local-api.md): OpenNote tells a service such as Zapier or Power Automate when a page
//! is added, changes, or gets a new tag.
//!
//! - Each hook goes to one `https` address the person typed, for the notebooks they picked.
//!   A page in a locked section never sends anything.
//!
//! - Only the page's title, IDs, and an `opennote://` link leave the PC, unless the person ticks "Send the page's
//!   text too".
//!
//! - Each delivery is signed: `X-OpenNote-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>">` under the hook's
//!   secret, which lives in the credential store as `OpenNote/webhook/<id>`, never in `api.json`.
//!
//! - A delivery that fails with a network error, 408, 429, or 5xx is tried again after 5 seconds, 30 seconds,
//!   2 minutes, 10 minutes, and 30 minutes. Other answers end it. Each try lands in the access log.
//!
//! - A page that keeps changing sends one "changed" after it has been quiet for a minute, not one per save.

use std::{
    collections::{BTreeSet, HashMap, HashSet, VecDeque},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    access_log::{AccessLog, Entry, Outcome},
    backend::PageInfo,
    grants::{lock, Grants, Scope, SecretStore},
    hmac::hmac_hex,
};

/// What a hook hears about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HookEvent {
    PageCreated,
    PageChanged,
    TagAdded,
}

/// One hook. Its signing secret lives in the credential store, never here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Webhook {
    pub id: String,
    /// A name the person gave it, such as "Zapier".
    pub name: String,
    /// An `https` address.
    pub url: String,
    pub events: Vec<HookEvent>,
    pub notebooks: Scope,
    /// Send the page's text too. Off by default, so only titles and links leave the PC.
    #[serde(default)]
    pub include_text: bool,
    pub enabled: bool,
}

/// The most hooks a person can have.
pub const MAX_HOOKS: usize = 20;

/// The most text a delivery carries.
pub const MAX_TEXT: usize = 100 * 1024;

/// How long a page must be quiet before "changed" goes out.
pub const QUIET: Duration = Duration::from_secs(60);

/// The waits between tries.
pub const BACKOFF: [Duration; 5] = [
    Duration::from_secs(5),
    Duration::from_secs(30),
    Duration::from_secs(120),
    Duration::from_secs(600),
    Duration::from_secs(1800),
];

/// The most deliveries waiting at once. Past that the oldest is dropped, and the log says so.
pub const MAX_QUEUE: usize = 500;

/// The credential name of a hook's signing secret.
pub fn secret_target(hook: &str) -> String {
    format!("OpenNote/webhook/{hook}")
}

/// Why an address can't be used.
pub fn check_url(url: &str) -> Result<(), &'static str> {
    if url.len() > 2048 || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("The address is too long or has spaces in it.");
    }
    let Some(rest) = url
        .get(..8)
        .filter(|scheme| scheme.eq_ignore_ascii_case("https://"))
        .map(|_| &url[8..])
    else {
        return Err("Use an https address.");
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.contains('@') {
        return Err("The address can't hold a user name or password.");
    }
    let host = match authority.rsplit_once(':') {
        Some((host, port)) => {
            if port.parse::<u16>().is_err() {
                return Err("The address has a port that isn't a number.");
            }
            host
        }
        _ => authority,
    };
    let host_ok = !host.is_empty()
        && host.contains('.')
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        && !host.starts_with('.')
        && !host.ends_with('.');
    if !host_ok {
        return Err("The address needs a full host name, such as hooks.zapier.com.");
    }
    Ok(())
}

/// A name for the hook: one line, at most 60 characters.
pub fn clean_hook(mut hook: Webhook) -> Result<Webhook, &'static str> {
    hook.name = crate::grants::clean_name(&hook.name);
    hook.url = hook.url.trim().to_owned();
    check_url(&hook.url)?;
    let mut seen = HashSet::new();
    hook.events.retain(|event| seen.insert(*event));
    if hook.events.is_empty() {
        return Err("Pick at least one thing to send.");
    }
    Ok(hook)
}

/// Something that happened to a page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageEvent {
    pub kind: HookEvent,
    pub page: PageInfo,
    /// The page or its section is locked: nothing goes out.
    pub locked: bool,
    /// For [`HookEvent::TagAdded`].
    pub tag: Option<String>,
    /// The page's Markdown, sent only to hooks with `include_text`.
    pub text: Option<String>,
}

/// The JSON a hook receives.
pub fn payload(hook: &Webhook, event: &PageEvent, time_ms: u64) -> Vec<u8> {
    let mut page = json!({
        "id": event.page.id,
        "title": event.page.title,
        "notebookId": event.page.notebook_id,
        "sectionId": event.page.section_id,
        "link": format!("opennote://page/{}", event.page.id),
    });
    if hook.include_text {
        if let Some(text) = &event.text {
            let mut end = text.len().min(MAX_TEXT);
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            page["markdown"] = json!(&text[..end]);
        }
    }
    let mut body = json!({
        "event": event.kind,
        "hookId": hook.id,
        "time": time_ms,
        "page": page,
    });
    if let Some(tag) = &event.tag {
        body["tag"] = json!(tag);
    }
    serde_json::to_vec(&body).unwrap_or_default()
}

/// The signature header's value for a body sent at `timestamp` (Unix seconds).
pub fn signature(secret: &[u8], timestamp: u64, body: &[u8]) -> String {
    let mut message = format!("{timestamp}.").into_bytes();
    message.extend_from_slice(body);
    format!("sha256={}", hmac_hex(secret, &message))
}

/// Sends one POST. The app's sender speaks HTTPS and follows no redirects; tests use plain HTTP to 127.0.0.1.
pub trait Poster: Send + Sync {
    /// The status code, or why nothing came back.
    fn post(&self, url: &str, headers: &[(String, String)], body: &[u8]) -> Result<u16, String>;
}

/// What happened to one try.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Attempt {
    Delivered(u16),
    /// Try again later.
    Retry,
    /// The receiver refused it for good.
    GaveUp,
}

/// Whether a status (or none, for a network error) is worth another try.
pub fn classify(result: &Result<u16, String>) -> Attempt {
    match result {
        Ok(status @ 200..=299) => Attempt::Delivered(*status),
        Ok(408 | 425 | 429 | 500..=599) | Err(_) => Attempt::Retry,
        Ok(_) => Attempt::GaveUp,
    }
}

struct Delivery {
    hook: String,
    name: String,
    url: String,
    body: Vec<u8>,
    tries: usize,
    not_before: Instant,
    page_id: String,
    page_title: String,
}

#[derive(Default)]
struct Queue {
    waiting: VecDeque<Delivery>,
    stop: bool,
}

struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
    grants: Arc<Grants>,
    secrets: Arc<dyn SecretStore>,
    log: Arc<AccessLog>,
    poster: Arc<dyn Poster>,
    backoff: Vec<Duration>,
    notify: Box<dyn Fn() + Send + Sync>,
}

/// Sends deliveries on its own thread, with retries.
pub struct Dispatcher {
    shared: Arc<Shared>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Dispatcher {
    /// Starts the sender. `notify` runs after each log entry, so App permissions can refresh.
    pub fn start(
        grants: Arc<Grants>,
        secrets: Arc<dyn SecretStore>,
        log: Arc<AccessLog>,
        poster: Arc<dyn Poster>,
        backoff: Vec<Duration>,
        notify: impl Fn() + Send + Sync + 'static,
    ) -> Dispatcher {
        let shared = Arc::new(Shared {
            queue: Mutex::default(),
            wake: Condvar::new(),
            grants,
            secrets,
            log,
            poster,
            backoff,
            notify: Box::new(notify),
        });
        let worker = shared.clone();
        let thread = thread::Builder::new()
            .name("opennote-webhooks".into())
            .spawn(move || run(&worker))
            .ok();
        Dispatcher { shared, thread }
    }

    /// Queues a delivery to every enabled hook that listens for the event and covers the page's notebook.
    pub fn publish(&self, event: &PageEvent) -> usize {
        if event.locked {
            return 0;
        }
        let hooks: Vec<Webhook> = self
            .shared
            .grants
            .config()
            .webhooks
            .into_iter()
            .filter(|hook| {
                hook.enabled && hook.events.contains(&event.kind) && hook.notebooks.covers(&event.page.notebook_id)
            })
            .collect();
        let mut queue = lock(&self.shared.queue);
        for hook in &hooks {
            if queue.waiting.len() >= MAX_QUEUE {
                if let Some(dropped) = queue.waiting.pop_front() {
                    self.shared.log.add(
                        Entry::new(
                            &format!("webhook:{}", dropped.hook),
                            &dropped.name,
                            "webhook.deliver",
                            Outcome::Failed,
                        )
                        .target(&dropped.page_id, Some(&dropped.page_title))
                        .detail("dropped: too many waiting"),
                    );
                }
            }
            queue.waiting.push_back(Delivery {
                hook: hook.id.clone(),
                name: hook.name.clone(),
                url: hook.url.clone(),
                body: payload(hook, event, crate::now_millis()),
                tries: 0,
                not_before: Instant::now(),
                page_id: event.page.id.clone(),
                page_title: event.page.title.clone(),
            });
        }
        drop(queue);
        self.shared.wake.notify_all();
        hooks.len()
    }

    /// Sends a test delivery to one hook now, once, and says what came back.
    pub fn test(&self, hook: &str) -> Result<u16, String> {
        let hook = self
            .shared
            .grants
            .config()
            .webhooks
            .into_iter()
            .find(|one| one.id == hook)
            .ok_or_else(|| "There's no such webhook.".to_owned())?;
        let event = PageEvent {
            kind: HookEvent::PageCreated,
            page: PageInfo {
                id: "test".into(),
                notebook_id: "test".into(),
                section_id: "test".into(),
                title: "A test from OpenNote".into(),
                modified: None,
            },
            locked: false,
            tag: None,
            text: Some("This is a test.".into()),
        };
        let body = payload(&hook, &event, crate::now_millis());
        let result = send(&self.shared, &hook.id, &hook.url, &body);
        let entry = Entry::new(
            &format!("webhook:{}", hook.id),
            &hook.name,
            "webhook.test",
            match classify(&result) {
                Attempt::Delivered(_) => Outcome::Allowed,
                _ => Outcome::Failed,
            },
        )
        .detail(&detail(&result));
        self.shared.log.add(entry);
        (self.shared.notify)();
        result
    }

    /// How many deliveries wait.
    pub fn waiting(&self) -> usize {
        lock(&self.shared.queue).waiting.len()
    }

    /// Stops the sender. Waiting deliveries are dropped.
    pub fn stop(mut self) {
        self.halt();
    }

    fn halt(&mut self) {
        lock(&self.shared.queue).stop = true;
        self.shared.wake.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Dispatcher {
    fn drop(&mut self) {
        self.halt();
    }
}

fn detail(result: &Result<u16, String>) -> String {
    match result {
        Ok(status) => format!("HTTP {status}"),
        Err(_) => "no answer".to_owned(),
    }
}

fn send(shared: &Shared, hook: &str, url: &str, body: &[u8]) -> Result<u16, String> {
    let secret = shared
        .secrets
        .get(&secret_target(hook))
        .ok()
        .flatten()
        .unwrap_or_default();
    let timestamp = crate::now_secs();
    let mut headers = vec![
        ("Content-Type".to_owned(), "application/json".to_owned()),
        ("User-Agent".to_owned(), "OpenNote-Webhook/1".to_owned()),
        ("X-OpenNote-Hook".to_owned(), hook.to_owned()),
        ("X-OpenNote-Timestamp".to_owned(), timestamp.to_string()),
    ];
    if !secret.is_empty() {
        headers.push((
            "X-OpenNote-Signature".to_owned(),
            signature(secret.as_bytes(), timestamp, body),
        ));
    }
    shared.poster.post(url, &headers, body)
}

fn run(shared: &Shared) {
    loop {
        let delivery = {
            let mut queue = lock(&shared.queue);
            loop {
                if queue.stop {
                    return;
                }
                let now = Instant::now();
                if let Some(at) = queue.waiting.iter().position(|one| one.not_before <= now) {
                    break queue.waiting.remove(at);
                }
                let wait = queue
                    .waiting
                    .iter()
                    .map(|one| one.not_before.saturating_duration_since(now))
                    .min()
                    .unwrap_or(Duration::from_secs(3600));
                queue = shared
                    .wake
                    .wait_timeout(queue, wait)
                    .map(|(guard, _)| guard)
                    .unwrap_or_else(|poisoned| poisoned.into_inner().0);
            }
        };
        let Some(mut delivery) = delivery else {
            continue;
        };
        // A hook removed or turned off while its delivery waited sends nothing.
        let live = shared
            .grants
            .config()
            .webhooks
            .into_iter()
            .find(|hook| hook.id == delivery.hook && hook.enabled);
        let Some(hook) = live else {
            continue;
        };
        delivery.url = hook.url;
        let result = send(shared, &delivery.hook, &delivery.url, &delivery.body);
        delivery.tries += 1;
        let attempt = classify(&result);
        let retry = attempt == Attempt::Retry && delivery.tries <= shared.backoff.len();
        let outcome = match attempt {
            Attempt::Delivered(_) => Outcome::Allowed,
            _ => Outcome::Failed,
        };
        let mut text = detail(&result);
        if retry {
            text.push_str(&format!(
                ", will try again ({} of {})",
                delivery.tries,
                shared.backoff.len() + 1
            ));
        }
        shared.log.add(
            Entry::new(
                &format!("webhook:{}", delivery.hook),
                &delivery.name,
                "webhook.deliver",
                outcome,
            )
            .target(&delivery.page_id, Some(&delivery.page_title))
            .detail(&text),
        );
        (shared.notify)();
        if retry {
            delivery.not_before = Instant::now() + shared.backoff[delivery.tries - 1];
            lock(&shared.queue).waiting.push_back(delivery);
        }
    }
}

/// Turns saves into hook events: "added" once for a new page, "tag added" for each new tag, and "changed" once a
/// page has been quiet for [`QUIET`].
#[derive(Default)]
pub struct ChangeWatcher {
    quiet: Duration,
    tags: HashMap<String, BTreeSet<String>>,
    created: HashSet<String>,
    pending: HashMap<String, (PageEvent, Instant)>,
}

/// What the app knows about a page when it saves.
#[derive(Debug, Clone)]
pub struct Saved {
    pub page: PageInfo,
    pub locked: bool,
    /// The page was made moments ago and hasn't been announced.
    pub new: bool,
    pub tags: Vec<String>,
    pub text: Option<String>,
}

impl ChangeWatcher {
    pub fn new(quiet: Duration) -> ChangeWatcher {
        ChangeWatcher {
            quiet,
            ..ChangeWatcher::default()
        }
    }

    /// The events to send at once for a save.
    pub fn saved(&mut self, saved: Saved, now: Instant) -> Vec<PageEvent> {
        let id = saved.page.id.clone();
        let event = |kind, tag: Option<String>| PageEvent {
            kind,
            page: saved.page.clone(),
            locked: saved.locked,
            tag,
            text: saved.text.clone(),
        };
        let mut out = Vec::new();
        let tags: BTreeSet<String> = saved.tags.iter().cloned().collect();
        let seen_before = self.tags.contains_key(&id);
        if saved.new && self.created.insert(id.clone()) {
            out.push(event(HookEvent::PageCreated, None));
        } else {
            if seen_before {
                let before = &self.tags[&id];
                for tag in tags.difference(before) {
                    out.push(event(HookEvent::TagAdded, Some(tag.clone())));
                }
            }
            self.pending
                .insert(id.clone(), (event(HookEvent::PageChanged, None), now + self.quiet));
        }
        self.tags.insert(id, tags);
        out
    }

    /// The "changed" events whose page has been quiet long enough.
    pub fn due(&mut self, now: Instant) -> Vec<PageEvent> {
        let ready: Vec<String> = self
            .pending
            .iter()
            .filter(|(_, (_, at))| *at <= now)
            .map(|(id, _)| id.clone())
            .collect();
        ready
            .into_iter()
            .filter_map(|id| self.pending.remove(&id).map(|(event, _)| event))
            .collect()
    }

    /// When the next "changed" is due.
    pub fn next_due(&self) -> Option<Instant> {
        self.pending.values().map(|(_, at)| *at).min()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(id: &str) -> PageInfo {
        PageInfo {
            id: id.into(),
            notebook_id: "nb1".into(),
            section_id: "s1".into(),
            title: format!("Page {id}"),
            modified: None,
        }
    }

    fn hook(include_text: bool) -> Webhook {
        Webhook {
            id: "h1".into(),
            name: "Zapier".into(),
            url: "https://hooks.example.org/a".into(),
            events: vec![HookEvent::PageCreated],
            notebooks: Scope::All,
            include_text,
            enabled: true,
        }
    }

    #[test]
    fn takes_only_https_addresses_with_a_real_host() {
        for good in [
            "https://hooks.zapier.com/hooks/catch/1/abc/",
            "https://prod-12.westus.logic.azure.com:443/workflows/x?api-version=1",
        ] {
            assert_eq!(check_url(good), Ok(()), "{good}");
        }
        for bad in [
            "http://hooks.zapier.com/x",
            "https://localhost/x",
            "https://user:pass@hooks.example.org/",
            "https://hooks.example.org:99999/",
            "https://exa mple.org/",
            "javascript:alert(1)",
            "https://",
            "https://.example.org/",
            "ftp://example.org/",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn sends_text_only_when_the_hook_asks_for_it() {
        let event = PageEvent {
            kind: HookEvent::PageCreated,
            page: page("p1"),
            locked: false,
            tag: None,
            text: Some("secret plans".into()),
        };
        let without = String::from_utf8(payload(&hook(false), &event, 1)).expect("utf-8");
        assert!(!without.contains("secret plans"));
        assert!(without.contains("opennote://page/p1"));
        let with = String::from_utf8(payload(&hook(true), &event, 1)).expect("utf-8");
        assert!(with.contains("secret plans"));
    }

    #[test]
    fn the_signature_covers_the_timestamp_and_the_body() {
        let one = signature(b"key", 100, b"{}");
        assert!(one.starts_with("sha256=") && one.len() == 7 + 64);
        assert_ne!(one, signature(b"key", 101, b"{}"));
        assert_ne!(one, signature(b"key", 100, b"{ }"));
        assert_ne!(one, signature(b"other", 100, b"{}"));
    }

    #[test]
    fn retries_only_what_might_work_later() {
        assert_eq!(classify(&Ok(204)), Attempt::Delivered(204));
        for retry in [Ok(500), Ok(503), Ok(429), Ok(408), Err("reset".to_owned())] {
            assert_eq!(classify(&retry), Attempt::Retry, "{retry:?}");
        }
        for give_up in [Ok(400), Ok(401), Ok(404), Ok(410), Ok(301)] {
            assert_eq!(classify(&give_up), Attempt::GaveUp, "{give_up:?}");
        }
    }

    #[test]
    fn a_busy_page_sends_one_change_after_it_goes_quiet() {
        let mut watcher = ChangeWatcher::new(Duration::from_secs(60));
        let start = Instant::now();
        let saved = |new: bool, tags: &[&str]| Saved {
            page: page("p1"),
            locked: false,
            new,
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
            text: None,
        };
        let created = watcher.saved(saved(true, &[]), start);
        assert_eq!(
            created.iter().map(|event| event.kind).collect::<Vec<_>>(),
            [HookEvent::PageCreated]
        );
        assert!(watcher
            .saved(saved(true, &[]), start + Duration::from_secs(5))
            .is_empty());
        assert!(watcher
            .saved(saved(false, &[]), start + Duration::from_secs(30))
            .is_empty());
        assert!(watcher.due(start + Duration::from_secs(60)).is_empty());
        let tagged = watcher.saved(saved(false, &["exam"]), start + Duration::from_secs(70));
        assert_eq!(tagged.len(), 1);
        assert_eq!(tagged[0].tag.as_deref(), Some("exam"));
        assert!(watcher.due(start + Duration::from_secs(129)).is_empty());
        let changed = watcher.due(start + Duration::from_secs(130));
        assert_eq!(
            changed.iter().map(|event| event.kind).collect::<Vec<_>>(),
            [HookEvent::PageChanged]
        );
        assert!(watcher.due(start + Duration::from_secs(500)).is_empty());
    }

    #[test]
    fn cleans_a_hook_before_saving_it() {
        let mut messy = hook(false);
        messy.name = " \u{7}Zapier ".into();
        messy.url = " https://hooks.example.org/a ".into();
        messy.events = vec![HookEvent::PageCreated, HookEvent::PageCreated];
        let clean = clean_hook(messy).expect("clean");
        assert_eq!(clean.name, "Zapier");
        assert_eq!(clean.events, [HookEvent::PageCreated]);
        let mut none = hook(false);
        none.events.clear();
        assert!(clean_hook(none).is_err());
    }
}
