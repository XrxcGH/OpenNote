//! Opening things outside the app (ARCHITECTURE.md section 23). The interface names a target instead of passing
//! a URL or path. Rust maps each target through an allowlist: releases and issues under
//! `https://github.com/XrxcGH/OpenNote/`, Microsoft's WebView2 page, and the notes, logs, data, and app folders.
//! The shell work package adds the allowlist and opens the targets.

use serde::{Deserialize, Serialize};

use crate::ipc::{IpcError, IpcResult};

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

#[tauri::command]
pub fn shell_open_external(target: ExternalTarget) -> IpcResult<()> {
    let _ = target;
    Err(IpcError::not_implemented("shell_open_external"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_every_target_the_interface_sends() {
        let targets = [
            json!({ "kind": "releasePage", "version": "0.4.0" }),
            json!({ "kind": "newIssue", "template": "rollback" }),
            json!({ "kind": "webview2Download" }),
            json!({ "kind": "folder", "which": "logs" }),
        ];
        for target in targets {
            let parsed: ExternalTarget = serde_json::from_value(target.clone()).expect("parses");
            assert_eq!(serde_json::to_value(parsed).expect("serializes"), target);
        }
        assert!(serde_json::from_value::<ExternalTarget>(json!({ "kind": "url", "url": "https://x" })).is_err());
    }
}
