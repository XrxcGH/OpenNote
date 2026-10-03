//! Edits from other programs. A watcher on each open notebook folder sees Git, Syncthing, a script, or a sync tool
//! change a page. After a short quiet time, a changed `page.json` of an open page is compared with the revision
//! OpenNote holds, and a different one (or a conflict copy that a sync tool made) goes to the interface as an
//! `external` event, which offers to reload the page. OpenNote never overwrites such a change silently: if the page
//! also has unsaved edits, the core's next save keeps both versions as a conflict.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError},
    },
    time::{Duration, Instant},
};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use opennote_core::store::external::{classify_path, NotebookChange, PageFile};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{emit, ok};
use crate::{
    core_bridge::{page_handle, CoreBridge},
    ipc::{IpcError, IpcResult},
};

/// How long the folder must be quiet before a batch of changes is looked at.
const QUIET: Duration = Duration::from_millis(700);
/// How often the set of watched notebooks is brought up to date.
const SYNC: Duration = Duration::from_secs(10);

static STARTED: AtomicBool = AtomicBool::new(false);

/// What a changed path means for a page, once it has settled.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Seen {
    PageJson,
    ConflictCopy,
}

/// The revision ID in the text of a `page.json`, if it has one.
pub fn revision_in(text: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(text).ok()?;
    value.get("revision")?.get("id")?.as_str().map(str::to_owned)
}

fn relevant(kind: &EventKind) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Modify(_))
}

pub fn start(_app: &AppHandle) {
    // The watcher starts when the interface asks, after the notebooks are loaded.
}

pub fn call(app: &AppHandle, name: &str, _args: &Value) -> IpcResult<Value> {
    match name {
        "external.start" => {
            if !STARTED.swap(true, Ordering::SeqCst) {
                let app = app.clone();
                let spawned = std::thread::Builder::new()
                    .name("opennote-watch".into())
                    .spawn(move || run(&app));
                if let Err(error) = spawned {
                    STARTED.store(false, Ordering::SeqCst);
                    return Err(IpcError::new("internal", error.to_string()));
                }
            }
            ok()
        }
        _ => Err(IpcError::invalid("name", "isn't an external call")),
    }
}

/// The folders of the open notebooks, backups left out.
fn notebook_roots(app: &AppHandle) -> Vec<PathBuf> {
    let bridge = app.state::<CoreBridge>();
    bridge
        .with(|b| {
            Ok(b.notebooks()
                .iter()
                .filter(|nb| !nb.is_backup())
                .map(|nb| nb.path().to_path_buf())
                .collect::<Vec<_>>())
        })
        .unwrap_or_default()
}

fn run(app: &AppHandle) {
    let (sender, receiver) = mpsc::channel::<PathBuf>();
    let made = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            if relevant(&event.kind) {
                for path in event.paths {
                    let _ = sender.send(path);
                }
            }
        }
    });
    let mut watcher: RecommendedWatcher = match made {
        Ok(watcher) => watcher,
        Err(error) => {
            ::log::warn!("Couldn't watch the notes folder: {error}");
            STARTED.store(false, Ordering::SeqCst);
            return;
        }
    };
    let mut watching: HashSet<PathBuf> = HashSet::new();
    let mut pending: HashMap<(PathBuf, String, Seen), PathBuf> = HashMap::new();
    let mut last_event = Instant::now();
    let mut last_sync: Option<Instant> = None;
    loop {
        if last_sync.is_none_or(|at| at.elapsed() >= SYNC) {
            last_sync = Some(Instant::now());
            let roots: HashSet<PathBuf> = notebook_roots(app).into_iter().collect();
            for gone in watching.difference(&roots).cloned().collect::<Vec<_>>() {
                let _ = watcher.unwatch(&gone);
                watching.remove(&gone);
            }
            for root in roots {
                if !watching.contains(&root) && watcher.watch(&root, RecursiveMode::Recursive).is_ok() {
                    watching.insert(root);
                }
            }
        }
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(path) => {
                last_event = Instant::now();
                note(&watching, &path, &mut pending);
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() && last_event.elapsed() >= QUIET {
                    settle(app, std::mem::take(&mut pending));
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    STARTED.store(false, Ordering::SeqCst);
}

/// Records a changed path under its notebook, when it is a page file that matters.
fn note(roots: &HashSet<PathBuf>, path: &Path, pending: &mut HashMap<(PathBuf, String, Seen), PathBuf>) {
    let Some(root) = roots.iter().find(|root| path.starts_with(root)) else {
        return;
    };
    if let Some(NotebookChange::Page { page, file, .. }) = classify_path(root, path) {
        let seen = match file {
            PageFile::PageJson => Seen::PageJson,
            PageFile::ConflictCopy => Seen::ConflictCopy,
            PageFile::ReadableCopy | PageFile::Other => return,
        };
        pending.insert((root.clone(), page.to_string(), seen), path.to_path_buf());
    }
}

/// Looks at each settled change and tells the interface about the ones another program made.
fn settle(app: &AppHandle, pending: HashMap<(PathBuf, String, Seen), PathBuf>) {
    for ((_, page, seen), path) in pending {
        let Ok(id) = opennote_core::PageId::parse(&page) else {
            continue;
        };
        let Some(handle) = page_handle(app, id) else {
            continue;
        };
        let foreign = match seen {
            Seen::ConflictCopy => true,
            Seen::PageJson => {
                // Saving first keeps OpenNote's own unsaved edits: the core keeps both versions if the file changed.
                let own = handle.save_now().ok().map(|info| info.revision.to_string());
                let disk = std::fs::read(&path).ok().and_then(|bytes| revision_in(&bytes));
                matches!((own, disk), (Some(own), Some(disk)) if own != disk)
            }
        };
        if foreign {
            let change = if seen == Seen::ConflictCopy {
                "conflictCopy"
            } else {
                "changed"
            };
            emit(app, "external", json!({ "pageId": page, "change": change }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_revision_id_of_a_page_file() {
        let text = br#"{ "id": "p", "revision": { "id": "r123", "parents": [] } }"#;
        assert_eq!(revision_in(text).as_deref(), Some("r123"));
        assert_eq!(revision_in(b"{}"), None);
        assert_eq!(revision_in(b"not json"), None);
    }

    #[test]
    fn only_creations_and_modifications_matter() {
        use notify::event::{CreateKind, ModifyKind, RemoveKind};
        assert!(relevant(&EventKind::Create(CreateKind::File)));
        assert!(relevant(&EventKind::Modify(ModifyKind::Any)));
        assert!(!relevant(&EventKind::Remove(RemoveKind::File)));
    }
}
