//! Page shortcuts and the taskbar jump list. A shortcut is a `.lnk` file that starts OpenNote with an
//! `opennote://page/<id>` link, the same link Outlook and Word use, so it survives renames and moves. The jump
//! list shows "New quick note" and the recent pages. A `--quick-note` argument (the jump list's task) opens the
//! quick capture window.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{arg, opt};
use crate::{
    core_bridge::CoreBridge,
    ipc::{IpcError, IpcResult},
};

/// The argument the jump list's task passes.
pub const QUICK_NOTE_ARG: &str = "--quick-note";

#[derive(Debug, Deserialize)]
struct Recent {
    title: String,
    url: String,
}

/// A file name made from a title: no characters Windows refuses, no trailing dots or spaces, at most 100
/// characters, and "OpenNote page" for a title with nothing left.
pub fn file_name_for(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let trimmed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let shortened: String = trimmed.chars().take(100).collect();
    let name = shortened.trim_matches(|c: char| c == '.' || c.is_whitespace()).to_owned();
    if name.is_empty() {
        "OpenNote page".to_owned()
    } else {
        name
    }
}

/// A link is safe to put in a shortcut when it is an `opennote://page/` link of plain characters.
pub fn is_page_link(link: &str) -> bool {
    link.len() <= 200
        && link.starts_with("opennote://page/")
        && link["opennote://".len()..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | '%'))
}

/// The first path free of a file of that name: `Name.lnk`, then `Name (2).lnk`, and so on.
pub fn free_path(dir: &Path, stem: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.lnk"));
    if !first.exists() {
        return first;
    }
    (2..1000)
        .map(|n| dir.join(format!("{stem} ({n}).lnk")))
        .find(|path| !path.exists())
        .unwrap_or(first)
}

#[cfg(windows)]
fn desktop() -> Option<PathBuf> {
    use windows::Win32::UI::Shell::FOLDERID_Desktop;

    crate::paths::known_folder(&FOLDERID_Desktop).ok()
}

#[cfg(not(windows))]
fn desktop() -> Option<PathBuf> {
    None
}

pub fn call(_app: &AppHandle, _bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "shortcut.create" => {
            let link: String = arg(args, "url")?;
            let title: String = arg(args, "title")?;
            let folder: Option<String> = opt(args, "folder")?;
            if !is_page_link(&link) {
                return Err(IpcError::invalid("url", "That isn't an OpenNote page link."));
            }
            let dir = folder
                .map(PathBuf::from)
                .or_else(desktop)
                .ok_or_else(|| IpcError::new("io", "There is no folder for the shortcut."))?;
            let path = free_path(&dir, &file_name_for(&title));
            let exe = std::env::current_exe()?;
            crate::install::create_link(&path, &exe, Some(&link), &title)
                .map_err(|error| IpcError::new("io", error.to_string()))?;
            Ok(json!({ "path": path }))
        }
        "shortcut.jumpList" => {
            let recent: Vec<Recent> = arg(args, "recent")?;
            let items: Vec<(String, String)> = recent
                .into_iter()
                .filter(|item| is_page_link(&item.url))
                .map(|item| (item.title, item.url))
                .take(10)
                .collect();
            let exe = std::env::current_exe()?;
            crate::install::set_jump_list(&exe, &items).map_err(|error| IpcError::new("io", error.to_string()))?;
            Ok(json!({ "ok": true }))
        }
        _ => Err(IpcError::invalid("name", "isn't a shortcut call")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_drop_what_windows_refuses() {
        assert_eq!(file_name_for("Chem: Lab 3 / notes?"), "Chem Lab 3 notes");
        assert_eq!(file_name_for("  ...  "), "OpenNote page");
        assert_eq!(file_name_for(""), "OpenNote page");
        assert_eq!(file_name_for(&"a".repeat(300)).len(), 100);
    }

    #[test]
    fn only_page_links_go_in_a_shortcut() {
        assert!(is_page_link("opennote://page/01hzx3k9q7m2v5c8d4e6f0abcd"));
        assert!(!is_page_link("https://example.com/page/abc"));
        assert!(!is_page_link("opennote://page/abc\" & calc"));
        assert!(!is_page_link("opennote://settings/abcdefgh"));
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert_eq!(free_path(dir.path(), "Notes"), dir.path().join("Notes.lnk"));
        std::fs::write(dir.path().join("Notes.lnk"), b"").expect("writes");
        assert_eq!(free_path(dir.path(), "Notes"), dir.path().join("Notes (2).lnk"));
    }
}
