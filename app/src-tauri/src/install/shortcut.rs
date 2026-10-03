//! The Start menu shortcut: a `.lnk` file with the app user model ID set, created through `IShellLinkW`.

use std::path::Path;

#[cfg(windows)]
use super::APP_USER_MODEL_ID;

/// Creates the Start menu shortcut to `target`, with the app user model ID set.
#[cfg(windows)]
pub fn create_shortcut(shortcut: &Path, target: &Path) -> windows::core::Result<()> {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

    if let Some(parent) = shortcut.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // SAFETY: COM is initialized for this call and released after it, and every object lives within that span.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = write_link(shortcut, target);
        if apartment.is_ok() {
            CoUninitialize();
        }
        result
    }
}

/// Builds the link object, sets its path, working folder, and identifier, and saves it.
///
/// # Safety
/// COM must be initialized on the calling thread.
#[cfg(windows)]
unsafe fn write_link(shortcut: &Path, target: &Path) -> windows::core::Result<()> {
    use windows::{
        core::{Interface, HSTRING},
        Win32::{
            System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER},
            UI::Shell::{IShellLinkW, PropertiesSystem::IPropertyStore, ShellLink},
        },
    };

    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
    link.SetPath(&HSTRING::from(target.as_os_str()))?;
    if let Some(dir) = target.parent() {
        link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()))?;
    }
    link.SetDescription(&HSTRING::from("OpenNote"))?;
    set_app_user_model_id(&link.cast::<IPropertyStore>()?)?;
    link.cast::<IPersistFile>()?
        .Save(&HSTRING::from(shortcut.as_os_str()), true)
}

/// Stores `PKEY_AppUserModel_ID` in the link's property store, as a `VT_LPWSTR` value.
///
/// # Safety
/// COM must be initialized on the calling thread.
#[cfg(windows)]
unsafe fn set_app_user_model_id(
    store: &windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore,
) -> windows::core::Result<()> {
    use std::mem::ManuallyDrop;

    use windows::{
        core::{Error, GUID, PWSTR},
        Win32::{
            Foundation::{E_OUTOFMEMORY, PROPERTYKEY},
            System::{
                Com::{
                    CoTaskMemAlloc,
                    StructuredStorage::{
                        PropVariantClear, PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
                    },
                },
                Variant::VT_LPWSTR,
            },
        },
    };

    // PKEY_AppUserModel_ID: {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 5.
    const KEY: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3),
        pid: 5,
    };
    // The identifier in memory that PropVariantClear frees.
    let wide: Vec<u16> = APP_USER_MODEL_ID.encode_utf16().chain(Some(0)).collect();
    let text = CoTaskMemAlloc(wide.len() * 2).cast::<u16>();
    if text.is_null() {
        return Err(Error::from(E_OUTOFMEMORY));
    }
    std::ptr::copy_nonoverlapping(wide.as_ptr(), text, wide.len());
    let mut value = PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_LPWSTR,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 { pwszVal: PWSTR(text) },
            }),
        },
    };
    let stored = store.SetValue(&KEY, &value).and_then(|()| store.Commit());
    let _ = PropVariantClear(&mut value);
    stored
}

#[cfg(not(windows))]
pub fn create_shortcut(_shortcut: &Path, _target: &Path) -> Result<(), std::io::Error> {
    Err(std::io::Error::other("Shortcuts need Windows."))
}
