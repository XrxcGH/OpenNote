// Backspace at the start of a flowing text block merges it into the text block above (ARCHITECTURE.md section 8.4;
// owner: WP4). The editor asks with MERGE_BLOCKS_EVENT, because merging needs the pool and the sync queue. The
// result is one batch: the text edit on the block above, with deleteBlocks for the merged block riding along.
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import type { MergeBlocksDetail } from '../../../editor/commands/state';
import { META_COMMAND } from '../../../editor/meta';
import { shownPool } from '../pool/shown';
import { appendToNextBatch } from '../sync/shown';

/** Moves `block`'s content to the end of `previous`, joining the two textblocks that meet. */
export function mergeIntoPrevious({ block, previous }: MergeBlocksDetail): boolean {
  const pool = shownPool.get();
  const above = pool?.editor(previous) ?? pool?.mount(previous, null, 'target') ?? null;
  const below = pool?.editor(block) ?? null;
  if (!above || !below || above.isDestroyed || below.isDestroyed) return false;
  const { state } = above;
  const end = state.doc.content.size;
  // Each editor builds its own schema, so the content moves through JSON.
  const content = Fragment.fromJSON(state.schema, below.state.doc.content.toJSON());
  const tr = state.tr.insert(end, content);
  const $join = tr.doc.resolve(end);
  const textblocks = Boolean($join.nodeBefore?.isTextblock && $join.nodeAfter?.isTextblock);
  const joins = textblocks && canJoin(tr.doc, end);
  if (joins) tr.join(end);
  const caret = joins ? end - 1 : end + 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))));
  appendToNextBatch(previous, [{ edit: 'deleteBlocks', blocks: [block] }]);
  above.view.dispatch(tr.setMeta(META_COMMAND, true));
  above.commands.focus(undefined, { scrollIntoView: false });
  return true;
}
