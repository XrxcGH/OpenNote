# OpenNote search

This crate finds things in a notebook. It holds the full-text index, the ranking, the quick switcher, the links between pages, and the code that keeps all of them current while the core saves notes.

It is the core of Phase 8 and has no screens. Each module below says what it does, lists the calls the interface will make, and names what the interface must supply. The interface work comes after the editor lands.

## Contents

- [How the pieces fit](#how-the-pieces-fit)
- [Pages and queries](#pages-and-queries)
- [Advanced search](#advanced-search)
- [Ranking](#ranking)
- [Quick switcher](#quick-switcher)
- [Command palette](#command-palette)
- [Links and renames](#links-and-renames)
- [Link previews](#link-previews)
- [Mentions and the link graph](#mentions-and-the-link-graph)
- [Tag changes](#tag-changes)
- [Keeping the index current](#keeping-the-index-current)
- [The index file](#the-index-file)
- [Wiring checklist](#wiring-checklist)
- [Tests and benchmarks](#tests-and-benchmarks)

## How the pieces fit

The index is a cache. It is one SQLite file with a full-text table, and the app can delete it at any time and build it again from the note files. Nothing here migrates.

| Module | What it does |
|---|---|
| `doc`, `index`, `query`, `search`, `snippet`, `saved`, `tags` | Turn a page into a document, store it, and answer queries with snippets, filters, saved searches, and a tag tree. |
| `boolean`, `pattern`, `syntax` | Read `OR`, `NOT`, brackets, `title:`, and regular expressions, and turn the text of the search box into a `Query`. |
| `rank` | Orders results by title, heading, body, age, and the notebook the person is in. |
| `fuzzy`, `switcher` | Match page names for Ctrl+O, with recent pages first. |
| `palette` | Match the names of commands for the command palette. |
| `preview` | Give the first lines of a link's target for the hover card. |
| `tag_plan` | List what renaming, merging, or deleting a tag would change. |
| `links`, `resolve` | Read `[[page links]]`, decide which page each one means, and track renames. |
| `mentions` | Find where a title appears without a link, and turn mentions into links. |
| `linkgraph` | Build the graph of links for the graph view and the connections list. |
| `sync`, `core_source` | Turn the core's save and tree notifications into index updates, on a background thread. |
| `persist`, `verify` | Survive a crash, replace a bad file, rebuild without a gap in search, and check the tables. |

Pages in encrypted sections never enter the index. Not their titles, tags, text, links, or old titles.

## Pages and queries

**What it does.** `PageDoc::from_page` reads what search needs from a core page. `SearchIndex::upsert`, `write`, and the `delete_*` calls change the index. `SearchIndex::search` answers a `Query`. A query can hold words matched as you type, quoted phrases, and filters for notebook, section, tag, date, and block type. Each `SearchHit` has a title with highlight ranges, a snippet, and a rank breakdown. `SavedSearches` stores named queries as JSON outside the index.

**How words match.** Matching ignores case in full, so `Straße` finds `STRASSE`. It ignores accents on Latin, Greek, Cyrillic, Hebrew, and Arabic letters. In other scripts a mark is part of the letter, so `がき` and `かき` stay different words, and so do `कमल` and `कमाल`. Chinese, Japanese, Korean, Thai, Lao, Khmer, and Myanmar are written without spaces between words. Each of their letters is a word, and a query word matches its letters in a row, so `東京` is found inside `今日は東京に行きます`. The index stores the folded words, and a query is folded the same way, so both sides always agree. A query reads at most 1,000 characters and 64 words.

**Public API.**

- `Query`, `DateRange`, `SearchScope`, `SearchHit`, `Snippet`, `SavedSearches`, `TagNode`
- `SearchIndex::{search, search_with, tag_tree, suggest_pages, headings, indexed_pages}`

**What the interface needs.** A search box that sends the text as typed, because the last word is a prefix until a space follows it. A results list that draws `title_highlights` and `snippet.highlights`. A filter bar that fills the `Query` fields. A place to keep saved searches next to the notebook settings.

## Advanced search

**What it does.** A `Query` has a text mode. `Simple` is the original. Every word is required. The last word matches as a prefix while the person types. `Boolean` also reads `OR`, `AND`, `NOT`, a minus sign, brackets, and `title:`. `Regex` reads the whole text as a regular expression. Operators count only in capitals, so the word "or" stays a word.

The boolean reader never fails. A missing right side, an open bracket, or a stray closing bracket is dropped and the rest still searches. A word left out is never a prefix. A text that only leaves words out lists every other page, newest first. A `title:` word or group must match in the title. `Query::title_only` limits a whole query to titles.

A regular expression search reads the title and plain text of every page that the filters allow. It ignores case unless the pattern says `(?-i)`. It cannot hang. The engine does not backtrack, a pattern may not be large, and it may not repeat anything more than 100 times. A pattern search has a time budget of 3 seconds, and `search_within` takes a deadline and a cancel flag as well. A search cut short returns the best of what it read, with `complete` set to false. Through `IndexerHandle`, a pattern search reads in slices of 20 ms and lets go of the index between them, so saves and other searches are not held up. The check function in `pattern` returns a plain message for a bad pattern, so the interface can show it while the person types. A search with a bad pattern returns `SearchError::Pattern`.

`syntax::parse` reads the search box. It takes `tag:`, `in:`, `notebook:`, `section:`, `type:`, `before:`, `after:`, `on:`, and the `created-` forms out of the text, sets the matching filters, and leaves the rest as boolean text. It never fails. Anything it cannot use becomes a `SyntaxNote` with a sentence for the line below the box.

**Public API.** `Query::{text, boolean, regex}`, `TextMode`, `Query::title_only`, `pattern::{check, MAX_PATTERN_CHARS}`, `syntax::{parse, SyntaxContext, TypedSearch, SyntaxNote, PlaceNames, PlaceList, NamedPlace, OPERATORS}`.

**What the interface needs.**

- A search box that calls `syntax::parse` on each change, with the current time and the offset of local time from Coordinated Universal Time. The caller sets `limit`, `offset`, and `scope` on the query that comes back.
- A `PlaceNames` made from the notebook tree, because the index holds IDs and not names. `PlaceList` is ready for that.
- A line below the box that lists `OPERATORS` and shows each `SyntaxNote::message`.
- A "Regular expression" switch that sets `Query::regex`, and one for "Titles only". Show the message of `pattern::check` beside the box.
- Switches for handwriting and alt text set `Query::block_types`. Transcripts wait for Phase 9.

Operators work on the whole search, so one inside brackets reads as words, and a minus sign before an operator does not exclude. Archived pages need a flag in the core's page model, which does not exist yet.

## Ranking

**What it does.** The full-text table finds the pages that hold the words and scores their text. The `rank` module adds what that score cannot see and orders the best 200 matches again:

- A page whose title is the words typed comes first, then one whose title starts with them, then one that holds them.
- A word in a heading beats a word in a paragraph.
- The text score is squeezed into 0 to 1, so one long page cannot dominate.
- Newer pages score higher. The boost halves every 30 days, so it settles ties and never beats a much better match.
- Pages of the notebook and section the person searches from score a little higher. This never hides other pages.

Every hit carries a `RankBreakdown`, so a result can be explained and a ranking can be tested.

**Public API.** `RankWeights`, `RankContext`, `SearchScope`, `RankBreakdown`, `SearchIndex::search_with`, and the pure functions in `rank` (`score`, `title_score`, `heading_score`, `recency`).

**What the interface needs.** Pass `Query::scope` with the open notebook and section. Settings may expose `RankWeights` later, for example to turn the recency boost off. Show the breakdown only in a debug view.

## Quick switcher

**What it does.** `fuzzy` matches a short query against a title in seven ways. From best to worst they are the exact title, a prefix, a later word, any order of words, a substring, scattered letters, and a small typo. Case, accents, and punctuation do not matter. Each match returns the byte ranges to highlight.

`Switcher` keeps every title in memory and reloads only when `SearchIndex::generation` changes. An empty query lists recent pages and then the newest. A typed query ranks matches, with a small boost for recent pages and for the current section. If nothing matches, the answer holds the title a new page would get.

**Public API.** `Switcher::{refresh, find}`, `SwitchContext`, `Switch`, `SwitchHit`, `MatchKind`, `fuzzy::{Needle, Haystack, fuzzy_match}`, `switcher::new_page_title`.

**What the interface needs.**

- The recent page list, latest first, and the open page. The core does not keep this list.
- Enter opens `hits[0]`. Ctrl+Enter opens it in a new tab. With no hits, Enter creates a page named `create` in the current section.
- Draw `highlights` in bold as well as color.
- Call `refresh` before each `find`. It costs nothing when the index has not changed.

## Command palette

**What it does.** `Palette` holds the commands the interface registers: an ID, a title, a category, keywords, a shortcut, and whether it can run now. A typed query matches the title first, then the category and title together, then the keywords, with the rules of `fuzzy`. So `np` and `new pa` find "New page", `file new` finds it through its category, and `remove` finds "Delete page" through a keyword. A keyword match scores half.

Commands used lately, and often, gain a small boost that never beats a better kind of match. A command that cannot run now still shows, after all that can. An empty query lists recent commands, then the most used, then the rest.

**Public API.** `Palette::{new, find, len, is_empty}`, `Command`, `PaletteContext`, `PaletteHit`, `palette::MatchedOn`.

**What the interface needs.**

- One `Command` for every action in the app, with a stable ID. The interface runs the ID of the hit the person picks.
- The recent IDs, latest first, and a use count for each ID, kept in the window state. The palette never records a use.
- A row that shows `shortcut`, draws `title_highlights` and `category_highlights` in bold as well as color, and says why a disabled command does nothing.

## Links and renames

**What it does.** A page links to another as `[[Title]]`, `[[Title#Heading]]`, or the stored ID link `[Title](opennote:page/<ID>)`. An ID link survives renames. A title link finds its page like this:

1. Pages with that title, ignoring case, accents, and spacing. Several pages are ambiguous, and the closest comes first: the same section, then the same notebook, then the newest.
2. A page that used to have that title. The index remembers up to 16 earlier titles per page, so a link that no edit has reached still opens the right page.
3. Otherwise the link is broken.

When a save changes a title, the index reports a `Rename` and keeps the old title as an alias. Titles are saved while they are typed, so the links follow only a settled title. `settle_title` makes the current title the settled one and returns the rename from the title the page had settled on before. It forgets the titles the page had only on the way. The indexer settles a title 20 seconds after it last changed, or at once when the interface calls `IndexerHandle::title_settled`. A start settles the titles an earlier run left unsettled. `rename_edits` lists the blocks whose link text must change, and `repair_edits` lists the stale links to a page that was renamed earlier. Applying them is the interface's job, as ordinary page edits.

**Public API.** `SearchIndex::{resolve_title, resolve_link, resolve_markdown, outgoing_links, backlinks, rename_edits, repair_edits, settle_title, unsettled_pages, suggest_pages, headings, resolver}`, `LinkStatus`, `Resolution`, `Resolver`, `LinkEdit`, `Rename`, `WriteReport`.

**What the interface needs.**

- `[[` autocomplete from `suggest_pages`, and `[[Page#` autocomplete from `headings`.
- A link style for each `LinkStatus`: resolved, ambiguous, renamed, and broken, with text as well as color.
- To call `IndexerHandle::title_settled` when the title field loses focus or the person presses Enter.
- To apply each `LinkEdit` as a text edit of its block, in one undo step, when it receives a `RenamePlan`. `LinkEdit::apply` changes only links, never the same text in a code span or a fenced block. To ask first when `RenamePlan::other_pages` is not empty.
- On a click, open `Resolution::first()` and scroll to its `block`.

## Link previews

**What it does.** `SearchIndex::link_preview` gives the card for a link: the first lines of a page, or the lines under a heading when the link names one. The heading section ends at the next heading of the same level or a higher one. A heading the page lacks falls back to the start of the page and sets `heading_missing`. A card holds at most 8 lines or 400 characters and ends with an ellipsis when it was cut. A page in an encrypted section has no card, because the index never holds its text.

**Public API.** `SearchIndex::link_preview`, `LinkPreview`.

**What the interface needs.** A card on hover and on focus, and a shortcut that opens it for keyboard and screen reader users. The card stays open while the pointer is over it, and Escape closes it. Opening the link scrolls to `LinkPreview::block`. Links to single paragraphs wait for the editor's element model.

## Mentions and the link graph

**What it does.** `unlinked_mentions` lists pages that say a page's title without linking to it. It reads the plain text in the index, so it says where to look. `find_mentions` reads the Markdown of one block and returns the exact places. It skips code, links, web addresses, HTML, math, and tags. `link_mentions` rewrites chosen mentions, or all of them, as ID links that keep the words as typed. Titles under three letters have no mentions.

`link_graph` builds the graph of resolved links for one notebook or all of them. It answers `connections` (what a page links to and what links to it), `neighbors` (pages within one to three links), `orphans` (pages with no links), and `broken` (links to repair).

**Public API.** `SearchIndex::{unlinked_mentions, link_graph}`, `mentions::{find_mentions, link_mentions}`, `LinkGraph`, `Connections`, `Neighbor`, `BrokenLink`.

**What the interface needs.**

- For "Link" and "Link all", read the Markdown of each block in `UnlinkedMention::blocks`, call `find_mentions`, show each `Mention` with its `before` and `after` context, and apply `link_mentions` as one undo step.
- A Connections list for the graph view, so keyboard and screen reader users get the same facts as the drawing.
- A separate list of orphan pages.

## Tag changes

**What it does.** `plan_tag_rename` and `plan_tag_delete` list what a change would do before it does anything. Each tag that changes comes with its new name and the pages that carry it. Tags nested in the tag move with it, so renaming `school` also renames `school/biology`. The plan also says how many different pages change, and whether the new name already exists, which makes the rename a merge.

**Public API.** `SearchIndex::{plan_tag_rename, plan_tag_delete}`, `TagPlan`, `TagChange`.

**What the interface needs.** A preview that shows the page count before the person confirms. The interface applies the change through the core, as one undo step. The index holds tags per page, so a count of lines that carry a tag comes from reading those pages. The tag pane that lists tagged lines and open checkboxes also waits for the editor's element model.

## Keeping the index current

**What it does.** The core calls `IndexSink::page_saved` after each save, and sends `CoreEvent`s for tree changes. `IndexerHandle` implements the sink and takes the events. Each becomes a `Job`:

- A save reloads one page.
- A tree change reconciles the notebook: the indexer lists the tree, compares it with the index, and fixes every difference.
- A start reconciles every open notebook, which catches a save made just before a crash.

To tell whether a page changed, a reconcile compares a fingerprint of the page file: its size, last-write time, and file ID. The index stores the fingerprint of the file it read. The tree's modified time cannot do this job, because it comes from a device cache that hears only of this device's saves. A file that another device changed, and a sync tool replaced while the app was closed, is read again. A page this device never saved is not read again on every tree change.

Jobs on the same page merge, and the indexer reads each page whole. It reads through a `PageSource`. `CorePageSource` reads from a running core without opening a page session. A read that may pass is tried again with a growing delay, as when a sync tool is still writing the file. So is a removal that fails for a reason other than damage, such as a full disk, so a page that became encrypted does not stay searchable. A page in an encrypted section is purged from the file. `BackgroundIndexer` runs the engine on its own thread. The index sits behind a lock that is held only while a batch is written.

**Public API.** `BackgroundIndexer::{spawn, handle, shutdown, close}`, `IndexerHandle::{start, tree_changed, notebook_closed, section_locked, page_removed, rebuild, on_event, flush, search, index, stats, failures}`, `IndexEvent`, `IndexUpdate`, `RenamePlan`, `PageSource`, `CorePageSource`, `CoreSlot`.

**What the interface needs.**

1. Make a `CoreSlot`, spawn the indexer with `CorePageSource::production(slot)`, start the core with the indexer handle as its sink, then put the core in the slot.
2. Forward every `CoreEvent` to `IndexerHandle::on_event`, in the same place that emits it to the window.
3. Call `start` with the open notebooks once they are open, `notebook_closed` when one closes, and `section_locked` when a section becomes encrypted.
4. Use the observer to refresh open result lists, the switcher, and the backlinks pane, and to apply each `RenamePlan`.
5. Call `BackgroundIndexer::close` before the core shuts down. It lets the waiting jobs go on for `IndexerConfig::shutdown_grace` (2 seconds), then ends the work between two batches and drops a rebuild that was still filling, so quitting never waits for the first index of a large notebook. The next start compares the notes with the index and does the rest. It closes the index file cleanly.
6. Show a notice when `IndexEvent::Failed` repeats, with "Rebuild search index" calling `rebuild`.

## The index file

**What it does.** Opening the file records whether the last run stopped cleanly. A clean stop is trusted at once. After a crash the file gets SQLite's quick check and a comparison of its tables, and a file that fails is replaced. A file from another schema version, or one that is not a database, is replaced too. `SearchIndex::status` says which case happened.

A file with the right version must also hold exactly the tables of that version, or it is replaced. A clean file is trusted at open, so the indexer runs the quick check after `start`, on a connection of its own. Damage that a search meets goes to the indexer too, through `IndexerHandle::search` or `report_error`, and the indexer rebuilds the file. A missing table counts as damage. Connections refuse to run code from the file's schema, and no value may exceed 128 MiB.

A rebuild fills a second file while search keeps answering from the first, then renames it over the first. A half-built file is never used. `check` looks for every way the tables can disagree.

The earlier titles of renamed pages exist only in the index. They are kept by page ID, so they survive a closed notebook. A rebuild carries them into the new file, and a file replaced for its version or its tables gives them up first when it can be read. A deleted page forgets them. A lost index file still loses them, since the page files do not record old titles.

**Public API.** `SearchIndex::{open, open_in_memory, status, was_created, was_unclean, close, is_healthy, check, begin_rebuild, finish_rebuild, rebuild_with, generation}`, `OpenStatus`, `ReplaceReason`, `Rebuild`, `CheckReport`, `SearchError::is_corrupt`, `IndexerHandle::report_error`.

**What the interface needs.** Put the file in the device-local data folder, never in the notebook folder, so sync tools never copy it. Call `close` on exit. After `was_created` or `was_unclean`, make sure `start` runs. Offer "Rebuild search index" in Settings and in the Check notebook report.

## Wiring checklist

The app wires the crate in `app/src-tauri/src/core_bridge/search.rs` and `app/src/features/search`. What is done and what is left:

1. Done: one Tauri command, `search_call`, carries `query` (typed syntax, filters, regular expression), `switcher`, `suggestPages`, `headings`, `resolve`, `linkPreview`, `backlinks`, `outgoing`, `unlinkedMentions`, `findMentions`, `linkMentions`, `repairEdits`, `tagTree`, `planTagRename`, `planTagDelete`, `titleSettled`, `rebuild`, `status`, and `flush`. The graph methods (`link_graph`, `connections`, `neighbors`) and `palette_find` are not wired: the command palette ranks the app's own commands in the interface.
2. Done: a `search:updated` event carries each batch (pages added, updated, and removed) and the rename plans, with the interface's page IDs.
3. Left: a recent-pages list in the window state. The quick switcher passes the session's recent pages.
4. Done: Ctrl+Shift+F opens the search panel, Ctrl+Alt+G the linked pages pane, and Ctrl+Alt+K, Ctrl+Alt+Enter, and Ctrl+Alt+P start, follow, and preview a link. Left: the OneNote set's tag keys (Ctrl+1 to Ctrl+9) wait for line tags.
5. Left: text equivalents for the graph, which has no view yet.

Until `storage.core` replaces the bridge's one notebook, the bridge's pages have the core's IDs and not the interface's, and their titles live in the interface's tree. The app sends the tree (`sync`) and the hub maps IDs and takes titles from it. Notebook and section filters wait for the real notebooks, and a page the person has not opened or listed in the tree has no entry.

## Tests and benchmarks

```sh
cargo test -p opennote-search -j 3
PROPTEST_CASES=500 cargo test -p opennote-search
cargo test --profile perf -p opennote-search --test benchmark --test corpus --test corpus_advanced -- --include-ignored --nocapture --test-threads=1
```

The property tests compare the index with a plain model after random operations, in memory and in a file. They also check that incremental updates match a fresh build. The `properties_boolean` test does the same for boolean and regular expression searches.

The corpus benchmark uses 1,000 pages and is ignored in a plain run. The `corpus_advanced` benchmark times boolean and regular expression search, the typed syntax, the palette, previews, and tag plans on the same corpus. The `benchmark` test uses 10,000 small pages. Both give their budgets as much time as a debug build needs, so run them with the `perf` profile for the real check. `docs/perf/phase-8-core.md` has the numbers. The `core` test drives a real core on real files.
