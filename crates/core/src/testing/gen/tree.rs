//! Generated tree, Trash, and history files.

use super::*;
use crate::id::{GroupId, NotebookId, SectionId, TrashItemId};
use crate::model::{
    FormatInfo, Group, Moving, NotebookFile, NotebookStyles, PageEntry, SectionFile, StyleSpec, TrashItemFile,
    TrashKind, TrashOrigin, TrashReason, VersionEntry, VersionReason, VersionsFile, STYLE_NAMES,
};

fn arb_device() -> impl Strategy<Value = DeviceRef> {
    (arb_id(), arb_text(12)).prop_map(|(id, label)| DeviceRef {
        id: DeviceId(id),
        label,
    })
}

fn arb_defaults(unknown: bool) -> BoxedStrategy<Option<JsonMap>> {
    proptest::option::of(arb_extra(unknown).prop_map(|mut m| {
        m.insert("view".into(), serde_json::json!({"mode": "paginated"}));
        m
    }))
    .boxed()
}

/// The named styles of a notebook: some of the names of version 1, and unknown names when `unknown` is set.
pub fn arb_styles(unknown: bool) -> impl Strategy<Value = NotebookStyles> {
    let name = if unknown {
        prop_oneof![
            proptest::sample::select(&STYLE_NAMES[..]).prop_map(str::to_owned),
            "zz[a-z]{1,4}"
        ]
        .boxed()
    } else {
        proptest::sample::select(&STYLE_NAMES[..])
            .prop_map(str::to_owned)
            .boxed()
    };
    let spec = (
        (
            proptest::option::of(arb_text(12)),
            proptest::option::of(arb_size()),
            proptest::option::of(arb_color()),
        ),
        (
            proptest::option::of(arb_size()),
            proptest::option::of(arb_size()),
            proptest::option::of((50i64..=500).prop_map(|n| n as f64 / 100.0)),
        ),
        arb_extra(unknown),
    )
        .prop_map(
            |((font, size, color), (space_before, space_after, line_height), extra)| StyleSpec {
                font,
                size,
                color,
                space_before,
                space_after,
                line_height,
                extra,
            },
        );
    proptest::collection::btree_map(name, spec, 0..4)
}

/// A section group with a unique ID. Its parent, when set, is an earlier group.
fn arb_groups(unknown: bool) -> impl Strategy<Value = Vec<Group>> {
    let group = (
        arb_text(12),
        proptest::option::of(arb_color()),
        any::<prop::sample::Index>(),
        any::<bool>(),
    );
    let fields = (
        group,
        arb_order_key(),
        arb_timestamp(),
        arb_timestamp(),
        arb_extra(unknown),
    );
    vec(fields, 0..4).prop_map(|items| {
        let ids: Vec<GroupId> = (0..items.len()).map(|i| GroupId(unique_id(6, i, 0))).collect();
        items
            .into_iter()
            .enumerate()
            .map(
                |(i, ((title, color, parent, nested), order, created, changed, extra))| Group {
                    id: ids[i],
                    title,
                    color,
                    parent: (nested && i > 0).then(|| ids[parent.index(i)]),
                    order,
                    created,
                    changed,
                    extra,
                },
            )
            .collect()
    })
}

/// A `notebook.json`.
pub fn arb_notebook_file(unknown: bool) -> impl Strategy<Value = NotebookFile> {
    let head = (
        arb_id(),
        arb_text(20),
        proptest::option::of(arb_color()),
        arb_timestamp(),
        arb_timestamp(),
    );
    (
        head,
        arb_defaults(unknown),
        arb_styles(unknown),
        arb_groups(unknown),
        arb_extra(unknown),
    )
        .prop_map(
            |((id, title, color, created, changed), defaults, styles, groups, extra)| NotebookFile {
                id: NotebookId(id),
                title,
                color,
                created,
                changed,
                defaults,
                styles,
                groups,
                extra,
                format: FormatInfo::default(),
            },
        )
}

/// Page entries with unique IDs. Parents, when set, are earlier entries.
pub fn arb_page_entries(unknown: bool) -> impl Strategy<Value = Vec<PageEntry>> {
    let moving = proptest::option::of(prop_oneof![
        arb_id().prop_map(|id| Moving::From(SectionId(id))),
        arb_id().prop_map(|id| Moving::FromTrash(TrashItemId(id))),
    ]);
    let entry = (
        arb_text(20),
        any::<prop::sample::Index>(),
        any::<bool>(),
        arb_order_key(),
        any::<bool>(),
    );
    let more = (
        proptest::option::of(arb_color()),
        arb_timestamp(),
        moving,
        arb_extra(unknown),
    );
    vec((entry, more), 0..6).prop_map(|items| {
        let ids: Vec<PageId> = (0..items.len()).map(|i| PageId(unique_id(7, i, 0))).collect();
        items
            .into_iter()
            .enumerate()
            .map(
                |(i, ((title, parent, sub, order, pinned), (color, changed, moving, extra)))| PageEntry {
                    id: ids[i],
                    title,
                    parent: (sub && i > 0).then(|| ids[parent.index(i)]),
                    order,
                    pinned,
                    color,
                    changed,
                    moving,
                    extra,
                },
            )
            .collect()
    })
}

/// A `section.json`.
pub fn arb_section_file(unknown: bool) -> impl Strategy<Value = SectionFile> {
    let head = (
        arb_id(),
        arb_text(20),
        proptest::option::of(arb_color()),
        proptest::option::of(arb_id()),
        arb_order_key(),
    );
    let rest = (
        arb_timestamp(),
        arb_timestamp(),
        arb_defaults(unknown),
        arb_page_entries(unknown),
        arb_extra(unknown),
    );
    (head, rest).prop_map(
        |((id, title, color, group, order), (created, changed, defaults, pages, extra))| SectionFile {
            id: SectionId(id),
            title,
            color,
            group: group.map(GroupId),
            order,
            created,
            changed,
            defaults,
            encryption: None,
            pages,
            extra,
            format: FormatInfo::default(),
        },
    )
}

fn arb_origin(unknown: bool) -> impl Strategy<Value = (TrashKind, TrashOrigin)> {
    let title = || proptest::option::of(arb_text(12));
    prop_oneof![
        (arb_id(), arb_text(12), arb_page_entries(unknown)).prop_map(|(section, section_title, entries)| (
            TrashKind::Page,
            TrashOrigin::Pages {
                section: SectionId(section),
                section_title,
                entries
            }
        )),
        (proptest::option::of(arb_id()), arb_order_key(), title()).prop_map(|(group, order, parent_title)| (
            TrashKind::Section,
            TrashOrigin::Section {
                group: group.map(GroupId),
                order,
                parent_title
            }
        )),
        (arb_groups(unknown), title())
            .prop_map(|(groups, parent_title)| (TrashKind::Group, TrashOrigin::Group { groups, parent_title })),
    ]
}

/// A Trash item's `item.json`.
pub fn arb_trash_item(unknown: bool) -> impl Strategy<Value = TrashItemFile> {
    let head = (arb_id(), arb_text(20), arb_timestamp(), arb_timestamp(), arb_device());
    let rest = (
        arb_named::<TrashReason>(unknown),
        arb_origin(unknown),
        vec(arb_id(), 1..3),
        arb_extra(unknown),
    );
    (head, rest).prop_map(
        |((id, title, deleted_at, expires_at, deleted_by), (reason, (kind, origin), contents, extra))| TrashItemFile {
            id: TrashItemId(id),
            kind,
            title,
            deleted_at,
            expires_at,
            deleted_by,
            reason,
            origin,
            contents,
            extra,
            format: FormatInfo::default(),
        },
    )
}

/// A `versions.json`, with versions oldest first.
pub fn arb_versions_file(unknown: bool) -> impl Strategy<Value = VersionsFile> {
    let entry = (
        arb_named::<VersionReason>(unknown),
        proptest::option::of(arb_text(10)),
        any::<bool>(),
        arb_device(),
    );
    let refs = (
        0u64..(1 << 40),
        vec(arb_id().prop_map(SegmentId), 0..3),
        vec(arb_id().prop_map(AssetId), 0..2),
    );
    let versions = vec((arb_timestamp(), entry, refs, arb_extra(unknown)), 0..4).prop_map(|items| {
        items
            .into_iter()
            .enumerate()
            .map(
                |(i, (saved_at, (reason, name, keep, device), (bytes, segments, assets), extra))| VersionEntry {
                    revision: RevisionId(unique_id(8, i, 0)),
                    saved_at,
                    reason,
                    name,
                    keep,
                    device,
                    bytes,
                    segments,
                    assets,
                    extra,
                },
            )
            .collect()
    });
    (arb_id(), versions, arb_extra(unknown)).prop_map(|(page, versions, extra)| VersionsFile {
        page: PageId(page),
        versions,
        extra,
        format: FormatInfo::default(),
    })
}
