//! Check notebook's repairs (A2-2): `check.repair` runs one repair the report offers, and `check.undo` puts back
//! what it replaced. A repair names its notebook by ID and its file by the path the report gave, relative to the
//! notebook folder; anything absolute or with `..` is refused here, and the core refuses any path outside the
//! notebook again. The bytes a repair replaced stay in memory for Undo until the app closes, for the last few
//! repairs only.

use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use opennote_core::store::repair::{Repair, RepairUndo};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{arg, storage::node_id};
use crate::{
    core_bridge::{run_notes, CoreBridge},
    ipc::{IpcError, IpcResult},
    notes::from_core,
};

/// How many repairs Undo remembers.
const KEPT: usize = 16;

/// A repair Undo can take back: its number, the notebook folder, and what the repair replaced.
type Done = (u64, PathBuf, RepairUndo);

/// The repairs Undo can take back, oldest first.
static DONE: Mutex<VecDeque<Done>> = Mutex::new(VecDeque::new());

/// A path from the report: relative, plain, and short.
pub(crate) fn relative(args: &Value) -> IpcResult<PathBuf> {
    let text: String = arg(args, "path")?;
    let path = PathBuf::from(&text);
    let plain = path.components().all(|c| matches!(c, Component::Normal(_)));
    if text.is_empty() || text.len() > 1024 || !plain || text.contains('\0') {
        return Err(IpcError::invalid("path", "isn't a file of the notebook"));
    }
    Ok(path)
}

/// The repair a `kind` names, for the file at `file` inside the notebook.
fn repair_for(kind: &str, file: &Path, backups: Option<PathBuf>) -> IpcResult<Repair> {
    let named = |name: &str| file.file_name().is_some_and(|n| n == name);
    let folder = || file.parent().map(Path::to_path_buf);
    let repair = match kind {
        "pageMd" if named("page.md") => folder().map(|page| Repair::PageMd { page }),
        "pageFromHistory" if named("page.json") => folder().map(|page| Repair::PageFromHistory { page }),
        "fromBackup" => {
            let backups = backups.ok_or_else(|| IpcError::invalid("kind", "No backup folder is set."))?;
            Some(Repair::FromBackup {
                file: file.to_path_buf(),
                backups,
            })
        }
        _ => None,
    };
    repair.ok_or_else(|| IpcError::invalid("kind", "isn't a repair for that file"))
}

fn remember(root: PathBuf, undo: RepairUndo) -> u64 {
    let mut done = DONE.lock().unwrap_or_else(PoisonError::into_inner);
    let token = done.back().map_or(1, |(n, _, _)| n.wrapping_add(1));
    done.push_back((token, root, undo));
    while done.len() > KEPT {
        done.pop_front();
    }
    token
}

fn take(token: u64) -> Option<(PathBuf, RepairUndo)> {
    let mut done = DONE.lock().unwrap_or_else(PoisonError::into_inner);
    let at = done.iter().position(|(n, _, _)| *n == token)?;
    done.remove(at).map(|(_, root, undo)| (root, undo))
}

pub fn call(app: &AppHandle, bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "check.repair" => {
            let id = node_id(args, "id")?;
            let kind: String = arg(args, "kind")?;
            let rel = relative(args)?;
            let config = super::backup::config(app);
            let backups = Some(config.destination.trim().to_owned())
                .filter(|d| !d.is_empty())
                .map(PathBuf::from);
            let (token, pages) = run_notes(app, bridge, |b| {
                let notebook = b.find(&id)?.notebook().clone();
                let (root, book) = (notebook.path().to_path_buf(), notebook.id());
                drop(notebook);
                let repair = repair_for(&kind, &root.join(&rel), backups.clone())?;
                let closes = !matches!(repair, Repair::PageMd { .. });
                let undo = b.core.repair(&root, &repair).map_err(from_core)?;
                let pages = if closes {
                    b.forget_notebook_pages(book)
                } else {
                    Vec::new()
                };
                Ok((remember(root, undo), pages))
            })?;
            reopen(app, &pages);
            Ok(json!({ "token": token }))
        }
        "check.undo" => {
            let token: u64 = arg(args, "token")?;
            let (root, undo) = take(token).ok_or_else(|| IpcError::invalid("token", "There is nothing to undo."))?;
            let pages = run_notes(app, bridge, |b| {
                let book = b.core.find_open(&root).map(|n| n.id());
                b.core.undo_repair(&root, &undo).map_err(from_core)?;
                let readable = undo.path.file_name().is_some_and(|n| n == "page.md");
                Ok(match book {
                    Some(book) if !readable => b.forget_notebook_pages(book),
                    _ => Vec::new(),
                })
            })?;
            reopen(app, &pages);
            Ok(json!({ "ok": true }))
        }
        _ => Err(IpcError::invalid("name", &format!("{name} isn't a check call"))),
    }
}

/// Pages that were open in a notebook a repair closed open again in the interface.
fn reopen(app: &AppHandle, pages: &[opennote_core::PageId]) {
    if !pages.is_empty() {
        let pages: Vec<String> = pages.iter().map(ToString::to_string).collect();
        super::emit(app, "reopenPages", json!({ "pages": pages }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_paths_must_be_plain_and_relative() {
        assert!(relative(&json!({ "path": "01abc/01def/page.json" })).is_ok());
        for bad in [
            "",
            "..\\x",
            "a/../../b",
            "C:\\Windows\\x",
            "/etc/x",
            "\\\\server\\share\\x",
        ] {
            assert!(relative(&json!({ "path": bad })).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_repair_must_fit_its_file() {
        let md = Path::new("/n/s/p/page.md");
        let page_json = Path::new("/n/s/p/page.json");
        assert!(matches!(repair_for("pageMd", md, None), Ok(Repair::PageMd { .. })));
        assert!(repair_for("pageMd", page_json, None).is_err());
        assert!(matches!(
            repair_for("pageFromHistory", page_json, None),
            Ok(Repair::PageFromHistory { .. })
        ));
        assert!(repair_for("fromBackup", page_json, None).is_err(), "no backup folder");
        assert!(repair_for("fromBackup", page_json, Some(PathBuf::from("/b"))).is_ok());
        assert!(repair_for("format", md, None).is_err());
    }

    #[test]
    fn undo_remembers_the_last_few_repairs() {
        let undo = RepairUndo {
            path: PathBuf::from("/n/x"),
            previous: None,
        };
        let first = remember(PathBuf::from("/n"), undo.clone());
        for _ in 0..KEPT {
            remember(PathBuf::from("/n"), undo.clone());
        }
        assert!(take(first).is_none(), "the oldest is forgotten");
        let last = remember(PathBuf::from("/n"), undo);
        assert!(take(last).is_some());
        assert!(take(last).is_none(), "an undo runs once");
    }
}
