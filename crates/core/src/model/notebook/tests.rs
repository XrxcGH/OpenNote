use super::*;
use crate::id::Id;

fn group(n: u64, parent: Option<u64>, order: &str) -> Group {
    Group {
        id: GroupId(Id::from_parts(n, 1)),
        title: format!("group {n}"),
        color: None,
        parent: parent.map(|p| GroupId(Id::from_parts(p, 1))),
        order: OrderKey::parse(order).unwrap(),
        created: Timestamp::EPOCH,
        changed: Timestamp::EPOCH,
        extra: JsonMap::new(),
    }
}

fn section(n: u64, group: Option<u64>, order: &str) -> SectionNode {
    SectionNode {
        id: SectionId(Id::from_parts(n, 2)),
        title: format!("section {n}"),
        color: Some(Color::Palette("fern".into())),
        group: group.map(|g| GroupId(Id::from_parts(g, 1))),
        order: OrderKey::parse(order).unwrap(),
        created: Timestamp::EPOCH,
        changed: Timestamp::EPOCH,
        pages: Vec::new(),
        access: Access::ReadWrite,
        encrypted: false,
        archived: false,
    }
}

fn tree(groups: Vec<Group>, sections: Vec<SectionNode>) -> NotebookTree {
    NotebookTree {
        notebook: NotebookId(Id::from_parts(1, 3)),
        title: "Biology".to_owned(),
        color: None,
        created: Timestamp::EPOCH,
        changed: Timestamp::EPOCH,
        styles: Default::default(),
        groups,
        sections,
        access: Access::ReadWrite,
        notices: Vec::new(),
        archived: false,
    }
}

fn names(children: &[TreeChild<'_>]) -> Vec<String> {
    children
        .iter()
        .map(|c| match c {
            TreeChild::Group(g) => g.title.clone(),
            TreeChild::Section(s) => s.title.clone(),
        })
        .collect()
}

#[test]
fn children_mix_groups_and_sections_in_order() {
    let t = tree(
        vec![group(1, None, "a1"), group(2, Some(1), "a0"), group(3, None, "a3")],
        vec![
            section(10, None, "a0"),
            section(11, None, "a2"),
            section(12, Some(1), "a1"),
        ],
    );
    assert_eq!(
        names(&t.children(None)),
        ["section 10", "group 1", "section 11", "group 3"]
    );
    let inside = t.children(Some(GroupId(Id::from_parts(1, 1))));
    assert_eq!(names(&inside), ["group 2", "section 12"]);
}

#[test]
fn group_depth_follows_parents_and_stops_at_loops() {
    let t = tree(
        vec![group(1, None, "a0"), group(2, Some(1), "a0"), group(3, Some(2), "a0")],
        Vec::new(),
    );
    assert_eq!(t.group_depth(GroupId(Id::from_parts(3, 1))), Some(3));
    assert_eq!(t.group_depth(GroupId(Id::from_parts(1, 1))), Some(1));
    assert_eq!(t.group_depth(GroupId(Id::from_parts(9, 1))), None);
    let looped = tree(vec![group(1, Some(2), "a0"), group(2, Some(1), "a0")], Vec::new());
    assert_eq!(looped.group_depth(GroupId(Id::from_parts(1, 1))), None);
}

#[test]
fn finds_sections_and_pages() {
    let mut s = section(10, None, "a0");
    s.pages.push(PageNode {
        id: PageId(Id::from_parts(20, 4)),
        title: "Photosynthesis".to_owned(),
        parent: None,
        order: OrderKey::parse("a0").unwrap(),
        level: 0,
        pinned: false,
        archived: false,
        color: None,
        created: Timestamp::EPOCH,
        modified: None,
        state: PageNodeState::Normal,
    });
    let t = tree(Vec::new(), vec![s]);
    assert!(t.section(SectionId(Id::from_parts(10, 2))).is_some());
    let (found, page) = t.find_page(PageId(Id::from_parts(20, 4))).unwrap();
    assert_eq!(
        (found.title.as_str(), page.title.as_str()),
        ("section 10", "Photosynthesis")
    );
    assert!(t.find_page(PageId(Id::from_parts(21, 4))).is_none());
}

#[test]
fn serializes_for_the_interface() {
    let mut s = section(10, None, "a0");
    s.pages.push(PageNode {
        id: PageId(Id::from_parts(20, 4)),
        title: "Light reactions".to_owned(),
        parent: None,
        order: OrderKey::parse("a0").unwrap(),
        level: 1,
        pinned: true,
        archived: false,
        color: None,
        created: Timestamp::EPOCH,
        modified: None,
        state: PageNodeState::Unavailable { maybe_syncing: true },
    });
    let json = serde_json::to_value(tree(Vec::new(), vec![s])).unwrap();
    let page = &json["sections"][0]["pages"][0];
    assert_eq!(page["level"], 1);
    assert_eq!(
        page["state"],
        serde_json::json!({"kind": "unavailable", "maybeSyncing": true})
    );
    assert_eq!(json["sections"][0]["color"], "fern");
    assert_eq!(json["access"], serde_json::json!({"access": "readWrite"}));
}

#[test]
fn nodes_of_an_encrypted_section_say_so_so_nothing_indexes_them() {
    let page = |n: u64| PageNode {
        id: PageId(Id::from_parts(n, 4)),
        title: format!("page {n}"),
        parent: None,
        order: OrderKey::parse("a0").unwrap(),
        level: 0,
        pinned: false,
        archived: false,
        color: None,
        created: Timestamp::EPOCH,
        modified: None,
        state: PageNodeState::Normal,
    };
    let mut diary = section(10, None, "a0");
    diary.encrypted = true;
    diary.pages.push(page(20));
    let mut open = section(11, None, "a1");
    open.pages.push(page(21));
    let t = tree(Vec::new(), vec![diary, open]);
    let flags = |nodes: Vec<crate::session::notes::NodeInfo>| {
        nodes.into_iter().map(|n| (n.title, n.encrypted)).collect::<Vec<_>>()
    };
    assert_eq!(
        flags(crate::session::notes::children_of(&t, t.notebook.0).unwrap()),
        [("section 10".to_owned(), true), ("section 11".to_owned(), false)]
    );
    assert_eq!(
        flags(crate::session::notes::children_of(&t, Id::from_parts(10, 2)).unwrap()),
        [("page 20".to_owned(), true)]
    );
    assert_eq!(
        flags(crate::session::notes::children_of(&t, Id::from_parts(11, 2)).unwrap()),
        [("page 21".to_owned(), false)]
    );
}
