// The editor pool (ARCHITECTURE.md section 7; owner after WP0: WP3): editors mount in place of static text on
// pointer down, focus, or in idle time, up to a cap, and demote back to static text when far away. WP0's pool has
// no cap and no demotion: renderers mount every text block at open and hand the editor to the pool.
import type { Editor } from '@tiptap/core';
import type { BlockId } from '../../../services/pages/types';
import { createStore } from '../../../state/store';

export type MountTarget =
  /** Mount, place the caret, and extend the selection on pointer moves. */
  | { kind: 'point'; event: PointerEvent }
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'remembered' }
  | { kind: 'selection'; anchor: number; head: number };

export interface EditorPool {
  mount(block: BlockId, target: MountTarget | null, reason: 'pointer' | 'focus' | 'target' | 'idle'): Editor | null;
  editor(block: BlockId): Editor | null;
  active(): { block: BlockId; editor: Editor } | null;
  onActiveChange(listener: (block: BlockId | null) => void): () => void;
  demote(block: BlockId): void;
  /** While on, no idle mounts and no demotion. */
  setScreenReader(on: boolean): void;
}

/** The pool of the page that is shown. Commands run on its active editor. */
export const shownPool = createStore<EditorPool | null>(null, 'page editor pool');

/** WP0's pool: renderers adopt the editors they mount, and release them when their block goes. */
export interface StaticPool extends EditorPool {
  adopt(block: BlockId, editor: Editor): void;
  release(block: BlockId): void;
}

export function createEditorPool(): StaticPool {
  const editors = new Map<BlockId, Editor>();
  const listeners = new Set<(block: BlockId | null) => void>();
  let focused: BlockId | null = null;
  const setActive = (block: BlockId | null) => {
    if (focused === block) return;
    focused = block;
    listeners.forEach((listener) => listener(block));
  };
  const place = (editor: Editor, target: MountTarget | null) => {
    if (!target || target.kind === 'point' || target.kind === 'remembered') return;
    if (target.kind === 'selection') editor.commands.setTextSelection({ from: target.anchor, to: target.head });
    else editor.commands.focus(target.kind);
  };
  return {
    mount(block, target) {
      const editor = editors.get(block) ?? null;
      if (editor && target) {
        place(editor, target);
        setActive(block);
      }
      return editor;
    },
    editor: (block) => editors.get(block) ?? null,
    active() {
      const editor = focused === null ? undefined : editors.get(focused);
      return focused !== null && editor ? { block: focused, editor } : null;
    },
    onActiveChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    demote: () => undefined,
    setScreenReader: () => undefined,
    adopt(block, editor) {
      editors.set(block, editor);
      editor.on('focus', () => setActive(block));
      editor.on('blur', () => setActive(focused === block ? null : focused));
    },
    release(block) {
      editors.get(block)?.destroy();
      editors.delete(block);
      if (focused === block) setActive(null);
    },
  };
}
