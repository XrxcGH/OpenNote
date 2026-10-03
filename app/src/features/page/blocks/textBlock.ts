// The text block renderer (ARCHITECTURE.md section 7; owner after WP0: WP3). WP0's version mounts an editor for
// every text block at open, through the static pool, and syncs it with the stub queue. WP3 renders static DOM
// first and mounts in place on demand.
import type { Editor } from '@tiptap/core';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { parseTextBlock } from '../../../editor/markdown';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { StaticPool } from '../pool/pool';
import { attachTextSync } from '../sync';
import type { PendingInsert, TextSyncHandle } from '../sync';
import styles from './blocks.module.css';
import type { BlockRendererDef, BlockView } from './types';

const drafts = new WeakMap<BlockJson, PendingInsert>();
const syncs = new WeakMap<Editor, TextSyncHandle>();

/** A text box that isn't in page.json yet. Its first change inserts it. */
export function markDraft(block: BlockJson, insert: PendingInsert): BlockJson {
  drafts.set(block, insert);
  return block;
}

/** The sync of a mounted text block's editor. */
export function syncOf(editor: Editor): TextSyncHandle | null {
  return syncs.get(editor) ?? null;
}

const markdownOf = (block: BlockJson) => (typeof block.data.markdown === 'string' ? block.data.markdown : '');

/** Floating blocks sit at their frame; flowing ones stack in the column. */
export function placeBlock(element: HTMLElement, block: BlockJson): void {
  const frame = block.frame;
  const floating = frame?.x !== undefined && frame?.y !== undefined;
  element.classList.toggle(styles.floating, floating);
  element.style.left = floating ? `${frame.x}px` : '';
  element.style.top = floating ? `${frame.y}px` : '';
  element.style.inlineSize = frame?.w !== undefined ? `${frame.w}px` : '';
}

export const textBlockRenderer: BlockRendererDef = {
  id: 'text',
  types: ['text'],
  priority: 0,
  create(block, ctx): BlockView {
    const element = document.createElement('div');
    element.className = styles.block;
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', t('page.block.text'));
    element.tabIndex = -1;
    element.dataset.blockId = block.id;
    const editRoot = document.createElement('div');
    editRoot.className = styles.text;
    editRoot.dataset.scope = 'editor';
    editRoot.style.setProperty('--placeholder', JSON.stringify(t('page.block.placeholder')));
    element.append(editRoot);
    placeBlock(element, block);
    const markdown = markdownOf(block);
    const editor = createBlockEditor(editRoot, parseTextBlock(markdown), {
      kind: 'text',
      block: block.id,
      host: ctx.host,
    });
    editor.view.dom.setAttribute('aria-label', t('page.block.textEditor'));
    editor.view.dom.setAttribute('aria-multiline', 'true');
    editor.view.dom.setAttribute('role', 'textbox');
    const pool = ctx.pool as StaticPool;
    pool.adopt(block.id, editor);
    const sync = attachTextSync(editor, block.id, ctx.sync, ctx.cache, markdown, drafts.get(block) ?? null);
    syncs.set(editor, sync);
    return {
      element,
      editRoot,
      update: (next) => placeBlock(element, next),
      measure: () => ({ x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight }),
      destroy() {
        sync.detach();
        pool.release(block.id);
        element.remove();
      },
    };
  },
};
