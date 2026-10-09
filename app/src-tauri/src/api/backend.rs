//! The local API's view of the notes, over the same core the interface uses. Reads go through the notebooks'
//! trees and a page's saved state; changes go through a page session of the `api` client, as one transaction each,
//! then a save whose version in page history is named "Added via <app>" or "Changed via <app>". A page in an
//! encrypted (locked) section is never opened.

use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(test)]
use std::{path::PathBuf, sync::Arc};

use opennote_api::backend::{
    Backend, BackendError, Location, NewPage, NotebookInfo, PageInfo, PageText, SearchHit, SectionInfo,
};
use opennote_core::{
    model::notebook::NotebookTree,
    ops::resolve::{Edit, TxnRequest},
    session::page::PageHandle,
    store::assets::AssetSource,
    BlockId, SystemClock,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::markdown;
use crate::{
    core_bridge::{Bridge, CoreBridge},
    ipc::{IpcError, IpcResult},
};

/// The page client the API edits as. The interface's own clients are `main-<n>` and the tool windows'.
pub const API_CLIENT: &str = "api";

/// The section daily notes live in, as the interface names it (`qolSearch.daily.sectionTitle`).
pub const DAILY_SECTION: &str = "Daily notes";

/// Each transaction's sequence number, rising across sessions, and starts.
static SEQ: AtomicU64 = AtomicU64::new(0);

fn next_seq() -> u64 {
    let floor = crate::boot::now_epoch_ms() as u64;
    let mut current = SEQ.load(Ordering::SeqCst);
    loop {
        let next = current.max(floor) + 1;
        match SEQ.compare_exchange(current, next, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return next,
            Err(seen) => current = seen,
        }
    }
}

/// Where the core is: the app's, or a test's.
#[derive(Clone)]
pub enum Notes {
    App(AppHandle),
    #[cfg(test)]
    Test(Arc<CoreBridge>, PathBuf),
}

/// The notes behind the local API.
#[derive(Clone)]
pub struct CoreBackend {
    notes: Notes,
}

fn from_ipc(error: IpcError) -> BackendError {
    match error.code.as_str() {
        "notFound" => BackendError::NotFound,
        "readOnly" => BackendError::ReadOnly,
        "locked" => BackendError::Locked,
        _ => BackendError::Failed(error.message),
    }
}

impl CoreBackend {
    pub fn new(notes: Notes) -> CoreBackend {
        CoreBackend { notes }
    }

    fn run<T>(&self, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> Result<T, BackendError> {
        match &self.notes {
            Notes::App(app) => crate::core_bridge::run_notes(app, &app.state::<CoreBridge>(), work),
            #[cfg(test)]
            Notes::Test(bridge, folder) => bridge.notes(Some(folder.clone()), work),
        }
        .map_err(from_ipc)
    }

    /// A page's Markdown and its page JSON, for webhooks, which also need its tags and when it was made. The caller
    /// checks that the page isn't locked first.
    pub fn page_with_json(&self, page: &str) -> Result<(String, Value), BackendError> {
        let place = self.locate(page)?;
        if place.locked {
            return Err(BackendError::Locked);
        }
        let json = self.run(|bridge| with_page(bridge, page, page_json))?;
        Ok((markdown::page_markdown(&place.title, &json), json))
    }

    fn trees(bridge: &Bridge) -> Vec<NotebookTree> {
        bridge
            .core
            .notebooks()
            .into_iter()
            .filter(|notebook| !notebook.is_backup())
            .map(|notebook| notebook.tree())
            .collect()
    }
}

/// Where an ID is in the trees.
fn locate_in(trees: &[NotebookTree], id: &str) -> Option<Location> {
    for tree in trees {
        let notebook = tree.notebook.to_string();
        if notebook == id {
            return Some(Location {
                id: id.to_owned(),
                notebook_id: notebook,
                section_id: None,
                locked: false,
                title: tree.title.clone(),
            });
        }
        for section in &tree.sections {
            let section_id = section.id.to_string();
            if section_id == id {
                return Some(Location {
                    id: id.to_owned(),
                    notebook_id: notebook,
                    section_id: Some(section_id),
                    locked: section.encrypted,
                    title: section.title.clone(),
                });
            }
            if let Some(page) = section.pages.iter().find(|page| page.id.to_string() == id) {
                return Some(Location {
                    id: id.to_owned(),
                    notebook_id: notebook,
                    section_id: Some(section_id),
                    locked: section.encrypted,
                    title: page.title.clone(),
                });
            }
        }
    }
    None
}

fn page_info(location: &Location) -> PageInfo {
    PageInfo {
        id: location.id.clone(),
        notebook_id: location.notebook_id.clone(),
        section_id: location.section_id.clone().unwrap_or_default(),
        title: location.title.clone(),
        modified: None,
    }
}

/// The page JSON of an open session.
fn page_json(handle: &PageHandle) -> IpcResult<Value> {
    let envelope = handle
        .envelope(None)
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?;
    let decoded = opennote_core::wire::envelope::decode(&envelope.bytes)
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?;
    serde_json::from_slice(decoded.page_json)
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))
}

/// Runs `work` on the API's session of a page, and closes the session after.
fn with_page<T>(bridge: &mut Bridge, page: &str, work: impl FnOnce(&PageHandle) -> IpcResult<T>) -> IpcResult<T> {
    let handle = bridge.handle(page, API_CLIENT)?;
    let result = work(&handle);
    bridge.close_client(page, API_CLIENT);
    result
}

fn edit_error(error: opennote_core::EditError) -> IpcError {
    IpcError::new(error.code(), error.to_string())
}

/// Applies `edits` as one transaction, saves, and names the new version in page history.
fn apply_named(handle: &PageHandle, edits: Vec<Edit>, label: &str) -> IpcResult<()> {
    if let Some(reason) = handle.read_only() {
        return Err(IpcError::new("readOnly", format!("{reason:?}")));
    }
    let request = TxnRequest {
        page: handle.id(),
        client: handle.client().clone(),
        client_seq: next_seq(),
        coalesce: None,
        ui: None,
        edits,
    };
    handle.apply(request).map_err(edit_error)?;
    let saved = handle
        .save_now()
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?;
    if let Err(error) = handle.name_version(saved.revision, Some(label.to_owned()), false) {
        ::log::warn!("Couldn't name the API's version in page history: {error}");
    }
    Ok(())
}

fn new_block_id() -> String {
    BlockId::generate(&SystemClock::new()).to_string()
}

/// The edits that add `markdown` and `attachments` after `after`.
fn content_edits(handle: &PageHandle, page: &NewPage, after: Option<String>) -> IpcResult<Vec<Edit>> {
    let mut edits = Vec::new();
    let mut after = after;
    let mut text = page.markdown.clone();
    if let Some(url) = &page.source_url {
        // The address stays a plain link, so it can't run anything when clicked.
        text = format!(
            "Source: <{url}>

{text}"
        );
    }
    if !text.trim().is_empty() {
        let id = new_block_id();
        let mut insert =
            json!({ "edit": "insertBlock", "block": { "id": id, "type": "text", "data": { "markdown": text } } });
        if let Some(previous) = after.as_ref() {
            insert["after"] = json!(previous);
        }
        edits.push(insert);
        after = Some(id);
    }
    for attachment in &page.attachments {
        let image = matches!(
            attachment.mime.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        );
        let asset = handle
            .import_asset(AssetSource::bytes(
                attachment.name.clone(),
                attachment.mime.clone(),
                attachment.bytes.clone(),
            ))
            .map_err(|error| IpcError::new(crate::ipc::codes::IO, error.to_string()))?;
        let id = new_block_id();
        let width = asset.width.map_or(624.0, |width| f64::from(width).min(624.0));
        let block = if image {
            json!({ "id": id, "type": "image", "frame": { "w": width }, "data": { "asset": asset.id.to_string(), "alt": attachment.name } })
        } else {
            json!({ "id": id, "type": "file", "data": { "asset": asset.id.to_string() } })
        };
        edits.push(json!({ "edit": "addAsset", "asset": asset.id.to_string() }));
        let mut insert = json!({ "edit": "insertBlock", "block": block });
        if let Some(previous) = after.as_ref() {
            insert["after"] = json!(previous);
        }
        edits.push(insert);
        after = Some(id);
    }
    serde_json::from_value(Value::Array(edits))
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))
}

/// Today in local time, as the daily note's title `YYYY-MM-DD`.
pub fn local_today() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::{FILETIME, SYSTEMTIME},
            System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime},
        };
        let since = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        // FILETIME counts 100 ns ticks since 1601.
        let ticks = since.as_nanos() / 100 + 116_444_736_000_000_000;
        let ticks = u64::try_from(ticks).unwrap_or(0);
        let file_time = FILETIME {
            dwLowDateTime: (ticks & 0xffff_ffff) as u32,
            dwHighDateTime: (ticks >> 32) as u32,
        };
        let (mut utc, mut local) = (SYSTEMTIME::default(), SYSTEMTIME::default());
        // SAFETY: both structures are valid for the calls, which only write them.
        let ok = unsafe {
            FileTimeToSystemTime(&file_time, &mut utc).is_ok()
                && SystemTimeToTzSpecificLocalTime(None, &utc, &mut local).is_ok()
        };
        if ok {
            return format!("{:04}-{:02}-{:02}", local.wYear, local.wMonth, local.wDay);
        }
    }
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs() / 86_400)
        .unwrap_or(0);
    let (year, month, day) = civil(i64::try_from(days).unwrap_or(0));
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

impl Backend for CoreBackend {
    fn notebooks(&self) -> Result<Vec<NotebookInfo>, BackendError> {
        self.run(|bridge| {
            Ok(Self::trees(bridge)
                .into_iter()
                .map(|tree| NotebookInfo {
                    id: tree.notebook.to_string(),
                    title: tree.title,
                })
                .collect())
        })
    }

    fn sections(&self, notebook: &str) -> Result<Vec<SectionInfo>, BackendError> {
        let trees = self.run(|bridge| Ok(Self::trees(bridge)))?;
        let tree = trees
            .iter()
            .find(|tree| tree.notebook.to_string() == notebook)
            .ok_or(BackendError::NotFound)?;
        Ok(tree
            .sections
            .iter()
            .filter(|section| !section.archived)
            .map(|section| SectionInfo {
                id: section.id.to_string(),
                notebook_id: notebook.to_owned(),
                title: section.title.clone(),
                locked: section.encrypted,
            })
            .collect())
    }

    fn pages(&self, section: &str) -> Result<Vec<PageInfo>, BackendError> {
        let trees = self.run(|bridge| Ok(Self::trees(bridge)))?;
        for tree in &trees {
            if let Some(found) = tree.sections.iter().find(|each| each.id.to_string() == section) {
                if found.encrypted {
                    return Err(BackendError::Locked);
                }
                return Ok(found
                    .pages
                    .iter()
                    .map(|page| PageInfo {
                        id: page.id.to_string(),
                        notebook_id: tree.notebook.to_string(),
                        section_id: section.to_owned(),
                        title: page.title.clone(),
                        modified: None,
                    })
                    .collect());
            }
        }
        Err(BackendError::NotFound)
    }

    fn locate(&self, id: &str) -> Result<Location, BackendError> {
        let trees = self.run(|bridge| Ok(Self::trees(bridge)))?;
        locate_in(&trees, id).ok_or(BackendError::NotFound)
    }

    fn read_page(&self, page: &str) -> Result<PageText, BackendError> {
        let place = self.locate(page)?;
        if place.locked {
            return Err(BackendError::Locked);
        }
        if place.section_id.is_none() || place.notebook_id == place.id {
            return Err(BackendError::NotFound);
        }
        let json = self.run(|bridge| with_page(bridge, page, page_json))?;
        Ok(PageText {
            markdown: markdown::page_markdown(&place.title, &json),
            page: PageInfo {
                modified: json["modified"].as_str().map(str::to_owned),
                ..page_info(&place)
            },
        })
    }

    fn create_page(&self, section: &str, page: NewPage, author: &str) -> Result<PageInfo, BackendError> {
        let place = self.locate(section)?;
        if place.locked {
            return Err(BackendError::Locked);
        }
        if place.section_id.as_deref() != Some(section) || place.id != section {
            return Err(BackendError::Invalid("Pages go into a section.".into()));
        }
        let label = format!("Added via {author}");
        let id = self.run(|bridge| {
            let input =
                json!({ "kind": "page", "placement": { "parentId": section, "beforeId": null }, "title": page.title });
            let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
            let id = node["id"].as_str().unwrap_or_default().to_owned();
            with_page(bridge, &id, |handle| {
                let edits = content_edits(handle, &page, None)?;
                if edits.is_empty() {
                    let saved = handle
                        .save_now()
                        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?;
                    let _ = handle.name_version(saved.revision, Some(label.clone()), false);
                    return Ok(());
                }
                apply_named(handle, edits, &label)
            })?;
            Ok(id)
        })?;
        self.locate(&id).map(|place| page_info(&place))
    }

    fn append(&self, page: &str, markdown: &str, author: &str) -> Result<PageInfo, BackendError> {
        let place = self.locate(page)?;
        if place.locked {
            return Err(BackendError::Locked);
        }
        let label = format!("Changed via {author}");
        self.run(|bridge| {
            with_page(bridge, page, |handle| {
                let after = markdown::last_block(&page_json(handle)?);
                let content = NewPage {
                    markdown: markdown.to_owned(),
                    ..NewPage::default()
                };
                apply_named(handle, content_edits(handle, &content, after)?, &label)
            })
        })?;
        Ok(page_info(&place))
    }

    fn append_daily(&self, markdown: &str, author: &str) -> Result<PageInfo, BackendError> {
        let title = local_today();
        let page = self.run(|bridge| {
            let trees = Self::trees(bridge);
            let tree = trees.first().ok_or_else(|| IpcError::new("notFound", "There are no notebooks yet."))?;
            let section = match tree.sections.iter().find(|section| section.title == DAILY_SECTION) {
                Some(section) if section.encrypted => return Err(IpcError::new("locked", "The daily notes are locked.")),
                Some(section) => section.id.to_string(),
                None => {
                    let input = json!({
                        "kind": "section",
                        "placement": { "parentId": tree.notebook.to_string(), "beforeId": null },
                        "title": DAILY_SECTION,
                    });
                    let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                    node["id"].as_str().unwrap_or_default().to_owned()
                }
            };
            let existing = trees
                .iter()
                .flat_map(|tree| tree.sections.iter())
                .find(|each| each.id.to_string() == section)
                .and_then(|each| each.pages.iter().find(|page| page.title == title))
                .map(|page| page.id.to_string());
            match existing {
                Some(id) => Ok(id),
                None => {
                    let input = json!({ "kind": "page", "placement": { "parentId": section, "beforeId": null }, "title": title });
                    let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                    Ok(node["id"].as_str().unwrap_or_default().to_owned())
                }
            }
        });
        self.append(&page?, markdown, author)
    }

    fn daily_target(&self) -> Result<Location, BackendError> {
        let trees = self.run(|bridge| Ok(Self::trees(bridge)))?;
        let tree = trees.first().ok_or(BackendError::NotFound)?;
        let section = tree.sections.iter().find(|section| section.title == DAILY_SECTION);
        Ok(Location {
            id: section.map_or_else(|| tree.notebook.to_string(), |section| section.id.to_string()),
            notebook_id: tree.notebook.to_string(),
            section_id: section.map(|section| section.id.to_string()),
            locked: section.is_some_and(|section| section.encrypted),
            title: format!("{DAILY_SECTION}, {}", local_today()),
        })
    }

    fn search(&self, text: &str, limit: usize) -> Result<Vec<SearchHit>, BackendError> {
        #[allow(irrefutable_let_patterns)] // the test notes are a second kind in test builds only
        let Notes::App(app) = &self.notes
        else {
            return Ok(Vec::new());
        };
        let bridge = app.state::<CoreBridge>();
        let found = bridge
            .search_query(json!({ "text": text, "limit": limit.min(100) }))
            .map_err(from_ipc)?;
        let trees = self.run(|bridge| Ok(Self::trees(bridge)))?;
        let hits = found["hits"].as_array().cloned().unwrap_or_default();
        Ok(hits
            .iter()
            .filter_map(|hit| {
                let id = hit["page"].as_str()?;
                let place = locate_in(&trees, id)?;
                (!place.locked).then(|| SearchHit {
                    page: page_info(&place),
                    snippet: hit["snippet"]["text"]
                        .as_str()
                        .unwrap_or_default()
                        .chars()
                        .take(300)
                        .collect(),
                })
            })
            .collect())
    }

    fn backup(&self) -> Result<String, BackendError> {
        #[allow(irrefutable_let_patterns)] // the test notes are a second kind in test builds only
        let Notes::App(app) = &self.notes
        else {
            return Err(BackendError::Failed("Backups need the app.".into()));
        };
        let record = crate::shellqol::backup::run(app).map_err(from_ipc)?;
        if record["running"].as_bool() == Some(true) {
            return Err(BackendError::Invalid("A backup is already running.".into()));
        }
        if let Some(error) = record["error"].as_str() {
            return Err(BackendError::Failed(error.to_owned()));
        }
        Ok(format!(
            "Backed up {} notebooks to the backup folder in Settings.",
            record["notebooks"].as_u64().unwrap_or(0)
        ))
    }
}

#[cfg(test)]
#[path = "backend_tests.rs"]
mod tests;
