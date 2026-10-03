//! Opening a notebook from any folder, in place, and checking a notebook for problems. A folder with a
//! `notebook.json` opens where it is, with no copy and no import; a folder without one offers to become a
//! notebook, and nothing is written until the person agrees (`library.convert`). The check reads the notebook
//! with the core's verify and reports each problem with its file, and a rescan repairs the tree's own problems.

use std::path::{Path, PathBuf};

use opennote_core::store::external::{classify_path, NotebookChange};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{arg, opt, out};
use crate::{
    core_bridge::{run_notes, CoreBridge},
    ipc::{IpcError, IpcResult},
    notes::{from_core, not_found, NOTEBOOK_FILE},
};

/// What a folder is, for the Open folder dialog.
#[derive(Debug, PartialEq, Eq)]
pub enum Kind {
    Missing,
    NotebookFolder,
    PlainFolder,
}

pub fn kind_of(path: &Path) -> Kind {
    if !path.is_dir() {
        Kind::Missing
    } else if path.join(NOTEBOOK_FILE).is_file() {
        Kind::NotebookFolder
    } else {
        Kind::PlainFolder
    }
}

/// A folder name to propose as a notebook's title.
pub fn title_for(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Notebook".to_owned())
}

pub fn call(app: &AppHandle, bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "library.inspect" => {
            let path = PathBuf::from(arg::<String>(args, "path")?);
            let kind = match kind_of(&path) {
                Kind::Missing => "missing",
                Kind::NotebookFolder => "notebook",
                Kind::PlainFolder => "plain",
            };
            Ok(json!({
                "kind": kind,
                "title": title_for(&path),
                "cloud": super::cloud::detect(&path),
                "network": path.to_string_lossy().starts_with(r"\\"),
            }))
        }
        "library.open" => {
            let path = PathBuf::from(arg::<String>(args, "path")?);
            if kind_of(&path) != Kind::NotebookFolder {
                return Err(IpcError::invalid("path", "That folder isn't a notebook."));
            }
            run_notes(app, bridge, |b| {
                let handle = b.core.open_notebook(&path).map_err(from_core)?;
                let id = handle.id().to_string();
                out(b.summary_of(&b.find(&id)?)?)
            })
        }
        "library.convert" => {
            let path = PathBuf::from(arg::<String>(args, "path")?);
            let title = opt::<String>(args, "title")?.unwrap_or_else(|| title_for(&path));
            if kind_of(&path) == Kind::Missing {
                return Err(IpcError::invalid("path", "That folder isn't there."));
            }
            run_notes(app, bridge, |b| {
                let handle = b.core.convert_folder(&path, &title).map_err(from_core)?;
                let id = handle.id().to_string();
                out(b.summary_of(&b.find(&id)?)?)
            })
        }
        "library.list" => run_notes(app, bridge, |b| {
            let items: Vec<Value> = b
                .core
                .library()
                .notebooks
                .iter()
                .map(|entry| {
                    json!({
                        "path": entry.path,
                        "title": entry.title,
                        "id": entry.notebook.to_string(),
                        "open": entry.open,
                        "available": entry.available,
                    })
                })
                .collect();
            Ok(Value::Array(items))
        }),
        "library.check" => {
            let id: String = arg(args, "id")?;
            run_notes(app, bridge, |b| check(b.find(&id)?.notebook().clone()))
        }
        "library.rescan" => {
            let id: String = arg(args, "id")?;
            run_notes(app, bridge, |b| {
                b.find(&id)?.notebook().scan().map_err(from_core)?;
                Ok(json!({ "ok": true }))
            })
        }
        _ => Err(IpcError::invalid("name", "isn't a library call")),
    }
}

/// Verifies a notebook and lists each problem with its file and, where the file is a page's, the page.
fn check(notebook: opennote_core::session::notebook::NotebookHandle) -> IpcResult<Value> {
    let root = notebook.path().to_path_buf();
    let report = notebook.verify().map_err(from_core)?;
    let problems: Vec<Value> = report
        .problems
        .iter()
        .map(|(path, warning)| {
            let page = match classify_path(&root, path) {
                Some(NotebookChange::Page { page, .. }) => Some(page.to_string()),
                _ => None,
            };
            json!({
                "path": path.strip_prefix(&root).unwrap_or(path).to_string_lossy(),
                "code": warning.code,
                "detail": warning.detail,
                "pageId": page,
            })
        })
        .collect();
    if root.as_os_str().is_empty() {
        return Err(not_found("The notebook"));
    }
    Ok(json!({ "files": report.files, "problems": problems }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_a_notebook_folder_from_a_plain_one() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert_eq!(kind_of(dir.path()), Kind::PlainFolder);
        std::fs::write(dir.path().join(NOTEBOOK_FILE), b"{}").expect("writes");
        assert_eq!(kind_of(dir.path()), Kind::NotebookFolder);
        assert_eq!(kind_of(&dir.path().join("nope")), Kind::Missing);
    }

    #[test]
    fn proposes_the_folder_name_as_the_title() {
        assert_eq!(title_for(Path::new(r"E:\Notes\Chemistry")), "Chemistry");
        assert_eq!(title_for(Path::new("")), "Notebook");
    }
}
