//! Page shortcuts and the taskbar jump list. A shortcut is a `.lnk` file that starts OpenNote with an
//! `opennote://page/<id>` link, the same link that Outlook, Word, and Teams use, so it survives renames and moves. A
//! section or notebook shortcut uses `opennote://section/<id>` or `opennote://notebook/<id>` and opens that section or
//! notebook itself. The shortcut goes on the desktop, in the Start menu, or in a folder the person chose. The jump
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

/// A file name made from a title. Characters Windows refuses become spaces, and trailing dots and spaces go.
/// The name keeps at most 100 characters. A title with nothing left becomes "OpenNote page".
pub fn file_name_for(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let shortened: String = trimmed.chars().take(100).collect();
    let name = shortened
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_owned();
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

/// A link is safe to put in a shortcut when it names a page, a section, or a notebook by plain characters.
pub fn is_shortcut_link(link: &str) -> bool {
    link.len() <= 200
        && ["page", "section", "notebook"]
            .iter()
            .any(|kind| link.strip_prefix(&format!("opennote://{kind}/")).is_some_and(|id| !id.is_empty()))
        && link["opennote://".len()..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | '%'))
}

/// Where a shortcut goes, as the interface names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Place {
    Desktop,
    StartMenu,
    Folder(PathBuf),
}

impl Place {
    /// Reads the place from the call's `place` and `folder` arguments. No place means the desktop.
    pub fn parse(place: Option<&str>, folder: Option<&str>) -> Result<Self, &'static str> {
        match place.unwrap_or("desktop") {
            "desktop" => Ok(Self::Desktop),
            "startMenu" => Ok(Self::StartMenu),
            "folder" => match folder {
                Some(path) if !path.trim().is_empty() => Ok(Self::Folder(PathBuf::from(path))),
                _ => Err("Choose a folder for the shortcut."),
            },
            _ => Err("That isn't a place for a shortcut."),
        }
    }

    /// The folder to write the shortcut in, given the desktop and Start menu folders Windows reports.
    pub fn directory(&self, desktop: Option<PathBuf>, start_menu: Option<PathBuf>) -> Result<PathBuf, &'static str> {
        let dir = match self {
            Self::Desktop => desktop.ok_or("There is no desktop folder for the shortcut.")?,
            Self::StartMenu => start_menu.ok_or("There is no Start menu folder for the shortcut.")?,
            Self::Folder(path) => path.clone(),
        };
        if dir.is_dir() || !matches!(self, Self::Folder(_)) {
            Ok(dir)
        } else {
            Err("That folder isn't there any more.")
        }
    }
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

#[cfg(windows)]
fn start_menu() -> Option<PathBuf> {
    use windows::Win32::UI::Shell::FOLDERID_Programs;

    crate::paths::known_folder(&FOLDERID_Programs).ok()
}

#[cfg(not(windows))]
fn start_menu() -> Option<PathBuf> {
    None
}

pub fn call(_app: &AppHandle, _bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "shortcut.create" => {
            let link: String = arg(args, "url")?;
            let title: String = arg(args, "title")?;
            let folder: Option<String> = opt(args, "folder")?;
            let place: Option<String> = opt(args, "place")?;
            if !is_shortcut_link(&link) {
                return Err(IpcError::invalid("url", "That isn't an OpenNote link."));
            }
            let place = Place::parse(place.as_deref(), folder.as_deref())
                .map_err(|message| IpcError::invalid("place", message))?;
            let dir = place
                .directory(desktop(), start_menu())
                .map_err(|message| IpcError::new("io", message))?;
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
    fn sections_and_notebooks_get_shortcuts_that_open_themselves() {
        assert!(is_shortcut_link("opennote://page/01hzx3k9q7m2v5c8d4e6f0abcd"));
        assert!(is_shortcut_link("opennote://section/01hzx3k9q7m2v5c8d4e6f0abcd"));
        assert!(is_shortcut_link("opennote://notebook/01hzx3k9q7m2v5c8d4e6f0abcd"));
        assert!(!is_shortcut_link("opennote://notebook/"));
        assert!(!is_shortcut_link("opennote://settings/abcdefgh"));
        assert!(!is_shortcut_link("opennote://section/abc\" & calc"));
        assert!(!is_page_link("opennote://section/01hzx3k9q7m2v5c8d4e6f0abcd"));
    }

    #[test]
    fn a_shortcut_goes_where_the_person_chose() {
        let desktop = Some(PathBuf::from("C:/Users/x/Desktop"));
        let start = Some(PathBuf::from("C:/Users/x/Start/Programs"));
        let place = |p, f| Place::parse(p, f);
        assert_eq!(place(None, None), Ok(Place::Desktop));
        assert_eq!(place(Some("startMenu"), None), Ok(Place::StartMenu));
        assert!(place(Some("folder"), None).is_err());
        assert!(place(Some("folder"), Some("  ")).is_err());
        assert!(place(Some("elsewhere"), None).is_err());
        assert_eq!(
            Place::Desktop.directory(desktop.clone(), start.clone()),
            Ok(PathBuf::from("C:/Users/x/Desktop"))
        );
        assert_eq!(
            Place::StartMenu.directory(desktop.clone(), start),
            Ok(PathBuf::from("C:/Users/x/Start/Programs"))
        );
        assert!(Place::Desktop.directory(None, None).is_err());
        let dir = tempfile::tempdir().expect("a temp folder");
        let chosen = Place::Folder(dir.path().to_path_buf());
        assert_eq!(chosen.directory(desktop.clone(), None), Ok(dir.path().to_path_buf()));
        let gone = Place::Folder(dir.path().join("missing"));
        assert!(gone.directory(desktop, None).is_err());
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert_eq!(free_path(dir.path(), "Notes"), dir.path().join("Notes.lnk"));
        std::fs::write(dir.path().join("Notes.lnk"), b"").expect("writes");
        assert_eq!(free_path(dir.path(), "Notes"), dir.path().join("Notes (2).lnk"));
    }
}
