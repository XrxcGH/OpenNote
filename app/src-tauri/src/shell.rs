//! Opening things outside the app (ARCHITECTURE.md section 23). The interface names a target instead of passing
//! a URL or path. Rust maps each target through an allowlist: releases and issues under
//! `https://github.com/XrxcGH/OpenNote/`, Microsoft's WebView2 page, the notes, logs, data, and app folders, and
//! links in notes (http, https, and mailto only).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{State, Url};

use crate::{
    ipc::{IpcError, IpcResult},
    paths::{is_local_path, Paths},
    settings::SettingsStore,
    window::webview::DOWNLOAD_PAGE,
};

/// The project's home on GitHub.
const REPOSITORY: &str = "https://github.com/XrxcGH/OpenNote";

/// The longest link Rust opens, in characters.
pub const MAX_LINK_CHARS: usize = 2048;

/// Something to open, matching the interface's `ExternalTarget`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum ExternalTarget {
    /// A release's page on GitHub.
    ReleasePage { version: String },
    /// A new GitHub issue from a template.
    NewIssue {
        #[cfg_attr(test, ts(inline))]
        template: IssueTemplate,
    },
    /// Microsoft's WebView2 Runtime download page.
    Webview2Download,
    /// One of the app's folders in File Explorer.
    Folder {
        #[cfg_attr(test, ts(inline))]
        which: AppFolder,
    },
    /// A link from a note, which opens in the default browser or mail app.
    Link { url: String },
    /// A page of Windows Settings, for voice and language. Only these two pages open.
    WindowsSettings {
        #[cfg_attr(test, ts(inline))]
        page: SettingsPage,
    },
}

/// The Windows Settings pages the app may open, each mapped to a fixed `ms-settings:` address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum SettingsPage {
    Speech,
    Language,
}

impl SettingsPage {
    /// The page's `ms-settings:` address.
    pub const fn uri(self) -> &'static str {
        match self {
            Self::Speech => "ms-settings:speech",
            Self::Language => "ms-settings:regionlanguage",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum IssueTemplate {
    Bug,
    Rollback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum AppFolder {
    Notes,
    Logs,
    Data,
    App,
}

/// What a target resolves to: a web address or mail link, or a folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolved {
    Url(String),
    Folder(PathBuf),
}

/// Whether a release version is a plain semantic version, so it can't smuggle anything into the address.
fn is_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

/// Checks a link from a note: http, https, or mailto, at most 2,048 characters, with no user name or password.
pub fn check_link(text: &str) -> IpcResult<String> {
    let invalid = |message: &str| IpcError::invalid("url", message);
    if text.chars().count() > MAX_LINK_CHARS {
        return Err(invalid("The link is longer than 2,048 characters."));
    }
    let url = Url::parse(text).map_err(|_| invalid("The link isn't a valid address."))?;
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return Err(invalid("OpenNote opens only http, https, and mailto links."));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("The link has a user name or password in it."));
    }
    if url.scheme() != "mailto" && url.host_str().is_none_or(str::is_empty) {
        return Err(invalid("The link has no site in it."));
    }
    Ok(url.into())
}

/// Maps a target through the allowlist. `notes` is where the notes folder is, and `app_exe_dir` the exe's folder.
pub fn resolve(
    target: &ExternalTarget,
    paths: &Paths,
    notes_folder: Option<&str>,
    app_exe_dir: PathBuf,
) -> IpcResult<Resolved> {
    Ok(match target {
        ExternalTarget::ReleasePage { version } => {
            if !is_version(version) {
                return Err(IpcError::invalid("version", "That isn't a version number."));
            }
            Resolved::Url(format!("{REPOSITORY}/releases/tag/v{version}"))
        }
        ExternalTarget::NewIssue { template } => Resolved::Url(match template {
            IssueTemplate::Bug => format!("{REPOSITORY}/issues/new?template=bug_report.yml"),
            IssueTemplate::Rollback => format!("{REPOSITORY}/issues/new?template=bug_report.yml&labels=rollback"),
        }),
        ExternalTarget::Webview2Download => Resolved::Url(DOWNLOAD_PAGE.to_owned()),
        ExternalTarget::Folder { which } => Resolved::Folder(match which {
            AppFolder::Notes => match notes_folder {
                Some(folder) if !is_local_path(Path::new(folder)) => {
                    return Err(IpcError::invalid(
                        "storage.notesFolder",
                        "The notes folder isn't a full path to a folder on this PC.",
                    ));
                }
                Some(folder) => PathBuf::from(folder),
                None => paths.documents.join("OpenNote"),
            },
            AppFolder::Logs => paths.logs.clone(),
            AppFolder::Data => paths.local.clone(),
            AppFolder::App => app_exe_dir,
        }),
        ExternalTarget::Link { url } => Resolved::Url(check_link(url)?),
        ExternalTarget::WindowsSettings { page } => Resolved::Url(page.uri().to_owned()),
    })
}

/// Opens an address or a folder with Windows' default handler.
#[cfg(windows)]
pub(crate) fn open(target: &str) -> IpcResult<()> {
    use windows::{
        core::{w, HSTRING},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };

    // SAFETY: the strings are NUL-terminated and outlive the call.
    let result = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(target), None, None, SW_SHOWNORMAL) };
    // ShellExecute reports success with a value above 32.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(IpcError::new(crate::ipc::codes::IO, "Windows couldn't open that."))
    }
}

#[cfg(not(windows))]
pub(crate) fn open(_target: &str) -> IpcResult<()> {
    Err(IpcError::not_implemented("shell_open_external"))
}

#[tauri::command]
pub fn shell_open_external(
    paths: State<'_, Paths>,
    settings: State<'_, SettingsStore>,
    target: ExternalTarget,
) -> IpcResult<()> {
    let exe = std::env::current_exe()?;
    let exe_dir = exe.parent().map(PathBuf::from).unwrap_or_default();
    let notes = settings.get().storage.notes_folder;
    match resolve(&target, &paths, notes.as_deref(), exe_dir)? {
        Resolved::Url(url) => open(&url),
        Resolved::Folder(folder) => {
            if !folder.is_dir() {
                // The app's own folders are made on demand. A notes folder that isn't there is left for setup or
                // the person to make, so this never writes to a path the settings name.
                if matches!(
                    target,
                    ExternalTarget::Folder {
                        which: AppFolder::Notes
                    }
                ) {
                    return Err(IpcError::new(crate::ipc::codes::IO, "The notes folder doesn't exist."));
                }
                std::fs::create_dir_all(&folder)?;
            }
            open(&folder.to_string_lossy())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::json;

    use super::*;

    fn paths() -> Paths {
        Paths::under_profile(Path::new("C:\\profile"))
    }

    fn resolve_url(target: ExternalTarget) -> IpcResult<Resolved> {
        resolve(&target, &paths(), None, PathBuf::from("C:\\Apps\\OpenNote"))
    }

    #[test]
    fn reads_every_target_the_interface_sends() {
        let targets = [
            json!({ "kind": "releasePage", "version": "0.4.0" }),
            json!({ "kind": "newIssue", "template": "rollback" }),
            json!({ "kind": "webview2Download" }),
            json!({ "kind": "folder", "which": "logs" }),
            json!({ "kind": "link", "url": "https://example.com/a" }),
            json!({ "kind": "windowsSettings", "page": "speech" }),
            json!({ "kind": "windowsSettings", "page": "language" }),
        ];
        for target in targets {
            let parsed: ExternalTarget = serde_json::from_value(target.clone()).expect("parses");
            assert_eq!(serde_json::to_value(parsed).expect("serializes"), target);
        }
        assert!(serde_json::from_value::<ExternalTarget>(json!({ "kind": "run", "command": "calc" })).is_err());
    }

    #[test]
    fn maps_fixed_targets_to_the_projects_own_pages() {
        assert_eq!(
            resolve_url(ExternalTarget::ReleasePage {
                version: "0.4.0-beta.1".into()
            }),
            Ok(Resolved::Url(
                "https://github.com/XrxcGH/OpenNote/releases/tag/v0.4.0-beta.1".into()
            ))
        );
        assert_eq!(
            resolve_url(ExternalTarget::NewIssue {
                template: IssueTemplate::Bug
            }),
            Ok(Resolved::Url(
                "https://github.com/XrxcGH/OpenNote/issues/new?template=bug_report.yml".into()
            ))
        );
        assert!(resolve_url(ExternalTarget::ReleasePage {
            version: "1/../../evil".into()
        })
        .is_err());
        assert!(resolve_url(ExternalTarget::ReleasePage { version: String::new() }).is_err());
    }

    #[test]
    fn opens_the_two_windows_settings_pages_and_no_others() {
        let page = |page| resolve_url(ExternalTarget::WindowsSettings { page });
        assert_eq!(
            page(SettingsPage::Speech),
            Ok(Resolved::Url("ms-settings:speech".into()))
        );
        assert_eq!(
            page(SettingsPage::Language),
            Ok(Resolved::Url("ms-settings:regionlanguage".into()))
        );
        // The interface names a page, never an address, so nothing else can be asked for.
        for bad in [
            json!({ "kind": "windowsSettings", "page": "privacy-microphone" }),
            json!({ "kind": "windowsSettings", "page": "ms-settings:about" }),
            json!({ "kind": "windowsSettings", "url": "ms-settings:about" }),
            json!({ "kind": "windowsSettings" }),
        ] {
            assert!(serde_json::from_value::<ExternalTarget>(bad.clone()).is_err(), "{bad}");
        }
        // And a link can't smuggle one in.
        assert!(check_link("ms-settings:speech").is_err());
    }

    #[test]
    fn maps_folders_to_the_apps_own_places() {
        let folder = |which| resolve_url(ExternalTarget::Folder { which });
        assert_eq!(folder(AppFolder::Logs), Ok(Resolved::Folder(paths().logs)));
        assert_eq!(
            folder(AppFolder::App),
            Ok(Resolved::Folder(PathBuf::from("C:\\Apps\\OpenNote")))
        );
        assert_eq!(
            folder(AppFolder::Notes),
            Ok(Resolved::Folder(paths().documents.join("OpenNote")))
        );
        let chosen = resolve(
            &ExternalTarget::Folder {
                which: AppFolder::Notes,
            },
            &paths(),
            Some("D:\\Notes"),
            PathBuf::new(),
        );
        assert_eq!(chosen, Ok(Resolved::Folder(PathBuf::from("D:\\Notes"))));
    }

    #[test]
    fn will_not_open_a_network_path_as_the_notes_folder() {
        let open_notes = |folder: &str| {
            resolve(
                &ExternalTarget::Folder {
                    which: AppFolder::Notes,
                },
                &paths(),
                Some(folder),
                PathBuf::new(),
            )
        };
        for bad in [
            r"\\attacker.example\share",
            r"\\?\C:\Notes",
            r"\\.\pipe\x",
            "//host/share",
            "Notes",
        ] {
            assert!(open_notes(bad).is_err(), "{bad}");
        }
        assert!(open_notes(r"D:\Notes").is_ok());
    }

    #[test]
    fn opens_web_and_mail_links_only() {
        for good in [
            "https://example.com/page?a=1#top",
            "http://example.com",
            "mailto:ada@example.com?subject=Hi",
        ] {
            assert!(check_link(good).is_ok(), "{good}");
        }
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "ms-settings:privacy-microphone",
            "C:\\Windows\\notepad.exe",
            "https://user:secret@example.com/",
            "https://user@example.com/",
            "not a link",
            "",
        ] {
            assert!(check_link(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_link_may_have_at_most_2048_characters() {
        let long = |extra: usize| format!("https://example.com/{}", "a".repeat(extra));
        assert!(check_link(&long(2048 - "https://example.com/".len())).is_ok());
        assert!(check_link(&long(2048)).is_err());
    }
}
