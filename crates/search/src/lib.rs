//! OpenNote search: a full-text index, saved searches, and the link graph between pages.
//!
//! The index is a SQLite file with an FTS5 table, and it is only a cache. Delete it and the app builds it again
//! from the note files, so nothing here needs a migration.
//!
//! A caller turns a page of the core model into a [`PageDoc`] with [`PageDoc::from_page`]. It then hands the
//! document to [`SearchIndex::upsert`]. [`SearchIndex::search`] answers a [`Query`]: words matched by prefix and
//! ranked, filtered by notebook, section, tag, date, or block type, each result with a snippet. Saved searches
//! are named queries in [`SavedSearches`], stored as JSON outside the index.
//!
//! Pages link to each other as `[[Page]]`, `[[Page#Heading]]`, or the stored `[Page](opennote:page/<ID>)`.
//! The graph side lists [`SearchIndex::backlinks`], and [`SearchIndex::rename_edits`] lists the blocks whose
//! link text must change after a rename. Tags nest with `/`, so `a/b/c` sits inside `a/b`.
//!
//! Pages in encrypted sections never enter the index: not their title, tags, text, or links (spec 5.7).

#![deny(unsafe_code)]

mod boolean;
pub mod core_source;
mod doc;
mod error;
pub mod fuzzy;
mod graph;
mod index;
pub mod linkgraph;
pub mod links;
pub mod mentions;
pub mod palette;
pub mod pattern;
mod persist;
mod plain;
mod prepare;
mod preview;
mod query;
pub mod rank;
pub mod resolve;
mod resolver;
mod saved;
mod schema;
mod search;
mod settle;
mod snippet;
pub mod switcher;
pub mod sync;
pub mod syntax;
mod tag_plan;
mod tag_tree;
pub mod tags;
mod text;
mod verify;
mod write;

pub use core_source::{stamps_from_tree, CorePageSource, CoreSlot};
pub use doc::{BlockKind, BlockText, PageDoc};
pub use error::{Result, SearchError};
pub use fuzzy::{FuzzyMatch, MatchKind};
pub use graph::{Backlink, HeadingRef, LinkEdit, LinkTarget, OutgoingLink, PageSuggestion};
pub use index::{IndexedPage, SearchIndex};
pub use linkgraph::{BrokenLink, Connection, Connections, GraphEdge, GraphPage, LinkGraph, Neighbor};
pub use links::{Link, LinkKind, Rename};
pub use mentions::{LinkedMentions, Mention, MentionBlock, UnlinkedMention};
pub use palette::{Command, Palette, PaletteContext, PaletteHit};
pub use persist::{OpenStatus, Rebuild, ReplaceReason};
pub use preview::LinkPreview;
pub use query::{DateField, DateRange, Query, TextMode, MAX_QUERY_CHARS, MAX_QUERY_TERMS};
pub use rank::{RankBreakdown, RankContext, RankWeights, SearchScope};
pub use resolve::{LinkStatus, Place, Resolution, ResolvedLink};
pub use resolver::{Resolver, ResolverPage};
pub use saved::{SavedSearch, SavedSearches};
pub use search::{SearchHit, SearchLimits, SearchResults, MAX_LIMIT};
pub use snippet::Snippet;
pub use switcher::{Switch, SwitchContext, SwitchEntry, SwitchHit, Switcher};
pub use sync::{
    jobs_for_event, BackgroundIndexer, IndexEvent, IndexUpdate, Indexer, IndexerConfig, IndexerHandle, IndexerStats,
    Job, Observer, PageSource, PageStamp, RenamePlan, SharedIndex, SourceError,
};
pub use syntax::{NamedPlace, PlaceList, PlaceNames, SyntaxContext, SyntaxNote, TypedSearch};
pub use tag_plan::{TagChange, TagPlan};
pub use tag_tree::TagNode;
pub use verify::CheckReport;
pub use write::WriteReport;
