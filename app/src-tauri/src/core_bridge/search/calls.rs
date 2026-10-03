//! The methods of the interface's search client, one function each, and the match that picks one by name.

use std::time::Duration;

use opennote_core::{NotebookId, PageId};
use opennote_search::{
    mentions, pattern, syntax, IndexerHandle, PlaceList, Query, SearchError, SearchIndex, SearchLimits, SwitchContext,
    TextMode,
};
use serde::Serialize;
use serde_json::{json, Value};

use super::args::{
    parse, MentionArgs, PageArgs, PreviewArgs, QueryArgs, ResolveArgs, SuggestArgs, SwitcherArgs, TagArgs,
};
use super::events::now;
use super::{internal, invalid, lock, lock_index, search_error, Hub};
use crate::ipc::IpcResult;

fn to_value<T: Serialize>(value: &T) -> IpcResult<Value> {
    serde_json::to_value(value).map_err(internal)
}

impl Hub {
    /// Runs the method `method` on the index.
    pub(super) fn dispatch(
        &self,
        handle: &IndexerHandle,
        notebooks: &[NotebookId],
        method: &str,
        args: &Value,
    ) -> IpcResult<Value> {
        let shared = handle.index();
        let index = || lock_index(&shared);
        match method {
            "query" => self.query(handle, notebooks, args),
            "switcher" => self.switch(&index(), args),
            "suggestPages" => suggest(&index(), args),
            "headings" => self.on_page(args, |page, _| index().headings(page)),
            "backlinks" => self.on_page(args, |page, _| index().backlinks(page)),
            "outgoing" => self.on_page(args, |page, _| index().outgoing_links(page)),
            "repairEdits" => self.on_page(args, |page, _| index().repair_edits(page)),
            "unlinkedMentions" => self.on_page(args, |page, a| index().unlinked_mentions(page, a.limit.unwrap_or(50))),
            "resolve" => self.resolve(&index(), args),
            "linkPreview" => self.link_preview(&index(), args),
            "findMentions" => find_mentions(args),
            "linkMentions" => self.link_mentions(args),
            "tagTree" => to_value(&index().tag_tree().map_err(search_error)?),
            "planTagRename" | "planTagDelete" => plan_tag(&index(), method, args),
            "titleSettled" => self.settle(handle, args),
            "rebuild" => rebuild(handle, notebooks),
            "status" => status(handle, &index()),
            "flush" => Ok(json!(handle.flush(Duration::from_secs(20)))),
            other => Err(invalid("method", format!("unknown search method {other}"))),
        }
    }

    /// Runs a read that takes one page.
    fn on_page<T: Serialize>(
        &self,
        args: &Value,
        read: impl FnOnce(PageId, &PageArgs) -> Result<T, SearchError>,
    ) -> IpcResult<Value> {
        let request: PageArgs = parse(args)?;
        let page = self.core_page(&request.page)?;
        to_value(&read(page, &request).map_err(search_error)?)
    }

    /// The names of the open notebooks and their sections, for the `in:` operator.
    fn places(&self, notebooks: &[NotebookId]) -> PlaceList {
        let mut places = PlaceList::new();
        for notebook in notebooks.iter().filter_map(|id| self.slot.notebook(*id)) {
            let tree = notebook.tree();
            places.notebook(&tree.title, tree.notebook);
            for section in &tree.sections {
                places.section(&section.title, section.id);
            }
        }
        places
    }

    fn switch(&self, index: &SearchIndex, args: &Value) -> IpcResult<Value> {
        let request: SwitcherArgs = parse(args)?;
        let mut switcher = lock(&self.switcher);
        switcher.refresh(index).map_err(search_error)?;
        let context = SwitchContext {
            recent: request.recent.iter().filter_map(|ui| self.core_page(ui).ok()).collect(),
            current: request.current.as_deref().and_then(|ui| self.core_page(ui).ok()),
            scope: None,
            limit: request.limit.unwrap_or(0),
        };
        to_value(&switcher.find(&request.query, &context))
    }

    fn resolve(&self, index: &SearchIndex, args: &Value) -> IpcResult<Value> {
        let request: ResolveArgs = parse(args)?;
        let from = request.from.as_deref().and_then(|ui| self.core_page(ui).ok());
        let mut out = Vec::new();
        for link in &request.links {
            let found = index.resolve_title(&link.title, link.heading.as_deref(), from);
            out.push(found.map_err(search_error)?);
        }
        to_value(&out)
    }

    fn link_preview(&self, index: &SearchIndex, args: &Value) -> IpcResult<Value> {
        let request: PreviewArgs = parse(args)?;
        let fragment = request.fragment.as_deref();
        let page = match (&request.page, &request.title) {
            (Some(ui), _) => Some(self.core_page(ui)?),
            (None, Some(title)) => {
                let from = request.from.as_deref().and_then(|ui| self.core_page(ui).ok());
                let resolved = index.resolve_title(title, fragment, from).map_err(search_error)?;
                resolved.first().map(|target| target.page)
            }
            (None, None) => None,
        };
        let preview = match page {
            Some(page) => index.link_preview(page, fragment).map_err(search_error)?,
            None => None,
        };
        to_value(&preview)
    }

    fn link_mentions(&self, args: &Value) -> IpcResult<Value> {
        let request: MentionArgs = parse(args)?;
        let target = self.core_page(request.target.as_deref().unwrap_or_default())?;
        let linked = mentions::link_mentions(&request.markdown, &request.title, target, request.which.as_deref());
        Ok(match linked {
            Some(linked) => json!({ "markdown": linked.markdown, "count": linked.linked.len() }),
            None => Value::Null,
        })
    }

    fn settle(&self, handle: &IndexerHandle, args: &Value) -> IpcResult<Value> {
        let request: PageArgs = parse(args)?;
        handle.title_settled(self.core_page(&request.page)?);
        Ok(Value::Null)
    }

    /// Reads the search box as the person typed it, and runs it. A pattern that is not valid comes back as a
    /// message for the line under the box, and a typed operator that can't be used as a note.
    pub(super) fn query(&self, handle: &IndexerHandle, notebooks: &[NotebookId], args: &Value) -> IpcResult<Value> {
        let request: QueryArgs = parse(args)?;
        let (mut query, notes) = match typed_query(&request, &self.places(notebooks)) {
            Ok(typed) => typed,
            Err(message) => return Ok(json!({ "hits": [], "complete": true, "notes": [], "patternError": message })),
        };
        let filters = request.filters;
        query.tags.extend(filters.tags);
        query.block_types.extend(filters.block_types);
        if filters.date.is_some() {
            query.date = filters.date;
        }
        query.title_only |= filters.title_only;
        query.limit = request.limit.unwrap_or(20).min(100);
        query.offset = request.offset.unwrap_or(0);
        let results = handle
            .search_within(&query, &SearchLimits::default())
            .map_err(search_error)?;
        Ok(json!({
            "hits": to_value(&results.hits)?,
            "complete": results.complete,
            "notes": notes,
        }))
    }
}

/// The query for the text of the box, and a note for each typed operator it could not use. A regular expression
/// that is not valid is the error.
fn typed_query(request: &QueryArgs, places: &PlaceList) -> Result<(Query, Vec<Value>), String> {
    if request.regex || request.filters.mode == TextMode::Regex {
        pattern::check(&request.text)?;
        return Ok((Query::regex(request.text.clone()), Vec::new()));
    }
    let context = syntax::SyntaxContext {
        now: now(),
        utc_offset_minutes: request.utc_offset_minutes,
        places,
    };
    let typed = syntax::parse(&request.text, &context);
    let notes = typed
        .notes
        .iter()
        .map(|note| json!({ "message": note.message() }))
        .collect();
    Ok((typed.query, notes))
}

fn suggest(index: &SearchIndex, args: &Value) -> IpcResult<Value> {
    let request: SuggestArgs = parse(args)?;
    let found = index.suggest_pages(&request.prefix, request.limit.unwrap_or(8));
    to_value(&found.map_err(search_error)?)
}

fn find_mentions(args: &Value) -> IpcResult<Value> {
    let request: MentionArgs = parse(args)?;
    to_value(&mentions::find_mentions(&request.markdown, &request.title))
}

fn plan_tag(index: &SearchIndex, method: &str, args: &Value) -> IpcResult<Value> {
    let request: TagArgs = parse(args)?;
    let plan = if method == "planTagDelete" {
        index.plan_tag_delete(&request.from)
    } else {
        index.plan_tag_rename(&request.from, request.to.as_deref().unwrap_or_default())
    };
    to_value(&plan.map_err(search_error)?)
}

fn rebuild(handle: &IndexerHandle, notebooks: &[NotebookId]) -> IpcResult<Value> {
    handle.rebuild(notebooks.to_vec());
    Ok(Value::Null)
}

fn status(handle: &IndexerHandle, index: &SearchIndex) -> IpcResult<Value> {
    let stats = handle.stats();
    let pages = index.page_count().map_err(search_error)?;
    Ok(json!({ "pages": pages, "failures": handle.failures().len(), "rebuilds": stats.rebuilds }))
}
