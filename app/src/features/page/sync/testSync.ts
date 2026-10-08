// A sync queue over the memory page service, with real editors and a recording frame context, for WP2's tests.
import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { createMarkdownCache, parseTextBlock } from '../../../editor/markdown';
import { META_REMOTE } from '../../../editor/meta';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { MemoryPageService } from '../../../services/pages/memory';
import type { BlockJson, EditBatch, OpenPage, PageJson } from '../../../services/pages/types';
import { createEditorHost } from '../editorHost';
import type { FrameContext } from './frames';
import { createSyncQueue } from './queue';
import type { SyncQueue } from './queue';
import { acceptRemoteText, attachTextSync } from './textSync';
import type { PendingInsert, TextSyncHandle } from './textSync';

export const PAGE = '01k6syncpage00000000000000';
export const blockId = (n: number) => `01k6syncb10ck0000000000${String(n).padStart(3, '0')}`;
const AT = '2026-10-01T09:00:00.000Z';

export function syncPage(texts: readonly string[], extra: readonly BlockJson[] = []): PageJson {
  const blocks: BlockJson[] = texts.map((markdown, i) => ({
    id: blockId(i + 1),
    type: 'text',
    order: `a${i}`,
    created: AT,
    modified: AT,
    data: { markdown },
  }));
  return {
    id: PAGE,
    title: 'Sync',
    created: AT,
    modified: AT,
    tags: [],
    view: {},
    blocks: [...blocks, ...extra],
    assets: {},
  };
}

export interface SyncRig {
  service: MemoryPageService;
  page: OpenPage;
  queue: SyncQueue;
  editors: Map<string, Editor>;
  syncs: Map<string, TextSyncHandle>;
  /** What the frame context was asked to do. */
  calls: string[];
  /** The order keys the frame context gave blocks. */
  orders: Record<string, string>;
  announced: string[];
  focused: { block: string | null };
  sent(): readonly EditBatch[];
  /** The page as the service holds it now. */
  held(): Promise<PageJson>;
  /** Mounts a text editor for a block, as the text renderer does. */
  mount(block: string, markdown: string, insert?: PendingInsert): Editor;
  /** Types each character as its own transaction at the selection. */
  type(block: string, text: string): void;
}

function frameContext(rig: Pick<SyncRig, 'editors' | 'syncs' | 'calls' | 'orders' | 'focused'>): FrameContext {
  return {
    textState(block) {
      const editor = rig.editors.get(block);
      const sync = rig.syncs.get(block);
      return editor && sync ? { doc: editor.state.doc, markdown: sync.lastSent() } : null;
    },
    replaceText(block, change, markdown) {
      const editor = rig.editors.get(block)!;
      const { tr } = editor.state;
      if (change === 'full') return;
      if ('full' in change)
        tr.replaceWith(0, tr.doc.content.size, Fragment.fromJSON(editor.schema, change.full.content.toJSON()));
      else tr.replaceWith(change.from, change.to, Fragment.fromJSON(editor.schema, change.content.toJSON()));
      editor.view.dispatch(tr.setMeta(META_REMOTE, true));
      acceptRemoteText(rig.syncs.get(block)!, markdown);
      rig.calls.push(`text ${block}`);
    },
    upsertBlock: (block) => void rig.calls.push(`upsert ${block.id}`),
    reorder: (block, order) => void (rig.orders[block] = order),
    removeBlock: (block) => void rig.calls.push(`remove ${block}`),
    setPageFields: (fields) => void rig.calls.push(`fields ${JSON.stringify(fields)}`),
    restoreSelection: (selection) => void rig.calls.push(`select ${JSON.stringify(selection)}`),
    focusedBlock: () => rig.focused.block,
  };
}

export async function syncRig(page: PageJson, options: { supportsSplice?: boolean } = {}): Promise<SyncRig> {
  const service = createMemoryPageService([{ page }], { supportsSplice: options.supportsSplice });
  const open = await service.open(page.id, { viewport: null });
  const cache = createMarkdownCache();
  const base = {
    editors: new Map<string, Editor>(),
    syncs: new Map<string, TextSyncHandle>(),
    calls: [],
    orders: {},
    focused: { block: null },
  };
  const announced: string[] = [];
  const queue = createSyncQueue({
    page: open,
    cache,
    frames: frameContext(base),
    announce: (text) => void announced.push(text),
  });
  const rig: SyncRig = {
    ...base,
    service,
    page: open,
    queue,
    announced,
    sent: () => service.sent(page.id),
    async held() {
      const again = await service.open(page.id, { viewport: null });
      await again.close();
      return again.initial;
    },
    mount(block, markdown, insert) {
      const root = document.body.appendChild(document.createElement('div'));
      const editor = createBlockEditor(root, parseTextBlock(markdown), {
        kind: 'text',
        block,
        host: createEditorHost(),
      });
      rig.editors.set(block, editor);
      rig.syncs.set(block, attachTextSync(editor, block, queue, cache, markdown, insert ?? null));
      return editor;
    },
    type(block, text) {
      const editor = rig.editors.get(block)!;
      for (const char of text) editor.view.dispatch(editor.state.tr.insertText(char));
    },
  };
  page.blocks
    .filter((block) => block.type === 'text')
    .forEach((block) => rig.mount(block.id, String(block.data.markdown)));
  return rig;
}

/** Puts the caret at the end of the block's text. */
export function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}
