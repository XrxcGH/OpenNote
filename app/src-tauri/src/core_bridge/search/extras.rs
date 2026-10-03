//! The search methods added in Beta 4: the link a launch carried, tagged lines, page facts for collections, the
//! link graph, and the text read from images and handwriting. They are methods of the same `search_call` command,
//! so the command list stays as it was.

use opennote_core::NotebookId;
use opennote_search::IndexerHandle;
use serde_json::{json, Value};

use super::{invalid, Hub};
use crate::ipc::IpcResult;

impl Hub {
    /// Runs a method that only Beta 4 added, or says the method is not known.
    pub(super) fn extra(
        &self,
        _handle: &IndexerHandle,
        _notebooks: &[NotebookId],
        method: &str,
        _args: &Value,
    ) -> IpcResult<Value> {
        match method {
            "launchLink" => Ok(json!(crate::deeplink::take_launch())),
            other => Err(invalid("method", format!("unknown search method {other}"))),
        }
    }
}
