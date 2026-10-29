//! The arguments of each method of the interface's search client.

use opennote_search::Query;
use serde::Deserialize;
use serde_json::Value;

use super::invalid;
use crate::ipc::IpcResult;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct QueryArgs {
    pub(super) text: String,
    pub(super) regex: bool,
    pub(super) filters: Query,
    pub(super) limit: Option<usize>,
    pub(super) offset: Option<usize>,
    pub(super) utc_offset_minutes: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SwitcherArgs {
    pub(super) query: String,
    #[serde(default)]
    pub(super) recent: Vec<String>,
    #[serde(default)]
    pub(super) current: Option<String>,
    #[serde(default)]
    pub(super) limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SuggestArgs {
    pub(super) prefix: String,
    #[serde(default)]
    pub(super) limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PageArgs {
    pub(super) page: String,
    #[serde(default)]
    pub(super) limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LinkArg {
    pub(super) title: String,
    #[serde(default)]
    pub(super) heading: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResolveArgs {
    #[serde(default)]
    pub(super) from: Option<String>,
    pub(super) links: Vec<LinkArg>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewArgs {
    #[serde(default)]
    pub(super) page: Option<String>,
    #[serde(default)]
    pub(super) title: Option<String>,
    #[serde(default)]
    pub(super) fragment: Option<String>,
    #[serde(default)]
    pub(super) from: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MentionArgs {
    pub(super) markdown: String,
    pub(super) title: String,
    #[serde(default)]
    pub(super) target: Option<String>,
    #[serde(default)]
    pub(super) which: Option<Vec<usize>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TagArgs {
    pub(super) from: String,
    #[serde(default)]
    pub(super) to: Option<String>,
}

pub(super) fn parse<T: for<'de> Deserialize<'de>>(args: &Value) -> IpcResult<T> {
    serde_json::from_value(args.clone()).map_err(|error| invalid("args", error))
}
