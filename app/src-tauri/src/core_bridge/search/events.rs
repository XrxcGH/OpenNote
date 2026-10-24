//! What the indexer tells the window.

use std::time::{SystemTime, UNIX_EPOCH};

use opennote_core::{PageId, Timestamp};
use opennote_search::{IndexEvent, IndexUpdate};
use serde_json::{json, Value};

use super::{Relay, UPDATED_EVENT};

/// The current time, for words such as `today` in a typed search.
pub(super) fn now() -> Timestamp {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0);
    Timestamp::from_unix_ms(ms)
}

/// Tells the interface what the indexer did.
pub(super) fn announce(relay: &Relay, event: IndexEvent) {
    let Some(emit) = relay.emit.get() else {
        return;
    };
    let payload = match event {
        IndexEvent::Updated(update) => update_payload(&update),
        IndexEvent::Rebuilt => json!({ "rebuilt": true }),
        IndexEvent::Failed { page, message } => json!({ "failed": { "page": page.to_string(), "message": message } }),
        IndexEvent::Damaged { message } => json!({ "damaged": message }),
        IndexEvent::CaughtUp => return,
    };
    emit(UPDATED_EVENT, payload);
}

fn update_payload(update: &IndexUpdate) -> Value {
    let pages = |list: &[PageId]| list.iter().map(ToString::to_string).collect::<Vec<_>>();
    let renames: Vec<Value> = update
        .renames
        .iter()
        .map(|plan| {
            json!({
                "page": plan.rename.page.to_string(),
                "oldTitle": plan.rename.old_title,
                "newTitle": plan.rename.new_title,
                "edits": serde_json::to_value(&plan.edits).unwrap_or(Value::Null),
                "otherPages": pages(&plan.other_pages()),
            })
        })
        .collect();
    json!({
        "generation": update.generation,
        "added": pages(&update.added),
        "updated": pages(&update.updated),
        "removed": pages(&update.removed),
        "renames": renames,
    })
}
