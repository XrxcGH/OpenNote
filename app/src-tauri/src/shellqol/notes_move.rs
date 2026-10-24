//! Change the notes folder (A4-5): "Move my notebooks" copies each notebook of the old notes folder into the new
//! one, checks every byte of the copy, and only then has the library name the copy and moves the old folder to the
//! Recycle Bin. A cancel stops between files; the notebook being copied stays where it was, and its partial copy is
//! removed. The interface updates `storage.notesFolder` once every notebook has moved.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use opennote_core::{session::library::same_path, CoreError, FsError, FsErrorKind};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{arg, emit};
use crate::{
    core_bridge::{notes_folder, CoreBridge},
    ipc::{IpcError, IpcResult},
};

static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

/// The longest path the calls take.
const MAX_PATH: usize = 1024;
/// How deep a notebook folder's files may sit.
const MAX_DEPTH: usize = 32;
/// The file a notebook folder is known by. It is copied last, so a partial copy is never a notebook.
const NOTEBOOK_JSON: &str = "notebook.json";

/// Checks the folder the notebooks move to: absolute, on this PC, and neither inside the old notes folder nor
/// holding it.
pub fn check_target(old: &Path, to: &Path) -> IpcResult<()> {
    let text = to.to_string_lossy();
    if !to.is_absolute() || text.starts_with(r"\\") || text.contains('\0') || text.len() > MAX_PATH {
        return Err(IpcError::invalid("to", "isn't a folder on this PC"));
    }
    if same_path(old, to) || to.starts_with(old) || old.starts_with(to) {
        return Err(IpcError::invalid(
            "to",
            "is the notes folder, or inside it, or holds it",
        ));
    }
    Ok(())
}

fn cancelled() -> CoreError {
    CoreError::Fs(FsError::new(FsErrorKind::Io, Path::new("cancelled")))
}

fn io(path: &Path, error: &std::io::Error) -> CoreError {
    let _ = error;
    CoreError::Fs(FsError::new(FsErrorKind::Io, path))
}

/// The files under `dir`, relative to it. Links are left out, so a copy never leaves the notebook.
fn files_under(dir: &Path) -> Result<Vec<PathBuf>, CoreError> {
    let mut files = Vec::new();
    let mut pending = vec![(PathBuf::new(), 0_usize)];
    while let Some((relative, depth)) = pending.pop() {
        let here = dir.join(&relative);
        for entry in fs::read_dir(&here).map_err(|e| io(&here, &e))?.flatten() {
            let kind = entry.file_type().map_err(|e| io(&entry.path(), &e))?;
            let name = relative.join(entry.file_name());
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if depth < MAX_DEPTH {
                    pending.push((name, depth + 1));
                }
            } else {
                files.push(name);
            }
        }
    }
    files.sort();
    Ok(files)
}

/// Whether two files hold the same bytes, read in pieces.
pub fn same_bytes(a: &Path, b: &Path) -> std::io::Result<bool> {
    let (mut left, mut right) = (fs::File::open(a)?, fs::File::open(b)?);
    if left.metadata()?.len() != right.metadata()?.len() {
        return Ok(false);
    }
    let (mut one, mut two) = (vec![0_u8; 64 * 1024], vec![0_u8; 64 * 1024]);
    loop {
        let read = left.read(&mut one)?;
        if read == 0 {
            return Ok(right.read(&mut two)? == 0);
        }
        right.read_exact(two.get_mut(..read).unwrap_or_default())?;
        if one.get(..read) != two.get(..read) {
            return Ok(false);
        }
    }
}

/// Copies one file and checks the copy.
fn copy_checked(from: &Path, to: &Path) -> Result<(), CoreError> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| io(parent, &e))?;
    }
    fs::copy(from, to).map_err(|e| io(from, &e))?;
    if !same_bytes(from, to).map_err(|e| io(to, &e))? {
        return Err(io(to, &std::io::Error::other("the copy differs")));
    }
    Ok(())
}

/// Copies a notebook folder to `to`, which must not exist yet, checking every file, with `notebook.json` last. On an
/// error or a cancel, the partial copy is removed. `progress` hears the files copied so far and the total.
pub fn copy_notebook(
    from: &Path,
    to: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<(), CoreError> {
    if to.exists() {
        return Err(CoreError::Fs(FsError::new(FsErrorKind::AlreadyExists, to)));
    }
    let result = (|| {
        let mut files = files_under(from)?;
        // notebook.json goes last, so a copy cut short is never taken for a notebook.
        files.sort_by_key(|file| file.as_os_str() == NOTEBOOK_JSON);
        fs::create_dir_all(to).map_err(|e| io(to, &e))?;
        let total = files.len();
        for (done, file) in files.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            copy_checked(&from.join(file), &to.join(file))?;
            progress(done + 1, total);
        }
        Ok(())
    })();
    if result.is_err() {
        // Only the copy this call made goes; the notebook itself is untouched.
        let _ = fs::remove_dir_all(to);
    }
    result
}

pub fn call(app: &AppHandle, bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "storage.moveNotes" => {
            let to: String = arg(args, "to")?;
            let to = PathBuf::from(to);
            let old = notes_folder(app).ok_or_else(|| IpcError::new("notFound", "There is no notes folder yet."))?;
            check_target(&old, &to)?;
            if RUNNING.swap(true, Ordering::SeqCst) {
                return Err(IpcError::new("busy", "The notebooks are already moving."));
            }
            CANCEL.store(false, Ordering::SeqCst);
            let core = bridge.with(|b| Ok(b.core.clone()))?;
            let app = app.clone();
            let spawned = std::thread::Builder::new()
                .name("opennote-move-notes".into())
                .spawn(move || {
                    let outcome = move_all(&app, &core, &old, &to);
                    RUNNING.store(false, Ordering::SeqCst);
                    emit(&app, "notesMoveDone", outcome);
                });
            if let Err(error) = spawned {
                RUNNING.store(false, Ordering::SeqCst);
                return Err(IpcError::new("internal", error.to_string()));
            }
            Ok(json!({ "ok": true }))
        }
        "storage.cancelMove" => {
            CANCEL.store(true, Ordering::SeqCst);
            Ok(json!({ "ok": true }))
        }
        _ => Err(IpcError::invalid("name", &format!("{name} isn't a notes folder call"))),
    }
}

/// Moves every open notebook of the old notes folder into the new one, one at a time.
fn move_all(app: &AppHandle, core: &opennote_core::session::core::Core, old: &Path, to: &Path) -> Value {
    if let Err(error) = fs::create_dir_all(to) {
        ::log::warn!("Couldn't create the new notes folder: {}", error.kind());
        return json!({ "ok": false, "moved": 0, "failed": 1, "cancelled": false });
    }
    let books: Vec<PathBuf> = core
        .library()
        .notebooks
        .into_iter()
        .filter(|book| book.open && book.path.starts_with(old))
        .map(|book| book.path)
        .collect();
    let (mut moved, mut failed) = (0_usize, 0_usize);
    let total = books.len();
    for (index, path) in books.iter().enumerate() {
        if CANCEL.load(Ordering::SeqCst) {
            break;
        }
        let id = core.find_open(path).map(|book| book.id());
        let mut copy = |from: &Path, target: &Path| {
            copy_notebook(from, target, &CANCEL, &mut |done, files| {
                emit(
                    app,
                    "notesMove",
                    json!({ "notebook": index + 1, "notebooks": total, "done": done, "total": files }),
                );
            })
        };
        match core.move_notebook_folder(path, to, &mut copy) {
            Ok(_) => {
                moved += 1;
                // The copy is checked and named; the old folder goes to the Recycle Bin, never deleted outright.
                if let Err(error) = crate::notes::purged::recycle(path) {
                    ::log::warn!("The old notebook folder stayed: {}", error.code);
                }
                if let Some(id) = id {
                    let bridge = app.state::<CoreBridge>();
                    let pages = bridge.with(|b| Ok(b.forget_notebook_pages(id))).unwrap_or_default();
                    if !pages.is_empty() {
                        let pages: Vec<String> = pages.iter().map(ToString::to_string).collect();
                        emit(app, "reopenPages", json!({ "pages": pages }));
                    }
                }
            }
            Err(_) => failed += 1,
        }
    }
    let cancelled = CANCEL.load(Ordering::SeqCst);
    json!({ "ok": failed == 0 && !cancelled, "moved": moved, "failed": failed, "cancelled": cancelled })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(root: &Path) {
        fs::create_dir_all(root.join("s1").join("p1").join("assets")).expect("folders");
        fs::write(root.join(NOTEBOOK_JSON), b"{}").expect("a file");
        fs::write(root.join("s1").join("section.json"), b"{\"s\":1}").expect("a file");
        fs::write(root.join("s1").join("p1").join("page.json"), vec![5_u8; 300_000]).expect("a file");
        fs::write(root.join("s1").join("p1").join("assets").join("a.png"), b"png").expect("a file");
    }

    #[test]
    fn copies_every_file_with_notebook_json_last_and_checks_each() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let (from, to) = (dir.path().join("Biology"), dir.path().join("New").join("Biology"));
        tree(&from);
        let mut seen = Vec::new();
        copy_notebook(&from, &to, &AtomicBool::new(false), &mut |done, total| {
            seen.push((done, total))
        })
        .expect("copies");
        assert_eq!(seen.last(), Some(&(4, 4)));
        for file in files_under(&from).expect("files") {
            assert!(
                same_bytes(&from.join(&file), &to.join(&file)).expect("reads"),
                "{file:?}"
            );
        }
        assert!(
            copy_notebook(&from, &to, &AtomicBool::new(false), &mut |_, _| {}).is_err(),
            "the target exists"
        );
    }

    #[test]
    fn a_cancelled_copy_removes_itself_and_leaves_the_notebook() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let (from, to) = (dir.path().join("Biology"), dir.path().join("New").join("Biology"));
        tree(&from);
        let cancel = AtomicBool::new(false);
        let result = copy_notebook(&from, &to, &cancel, &mut |done, _| {
            if done == 2 {
                cancel.store(true, Ordering::SeqCst);
            }
        });
        assert!(result.is_err());
        assert!(!to.exists(), "the partial copy is removed");
        assert!(from.join(NOTEBOOK_JSON).is_file(), "the notebook is untouched");
    }

    #[test]
    fn different_bytes_are_found() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        fs::write(&a, vec![1_u8; 70_000]).expect("a file");
        let mut other = vec![1_u8; 70_000];
        other[69_999] = 2;
        fs::write(&b, other).expect("a file");
        assert!(!same_bytes(&a, &b).expect("reads"));
        fs::write(&b, vec![1_u8; 70_001]).expect("a file");
        assert!(!same_bytes(&a, &b).expect("reads"));
        fs::write(&b, vec![1_u8; 70_000]).expect("a file");
        assert!(same_bytes(&a, &b).expect("reads"));
    }

    #[test]
    fn the_new_folder_is_checked() {
        let old = Path::new(r"C:\Users\a\Documents\OpenNote");
        assert!(check_target(old, Path::new(r"D:\Notes")).is_ok());
        for bad in [
            r"C:\Users\a\Documents\OpenNote",
            r"C:\Users\a\Documents\OpenNote\Inner",
            r"C:\Users\a",
            r"Notes",
            r"\\server\share\Notes",
        ] {
            assert!(check_target(old, Path::new(bad)).is_err(), "{bad}");
        }
    }
}
