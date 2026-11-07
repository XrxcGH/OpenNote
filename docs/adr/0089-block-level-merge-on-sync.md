# ADR 0089: Block-level merge on sync, with a merger and a conflict view per block type

- Status: Proposed
- Date: 2026-11-07

## Context

When two devices change the same page and neither saw the other's save, sync keeps one version as `page.json` and the other in `.conflicts/` (ADR 0049, format spec 14.1). ADR 0049 lists block-level merge of `page.json` as a follow-up. Tables (ADR 0066) and code projects (ADR 0069) each want to merge their own blocks and to show their own compare view. Without one shared entry point, each would change the sync merge and the conflict dialog on its own.

## Decision

One entry point in `crates/core/src/merge` and one view registry in `app/src/features/qol/conflict`.

- **Mergers.** A block type registers a `BlockMerger` with `opennote_core::merge::register(type, merger)` at startup. `merge_block(type, base, mine, theirs)` returns the merged block, or a conflict. Equal sides, or a side equal to the base, need no merger. With no merger for the type, the result is a conflict, which means today's conflict copy.
- **When a page merges.** Sync tries `merge_page` only when two maximal versions of one `page.json` are both live and neither revision lists the other among its ancestors. The base is the newest revision both list as an ancestor whose `.history/<revision>.json.gz` snapshot is in the merged manifests. With no such snapshot, nothing merges. `merge_page` returns a page only when all of these hold:
  - At least one changed block has a type with a registered merger. So with no merger registered, every result is byte-identical to today's, and a page whose changes are all in text never merges here.
  - Every block that changed on both sides, to different results, has a merger, and it succeeds.
  - No block was deleted on one side and changed on the other.
  - Every other page field (title, tags, view, ink, recordings, encryption, unknown keys) changed on at most one side. Assets merge per key. `modified` takes the later time.
- **Convergence.** Every device must reach the same bytes from the same versions, in any order. Mergers must be commutative. The merged revision is made from the two revisions alone. Its ID's time is one millisecond after the later one, and its random part is the exclusive or of theirs. Both revisions are its parents and ancestors. Its device, writer, and `saved_at` are the later side's. The merged file's version vector is the join of the two, as for the other merged files.
- **Conflict views.** `conflict.text` also returns `blocks`: each block that differs between the two versions, with its ID, type, and both sides as `page.json` writes them. A block type registers a compare and resolve view with `registerConflictView(type, view)`. The conflict dialog shows that view for each changed block of the type, and the side-by-side text for everything else. A view resolves the conflict with the same three choices as the dialog.

## Options considered

| Option | For | Against |
|---|---|---|
| One registry for mergers and one for views, opt in per block type (chosen) | Each program plugs in without touching sync or the dialog; nothing changes until a type registers | A page with a table and text merges text changes only when the table changed too |
| Merge every page whose blocks changed on different sides, even with no merger | More pages merge | Changes today's results for text pages, which the plan rules out until text merges per paragraph |
| Each program edits the sync merge and the dialog | No shared code | Three lanes editing the same two files; rules drift apart |

## Consequences

- Tables (ADR 0066) register their merger and view in B14; code projects (ADR 0069) register theirs in B13.
- Two devices on app versions with different mergers can disagree for one round: the newer one merges, and the older one keeps a conflict copy. The merged revision lists both versions as ancestors, so every device keeps the merged page, and the older device's conflict copy stays for the person to review. No text is lost.
- A merge needs a shared `.history` snapshot. History thinning (spec 13.3) can remove the newest one, and then an older shared snapshot is the base, or the page keeps its conflict copy.
- Tests in `crates/sync/tests/block_merge.rs`: with no merger, sync results and conflict copies are byte-identical.
- Tests in `crates/core/src/merge/mod.rs`: with a fake merger, two devices that changed different blocks merge with no conflict copy. `merge(base, a, b)` equals `merge(base, b, a)` over 2,000 generated cases.
- Tests in `app/src/features/qol/conflict/registry.test.tsx`: the conflict dialog shows a registered view, and the text view for the rest.
