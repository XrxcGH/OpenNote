#![allow(clippy::unwrap_used)]

use serde_json::json;

use super::*;
use crate::testing::sample::sample_page;

fn set_view(view: Value) -> Edit {
    Edit::SetPage {
        title: None,
        tags: None,
        view: Some(view),
    }
}

fn locked(page: &Page) -> Page {
    let mut page = page.clone();
    page.view.extra.insert(
        KEY.into(),
        json!({"lockedAt": "2026-10-01T10:00:00Z", "by": "Ada", "hash": "sha256:00"}),
    );
    page
}

#[test]
fn a_locked_page_takes_only_its_unlock() {
    let page = locked(&sample_page());
    assert!(is_locked(&page));
    assert!(check(&page, &[set_view(json!({ KEY: null }))]).is_ok());
    for edits in [
        vec![set_view(json!({ KEY: null, "paper": "lined" }))],
        vec![Edit::SetPage {
            title: Some("New".into()),
            tags: None,
            view: None,
        }],
        vec![set_view(json!({ KEY: null })), set_view(json!({ KEY: null }))],
        vec![],
    ] {
        assert!(
            matches!(
                check(&page, &edits),
                Err(EditError::ReadOnly(ReadOnlyReason::LockedEntry))
            ),
            "{edits:?}"
        );
    }
    assert!(check(&sample_page(), &[]).is_ok(), "an unlocked page takes anything");
}

#[test]
fn the_core_stamps_the_time_and_the_content_hash() {
    let page = sample_page();
    let now = Timestamp::parse("2026-10-14T09:30:00Z").unwrap();
    let sent = [set_view(
        json!({ KEY: { "by": "Ada", "lockedAt": "1999-01-01T00:00:00Z", "hash": "forged" } }),
    )];
    let stamped = stamp(&page, &sent, now).unwrap();
    let Edit::SetPage { view: Some(view), .. } = &stamped[0] else {
        panic!("{stamped:?}")
    };
    let lock = &view[KEY];
    assert_eq!(lock["lockedAt"], "2026-10-14T09:30:00.000Z");
    assert_eq!(lock["by"], "Ada");
    assert_eq!(lock["hash"], content_hash(&page));
    assert!(stamp(&page, &[set_view(json!({ KEY: null }))], now).is_none());
}

#[test]
fn the_hash_follows_the_content() {
    let page = sample_page();
    let mut renamed = page.clone();
    renamed.title = "Another title".into();
    assert!(content_hash(&page).starts_with("sha256:"));
    assert_eq!(content_hash(&page), content_hash(&page.clone()));
    assert_ne!(content_hash(&page), content_hash(&renamed));
}
