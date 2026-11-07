//! Runtime packs for the code studio (ADR 0070). The packs are full Python (Pyodide), the C and C++ compiler
//! (YoWASP Clang), Ruby, and each Pyodide package. A pack downloads only after the person saw its size and agreed.
//! The model downloader does the work, with its rules. It resumes, caps at the exact size, checks the SHA-256, and
//! refuses while Work offline or safe mode is on. Verified pack files reach the studio's workers through the
//! read-only `opennote-pack` scheme. WebView2 reaches it as `http://opennote-pack.localhost/<pack>/<file>`. The
//! CSP's `connect-src` names it.

use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use tauri::{Builder, Manager, State, Wry};

use crate::intel::models::{DownloadError, HttpSource, ModelView, Models, Source, Specs};
use crate::ipc::{codes, IpcError, IpcResult};

pub mod catalog;
#[cfg(test)]
mod catalog_tests;
pub mod serve;
#[cfg(test)]
mod tests;

pub const SCHEME: &str = "opennote-pack";

/// The sentences a refused download carries. The help and the interface use the same words.
pub const OFFLINE_MESSAGE: &str = "Work offline is on. Turn it off to download this pack.";
pub const SAFE_MODE_MESSAGE: &str = "Safe mode is on. Restart OpenNote normally to download this pack.";

/// Where a pack stands, in the shape of `PackState` in `features/codestudio/contracts/packs.ts`.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PackState {
    Absent,
    Partial {
        #[serde(rename = "receivedBytes")]
        received_bytes: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: u64,
    },
    Downloading {
        #[serde(rename = "receivedBytes")]
        received_bytes: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: u64,
    },
    Ready {
        bytes: u64,
    },
    Failed {
        reason: &'static str,
    },
    Blocked {
        reason: &'static str,
    },
}

/// One pack as the download dialog shows it, in the shape of `PackInfo`.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub detail: &'static str,
    pub version: &'static str,
    pub bytes: u64,
    pub license: &'static str,
    pub depends: &'static [&'static str],
    pub state: PackState,
}

/// The list: the core packs, and each Pyodide package with bytes on disk. `blocked` says why nothing may download.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackList {
    pub packs: Vec<PackInfo>,
    pub blocked: Option<&'static str>,
}

/// Why no download may start now: safe mode first, then Work offline.
fn blocked(offline: bool, safe_mode: bool) -> Option<DownloadError> {
    if safe_mode {
        Some(DownloadError::SafeMode)
    } else if offline {
        Some(DownloadError::Offline)
    } else {
        None
    }
}

fn blocked_reason(error: &DownloadError) -> &'static str {
    match error {
        DownloadError::SafeMode => "safe-mode",
        _ => "offline",
    }
}

/// The error the interface gets. The code picks its words; the message is for logs and tests.
pub fn pack_error(error: &DownloadError) -> IpcError {
    match error {
        DownloadError::Offline => IpcError::new(error.code(), OFFLINE_MESSAGE),
        DownloadError::SafeMode => IpcError::new(error.code(), SAFE_MODE_MESSAGE),
        DownloadError::Disk(message) => IpcError::new(codes::IO, message.clone()),
        other => IpcError::new(other.code(), format!("{other:?}")),
    }
}

fn state_of(view: &ModelView, blocked: Option<&DownloadError>) -> PackState {
    let total = view.size_bytes;
    match view.state {
        "installed" => PackState::Ready { bytes: total },
        "downloading" => PackState::Downloading {
            received_bytes: view.bytes,
            total_bytes: total,
        },
        _ if blocked.is_some() => PackState::Blocked {
            reason: blocked.map_or("offline", blocked_reason),
        },
        "failed" => PackState::Failed {
            reason: view.error.unwrap_or("network"),
        },
        "partial" => PackState::Partial {
            received_bytes: view.bytes,
            total_bytes: total,
        },
        _ => PackState::Absent,
    }
}

/// The packs of this device.
#[derive(Clone)]
pub struct Packs {
    downloads: Models,
    catalog: catalog::Catalog,
}

impl Packs {
    /// The packs live in this device's folder, beside the models.
    pub fn new(paths: &crate::paths::Paths) -> Packs {
        Packs::at(
            paths.local.join("packs"),
            Arc::new(HttpSource::allowing(catalog::HOSTS)),
        )
    }

    pub fn at(dir: PathBuf, source: Arc<dyn Source>) -> Packs {
        Packs::with_catalog(dir, source, catalog::all)
    }

    /// Packs from another list than the app's, for tests.
    pub fn with_catalog(dir: PathBuf, source: Arc<dyn Source>, list: catalog::Catalog) -> Packs {
        let specs: Specs = Arc::new(move || Box::new(list().map(|pack| pack.spec)));
        Packs {
            downloads: Models::with_specs(dir, source, specs),
            catalog: list,
        }
    }

    fn find(&self, id: &str) -> Option<&'static catalog::Pack> {
        catalog::find(self.catalog, id)
    }

    /// The answer of the `opennote-pack` scheme to one request.
    pub fn serve(&self, method: &tauri::http::Method, path: &str) -> tauri::http::Response<Vec<u8>> {
        serve::answer(self.dir(), self.catalog, method, path)
    }

    pub fn dir(&self) -> &std::path::Path {
        self.downloads.dir()
    }

    pub fn list(&self, offline: bool, safe_mode: bool) -> PackList {
        let stop = blocked(offline, safe_mode);
        let views = self.downloads.list().models;
        let packs = views
            .iter()
            .filter_map(|view| {
                let pack = self.find(view.id)?;
                (pack.always_listed || view.state != "notInstalled").then(|| PackInfo {
                    id: pack.spec.id,
                    name: pack.spec.name,
                    detail: pack.spec.detail,
                    version: pack.version,
                    bytes: view.size_bytes,
                    license: pack.license,
                    depends: pack.depends,
                    state: state_of(view, stop.as_ref()),
                })
            })
            .collect();
        PackList {
            packs,
            blocked: stop.as_ref().map(blocked_reason),
        }
    }

    /// Starts or resumes a download. Work offline and safe mode refuse it before any byte moves.
    pub fn download(&self, id: &str, offline: bool, safe_mode: bool) -> Result<(), IpcError> {
        if self.find(id).is_none() {
            return Err(IpcError::invalid("pack", "There is no pack with that name."));
        }
        self.downloads
            .start(id, blocked(offline, safe_mode))
            .map_err(|error| pack_error(&error))
    }

    pub fn cancel(&self, id: &str) {
        self.downloads.cancel(id);
    }

    /// Deletes a pack and any part of it. It waits for a running download to stop.
    pub fn remove(&self, id: &str) -> Result<(), IpcError> {
        if self.find(id).is_none() {
            return Err(IpcError::invalid("pack", "There is no pack with that name."));
        }
        self.downloads.remove(id).map_err(|error| pack_error(&error))
    }
}

/// Registers the scheme. It only reads, and serves only verified catalog files from the packs folder.
pub fn register(builder: Builder<Wry>) -> Builder<Wry> {
    builder.register_asynchronous_uri_scheme_protocol(SCHEME, |context, request, responder| {
        let packs = context
            .app_handle()
            .try_state::<Packs>()
            .map(|packs| packs.inner().clone());
        let method = request.method().clone();
        let path = request.uri().path().to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let response = match packs {
                Some(packs) => packs.serve(&method, &path),
                None => serve::refuse(tauri::http::StatusCode::NOT_FOUND),
            };
            responder.respond(response);
        });
    })
}

/// The packs this device has, with their sizes, and why nothing may download now.
#[tauri::command]
pub fn packs_list(packs: State<'_, Packs>) -> IpcResult<PackList> {
    Ok(packs.list(crate::hardening::offline(), crate::hardening::safe_mode()))
}

/// Starts or resumes a pack download. The interface asked the person first, with the size.
#[tauri::command]
pub fn packs_download(packs: State<'_, Packs>, pack: String) -> IpcResult<()> {
    packs.download(&pack, crate::hardening::offline(), crate::hardening::safe_mode())
}

/// Stops a running download and keeps what arrived, so the next download resumes.
#[tauri::command]
pub fn packs_cancel(packs: State<'_, Packs>, pack: String) -> IpcResult<()> {
    packs.cancel(&pack);
    Ok(())
}

/// Removes a downloaded pack. It may wait for a download to stop, so it runs off the main thread.
#[tauri::command]
pub async fn packs_remove(packs: State<'_, Packs>, pack: String) -> IpcResult<()> {
    let packs = packs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || packs.remove(&pack))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
}
