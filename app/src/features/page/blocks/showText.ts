// Shows text a command already sent for a block (Replace, the Markdown source view): in the block's editor when
// it has one, even focused, and in the block layer. The editor takes only the changed range, so the caret stays
// where it was, and its sync learns the core's text so it never sends the same text back.
import { META_REMOTE } from '../../../editor/meta';
import { parseTextBlock } from '../../../editor/markdown';
import type { BlockId } from '../../../services/pages/types';
import type { EditorPool } from '../pool/pool';
import { blockLaidOut } from '../seams/geometry';
import { acceptRemoteText } from '../sync';
import { syncOf } from './textBlock';
import type { PageBlockLayer } from './blockLayer';

export function showSentText(pool: EditorPool, layer: PageBlockLayer, block: BlockId, markdown: string): void {
  const editor = pool.editor(block);
  const sync = editor ? syncOf(editor) : null;
  if (editor && sync) {
    const next = editor.schema.nodeFromJSON(parseTextBlock(markdown).toJSON());
    const { doc } = editor.state;
    const start = doc.content.findDiffStart(next.content);
    if (start !== null) {
      let { a: endA, b: endB } = doc.content.findDiffEnd(next.content)!;
      const overlap = start - Math.min(endA, endB);
      if (overlap > 0) {
        endA += overlap;
        endB += overlap;
      }
      editor.view.dispatch(editor.state.tr.replace(start, endA, next.slice(start, endB)).setMeta(META_REMOTE, true));
      blockLaidOut(block);
    }
    acceptRemoteText(sync, markdown);
  }
  const current = layer.block(block);
  if (current) layer.upsert({ ...current, data: { ...current.data, markdown } });
}
