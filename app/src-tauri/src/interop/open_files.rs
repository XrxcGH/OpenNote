//! Opening one Markdown or text file as a page that saves back to the file (A3-18, A4-26, A1-27).
//!
//! A file reaches OpenNote three ways: Windows starts the app with it ("Open with", or the default app for `.md` and
//! `.txt`), a second launch forwards it to the running window, or the person picks it with Open file. Each way is the
//! person's own choice of that file, so each grants access to that one path. The interface can then read the file,
//! write it back, and watch it for outside edits, and nothing else: a path that was never granted is refused, and
//! only `.md`, `.markdown`, and `.txt` files are read or written. The pages linked to files are listed in
//! `opened_files.json` in the app's data folder, so a link, and its grant, outlive a restart.
//!
//! A write goes to a temporary file beside the original first and then replaces it, so a crash never leaves half a
//! file. It is refused when the file changed since the interface last read it, so an outside edit is never lost.

use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Write as _,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ipc::{IpcError, IpcResult};

/// The extensions of files that open as a page.
pub const TEXT_EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];
/// The extension of a shared notebook file, which opens through Import notes.
pub const SHARE_EXTENSION: &str = "opennote";
/// The biggest file that opens as a page.
const MAX_FILE_BYTES: u64 = 16 << 20;
/// The most pages linked to files.
const MAX_LINKS: usize = 2_000;
/// The file that lists the links.
const LINKS_FILE: &str = "opened_files.json";

#[derive(Default)]
struct State {
    grants: HashSet<PathBuf>,
    launch: Vec<PathBuf>,
    loaded: bool,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(Mutex::default)
}

fn lock() -> std::sync::MutexGuard<'static, State> {
    state().lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The extension in lowercase, without the dot.
fn extension(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Whether a path names a file this module opens: a text file, or a shared notebook file.
pub fn is_openable(path: &Path) -> bool {
    let ext = extension(path);
    TEXT_EXTENSIONS.contains(&ext.as_str()) || ext == SHARE_EXTENSION
}

/// The path as the grants keep it: absolute and resolved, so `..` or a different case can't name another file.
fn key(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    fs::canonicalize(path).ok().filter(|p| p.is_file())
}

/// Grants access to one file the person chose. Returns the key it is kept under.
pub fn grant(path: &Path) -> Option<PathBuf> {
    if !is_openable(path) {
        return None;
    }
    let found = key(path)?;
    lock().grants.insert(found.clone());
    Some(found)
}

/// The files among a launch's arguments: absolute paths of existing files with an extension this module opens.
/// Flags, links, and anything else are left alone.
pub fn files_in(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .filter(|arg| !arg.starts_with("--") && !crate::deeplink::is_link(arg))
        .map(|arg| PathBuf::from(arg.trim().trim_matches('"')))
        .filter(|path| is_openable(path))
        .filter_map(|path| grant(&path))
        .take(32)
        .collect()
}

/// Keeps the files the first launch was started with, for the interface to take once.
pub fn remember_launch(args: &[String]) {
    let files = files_in(args);
    if !files.is_empty() {
        lock().launch.extend(files);
    }
}

/// Grants the files a second launch forwarded. The interface reads the same arguments from the forwarded event.
pub fn grant_forwarded(args: &[String]) {
    let _ = files_in(args);
}

fn granted(path: &str) -> IpcResult<PathBuf> {
    let refused = || IpcError::invalid("path", "OpenNote can only open files you chose.");
    let found = key(Path::new(path)).ok_or_else(refused)?;
    if !TEXT_EXTENSIONS.contains(&extension(&found).as_str()) {
        return Err(IpcError::invalid(
            "path",
            "Only Markdown and text files open as a page.",
        ));
    }
    if lock().grants.contains(&found) {
        Ok(found)
    } else {
        Err(refused())
    }
}

/// The file's last change, in milliseconds since 1970.
fn modified(path: &Path) -> IpcResult<i64> {
    let meta = fs::metadata(path).map_err(IpcError::from)?;
    let time = meta.modified().map_err(IpcError::from)?;
    Ok(time
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX)))
}

#[derive(Deserialize)]
pub(super) struct PathArgs {
    path: String,
}

/// The files the app was started with, given out once.
pub(super) fn take_launch(data: &Path) -> IpcResult<Value> {
    load_links(data);
    let files: Vec<String> = std::mem::take(&mut lock().launch)
        .into_iter()
        .map(|p| display(&p))
        .collect();
    Ok(json!({ "files": files }))
}

/// Resolves a file the person already picked with Open file, or that the app was started with. It grants nothing:
/// the picker (`interop_pick`) and the launch arguments are the only grants, so script in the interface can't name
/// a file of its own choosing and get it opened.
pub(super) fn open_picked(args: PathArgs) -> IpcResult<Value> {
    let found = granted(&args.path)?;
    Ok(json!({ "path": display(&found), "share": false }))
}

/// A path as the interface shows it, without the `\\?\` prefix that resolving adds on Windows.
fn display(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
}

/// Reads a granted file: its text, decoded as the interop crate decodes notes, and when it last changed.
pub(super) fn read(args: PathArgs) -> IpcResult<Value> {
    let path = granted(&args.path)?;
    let size = fs::metadata(&path).map_err(IpcError::from)?.len();
    if size > MAX_FILE_BYTES {
        return Err(IpcError::invalid("path", "The file is too big to open as a page."));
    }
    let bytes = fs::read(&path).map_err(IpcError::from)?;
    let decoded = opennote_interop::text::decode(&bytes);
    Ok(json!({
        "path": display(&path),
        "text": decoded.text,
        "modified": modified(&path)?,
        "markdown": extension(&path) != "txt",
    }))
}

#[derive(Deserialize)]
pub(super) struct WriteArgs {
    path: String,
    text: String,
    /// When the interface last read or wrote the file. A file that changed since is not overwritten.
    expected: Option<i64>,
}

/// Writes a page's text back to its granted file, unless the file changed since the interface last saw it.
pub(super) fn write(args: WriteArgs) -> IpcResult<Value> {
    let path = granted(&args.path)?;
    if args.text.len() as u64 > MAX_FILE_BYTES {
        return Err(IpcError::invalid("text", "The page is too big to save into the file."));
    }
    let now = modified(&path)?;
    if args.expected.is_some_and(|expected| expected != now) {
        return Err(IpcError::new("changed", "The file changed outside OpenNote."));
    }
    let parent = path
        .parent()
        .ok_or_else(|| IpcError::invalid("path", "The file has no folder."))?;
    let mut temp = tempfile::Builder::new()
        .prefix(".opennote-save-")
        .tempfile_in(parent)
        .map_err(IpcError::from)?;
    temp.write_all(args.text.as_bytes()).map_err(IpcError::from)?;
    temp.as_file().sync_all().map_err(IpcError::from)?;
    temp.persist(&path).map_err(|e| IpcError::from(e.error))?;
    Ok(json!({ "modified": modified(&path)? }))
}

/// When a granted file last changed, or that it is gone. A path that was never granted is refused the same way
/// whether it exists, so the interface can't use this to learn which files are on the PC.
pub(super) fn stat(args: PathArgs) -> IpcResult<Value> {
    let refused = || IpcError::invalid("path", "OpenNote can only open files you chose.");
    let Some(asked) = Path::new(&args.path).is_absolute().then(|| PathBuf::from(&args.path)) else {
        return Err(refused());
    };
    if let Ok(path) = granted(&args.path) {
        return Ok(json!({ "exists": true, "modified": modified(&path)? }));
    }
    // A granted file that has since gone no longer resolves, so it is matched by the path it was granted under.
    let gone = !asked.exists()
        && lock()
            .grants
            .iter()
            .any(|g| display(g).eq_ignore_ascii_case(&display(&asked)));
    if gone {
        Ok(json!({ "exists": false, "modified": null }))
    } else {
        Err(refused())
    }
}

/// The pages linked to files: page ID to path.
#[derive(Default, Serialize, Deserialize)]
struct Links {
    pages: BTreeMap<String, String>,
}

fn links_path(data: &Path) -> PathBuf {
    data.join(LINKS_FILE)
}

fn read_links(data: &Path) -> Links {
    fs::read(links_path(data))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Loads the saved links once, and grants their files again: the person chose each of them before.
fn load_links(data: &Path) {
    if lock().loaded {
        return;
    }
    let links = read_links(data);
    let mut state = lock();
    state.loaded = true;
    for path in links.pages.values() {
        if let Some(found) = key(Path::new(path)).filter(|p| is_openable(p)) {
            state.grants.insert(found);
        }
    }
}

/// Every page linked to a file.
pub(super) fn list(data: &Path) -> IpcResult<Value> {
    load_links(data);
    Ok(json!({ "pages": read_links(data).pages }))
}

#[derive(Deserialize)]
pub(super) struct LinkArgs {
    page: String,
    /// The file, or `None` to take the link away.
    path: Option<String>,
}

/// Links a page to a granted file, or takes the link away.
pub(super) fn link(data: &Path, args: LinkArgs) -> IpcResult<Value> {
    load_links(data);
    let valid_page = !args.page.is_empty()
        && args.page.len() <= 64
        && args
            .page
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid_page {
        return Err(IpcError::invalid("page", "That isn't a page."));
    }
    let mut links = read_links(data);
    match args.path {
        Some(path) => {
            let found = granted(&path)?;
            if links.pages.len() >= MAX_LINKS && !links.pages.contains_key(&args.page) {
                return Err(IpcError::invalid("page", "Too many pages are linked to files."));
            }
            links.pages.insert(args.page, display(&found));
        }
        None => {
            links.pages.remove(&args.page);
        }
    }
    fs::create_dir_all(data).map_err(IpcError::from)?;
    let bytes = serde_json::to_vec_pretty(&links).map_err(|e| IpcError::invalid("links", &e.to_string()))?;
    fs::write(links_path(data), bytes).map_err(IpcError::from)?;
    Ok(Value::Null)
}

/// Opens Windows' Default apps settings, where the person can make OpenNote the app for `.md` and `.txt` files.
/// Windows lets only the person choose a default app, so OpenNote shows the page and changes nothing itself.
pub(super) fn default_apps() -> IpcResult<Value> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:defaultapps")
            .spawn()
            .map_err(IpcError::from)?;
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(dir: &Path, name: &str, text: &str) -> String {
        let path = dir.join(name);
        fs::write(&path, text).expect("a file");
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn naming_a_file_grants_nothing_and_says_nothing_about_it() {
        let dir = tempfile::tempdir().expect("a folder");
        let there = file(
            dir.path(),
            "Diary.md",
            "private
",
        );
        let missing = dir.path().join("Missing.md").to_string_lossy().into_owned();
        assert!(
            open_picked(PathArgs { path: there.clone() }).is_err(),
            "only the picker grants"
        );
        assert!(read(PathArgs { path: there.clone() }).is_err());
        let a = stat(PathArgs { path: there.clone() }).expect_err("refused");
        let b = stat(PathArgs { path: missing }).expect_err("refused the same way");
        assert_eq!(format!("{a:?}"), format!("{b:?}"));
        grant(Path::new(&there)).expect("granted by the picker");
        assert!(open_picked(PathArgs { path: there.clone() }).is_ok());
        fs::remove_file(&there).expect("removed");
        assert_eq!(stat(PathArgs { path: there }).expect("known")["exists"], false);
    }

    #[test]
    fn only_granted_text_files_are_read_and_written() {
        let dir = tempfile::tempdir().expect("a folder");
        let notes = file(dir.path(), "Notes.md", "# Notes\n\nHello\n");
        let other = file(dir.path(), "Other.md", "secret\n");
        let refused = read(PathArgs { path: notes.clone() });
        assert!(refused.is_err(), "not granted yet");
        assert!(grant(Path::new(&notes)).is_some());
        let read_back = read(PathArgs { path: notes.clone() }).expect("reads");
        assert_eq!(read_back["text"], "# Notes\n\nHello\n");
        assert_eq!(read_back["markdown"], true);
        assert!(read(PathArgs { path: other }).is_err(), "another file stays closed");
        let sneaky = format!("{}\\..\\Other.md", dir.path().join("x").display());
        assert!(read(PathArgs { path: sneaky }).is_err());
        assert!(grant(&dir.path().join("Notes.exe")).is_none());
        assert!(
            read(PathArgs {
                path: "Notes.md".into()
            })
            .is_err(),
            "a relative path is refused"
        );
    }

    #[test]
    fn a_write_replaces_the_file_unless_it_changed_outside() {
        let dir = tempfile::tempdir().expect("a folder");
        let notes = file(dir.path(), "Save.md", "one\n");
        grant(Path::new(&notes)).expect("granted");
        let first = read(PathArgs { path: notes.clone() }).expect("reads");
        let when = first["modified"].as_i64();
        let saved = write(WriteArgs {
            path: notes.clone(),
            text: "two\n".into(),
            expected: when,
        })
        .expect("saves");
        assert_eq!(fs::read_to_string(&notes).expect("reads"), "two\n");
        let stale = write(WriteArgs {
            path: notes.clone(),
            text: "three\n".into(),
            expected: Some(1),
        });
        assert_eq!(stale.expect_err("refused").code, "changed");
        assert_eq!(
            fs::read_to_string(&notes).expect("reads"),
            "two\n",
            "the outside copy is kept"
        );
        let again = write(WriteArgs {
            path: notes.clone(),
            text: "four\n".into(),
            expected: saved["modified"].as_i64(),
        });
        assert!(again.is_ok());
        let leftovers = fs::read_dir(dir.path()).expect("lists").count();
        assert_eq!(leftovers, 1, "no temporary file is left");
    }

    #[test]
    fn launch_arguments_grant_only_existing_text_files() {
        let dir = tempfile::tempdir().expect("a folder");
        let notes = file(dir.path(), "Launch.txt", "hi");
        let args = vec![
            "--wait-pid=3".to_owned(),
            "opennote://page/abc".to_owned(),
            notes.clone(),
            dir.path().join("missing.md").to_string_lossy().into_owned(),
            "relative.md".to_owned(),
        ];
        let files = files_in(&args);
        assert_eq!(files.len(), 1);
        assert!(read(PathArgs { path: notes }).is_ok());
    }

    #[test]
    fn links_are_kept_and_grant_their_files_again() {
        let dir = tempfile::tempdir().expect("a folder");
        let data = dir.path().join("data");
        let notes = file(dir.path(), "Linked.md", "x");
        grant(Path::new(&notes)).expect("granted");
        link(
            &data,
            LinkArgs {
                page: "p1".into(),
                path: Some(notes.clone()),
            },
        )
        .expect("links");
        let listed = list(&data).expect("lists");
        assert!(listed["pages"]["p1"].as_str().is_some_and(|p| p.ends_with("Linked.md")));
        assert!(link(
            &data,
            LinkArgs {
                page: "../x".into(),
                path: None
            }
        )
        .is_err());
        link(
            &data,
            LinkArgs {
                page: "p1".into(),
                path: None,
            },
        )
        .expect("unlinks");
        assert!(list(&data).expect("lists")["pages"]
            .as_object()
            .is_some_and(|m| m.is_empty()));
    }
}
