//! Outgoing webhooks in the app (crates/api/src/webhooks.rs; docs/help/local-api.md). The core's saves arrive
//! through the bridge's relay as page IDs; a worker thread reads each page, turns the saves into "added", "changed"
//! and "tag added" events, and hands them to the dispatcher, which posts them over HTTPS with Windows' TLS stack.
//! Nothing is sent while Work offline is on, and a page in a locked section is never read.

use std::{
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use opennote_api::{
    backend::Backend,
    webhooks::{check_url, ChangeWatcher, Dispatcher, Poster, Saved, QUIET},
};
use ureq::Agent;

use super::backend::CoreBackend;

/// How long one delivery may take.
const TIMEOUT: Duration = Duration::from_secs(15);

/// The most a receiver's answer is read, since only its status matters.
const MAX_ANSWER: u64 = 64 * 1024;

/// Posts with `ureq`: HTTPS only, no proxy, no cookies, no redirects, so a delivery goes only to the address the
/// person typed.
pub struct HttpsPoster;

fn agent() -> Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    Agent::config_builder()
        .tls_config(tls)
        .https_only(true)
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT))
        .build()
        .into()
}

impl Poster for HttpsPoster {
    fn post(&self, url: &str, headers: &[(String, String)], body: &[u8]) -> Result<u16, String> {
        if crate::hardening::offline() {
            return Err("Work offline is on.".to_owned());
        }
        check_url(url).map_err(str::to_owned)?;
        let mut request = agent().post(url);
        for (name, value) in headers {
            request = request.header(name.as_str(), value.as_str());
        }
        // The message never repeats the address or the body.
        let mut response = request
            .send(body)
            .map_err(|_| "The address couldn't be reached.".to_owned())?;
        let status = response.status().as_u16();
        let _ = response.body_mut().with_config().limit(MAX_ANSWER).read_to_vec();
        Ok(status)
    }
}

/// The page IDs of saves, and when to stop.
pub enum Watch {
    Saved(String),
    Stop,
}

/// Reads saved pages and publishes their events, until it hears [`Watch::Stop`].
pub fn start_watcher(backend: CoreBackend, dispatcher: Arc<Dispatcher>) -> mpsc::Sender<Watch> {
    let (sender, receiver) = mpsc::channel::<Watch>();
    let spawned = thread::Builder::new()
        .name("opennote-webhook-watch".into())
        .spawn(move || {
            let mut watcher = ChangeWatcher::new(QUIET);
            loop {
                let wait = watcher.next_due().map_or(Duration::from_secs(3600), |at| {
                    at.saturating_duration_since(Instant::now())
                });
                match receiver.recv_timeout(wait) {
                    Ok(Watch::Saved(page)) => {
                        if let Some(saved) = describe(&backend, &page) {
                            for event in watcher.saved(saved, Instant::now()) {
                                dispatcher.publish(&event);
                            }
                        }
                    }
                    Ok(Watch::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                for event in watcher.due(Instant::now()) {
                    dispatcher.publish(&event);
                }
            }
        });
    if spawned.is_err() {
        ::log::warn!("Webhooks couldn't start their watcher.");
    }
    sender
}

/// A page made within this long before its save counts as new.
const NEW_FOR_MS: i64 = 2 * 60 * 1000;

/// What a webhook needs to know about a saved page. A locked page is described without being read.
fn describe(backend: &CoreBackend, page: &str) -> Option<Saved> {
    let place = backend.locate(page).ok()?;
    let section = place.section_id.clone()?;
    let info = opennote_api::backend::PageInfo {
        id: place.id.clone(),
        notebook_id: place.notebook_id.clone(),
        section_id: section,
        title: place.title.clone(),
        modified: None,
    };
    if place.locked {
        return Some(Saved {
            page: info,
            locked: true,
            new: false,
            tags: Vec::new(),
            text: None,
        });
    }
    let (markdown, json) = backend.page_with_json(page).ok()?;
    let created = json["created"]
        .as_str()
        .and_then(|text| opennote_core::Timestamp::parse(text).ok())
        .map(opennote_core::Timestamp::unix_ms);
    let now = crate::boot::now_epoch_ms() as i64;
    Some(Saved {
        page: info,
        locked: false,
        new: created.is_some_and(|created| now - created < NEW_FOR_MS),
        tags: super::markdown::tags(&json),
        text: Some(markdown),
    })
}
