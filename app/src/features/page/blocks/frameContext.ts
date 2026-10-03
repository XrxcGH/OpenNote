// How undo, redo, and other windows' frames reach the page view (ARCHITECTURE.md section 10.5; owner WP3): text
// goes to a block's editor when it has one, and every changed block goes through the block layer, which renders
// static text again for blocks without an editor.
import type { Node as PMNode } from '@tiptap/pm/model';
import { META_REMOTE } from '../../../editor/meta';
import type { AppliedFrame } from '../../../services/pages/types';
import type { EditorPool } from '../pool/pool';
import { blockLaidOut } from '../seams/geometry';
import { acceptRemoteText } from '../sync';
import type { FrameContext } from '../sync';
import { syncOf } from './textBlock';
import type { BlockLayer } from './types';

export interface FrameHooks {
  /** Undo or another window changed the title, tags, or view. */
  setPageFields(fields: NonNullable<AppliedFrame['page']>): void;
  /** Undo or redo restored an object selection. */
  selectObjects(blocks: readonly string[]): void;
}

export function frameContext(pool: EditorPool, layer: () => BlockLayer, hooks: FrameHooks): FrameContext {
  return {
    textState(block) {
      const editor = pool.editor(block);
      const sync = editor && syncOf(editor);
      return editor && sync ? { doc: editor.state.doc, markdown: sync.lastSent() } : null;
    },
    replaceText(block, change, markdown) {
      const editor = pool.editor(block);
      if (!editor || change === 'full' || !('full' in change)) return;
      const doc: PMNode = editor.schema.nodeFromJSON(change.full.toJSON());
      const { tr } = editor.state;
      editor.view.dispatch(tr.replaceWith(0, tr.doc.content.size, doc.content).setMeta(META_REMOTE, true));
      const sync = syncOf(editor);
      if (sync) acceptRemoteText(sync, markdown);
      blockLaidOut(block);
    },
    upsertBlock: (block) => layer().upsert(block),
    removeBlock: (block) => layer().remove(block),
    setPageFields: (fields) => hooks.setPageFields(fields),
    restoreSelection(selection) {
      if (selection.kind === 'objects') return hooks.selectObjects(selection.blocks);
      if (selection.kind !== 'text') return;
      pool.mount(selection.block, { kind: 'selection', anchor: selection.anchor, head: selection.head }, 'target');
      pool.editor(selection.block)?.commands.focus();
    },
    focusedBlock: () => pool.active()?.block ?? null,
  };
}
