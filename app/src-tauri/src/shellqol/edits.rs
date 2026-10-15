//! Edits from other apps (A2-1, A4-15, A3-1): the `page.md` a person edited in another program, brought back into
//! the page after a preview, the page's files that are only in the cloud, and "Open in another editor".
//!
//! The interface names a page by its ID and an edited copy by the path this module listed. The core refuses any
//! path it didn't list, so these calls can't read or delete another file.

use std::{
    io::Read,
    path::{Path, PathBuf},
};

use opennote_core::{
    session::page::{EditedImport, PageHandle},
    store::external::{import::TextChange, EditedCopy},
    PageId,
};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{arg, emit, ok, storage::node_id};
use crate::{
    core_bridge::{core_error, page_handle},
    ipc::{IpcError, IpcResult},
};

/// The longest path of an edited copy the calls take.
const MAX_PATH: usize = 4096;
/// The most cloud-only files listed or downloaded for one page.
const MAX_CLOUD_FILES: usize = 500;

/// The open page an argument names.
pub(crate) fn open_page(app: &AppHandle, args: &Value) -> IpcResult<PageHandle> {
    let id = node_id(args, "pageId")?;
    let page = PageId::parse(&id).map_err(|_| IpcError::invalid("pageId", "isn't a page ID"))?;
    page_handle(app, page).ok_or_else(|| IpcError::new("notFound", "That page isn't open."))
}

/// The edited copy an argument names, as a path. It is checked against the page's list by the core.
fn copy_arg(args: &Value) -> IpcResult<PathBuf> {
    let copy: String = arg(args, "copy")?;
    if copy.is_empty() || copy.len() > MAX_PATH || copy.contains('\0') {
        return Err(IpcError::invalid("copy", "isn't an edited copy"));
    }
    Ok(PathBuf::from(copy))
}

fn copy_json(copy: &EditedCopy) -> Value {
    json!({
        "copy": copy.path.to_string_lossy(),
        "keptAt": copy.kept_at.map(|at| at.to_string()),
    })
}

/// Only `page.md` copies come back as text; an edited `ink.svg` stays aside for the person to look at.
fn page_md_copies(copies: Vec<EditedCopy>) -> Vec<Value> {
    copies
        .iter()
        .filter(|copy| copy.file == "page.md")
        .map(copy_json)
        .collect()
}

/// The plan as the preview shows it, with the edits the interface sends as one request.
pub(crate) fn plan_json(import: &EditedImport) -> IpcResult<Value> {
    let changes: Vec<Value> = import
        .plan
        .changes
        .iter()
        .map(|change| match change {
            TextChange::Replace { block, markdown } => {
                json!({ "kind": "replace", "block": block.to_string(), "markdown": markdown })
            }
            TextChange::Insert { markdown, .. } => json!({ "kind": "insert", "markdown": markdown }),
            TextChange::Remove { block } => json!({ "kind": "remove", "block": block.to_string() }),
        })
        .collect();
    let edits = serde_json::to_value(&import.edits).map_err(|error| IpcError::new("io", error.to_string()))?;
    Ok(json!({
        "copy": import.copy.to_string_lossy(),
        "baseKnown": import.base_known,
        "title": import.plan.title,
        "tags": import.plan.tags,
        "changes": changes,
        "conflicts": import.plan.conflicts.len(),
        "skipped": import.plan.skipped,
        "tooDifferent": import.plan.too_different,
        "edits": edits,
    }))
}

pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "edits.list" => {
            let handle = open_page(app, args)?;
            Ok(Value::Array(page_md_copies(
                handle.edited_copies().map_err(core_error)?,
            )))
        }
        "edits.plan" => {
            let handle = open_page(app, args)?;
            let import = handle.plan_edited_import(&copy_arg(args)?).map_err(core_error)?;
            plan_json(&import)
        }
        "edits.discard" => {
            let handle = open_page(app, args)?;
            handle.discard_edited_copy(&copy_arg(args)?).map_err(core_error)?;
            ok()
        }
        "source.openExternal" => {
            let handle = open_page(app, args)?;
            // Saving first writes a current page.md, keeping aside any edits already made to it.
            handle.save_now().map_err(core_error)?;
            handle.collect_edited_copies().map_err(core_error)?;
            let file = handle
                .page_md_path()
                .ok_or_else(|| IpcError::new("locked", "This page is in a protected section."))?;
            if !file.is_file() {
                return Err(IpcError::new("notFound", "This page has no page.md yet."));
            }
            open_in_editor(&file)?;
            ok()
        }
        "storage.cloudOnly" => {
            let handle = open_page(app, args)?;
            let files = handle.cloud_only_files();
            Ok(json!({ "count": files.len().min(MAX_CLOUD_FILES) }))
        }
        "storage.download" => {
            let handle = open_page(app, args)?;
            let id = handle.id().to_string();
            let files: Vec<PathBuf> = handle.cloud_only_files().into_iter().take(MAX_CLOUD_FILES).collect();
            let total = files.len();
            let mut failed = 0_usize;
            for (done, file) in files.iter().enumerate() {
                if download(file).is_err() {
                    failed += 1;
                }
                emit(
                    app,
                    "cloudDownload",
                    json!({ "pageId": id, "done": done + 1, "total": total }),
                );
            }
            Ok(json!({ "ok": failed == 0, "total": total, "failed": failed }))
        }
        _ => Err(IpcError::invalid("name", &format!("{name} isn't an edits call"))),
    }
}

/// Reads a cloud-only file to the end, which makes the sync tool download it. Nothing is kept in memory.
fn download(file: &Path) -> std::io::Result<()> {
    let mut reader = std::fs::File::open(file)?;
    let mut buffer = vec![0_u8; 64 * 1024];
    while reader.read(&mut buffer)? > 0 {}
    Ok(())
}

/// Opens `page.md` in the person's own editor: the app Windows opens Markdown with, else its edit verb, else
/// Notepad. Only the page's own `page.md` reaches here.
#[cfg(windows)]
fn open_in_editor(file: &Path) -> IpcResult<()> {
    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };

    let path = HSTRING::from(file.as_os_str());
    let run = |verb: PCWSTR, target: &HSTRING, parameters: Option<&HSTRING>| {
        // SAFETY: the strings outlive the call, and ShellExecuteW takes no other pointers.
        let result = unsafe {
            ShellExecuteW(
                None,
                verb,
                target,
                parameters.map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr())),
                None,
                SW_SHOWNORMAL,
            )
        };
        // ShellExecute reports success with a value above 32.
        (result.0 as isize) > 32
    };
    if run(w!("open"), &path, None) || run(w!("edit"), &path, None) {
        return Ok(());
    }
    let quoted = HSTRING::from(format!("\"{}\"", file.display()));
    if run(w!("open"), &HSTRING::from("notepad.exe"), Some(&quoted)) {
        return Ok(());
    }
    Err(IpcError::new(
        "noApp",
        "Windows has no app set up to edit Markdown files.",
    ))
}

#[cfg(not(windows))]
fn open_in_editor(_file: &Path) -> IpcResult<()> {
    Err(IpcError::not_implemented("source.openExternal"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edited_copy_paths_are_checked() {
        assert!(copy_arg(&json!({ "copy": "C:\\Notes\\a\\.conflicts\\page.md.x.edited" })).is_ok());
        for bad in [
            json!({}),
            json!({ "copy": "" }),
            json!({ "copy": 4 }),
            json!({ "copy": "a\0b" }),
        ] {
            assert!(copy_arg(&bad).is_err(), "{bad}");
        }
        assert!(copy_arg(&json!({ "copy": "x".repeat(MAX_PATH + 1) })).is_err());
    }

    #[test]
    fn only_page_md_copies_are_offered() {
        let copies = vec![
            EditedCopy {
                path: PathBuf::from("a/page.md.1.edited"),
                file: "page.md".into(),
                kept_at: None,
            },
            EditedCopy {
                path: PathBuf::from("a/ink.svg.1.edited"),
                file: "ink.svg".into(),
                kept_at: None,
            },
        ];
        let offered = page_md_copies(copies);
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0]["copy"], "a/page.md.1.edited");
    }

    #[test]
    fn a_cloud_file_that_cant_be_read_fails_its_download() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let file = dir.path().join("photo.jpg");
        assert!(download(&file).is_err());
        std::fs::write(&file, vec![7_u8; 200_000]).expect("a file");
        assert!(download(&file).is_ok());
    }
}
