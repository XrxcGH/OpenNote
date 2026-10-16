//! The paths the person chose in this app's own picker, or that the app found or wrote itself. The import, report,
//! and reveal commands take only these, so a script that got into the WebView can't read or write anywhere else
//! on disk through them.

use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    sync::{Mutex, PoisonError},
};

use crate::ipc::{IpcError, IpcResult};

static GRANTED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

/// Lets the commands use `path` for the rest of this run.
pub fn grant(path: impl Into<PathBuf>) {
    GRANTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashSet::new)
        .insert(path.into());
}

fn is_granted(path: &Path) -> bool {
    GRANTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .is_some_and(|set| set.contains(path))
}

/// `path` itself was granted.
pub fn require(path: &str) -> IpcResult<PathBuf> {
    let path = PathBuf::from(path);
    if is_granted(&path) {
        Ok(path)
    } else {
        Err(IpcError::invalid(
            "path",
            "Choose the file or folder with Browse first.",
        ))
    }
}

/// Whether `path` steps up or stays put anywhere (`..` or `.`), which `Path::ancestors` does not resolve, so
/// `<granted>\..\elsewhere` would look inside the granted folder. A verbatim (`\\?\`) path keeps them as
/// plain names, so those are refused too.
fn has_dot_steps(path: &Path) -> bool {
    path.components().any(|c| match c {
        Component::ParentDir | Component::CurDir => true,
        Component::Normal(name) => name == ".." || name == ".",
        _ => false,
    })
}

/// `path` or a folder it is inside was granted, as for what an export wrote into a chosen folder.
pub fn require_within(path: &str) -> IpcResult<PathBuf> {
    let path = PathBuf::from(path);
    if !has_dot_steps(&path) && path.ancestors().any(is_granted) {
        Ok(path)
    } else {
        Err(IpcError::invalid(
            "path",
            "That file or folder isn't one OpenNote chose or wrote.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_granted_paths_and_what_is_inside_granted_folders_pass() {
        let base = std::env::temp_dir().join("opennote-grants-test");
        assert!(require(&base.to_string_lossy()).is_err());
        grant(base.clone());
        assert!(require(&base.to_string_lossy()).is_ok());
        let inside = base.join("Export").join("page.md");
        assert!(require(&inside.to_string_lossy()).is_err());
        assert!(require_within(&inside.to_string_lossy()).is_ok());
        assert!(require_within(&std::env::temp_dir().join("elsewhere").to_string_lossy()).is_err());
    }

    /// `..` under a granted folder does not reach outside it (R3-4).
    #[test]
    fn parent_steps_under_a_granted_folder_are_refused() {
        let base = std::env::temp_dir().join("opennote-grants-dots");
        grant(base.clone());
        let escape = base.join("..").join("..").join("secret.docx");
        assert!(require_within(&escape.to_string_lossy()).is_err());
        let verbatim = format!(r"\\?\{}\..\secret.docx", base.display());
        assert!(require_within(&verbatim).is_err());
        assert!(require_within(&base.join("page.md").to_string_lossy()).is_ok());
    }
}
