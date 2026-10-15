//! The Windows pickers for a source to import and a folder to export into.

use serde::Deserialize;

use crate::ipc::IpcResult;

/// What the person picks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PickKind {
    /// A file: an export from another app, a Word file, or a database.
    File,
    /// A folder: a vault, an export, or the place an export goes.
    Folder,
}

/// The file types the picker lists first, as one filter. The interop crate decides what each file really is.
#[cfg(windows)]
const SOURCE_TYPES: &str = concat!(
    "*.enex;*.docx;*.odt;*.xlsx;*.xlsm;*.pptx;*.eml;*.opennote;*.md;*.markdown;*.txt;",
    "*.html;*.htm;*.mht;*.mhtml;*.csv;*.tsv;*.zip;*.sqlite;*.one;*.onepkg"
);

/// Shows the picker and returns the chosen path, or `None` when the person cancels.
#[cfg(windows)]
pub fn pick(owner: isize, kind: PickKind, initial: Option<String>) -> IpcResult<Option<String>> {
    use std::path::Path;

    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::{
            Foundation::{ERROR_CANCELLED, HWND},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                Common::COMDLG_FILTERSPEC, FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
                FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
            },
        },
    };

    // SAFETY: COM is initialized for this thread and released before it returns, and every object below lives
    // within that span. The owner handle names the main window, or is null for none. The filter strings outlive
    // the dialog.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Option<String>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let options = dialog.GetOptions()? | FOS_FORCEFILESYSTEM;
            match kind {
                PickKind::Folder => dialog.SetOptions(options | FOS_PICKFOLDERS)?,
                PickKind::File => {
                    dialog.SetOptions(options)?;
                    let types = HSTRING::from(SOURCE_TYPES);
                    let filters = [
                        COMDLG_FILTERSPEC {
                            pszName: w!("Notes and documents"),
                            pszSpec: PCWSTR(types.as_ptr()),
                        },
                        COMDLG_FILTERSPEC {
                            pszName: w!("All files"),
                            pszSpec: w!("*.*"),
                        },
                    ];
                    dialog.SetFileTypes(&filters)?;
                }
            }
            if let Some(folder) = initial.filter(|folder| Path::new(folder).is_dir()) {
                if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(folder), None) {
                    dialog.SetFolder(&item)?;
                }
            }
            let parent = (owner != 0).then_some(HWND(owner as *mut _));
            if let Err(error) = dialog.Show(parent) {
                return if error.code() == ERROR_CANCELLED.to_hresult() {
                    Ok(None)
                } else {
                    Err(error)
                };
            }
            let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string().ok();
            CoTaskMemFree(Some(name.0.cast_const().cast()));
            Ok(path)
        })();
        if apartment.is_ok() {
            CoUninitialize();
        }
        Ok(result?)
    }
}

#[cfg(not(windows))]
pub fn pick(_owner: isize, _kind: PickKind, _initial: Option<String>) -> IpcResult<Option<String>> {
    Err(crate::ipc::IpcError::not_implemented("interop_pick"))
}
