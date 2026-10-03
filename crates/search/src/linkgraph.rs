//! The link graph: pages as nodes and links between them as edges, for the graph view and for lists of a page's
//! connections.
//!
//! [`SearchIndex::link_graph`] reads every link of the index once and resolves it with a
//! [`Resolver`](crate::Resolver). It builds the graph in memory, for one notebook or for all of them. A title
//! that several pages share points at the closest one, as following the link would. A link to a page that was
//! renamed counts as a link to it. A link to nothing is listed apart, as a broken link.
//!
//! The graph answers the questions the views ask. It lists what a page links to and what links to it. This is
//! the "Connections" list, which serves keyboard and screen reader users as well as the drawing. It lists the
//! pages within one to three links of the open page, the pages with no links at all, and the broken links to
//! repair.

use std::collections::{HashMap, VecDeque};

use opennote_core::{BlockId, NotebookId, PageId, SectionId};
use serde::Serialize;

use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::resolve::{LinkStatus, Place};
use crate::resolver::Resolver;
use crate::text::fold;

/// The most links apart a neighborhood reaches.
pub const MAX_DEPTH: u8 = 3;

/// A page in the graph.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
}

/// All the links from one page to another.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    /// The page that holds the links.
    pub from: PageId,
    /// The page they point at.
    pub to: PageId,
    /// How many links.
    pub count: u32,
    /// At least one of the links names a title that several pages share, and this is the closest of them.
    pub ambiguous: bool,
}

/// A link that points at no page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenLink {
    /// The page that holds the link.
    pub source: PageId,
    /// The block that holds it.
    pub block: BlockId,
    /// The link as written.
    pub link: String,
    /// The text of the link.
    pub label: String,
}

/// A page next to another in the graph.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// How many links join the two pages in this direction.
    pub count: u32,
    /// The links name a title that several pages share.
    pub ambiguous: bool,
}

/// What a page links to and what links to it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connections {
    /// The pages this page links to.
    pub outgoing: Vec<Connection>,
    /// The pages that link to this page.
    pub incoming: Vec<Connection>,
}

/// A page within a few links of another.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Neighbor {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// How many links away it is, following links in either direction. 1 is next to the page.
    pub distance: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Hop {
    to: usize,
    count: u32,
    ambiguous: bool,
}

/// The pages of a notebook, or of all notebooks, and the links between them.
#[derive(Clone, Debug, Default)]
pub struct LinkGraph {
    pages: Vec<GraphPage>,
    position: HashMap<PageId, usize>,
    out: Vec<Vec<Hop>>,
    back: Vec<Vec<Hop>>,
    broken: Vec<BrokenLink>,
}

impl LinkGraph {
    /// The pages, in the order the index holds them.
    pub fn pages(&self) -> &[GraphPage] {
        &self.pages
    }

    /// Whether the graph holds the page.
    pub fn contains(&self, page: PageId) -> bool {
        self.position.contains_key(&page)
    }

    /// Every edge, by source page and then target page.
    pub fn edges(&self) -> Vec<GraphEdge> {
        let mut edges = Vec::new();
        for (from, arcs) in self.out.iter().enumerate() {
            for arc in arcs {
                edges.push(GraphEdge {
                    from: self.pages[from].page,
                    to: self.pages[arc.to].page,
                    count: arc.count,
                    ambiguous: arc.ambiguous,
                });
            }
        }
        edges
    }

    /// The links that point at no page.
    pub fn broken(&self) -> &[BrokenLink] {
        &self.broken
    }

    /// What a page links to and what links to it, each list by title. Empty for a page not in the graph.
    pub fn connections(&self, page: PageId) -> Connections {
        let Some(&at) = self.position.get(&page) else {
            return Connections::default();
        };
        Connections {
            outgoing: self.list(&self.out[at]),
            incoming: self.list(&self.back[at]),
        }
    }

    fn list(&self, arcs: &[Hop]) -> Vec<Connection> {
        let mut list: Vec<Connection> = arcs
            .iter()
            .map(|arc| Connection {
                page: self.pages[arc.to].page,
                title: self.pages[arc.to].title.clone(),
                count: arc.count,
                ambiguous: arc.ambiguous,
            })
            .collect();
        list.sort_by(|a, b| fold(&a.title).cmp(&fold(&b.title)).then(a.page.cmp(&b.page)));
        list
    }

    /// The pages within `depth` links of a page, nearest first and then by title. Links count in both
    /// directions. `depth` is held between 1 and [`MAX_DEPTH`].
    pub fn neighbors(&self, page: PageId, depth: u8) -> Vec<Neighbor> {
        let Some(&start) = self.position.get(&page) else {
            return Vec::new();
        };
        let depth = depth.clamp(1, MAX_DEPTH);
        let mut seen: HashMap<usize, u8> = HashMap::from([(start, 0)]);
        let mut queue = VecDeque::from([start]);
        while let Some(at) = queue.pop_front() {
            let distance = seen[&at];
            if distance == depth {
                continue;
            }
            for arc in self.out[at].iter().chain(&self.back[at]) {
                if let std::collections::hash_map::Entry::Vacant(slot) = seen.entry(arc.to) {
                    slot.insert(distance + 1);
                    queue.push_back(arc.to);
                }
            }
        }
        let mut found: Vec<Neighbor> = seen
            .into_iter()
            .filter(|(at, _)| *at != start)
            .map(|(at, distance)| Neighbor {
                page: self.pages[at].page,
                title: self.pages[at].title.clone(),
                distance,
            })
            .collect();
        found.sort_by(|a, b| {
            a.distance
                .cmp(&b.distance)
                .then_with(|| fold(&a.title).cmp(&fold(&b.title)))
                .then(a.page.cmp(&b.page))
        });
        found
    }

    /// The pages with no links to or from any page, by title. The graph view lists them apart.
    pub fn orphans(&self) -> Vec<&GraphPage> {
        let mut found: Vec<&GraphPage> = (0..self.pages.len())
            .filter(|at| self.out[*at].is_empty() && self.back[*at].is_empty())
            .map(|at| &self.pages[at])
            .collect();
        found.sort_by(|a, b| fold(&a.title).cmp(&fold(&b.title)).then(a.page.cmp(&b.page)));
        found
    }
}

/// The links between pages by position in the graph: how many, and whether any names a shared title.
type Weights = HashMap<(usize, usize), (u32, bool)>;

/// A row of the links table.
struct LinkRow {
    page: i64,
    block: String,
    kind: String,
    label: String,
    norm: Option<String>,
    target: Option<String>,
    raw: String,
}

impl LinkGraph {
    /// The pages of one notebook, or of all, with no links yet. Returns the graph and the position of each
    /// resolver page in it.
    fn with_pages(resolver: &Resolver, notebook: Option<NotebookId>) -> (LinkGraph, HashMap<usize, usize>) {
        let mut graph = LinkGraph::default();
        let mut slot = HashMap::new();
        for (at, page) in resolver.pages().iter().enumerate() {
            if notebook.is_some_and(|wanted| wanted != page.notebook) {
                continue;
            }
            slot.insert(at, graph.pages.len());
            graph.position.insert(page.page, graph.pages.len());
            graph.pages.push(GraphPage {
                page: page.page,
                title: page.title.clone(),
                notebook: page.notebook,
                section: page.section,
            });
        }
        graph.out = vec![Vec::new(); graph.pages.len()];
        graph.back = vec![Vec::new(); graph.pages.len()];
        (graph, slot)
    }

    /// Stores the weighed links as edges, by source page and then target page.
    fn add_edges(&mut self, weights: Weights) {
        let mut arcs: Vec<((usize, usize), (u32, bool))> = weights.into_iter().collect();
        arcs.sort_by_key(|(key, _)| *key);
        for ((from, to), (count, ambiguous)) in arcs {
            self.out[from].push(Hop { to, count, ambiguous });
            self.back[to].push(Hop {
                to: from,
                count,
                ambiguous,
            });
        }
    }
}

/// Where a link points: the status, and the resolver pages it names, closest first.
fn resolve_row(resolver: &Resolver, row: &LinkRow, place: Place) -> Result<(LinkStatus, Vec<usize>)> {
    Ok(match (row.kind.as_str(), row.norm.as_deref(), row.target.as_deref()) {
        ("title", Some(norm), _) => resolver.resolve_title(norm, Some(place)),
        (_, _, Some(target)) => match resolver.resolve_id(parse_id(target)?) {
            Some(at) => (LinkStatus::Resolved, vec![at]),
            None => (LinkStatus::Broken, Vec::new()),
        },
        _ => (LinkStatus::Broken, Vec::new()),
    })
}

impl SearchIndex {
    /// Builds the graph of the links in one notebook, or in every notebook with `None`. A link from a page of
    /// the notebook to a page of another leaves the graph of the notebook.
    pub fn link_graph(&self, notebook: Option<NotebookId>) -> Result<LinkGraph> {
        let resolver = self.resolver()?;
        let (mut graph, slot) = LinkGraph::with_pages(&resolver, notebook);
        let rid_at: HashMap<i64, usize> = resolver.pages().iter().enumerate().map(|(at, p)| (p.rid, at)).collect();
        let mut weights = Weights::new();
        for row in self.link_rows()? {
            let Some(&source) = rid_at.get(&row.page) else { continue };
            let Some(&from) = slot.get(&source) else { continue };
            let page = &resolver.pages()[source];
            let place = Place {
                notebook: page.notebook,
                section: page.section,
            };
            let (status, found) = resolve_row(&resolver, &row, place)?;
            let Some(&closest) = found.first() else {
                graph.broken.push(BrokenLink {
                    source: page.page,
                    block: parse_id(&row.block)?,
                    link: row.raw,
                    label: row.label,
                });
                continue;
            };
            match slot.get(&closest) {
                Some(&to) if to != from => {
                    let entry = weights.entry((from, to)).or_insert((0, false));
                    entry.0 += 1;
                    entry.1 |= status == LinkStatus::Ambiguous;
                }
                _ => {}
            }
        }
        graph.add_edges(weights);
        Ok(graph)
    }

    fn link_rows(&self) -> Result<Vec<LinkRow>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT page, block, kind, title, title_norm, target, raw FROM links ORDER BY page, rowid",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(LinkRow {
                page: row.get(0)?,
                block: row.get(1)?,
                kind: row.get(2)?,
                label: row.get(3)?,
                norm: row.get(4)?,
                target: row.get(5)?,
                raw: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<LinkRow>>>()?)
    }
}
