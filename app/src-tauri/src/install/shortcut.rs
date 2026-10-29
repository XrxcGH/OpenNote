//! The Start menu shortcut: a `.lnk` file with the app user model ID set, created through `IShellLinkW`.

use std::path::Path;

#[cfg(windows)]
use super::APP_USER_MODEL_ID;

/// Creates the Start menu shortcut to `target`, with the app user model ID set.
#[cfg(windows)]
pub fn create_shortcut(shortcut: &Path, target: &Path) -> windows::core::Result<()> {
    create_link(shortcut, target, None, "OpenNote")
}

/// Creates a shortcut to `target` that passes `arguments`, such as an `opennote://` link, with the app user model
/// ID set so a pinned copy groups with the running window on the taskbar.
#[cfg(windows)]
pub fn create_link(
    shortcut: &Path,
    target: &Path,
    arguments: Option<&str>,
    description: &str,
) -> windows::core::Result<()> {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

    if let Some(parent) = shortcut.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // SAFETY: COM is initialized for this call and released after it, and every object lives within that span.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = write_link(shortcut, target, arguments, description);
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
unsafe fn write_link(
    shortcut: &Path,
    target: &Path,
    arguments: Option<&str>,
    description: &str,
) -> windows::core::Result<()> {
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
    if let Some(arguments) = arguments {
        link.SetArguments(&HSTRING::from(arguments))?;
    }
    link.SetIconLocation(&HSTRING::from(target.as_os_str()), 0)?;
    link.SetDescription(&HSTRING::from(description))?;
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
    use windows::{core::GUID, Win32::Foundation::PROPERTYKEY};

    // PKEY_AppUserModel_ID: {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 5.
    const KEY: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3),
        pid: 5,
    };
    set_string_property(store, &KEY, APP_USER_MODEL_ID)
}

/// Stores a text value in a property store, as a `VT_LPWSTR` value.
///
/// # Safety
/// COM must be initialized on the calling thread.
#[cfg(windows)]
unsafe fn set_string_property(
    store: &windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore,
    key: &windows::Win32::Foundation::PROPERTYKEY,
    value_text: &str,
) -> windows::core::Result<()> {
    use std::mem::ManuallyDrop;

    use windows::{
        core::{Error, PWSTR},
        Win32::{
            Foundation::E_OUTOFMEMORY,
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

    // The text in memory that PropVariantClear frees.
    let wide: Vec<u16> = value_text.encode_utf16().chain(Some(0)).collect();
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
    let stored = store.SetValue(key, &value).and_then(|()| store.Commit());
    let _ = PropVariantClear(&mut value);
    stored
}

/// Sets the taskbar jump list: "New quick note" as a task, and the recent pages (title and `opennote://` link) as
/// a category.
#[cfg(windows)]
pub fn set_jump_list(exe: &Path, recent: &[(String, String)]) -> windows::core::Result<()> {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

    // SAFETY: COM is initialized for this call and released after it, and every object lives within that span.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = write_jump_list(exe, recent);
        if apartment.is_ok() {
            CoUninitialize();
        }
        result
    }
}

/// A link for a jump list entry: the program with arguments, and a title.
///
/// # Safety
/// COM must be initialized on the calling thread.
#[cfg(windows)]
unsafe fn entry_link(
    exe: &Path,
    arguments: &str,
    title: &str,
) -> windows::core::Result<windows::Win32::UI::Shell::IShellLinkW> {
    use windows::{
        core::{Interface, GUID, HSTRING},
        Win32::{
            Foundation::PROPERTYKEY,
            System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
            UI::Shell::{IShellLinkW, PropertiesSystem::IPropertyStore, ShellLink},
        },
    };

    // PKEY_Title: {F29F85E0-4FF9-1068-AB91-08002B27B3D9}, 2.
    const TITLE: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xF29F85E0_4FF9_1068_AB91_08002B27B3D9),
        pid: 2,
    };
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
    link.SetPath(&HSTRING::from(exe.as_os_str()))?;
    link.SetArguments(&HSTRING::from(arguments))?;
    link.SetIconLocation(&HSTRING::from(exe.as_os_str()), 0)?;
    link.SetDescription(&HSTRING::from(title))?;
    set_string_property(&link.cast::<IPropertyStore>()?, &TITLE, title)?;
    Ok(link)
}

/// # Safety
/// COM must be initialized on the calling thread.
#[cfg(windows)]
unsafe fn write_jump_list(exe: &Path, recent: &[(String, String)]) -> windows::core::Result<()> {
    use windows::{
        core::{Interface, HSTRING},
        Win32::{
            System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
            UI::Shell::{
                Common::{IObjectArray, IObjectCollection},
                DestinationList, EnumerableObjectCollection, ICustomDestinationList,
            },
        },
    };

    let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
    list.SetAppID(&HSTRING::from(APP_USER_MODEL_ID))?;
    let mut slots = 0u32;
    let _removed: IObjectArray = list.BeginList(&mut slots)?;
    if !recent.is_empty() {
        let pages: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
        for (title, link) in recent.iter().take(slots.max(1) as usize) {
            pages.AddObject(&entry_link(exe, link, title)?)?;
        }
        list.AppendCategory(&HSTRING::from("Recent pages"), &pages.cast::<IObjectArray>()?)?;
    }
    let tasks: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
    tasks.AddObject(&entry_link(exe, "--quick-note", "New quick note")?)?;
    list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
    list.CommitList()
}

#[cfg(not(windows))]
pub fn create_link(
    _shortcut: &Path,
    _target: &Path,
    _arguments: Option<&str>,
    _description: &str,
) -> Result<(), std::io::Error> {
    Err(std::io::Error::other("Shortcuts need Windows."))
}

#[cfg(not(windows))]
pub fn set_jump_list(_exe: &Path, _recent: &[(String, String)]) -> Result<(), std::io::Error> {
    Err(std::io::Error::other("Jump lists need Windows."))
}

#[cfg(not(windows))]
pub fn create_shortcut(_shortcut: &Path, _target: &Path) -> Result<(), std::io::Error> {
    Err(std::io::Error::other("Shortcuts need Windows."))
}
