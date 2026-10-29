//! The operating system's file dialogs and its "open with the default app" (ADR 0055).
//!
//! Windows has its own code next to each command: the common item dialogs and `ShellExecuteW`. macOS and Linux use
//! the dialog plugin (NSOpenPanel and NSSavePanel on macOS, GTK's or the desktop portal's chooser on Linux) and the
//! system's opener: `open` on macOS and `xdg-open` on Linux. A path or address is always one argument to the opener,
//! never part of a shell command, so no file name can run anything.

use tauri::WebviewWindow;

/// What a native dialog opens over. On Windows it's the window's handle as a number, since a handle isn't `Send`
/// and the dialog runs on its own thread. Elsewhere it's the window itself.
#[cfg(windows)]
pub type DialogOwner = isize;
#[cfg(not(windows))]
pub type DialogOwner = WebviewWindow;

/// The owner for a dialog that opens over `window`.
#[cfg(windows)]
pub fn dialog_owner(window: &WebviewWindow) -> DialogOwner {
    window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0)
}

#[cfg(not(windows))]
pub fn dialog_owner(window: &WebviewWindow) -> DialogOwner {
    window.clone()
}

/// The program that opens a file or an address with its default app on this system.
#[cfg(not(windows))]
pub const OPENER: &str = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };

/// The arguments for the opener: the target alone, or on macOS `-R` first to select it in Finder.
#[cfg(not(windows))]
pub fn opener_args(target: &std::ffi::OsStr, reveal: bool) -> Vec<std::ffi::OsString> {
    let mut args = Vec::new();
    if reveal && cfg!(target_os = "macos") {
        args.push("-R".into());
    }
    // A target that starts with "-" would read as an option, so it's made a path the opener can't mistake.
    let target = std::path::Path::new(target);
    if target.as_os_str().to_string_lossy().starts_with('-') {
        args.push(std::path::Path::new(".").join(target).into_os_string());
    } else {
        args.push(target.as_os_str().to_owned());
    }
    args
}

#[cfg(not(windows))]
pub use unix::*;

#[cfg(not(windows))]
mod unix {
    use std::{
        ffi::OsStr,
        path::{Path, PathBuf},
        process::{Command, Stdio},
    };

    use tauri_plugin_dialog::{DialogExt, FilePath};

    use super::{opener_args, DialogOwner, OPENER};
    use crate::ipc::{codes, IpcError, IpcResult};

    /// Opens `target`, a file, a folder, or an address, with its default app. `reveal` shows a file in its folder
    /// instead: selected in Finder on macOS, and its folder opened on Linux, where file managers share no way to
    /// select one.
    pub fn open_with_default(target: &OsStr, reveal: bool) -> IpcResult<()> {
        let target = match (reveal, cfg!(target_os = "macos")) {
            (true, false) => Path::new(target).parent().map_or(target, Path::as_os_str),
            _ => target,
        };
        Command::new(OPENER)
            .args(opener_args(target, reveal))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(drop)
            .map_err(|error| {
                IpcError::new(
                    codes::IO,
                    format!("This computer couldn't open it, because {OPENER} didn't start: {error}"),
                )
            })
    }

    fn into_path(picked: Option<FilePath>) -> IpcResult<Option<PathBuf>> {
        picked
            .map(|path| {
                path.into_path()
                    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
            })
            .transpose()
    }

    fn start_in(
        dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
        initial: Option<&str>,
    ) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
        match initial.filter(|folder| Path::new(folder).is_dir()) {
            Some(folder) => dialog.set_directory(folder),
            None => dialog,
        }
    }

    /// A folder, or `None` when the person cancels. Call it off the main thread: it waits for the dialog.
    pub fn pick_folder(owner: &DialogOwner, initial: Option<&str>) -> IpcResult<Option<PathBuf>> {
        let dialog = start_in(owner.dialog().file().set_parent(owner), initial);
        into_path(dialog.blocking_pick_folder())
    }

    /// A file of one of `extensions`, or `None` when the person cancels.
    pub fn pick_file(
        owner: &DialogOwner,
        initial: Option<&str>,
        label: &str,
        extensions: &[&str],
    ) -> IpcResult<Option<PathBuf>> {
        let dialog = start_in(owner.dialog().file().set_parent(owner), initial).add_filter(label, extensions);
        into_path(dialog.blocking_pick_file())
    }

    /// Where to save a file named `suggested` with `extension`, or `None` when the person cancels.
    pub fn save_file(owner: &DialogOwner, suggested: &str, label: &str, extension: &str) -> IpcResult<Option<PathBuf>> {
        let dialog = owner
            .dialog()
            .file()
            .set_parent(owner)
            .set_file_name(suggested)
            .add_filter(label, &[extension]);
        into_path(dialog.blocking_save_file())
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use std::ffi::{OsStr, OsString};

    use super::*;

    #[test]
    fn the_target_is_one_argument_and_never_an_option() {
        assert_eq!(
            opener_args(OsStr::new("/tmp/a b; rm -rf ~"), false),
            [OsString::from("/tmp/a b; rm -rf ~")]
        );
        assert_eq!(
            opener_args(OsStr::new("-a Calculator"), false),
            [OsString::from("./-a Calculator")]
        );
    }

    #[test]
    fn reveal_selects_the_file_in_finder_on_macos() {
        let args = opener_args(OsStr::new("/Users/a/notes.md"), true);
        if cfg!(target_os = "macos") {
            assert_eq!(args, [OsString::from("-R"), OsString::from("/Users/a/notes.md")]);
        } else {
            assert_eq!(args, [OsString::from("/Users/a/notes.md")]);
        }
    }

    #[test]
    fn the_opener_is_the_systems_own() {
        assert_eq!(OPENER, if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
    }
}
