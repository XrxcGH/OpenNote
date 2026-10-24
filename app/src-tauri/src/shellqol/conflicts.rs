//! Copies that sync tools and other devices made of an open page. The core keeps the other version aside and says
//! so with a conflict event; these calls list the open conflicts, give both versions as text for a side-by-side
//! view, and resolve one by keeping this version, the other, or both as separate pages.

use opennote_core::{session::page::ConflictChoice, PageId, RevisionId};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{arg, out};
use crate::{
    core_bridge::{core_error, page_handle},
    ipc::{IpcError, IpcResult},
};

pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    let page: String = arg(args, "pageId")?;
    let id = PageId::parse(&page).map_err(|error| IpcError::invalid("pageId", &error.to_string()))?;
    let handle = page_handle(app, id).ok_or_else(|| IpcError::new("notFound", "That page isn't open."))?;
    match name {
        "conflict.list" => out(handle.conflicts().map_err(core_error)?),
        "conflict.text" => {
            let revision: String = arg(args, "revision")?;
            let revision =
                RevisionId::parse(&revision).map_err(|error| IpcError::invalid("revision", &error.to_string()))?;
            Ok(json!({
                "mine": handle.text(),
                "theirs": handle.conflict_text(revision).map_err(core_error)?,
            }))
        }
        "conflict.resolve" => {
            let revision: String = arg(args, "revision")?;
            let revision =
                RevisionId::parse(&revision).map_err(|error| IpcError::invalid("revision", &error.to_string()))?;
            let choice: ConflictChoice = arg(args, "choice")?;
            handle.resolve_conflict(revision, choice).map_err(core_error)?;
            Ok(json!({ "ok": true }))
        }
        _ => Err(IpcError::invalid("name", "isn't a conflict call")),
    }
}
