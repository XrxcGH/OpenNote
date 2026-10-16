//! The link graph: edges, connections, neighborhoods, orphans, and broken links.

mod common;

use common::{block_id, doc, notebook_id, page_id, DocExt};
use opennote_search::{LinkGraph, PageDoc, SearchIndex};

fn id_link(text: &str, page: u64) -> String {
    format!("[{text}](opennote:page/{})", page_id(page))
}

fn index_of(docs: &[PageDoc]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(docs).unwrap();
    index
}

fn n(page: opennote_core::PageId) -> u64 {
    page.id().time_ms() - 1_000
}

/// 1 -> 2 -> 3 -> 4, 1 -> 3 twice, 5 alone, 6 links to a missing page and to itself.
fn chain() -> Vec<PageDoc> {
    vec![
        doc(1, "One").text("[[Two]] and [[Three]] and again [[three]]"),
        doc(2, "Two").text("[[Three]]"),
        doc(3, "Three").text(&id_link("four", 4)),
        doc(4, "Four"),
        doc(5, "Five"),
        doc(6, "Six").text("[[Nowhere]] and [[Six]]"),
    ]
}

fn edges(graph: &LinkGraph) -> Vec<(u64, u64, u32)> {
    graph.edges().iter().map(|e| (n(e.from), n(e.to), e.count)).collect()
}

#[test]
fn edges_count_the_links_between_two_pages() {
    let graph = index_of(&chain()).link_graph(None).unwrap();
    assert_eq!(edges(&graph), [(1, 2, 1), (1, 3, 2), (2, 3, 1), (3, 4, 1)]);
    assert_eq!(graph.pages().len(), 6);
}

#[test]
fn broken_links_are_listed_apart_and_a_self_link_is_no_edge() {
    let graph = index_of(&chain()).link_graph(None).unwrap();
    assert_eq!(graph.broken().len(), 1);
    let broken = &graph.broken()[0];
    assert_eq!((n(broken.source), broken.block), (6, block_id(6, 0)));
    assert_eq!(broken.link, "[[Nowhere]]");
    assert_eq!(broken.label, "Nowhere");
    assert!(graph.connections(page_id(6)).outgoing.is_empty());
}

#[test]
fn orphans_have_no_links_in_or_out() {
    let graph = index_of(&chain()).link_graph(None).unwrap();
    let orphans: Vec<u64> = graph.orphans().iter().map(|page| n(page.page)).collect();
    assert_eq!(
        orphans,
        [5, 6],
        "a page with only a broken link or a self link is still alone"
    );
}

#[test]
fn connections_list_both_directions_by_title() {
    let graph = index_of(&chain()).link_graph(None).unwrap();
    let three = graph.connections(page_id(3));
    let titles = |list: &[opennote_search::Connection]| list.iter().map(|c| c.title.clone()).collect::<Vec<_>>();
    assert_eq!(titles(&three.incoming), ["One", "Two"]);
    assert_eq!(three.incoming[0].count, 2);
    assert_eq!(titles(&three.outgoing), ["Four"]);
    assert_eq!(graph.connections(page_id(99)), Default::default());
}

#[test]
fn a_neighborhood_follows_links_in_both_directions_up_to_three_deep() {
    let graph = index_of(&chain()).link_graph(None).unwrap();
    let near = |page, depth| {
        graph
            .neighbors(page_id(page), depth)
            .iter()
            .map(|nb| (n(nb.page), nb.distance))
            .collect::<Vec<_>>()
    };
    assert_eq!(near(4, 1), [(3, 1)]);
    assert_eq!(near(4, 2), [(3, 1), (1, 2), (2, 2)]);
    assert_eq!(
        near(4, 3),
        [(3, 1), (1, 2), (2, 2)],
        "everything reachable is already in"
    );
    assert_eq!(near(4, 0), near(4, 1), "the depth is at least 1");
    assert_eq!(near(4, 9), near(4, 3), "and at most 3");
    assert_eq!(near(5, 3), []);
    assert_eq!(near(77, 3), []);
}

#[test]
fn a_long_chain_stops_at_the_depth() {
    let docs: Vec<PageDoc> = (1..=8)
        .map(|k| {
            let page = doc(k, &format!("Page {k}"));
            if k < 8 {
                page.text(&format!("[[Page {}]]", k + 1))
            } else {
                page
            }
        })
        .collect();
    let graph = index_of(&docs).link_graph(None).unwrap();
    let reach: Vec<u64> = graph.neighbors(page_id(1), 3).iter().map(|nb| n(nb.page)).collect();
    assert_eq!(reach, [2, 3, 4]);
}

#[test]
fn a_shared_title_points_at_the_closest_page_and_says_so() {
    let index = index_of(&[
        doc(1, "Source").notebook(1).section(1).text("[[Twin]]"),
        doc(2, "Twin").notebook(2).section(5).modified(9_000),
        doc(3, "Twin").notebook(1).section(1).modified(1_000),
    ]);
    let graph = index.link_graph(None).unwrap();
    let edges = graph.edges();
    assert_eq!(edges.len(), 1);
    assert_eq!(n(edges[0].to), 3, "the page in the same section");
    assert!(edges[0].ambiguous);
}

#[test]
fn a_link_through_an_old_title_still_joins_the_pages() {
    let mut index = index_of(&[doc(1, "Old name"), doc(2, "Reader").text("[[Old name]]")]);
    index.upsert(&doc(1, "New name")).unwrap();
    let graph = index.link_graph(None).unwrap();
    assert_eq!(edges(&graph), [(2, 1, 1)]);
    assert!(graph.broken().is_empty());
}

#[test]
fn one_notebook_leaves_out_links_to_the_others() {
    let index = index_of(&[
        doc(1, "A").notebook(1).text("[[B]] [[C]]"),
        doc(2, "B").notebook(1),
        doc(3, "C").notebook(2).text("[[A]]"),
    ]);
    let whole = index.link_graph(None).unwrap();
    assert_eq!(edges(&whole), [(1, 2, 1), (1, 3, 1), (3, 1, 1)]);
    let first = index.link_graph(Some(notebook_id(1))).unwrap();
    assert_eq!(first.pages().len(), 2);
    assert_eq!(edges(&first), [(1, 2, 1)]);
    assert!(first.broken().is_empty(), "a link out of the notebook is not broken");
    assert!(!first.contains(page_id(3)));
}

#[test]
fn an_empty_index_has_an_empty_graph() {
    let graph = SearchIndex::open_in_memory().unwrap().link_graph(None).unwrap();
    assert!(graph.pages().is_empty() && graph.edges().is_empty() && graph.orphans().is_empty());
}
