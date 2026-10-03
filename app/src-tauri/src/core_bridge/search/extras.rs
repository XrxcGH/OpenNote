//! The search methods added in Beta 4. They answer for the link a launch carried, for page facts (collections, the
//! calendar, and the graph filters), for tagged lines, and for the link graph. They are methods of the same
//! `search_call` command, so the command list stays as it was. Reading a page file here never opens a page
//! session, so it cannot disturb a page being edited, and a page in an encrypted section is never read.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::limits::{Limits, Timings};
use opennote_core::model::{BlockData, Page};
use opennote_core::seams::Codec;
use opennote_core::session::page::read_page_dir;
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::std_fs::StdFs;
use opennote_core::{BlockId, NotebookId, PageId, SectionId};
use opennote_search::sync::Job;
use opennote_search::{IndexerHandle, MediaKind, PageFact, Scope};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{internal, invalid, lock_index, search_error, Hub};
use crate::ipc::IpcResult;

/// The most tagged blocks one request returns.
const MAX_TAGGED: usize = 4000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopeArgs {
    scope: Scope,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotebookArgs {
    notebook: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FindArgs {
    needle: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaArgs {
    page: String,
    block: Option<String>,
    kind: Option<MediaKind>,
    text: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeighborArgs {
    page: String,
    depth: Option<u8>,
}

/// A text block that carries line tags or an open checkbox.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaggedBlock {
    page: PageId,
    title: String,
    notebook: NotebookId,
    section: SectionId,
    modified: i64,
    block: String,
    markdown: String,
    ids: Vec<String>,
    tags: BTreeMap<String, Vec<String>>,
    checked: Vec<String>,
}

fn args<T: for<'de> Deserialize<'de>>(value: &Value) -> IpcResult<T> {
    serde_json::from_value(value.clone()).map_err(|error| invalid("args", error))
}

fn notebook_of(args: &NotebookArgs) -> IpcResult<Option<NotebookId>> {
    args.notebook
        .as_deref()
        .map(|text| NotebookId::parse(text).map_err(|error| invalid("notebook", error)))
        .transpose()
}

/// Reads page files of open notebooks that are not encrypted.
struct PageReader<'a> {
    hub: &'a Hub,
    fs: Arc<dyn Fs>,
    codec: Arc<dyn Codec>,
    limits: Limits,
    /// The encrypted sections of each notebook already looked at, or `None` for a notebook that can't be read.
    locked: BTreeMap<NotebookId, Option<HashSet<SectionId>>>,
}

impl<'a> PageReader<'a> {
    fn new(hub: &'a Hub) -> Self {
        PageReader {
            hub,
            fs: Arc::new(StdFs::new(&Timings::default())),
            codec: Arc::new(CanonicalCodec),
            limits: Limits::default(),
            locked: BTreeMap::new(),
        }
    }

    fn read(&mut self, notebook: NotebookId, section: SectionId, page: PageId) -> Option<Page> {
        let handle = self.hub.slot.notebook(notebook)?;
        let locked = self.locked.entry(notebook).or_insert_with(|| {
            (!handle.is_backup()).then(|| {
                let tree = handle.tree();
                tree.sections.iter().filter(|s| s.encrypted).map(|s| s.id).collect()
            })
        });
        if locked.as_ref()?.contains(&section) {
            return None;
        }
        let dir = NotebookLayout::new(handle.path()).page_dir(section, page);
        read_page_dir(self.fs.as_ref(), self.codec.as_ref(), &dir, &self.limits)
            .ok()
            .map(|loaded| loaded.page)
    }
}

/// Whether Markdown has an unchecked task item.
fn has_open_box(markdown: &str) -> bool {
    markdown.lines().any(|line| {
        let line = line.trim_start();
        let rest = line
            .strip_prefix("- ")
            .or_else(|| line.strip_prefix("* "))
            .or_else(|| line.strip_prefix("+ "))
            .or_else(|| {
                let digits = line.trim_start_matches(|c: char| c.is_ascii_digit());
                digits.strip_prefix(". ").or_else(|| digits.strip_prefix(") "))
            });
        rest.is_some_and(|rest| rest.starts_with("[ ]"))
    })
}

impl Hub {
    /// Runs a method that only Beta 4 added, or says the method is not known.
    pub(super) fn extra(
        &self,
        handle: &IndexerHandle,
        _notebooks: &[NotebookId],
        method: &str,
        value: &Value,
    ) -> IpcResult<Value> {
        let shared = handle.index();
        match method {
            "launchLink" => Ok(json!(crate::deeplink::take_launch())),
            "pageFacts" => {
                let request: NotebookArgs = args(value).unwrap_or_default();
                let facts = lock_index(&shared)
                    .page_facts(notebook_of(&request)?)
                    .map_err(search_error)?;
                self.facts_json(facts)
            }
            "taggedBlocks" => {
                let request: ScopeArgs = args(value)?;
                let candidates = lock_index(&shared).tag_candidates(request.scope).map_err(search_error)?;
                Ok(self.tagged_blocks(&candidates))
            }
            "setMediaText" => {
                let request: MediaArgs = args(value)?;
                let page = self.core_page(&request.page)?;
                let (Some(block), Some(kind)) = (request.block.as_deref(), request.kind) else {
                    return Err(invalid("args", "setMediaText needs a block and a kind"));
                };
                let block = BlockId::parse(block).map_err(|error| invalid("block", error))?;
                // A page the index does not hold is locked, deleted, or unknown, so nothing of it is kept.
                let held = lock_index(&shared).indexed_page(page).map_err(search_error)?.is_some();
                let changed = held
                    && self
                        .media
                        .set(page, block, kind, request.text.as_deref().unwrap_or_default());
                if changed {
                    handle.submit(Job::Reload { page, notebook: None });
                }
                Ok(json!(changed))
            }
            "mediaBlocks" => {
                let request: MediaArgs = args(value)?;
                let page = self.core_page(&request.page)?;
                let blocks: Vec<Value> = self
                    .media
                    .blocks(page)
                    .into_iter()
                    .map(|(block, kind)| json!({ "block": block, "kind": kind }))
                    .collect();
                Ok(Value::Array(blocks))
            }
            "findText" => {
                let request: FindArgs = args(value)?;
                if request.needle.trim().is_empty() {
                    return Ok(json!([]));
                }
                let limit = request.limit.unwrap_or(2000).min(5000);
                let hits = lock_index(&shared)
                    .blocks_containing(&request.needle, limit)
                    .map_err(search_error)?;
                serde_json::to_value(hits).map_err(internal)
            }
            "graph" => {
                let request: NotebookArgs = args(value).unwrap_or_default();
                let graph = lock_index(&shared)
                    .link_graph(notebook_of(&request)?)
                    .map_err(search_error)?;
                Ok(json!({
                    "pages": graph.pages(),
                    "edges": graph.edges(),
                    "orphans": graph.orphans().iter().map(|page| page.page).collect::<Vec<_>>(),
                    "broken": graph.broken().len(),
                }))
            }
            "neighbors" | "connections" => {
                let request: NeighborArgs = args(value)?;
                let page = self.core_page(&request.page)?;
                let graph = lock_index(&shared).link_graph(None).map_err(search_error)?;
                if method == "connections" {
                    serde_json::to_value(graph.connections(page)).map_err(internal)
                } else {
                    let depth = request.depth.unwrap_or(1).clamp(1, opennote_search::linkgraph::MAX_DEPTH);
                    serde_json::to_value(graph.neighbors(page, depth)).map_err(internal)
                }
            }
            other => Err(invalid("method", format!("unknown search method {other}"))),
        }
    }

    /// The facts as JSON, with the properties of the pages that have them read from their files.
    fn facts_json(&self, facts: Vec<PageFact>) -> IpcResult<Value> {
        let mut reader = PageReader::new(self);
        let mut out = Vec::with_capacity(facts.len());
        for fact in facts {
            let properties = if fact.has_properties {
                reader
                    .read(fact.notebook, fact.section, fact.page)
                    .and_then(|page| page.view.extra.get("properties").cloned())
            } else {
                None
            };
            let mut row = serde_json::to_value(&fact).map_err(internal)?;
            if let (Some(map), Some(properties)) = (row.as_object_mut(), properties) {
                map.insert("properties".into(), properties);
            }
            out.push(row);
        }
        Ok(Value::Array(out))
    }

    /// The text blocks of the candidate pages that carry line tags or an open checkbox.
    fn tagged_blocks(&self, candidates: &[PageFact]) -> Value {
        let mut reader = PageReader::new(self);
        let mut out: Vec<TaggedBlock> = Vec::new();
        'pages: for fact in candidates {
            let Some(page) = reader.read(fact.notebook, fact.section, fact.page) else {
                continue;
            };
            for id in page.reading_order() {
                let Some(block) = page.blocks.get(id) else { continue };
                let BlockData::Text(data) = &block.data else { continue };
                let tagged = data.tags.values().any(|tags| !tags.is_empty());
                if !tagged && !has_open_box(&data.markdown) {
                    continue;
                }
                out.push(TaggedBlock {
                    page: fact.page,
                    title: fact.title.clone(),
                    notebook: fact.notebook,
                    section: fact.section,
                    modified: fact.modified,
                    block: block.id.to_string(),
                    markdown: data.markdown.to_string(),
                    ids: data.ids.iter().map(ToString::to_string).collect(),
                    tags: data
                        .tags
                        .iter()
                        .filter(|(_, tags)| !tags.is_empty())
                        .map(|(id, tags)| (id.to_string(), tags.clone()))
                        .collect(),
                    checked: data.checked.iter().map(ToString::to_string).collect(),
                });
                if out.len() >= MAX_TAGGED {
                    break 'pages;
                }
            }
        }
        json!(out)
    }
}

#[cfg(test)]
mod tests {
    use super::has_open_box;

    #[test]
    fn finds_unchecked_task_items() {
        assert!(has_open_box("Intro\n\n- [ ] buy milk\n- [x] done"));
        assert!(has_open_box("1. [ ] first"));
        assert!(!has_open_box("- [x] done\n- plain"));
        assert!(!has_open_box("a [ ] in the middle"));
    }
}
