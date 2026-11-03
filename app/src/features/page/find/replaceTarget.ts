// The page on screen as the target of Replace in all notebooks (search/replace/apply.ts): its batch goes through the
// page's own queue, so the page's undo and redo cover it, and the new text shows at once in the editor and the layer.
import type { BlockJson, Edit } from '../../../services/pages/types';
import { showSentText } from '../blocks/showText';
import { syncOf } from '../blocks/textBlock';
import { shownMounted } from '../pagesApi';

export interface ReplaceTarget {
  readonly id: string;
  flush(): Promise<void>;
  blocks(): readonly BlockJson[];
  send(edits: Edit[]): Promise<void>;
  show(edit: Edit): void;
}

export function shownReplaceTarget(): ReplaceTarget | null {
  const mounted = shownMounted.get();
  if (!mounted || mounted.page.readOnly) return null;
  const { layer, pool, sync } = mounted;
  return {
    id: mounted.page.id,
    flush: () => sync.flushAll('command'),
    blocks() {
      // A text block's editor knows the core's Markdown; the layer's copy may be older.
      return layer.blocks().map((block): BlockJson => {
        const editor = block.type === 'text' ? pool.editor(block.id) : null;
        const sent = editor ? syncOf(editor)?.lastSent() : undefined;
        return sent === undefined ? block : { ...block, data: { ...block.data, markdown: sent } };
      });
    },
    async send(edits) {
      await sync.send({ edits });
    },
    show(edit: Edit) {
      if (edit.edit === 'setText') return showSentText(pool, layer, edit.block, edit.markdown);
      if (edit.edit !== 'patchBlock' || !edit.data) return;
      const current = layer.block(edit.block);
      if (current) layer.upsert({ ...current, data: { ...current.data, ...edit.data } });
    },
  };
}
