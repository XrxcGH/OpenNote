//! For the end-to-end builds only (the `test-endpoints` feature, which release builds never have: build.rs compiles
//! a marker into them and `check-release-exe.ts` refuses an exe that holds it). Windows draws the file and folder
//! pickers in a window that a WebDriver session cannot reach, so a spec that must choose a path starts the app with
//! the answer in its environment, and the picker commands return it without showing a window:
//!
//! - `OPENNOTE_TEST_PICK_FOLDER=<folder>` answers every folder picker.
//! - `OPENNOTE_TEST_PICK_FILE=<file>` answers every file picker.
//!
//! The commands treat the answer as the person's choice, so the path is granted to the import and export commands
//! exactly as a path from the real picker is. Nothing is read from the page: a script in the interface cannot name
//! a path, only the process that started the app can.

use crate::interop::pick::PickKind;

const FOLDER: &str = "OPENNOTE_TEST_PICK_FOLDER";
const FILE: &str = "OPENNOTE_TEST_PICK_FILE";

/// The answer for a picker of this kind, or `None` to show the real picker.
pub fn answer(kind: PickKind) -> Option<String> {
    answer_from(kind, |name| std::env::var(name).ok())
}

fn answer_from(kind: PickKind, lookup: impl Fn(&str) -> Option<String>) -> Option<String> {
    let name = match kind {
        PickKind::Folder => FOLDER,
        PickKind::File => FILE,
    };
    lookup(name).filter(|path| !path.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(name: &str) -> Option<String> {
        match name {
            FOLDER => Some(r"C:\Out".to_owned()),
            FILE => Some(String::new()),
            _ => None,
        }
    }

    #[test]
    fn a_folder_picker_takes_the_folder_answer() {
        assert_eq!(answer_from(PickKind::Folder, env).as_deref(), Some(r"C:\Out"));
    }

    #[test]
    fn an_empty_answer_leaves_the_real_picker() {
        assert_eq!(answer_from(PickKind::File, env), None);
        assert_eq!(answer_from(PickKind::Folder, |_| None), None);
    }
}
