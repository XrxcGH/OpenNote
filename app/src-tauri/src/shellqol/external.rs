//! Edits from other programs. A watcher on each open notebook folder sees Git, Syncthing, a script, or a sync tool
//! change a page. After a short quiet time, a changed `page.json` of an open page is compared with the revision
//! OpenNote holds, and a different one (or a conflict copy that a sync tool made) goes to the interface as an
//! `external` event, which offers to reload the page. OpenNote never overwrites such a change silently: if the page
//! also has unsaved edits, the core's next save keeps both versions as a conflict. An edited `page.md` goes to the
//! interface as a `readable` change, which offers to bring its text into the page (`external.readable` plans it).

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
    Readable,
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

pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        // The edits that bring an edited `page.md` into its open page, or null when there is nothing to bring.
        "external.readable" => {
            let page: String = super::arg(args, "pageId")?;
            let id =
                opennote_core::PageId::parse(&page).map_err(|error| IpcError::invalid("pageId", &error.to_string()))?;
            let Some(handle) = page_handle(app, id) else {
                return Ok(Value::Null);
            };
            let plan = handle.plan_readable_import().map_err(crate::core_bridge::core_error)?;
            Ok(plan.map_or(
                Value::Null,
                |plan| json!({ "edits": plan.edits, "baseKnown": plan.base_known }),
            ))
        }
        // Brings the edited `page.md` text into the page as one undo step; true when something changed.
        "external.importReadable" => {
            let page: String = super::arg(args, "pageId")?;
            let id =
                opennote_core::PageId::parse(&page).map_err(|error| IpcError::invalid("pageId", &error.to_string()))?;
            let Some(handle) = page_handle(app, id) else {
                return Ok(json!(false));
            };
            import_readable(&handle, id).map(Value::Bool)
        }
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

/// Applies the edited `page.md` text to the page as one transaction; true when something changed.
fn import_readable(handle: &opennote_core::session::page::PageHandle, id: opennote_core::PageId) -> IpcResult<bool> {
    let Some(plan) = handle.plan_readable_import().map_err(crate::core_bridge::core_error)? else {
        return Ok(false);
    };
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() % 1_000_000_000_000);
    let client = opennote_core::ClientId::parse(&format!("readable-{nanos}"))
        .map_err(|error| IpcError::invalid("client", &error.to_string()))?;
    let request = opennote_core::ops::resolve::TxnRequest {
        page: id,
        client,
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: plan.edits,
    };
    handle
        .apply(request)
        .map_err(|error| crate::core_bridge::core_error(opennote_core::CoreError::Edit(error)))?;
    // The save rewrites `page.md` from the page, so the same text isn't offered a second time (and applied twice).
    handle.save_now().map_err(crate::core_bridge::core_error)?;
    Ok(true)
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
            PageFile::ReadableCopy if path.file_name().is_some_and(|name| name == "page.md") => Seen::Readable,
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
            // OpenNote's own copy reads as its own; only a copy someone edited has text to bring in.
            Seen::Readable => handle.plan_readable_import().ok().flatten().is_some(),
            Seen::PageJson => {
                // Saving first keeps OpenNote's own unsaved edits: the core keeps both versions if the file changed.
                let own = handle.save_now().ok().map(|info| info.revision.to_string());
                let disk = std::fs::read(&path).ok().and_then(|bytes| revision_in(&bytes));
                matches!((own, disk), (Some(own), Some(disk)) if own != disk)
            }
        };
        if foreign {
            let change = match seen {
                Seen::ConflictCopy => "conflictCopy",
                Seen::Readable => "readable",
                Seen::PageJson => "changed",
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

    #[test]
    fn an_edited_page_md_comes_into_the_page_once() {
        use opennote_core::ops::resolve::{Edit, NewBlock, TxnRequest};
        let dir = tempfile::tempdir().expect("a temp folder");
        let notes = dir.path().join("Notes");
        let bridge = CoreBridge::at(dir.path().join("local"));
        let (id, handle) = bridge
            .notes(Some(notes.clone()), |b| {
                let mut make = |kind: &str, parent: Option<String>| {
                    let input = json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null } });
                    let node = b.dispatch("notes_create", &json!({ "input": input }))?;
                    Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
                };
                let notebook = make("notebook", None)?;
                let section = make("section", Some(notebook))?;
                let page = make("page", Some(section))?;
                let handle = b.handle(&page, "main-1")?;
                Ok((page, handle))
            })
            .expect("a page");
        let block: NewBlock = serde_json::from_value(
            json!({ "id": "01k6f00000000000000000b001", "type": "text", "data": { "markdown": "Gamma" } }),
        )
        .expect("a block");
        let request = TxnRequest {
            page: handle.id(),
            client: handle.client().clone(),
            client_seq: 1,
            coalesce: None,
            ui: None,
            edits: vec![Edit::InsertBlock {
                block,
                after: None,
                before: None,
            }],
        };
        handle.apply(request).expect("applies");
        handle.save_now().expect("saves");
        let page_id = opennote_core::PageId::parse(&id).expect("a page ID");
        let path = (0..200)
            .find_map(|_| {
                let found = find_page_md(&notes, &id)
                    .filter(|p| std::fs::read_to_string(p).is_ok_and(|text| text.contains("Gamma")));
                if found.is_none() {
                    std::thread::sleep(Duration::from_millis(25));
                }
                found
            })
            .expect("a page.md is written");
        // OpenNote's own copy has nothing to bring in.
        assert!(!import_readable(&handle, page_id).unwrap());
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::write(
            &path,
            text.replace(
                "Gamma",
                "Gamma

Added outside",
            ),
        )
        .unwrap();
        assert!(import_readable(&handle, page_id).unwrap());
        let envelope = handle.envelope(None).expect("an envelope");
        let decoded = opennote_core::wire::envelope::decode(&envelope.bytes).expect("decodes");
        let page: Value = serde_json::from_slice(decoded.page_json).expect("page JSON");
        assert!(page.to_string().contains("Added outside"), "the text came in");
        assert!(
            !import_readable(&handle, page_id).unwrap(),
            "a second call has nothing to bring in"
        );
        bridge.shutdown();
    }

    fn find_page_md(dir: &Path, page: &str) -> Option<PathBuf> {
        for entry in std::fs::read_dir(dir).ok()?.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == page) {
                    let md = path.join("page.md");
                    return md.exists().then_some(md);
                }
                if let Some(found) = find_page_md(&path, page) {
                    return Some(found);
                }
            }
        }
        None
    }
}
