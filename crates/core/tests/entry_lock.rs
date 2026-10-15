//! Stamped entry locks through a real session (ADR 0041, A2-17): the lock is saved in `page.json` and reads back,
//! a locked page refuses every change but its unlock, and Undo can't take the page out of its lock by accident.

mod real_core;

use opennote_core::error::EditError;
use opennote_core::id::{BlockId, Id};
use opennote_core::model::ReadOnlyReason;
use opennote_core::ops::resolve::{Edit, NewBlock, TxnRequest};
use real_core::{page_json, Real};
use serde_json::json;

fn text(n: u128, markdown: &str) -> Edit {
    Edit::InsertBlock {
        block: NewBlock {
            id: BlockId(Id::from_parts(1_800_000_000_000, n)),
            type_name: "text".into(),
            frame: None,
            data: json!({ "markdown": markdown }).as_object().cloned().unwrap(),
            fallback: None,
        },
        after: None,
        before: None,
    }
}

fn view(patch: serde_json::Value) -> Edit {
    Edit::SetPage {
        title: None,
        tags: None,
        view: Some(patch),
    }
}

#[test]
fn a_locked_entry_is_stamped_saved_and_refuses_changes_until_unlocked() {
    let mut real = Real::new();
    let handle = real.open();
    handle
        .apply(real.request(vec![text(1, "Sample 4 weighed 2.31 g")]))
        .unwrap();
    handle
        .apply(real.request(vec![view(json!({ "entryLock": { "by": "Ada" } }))]))
        .unwrap();
    handle.save_now().unwrap();

    let page = page_json(&handle);
    let lock = &page["view"]["entryLock"];
    assert_eq!(lock["by"], "Ada");
    assert!(lock["hash"].as_str().unwrap().starts_with("sha256:"), "{lock}");
    assert!(lock["lockedAt"].as_str().is_some(), "{lock}");
    let on_disk = std::fs::read_to_string(
        real.notebook
            .path()
            .join(real.section.to_string())
            .join(real.page.to_string())
            .join("page.json"),
    )
    .unwrap();
    assert!(on_disk.contains("entryLock"), "the lock is in page.json");

    // A refused request doesn't use up its sequence number, so the next ones reuse it.
    let next = real.request(Vec::new());
    let with = |edits: Vec<Edit>| TxnRequest { edits, ..next.clone() };
    let refused = handle.apply(with(vec![text(2, "Changed later")]));
    assert!(
        matches!(refused, Err(EditError::ReadOnly(ReadOnlyReason::LockedEntry))),
        "{refused:?}"
    );
    let title = handle.apply(with(vec![Edit::SetPage {
        title: Some("Renamed".into()),
        tags: None,
        view: None,
    }]));
    assert!(title.is_err(), "the title is part of the entry");

    handle.apply(with(vec![view(json!({ "entryLock": null }))])).unwrap();
    assert!(page_json(&handle)["view"].get("entryLock").is_none());
    handle.apply(real.request(vec![text(2, "Changed later")])).unwrap();
}
