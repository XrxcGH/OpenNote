//! Storage administration over the core: how long history is kept (`settings.editing.history.keep`) and the
//! commands that delete history.

use std::sync::PoisonError;

use opennote_core::{
    session::notebook::{HistoryDeleted, HistoryScope, NotebookHandle},
    store::history::Retention,
    CoreError, PageId, SectionId,
};
use serde::Deserialize;
use tauri::State;

use super::{core_error, CoreBridge};
use crate::ipc::{IpcError, IpcResult};
use crate::settings::editing::HistoryKeep;

/// Which pages Delete history reaches, as the interface names them: `{ kind, id }`, where a notebook's `id` is the
/// notebook's own ID.
#[derive(Clone, Debug, Deserialize)]
pub struct ScopeArg {
    pub kind: String,
    pub id: String,
}

impl ScopeArg {
    /// The core's scope. Every ID is parsed, so nothing but an ID reaches the core.
    fn scope(&self) -> IpcResult<HistoryScope> {
        let bad = || IpcError::invalid("scope", "isn't a page, section, or notebook");
        match self.kind.as_str() {
            "page" => PageId::parse(&self.id).map(HistoryScope::Page).map_err(|_| bad()),
            "section" => SectionId::parse(&self.id).map(HistoryScope::Section).map_err(|_| bad()),
            "notebook" if !self.id.is_empty() && self.id.len() <= 64 => Ok(HistoryScope::Notebook),
            _ => Err(bad()),
        }
    }
}

/// The core's retention for the history setting (spec 13.3).
pub fn retention_for(keep: HistoryKeep) -> Retention {
    match keep {
        HistoryKeep::Month => Retention::Days30,
        HistoryKeep::Year => Retention::Year1,
        HistoryKeep::Forever => Retention::Forever,
    }
}

impl CoreBridge {
    /// Sets how long page versions are kept. The setting is held until the core starts, and reaches a started
    /// core at once. Versions are thinned to it page by page, when each page is tidied after it closes.
    pub fn set_retention(&self, keep: HistoryKeep) {
        let retention = retention_for(keep);
        *self.retention.lock().unwrap_or_else(PoisonError::into_inner) = retention;
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(bridge) = state.as_ref() {
            bridge.core.set_retention(retention);
        }
    }

    /// Forgets what search keeps beside the index for pages deleted for good: the words read from their pictures,
    /// handwriting, and recordings, which include transcripts.
    pub fn forget_pages(&self, pages: &[opennote_core::PageId]) {
        self.search.forget_pages(pages);
    }

    /// Delete history (A2-3, A4-12): deletes the saved versions of a page, a section, or a notebook. With
    /// `keep_named`, named versions and versions marked to keep stay. Pages' current content is untouched. A page or
    /// section is looked for in `notebook` first, then in the other open notebooks, since the interface may not know
    /// which notebook holds it.
    pub fn delete_history(&self, notebook: &str, scope: &ScopeArg, keep_named: bool) -> IpcResult<HistoryDeleted> {
        let parsed = scope.scope()?;
        let notebooks = self.notebooks();
        let named = |id: &str| notebooks.iter().find(|nb| nb.id().to_string() == id);
        if parsed == HistoryScope::Notebook {
            let target = named(&scope.id).ok_or_else(|| IpcError::new("notFound", "That notebook isn't open."))?;
            return target.delete_history(parsed, keep_named).map_err(core_error);
        }
        let mut order: Vec<&NotebookHandle> = named(notebook).into_iter().collect();
        order.extend(notebooks.iter().filter(|nb| nb.id().to_string() != notebook));
        for candidate in order {
            match candidate.delete_history(parsed, keep_named) {
                Err(CoreError::NotFound(_)) => continue,
                other => return other.map_err(core_error),
            }
        }
        Err(IpcError::new(
            "notFound",
            "That page or section isn't in an open notebook.",
        ))
    }

    /// How long page versions are kept, as the bridge holds it.
    pub fn retention(&self) -> Retention {
        *self.retention.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Delete history for a page, a section, or a notebook (`history_delete`).
#[tauri::command]
pub async fn history_delete(
    bridge: State<'_, CoreBridge>,
    notebook: String,
    scope: ScopeArg,
    keep_named: bool,
) -> IpcResult<HistoryDeleted> {
    bridge.delete_history(&notebook, &scope, keep_named)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core_bridge::edit_error;

    #[test]
    fn each_setting_maps_to_the_cores_retention() {
        assert_eq!(retention_for(HistoryKeep::Month), Retention::Days30);
        assert_eq!(retention_for(HistoryKeep::Year), Retention::Year1);
        assert_eq!(retention_for(HistoryKeep::Forever), Retention::Forever);
        assert_eq!(retention_for(HistoryKeep::default()), Retention::default());
    }

    #[test]
    fn the_setting_reaches_the_core_before_and_after_it_starts() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let bridge = CoreBridge::at(dir.path().join("local"));
        bridge.set_retention(HistoryKeep::Month);
        let started = bridge
            .with(|bridge| Ok(bridge.core.retention()))
            .expect("the core starts");
        assert_eq!(
            started,
            Retention::Days30,
            "a setting made before start-up is applied when the core starts"
        );
        bridge.set_retention(HistoryKeep::Forever);
        let changed = bridge
            .with(|bridge| Ok(bridge.core.retention()))
            .expect("the core runs");
        assert_eq!(changed, Retention::Forever, "a change reaches the running core");
        bridge.shutdown();
    }

    /// A notebook, a section, and a page made through the notes commands, with two saved versions of the page,
    /// the first one named. Returns the notebook, section, and page IDs.
    fn a_page_with_versions(bridge: &CoreBridge, notes: &std::path::Path) -> (String, String, String) {
        use opennote_core::ops::resolve::{Edit, NewBlock, TxnRequest};
        use serde_json::json;
        bridge
            .notes(Some(notes.to_path_buf()), |bridge| {
                let mut create = |kind: &str, parent: Option<String>| {
                    let input = json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null } });
                    let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                    Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
                };
                let notebook = create("notebook", None)?;
                let section = create("section", Some(notebook.clone()))?;
                let page = create("page", Some(section.clone()))?;
                let handle = bridge.handle(&page, "main-1")?;
                for (seq, id) in [(1_u64, "01k6f00000000000000000b001"), (2, "01k6f00000000000000000b002")] {
                    let block: NewBlock = serde_json::from_value(json!({
                        "id": id, "type": "text", "data": { "markdown": format!("Version {seq}") }
                    }))
                    .map_err(|e| IpcError::new("io", e.to_string()))?;
                    let request = TxnRequest {
                        page: handle.id(),
                        client: handle.client().clone(),
                        client_seq: seq,
                        coalesce: None,
                        ui: None,
                        edits: vec![Edit::InsertBlock {
                            block,
                            after: None,
                            before: None,
                        }],
                    };
                    handle.apply(request).map_err(edit_error)?;
                    if seq == 1 {
                        let saved = handle.save_now().map_err(core_error)?;
                        handle
                            .name_version(saved.revision, Some("Named".into()), false)
                            .map_err(core_error)?;
                    }
                }
                // Closing the page saves the second edit as an unnamed version.
                let client = handle.client().clone();
                handle.close(&client).map_err(core_error)?;
                Ok((notebook, section, page))
            })
            .expect("a page with versions")
    }

    fn versions(bridge: &CoreBridge, page: &str) -> Vec<Option<String>> {
        bridge
            .with(|bridge| {
                let handle = bridge.open_handle(page, "main-1")?;
                Ok(handle
                    .history()
                    .map_err(core_error)?
                    .into_iter()
                    .map(|v| v.name)
                    .collect())
            })
            .expect("the history")
    }

    #[test]
    fn delete_history_keeps_named_versions_when_asked_and_checks_its_scope() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let notes = dir.path().join("Notes");
        let bridge = CoreBridge::at(dir.path().join("local"));
        let (notebook, section, page) = a_page_with_versions(&bridge, &notes);
        assert_eq!(versions(&bridge, &page).len(), 2, "two saved versions");

        let scope = |kind: &str, id: &str| ScopeArg {
            kind: kind.into(),
            id: id.into(),
        };
        // The page is found even when the interface names no notebook.
        let deleted = bridge.delete_history("", &scope("page", &page), true).expect("deletes");
        assert_eq!((deleted.pages, deleted.versions), (1, 1));
        assert_eq!(
            versions(&bridge, &page),
            [Some("Named".to_owned())],
            "the named version stays"
        );

        let deleted = bridge
            .delete_history(&notebook, &scope("section", &section), false)
            .expect("deletes");
        assert_eq!(deleted.versions, 1);
        assert!(versions(&bridge, &page).is_empty(), "nothing is left");
        assert!(bridge
            .delete_history(&notebook, &scope("notebook", &notebook), true)
            .is_ok());

        for bad in [scope("page", "..\\x"), scope("folder", &page), scope("notebook", "")] {
            assert!(bridge.delete_history(&notebook, &bad, true).is_err(), "{bad:?}");
        }
        assert_eq!(
            bridge
                .delete_history(&notebook, &scope("notebook", "01k6f00000000000000000n999"), true)
                .unwrap_err()
                .code,
            "notFound"
        );
        bridge.shutdown();
    }
}
