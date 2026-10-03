// The editor pool (ARCHITECTURE.md section 7; owner after WP0: WP3). Text renders as static DOM, and an editor
// mounts in place of it on pointer down, on focus, for a target (an undo selection, a link, the Reading order
// pane), or in idle time for blocks near the viewport. At most 16 unfocused editors stay mounted: one more demotes
// the least recently used editor that is off screen, unfocused, and has nothing unsent. While a screen reader runs,
// nothing mounts in idle time and nothing demotes, because replacing DOM under a virtual cursor would move it.
import type { Editor } from '@tiptap/core';
import type { BlockId } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { placeAtPoint } from './point';

export type MountTarget =
  /** Mount, place the caret, and extend the selection on pointer moves. */
  | { kind: 'point'; event: PointerEvent }
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'remembered' }
  | { kind: 'selection'; anchor: number; head: number };

export type MountReason = 'pointer' | 'focus' | 'target' | 'idle';

export interface EditorPool {
  mount(block: BlockId, target: MountTarget | null, reason: MountReason): Editor | null;
  editor(block: BlockId): Editor | null;
  active(): { block: BlockId; editor: Editor } | null;
  onActiveChange(listener: (block: BlockId | null) => void): () => void;
  demote(block: BlockId): void;
  /** While on, no idle mounts and no demotion. */
  setScreenReader(on: boolean): void;
}

/** The pool of the page that is shown. Commands run on its active editor. */
export const shownPool = createStore<EditorPool | null>(null, 'page editor pool');

/** At most this many unfocused editors stay mounted (ADR 0005, spike S3). */
export const POOL_CAP = 16;

/** A block whose editor the pool mounts and demotes: the text renderer registers one per text block. */
export interface Mountable {
  /** The editing root, which stays the same node mounted or not. */
  readonly root: HTMLElement;
  /** Mounts the editor in place of the static DOM, in one task. */
  mount(): Editor;
  /** Destroys the editor and puts static DOM from its document back, in one task. */
  unmount(): void;
  /** Whether the editor has changes the core hasn't seen. */
  dirty(): boolean;
}

/** The page view's pool: the EditorPool contract plus what renderers and the page view use. */
export interface PagePool extends EditorPool {
  /** Makes a block's editor the pool's to mount. Returns a function that destroys it and forgets the block. */
  register(block: BlockId, mountable: Mountable): () => void;
  /** An editor a renderer mounted itself; it counts toward the cap but never demotes. */
  adopt(block: BlockId, editor: Editor): void;
  release(block: BlockId): void;
  /** How many editors are mounted. */
  mountedCount(): number;
  /** Starts idle mounting for blocks within half a viewport of `viewport`. */
  watch(viewport: HTMLElement): void;
  destroy(): void;
}

/** WP0's name for the page view's pool. */
export type StaticPool = PagePool;

interface Entry {
  mountable: Mountable | null;
  editor: Editor | null;
  used: number;
  remembered: { anchor: number; head: number } | null;
  stop: (() => void) | null;
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: (deadline: { timeRemaining(): number }) => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};
type Scheduling = { scheduling?: { isInputPending?: () => boolean } };

/** Places the caret for a mount's target. */
function place(editor: Editor, target: MountTarget, entry: Entry): void {
  if (target.kind === 'point') return placeAtPoint(editor, target.event);
  if (target.kind === 'selection') {
    editor.commands.setTextSelection({ from: target.anchor, to: target.head });
    return;
  }
  if (target.kind === 'remembered' && entry.remembered) {
    const size = editor.state.doc.content.size;
    const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
    editor.commands.focus(null, { scrollIntoView: false });
    editor.commands.setTextSelection({ from: clamp(entry.remembered.anchor), to: clamp(entry.remembered.head) });
    return;
  }
  editor.commands.focus(target.kind === 'end' ? 'end' : 'start', { scrollIntoView: false });
}

class Pool implements PagePool {
  private readonly entries = new Map<BlockId, Entry>();
  private readonly listeners = new Set<(block: BlockId | null) => void>();
  private readonly near = new Set<BlockId>();
  private focused: BlockId | null = null;
  private clock = 0;
  private screenReader = false;
  private observer: IntersectionObserver | null = null;
  private idle = 0;

  constructor(private readonly view: IdleWindow) {}

  mount(block: BlockId, target: MountTarget | null, reason: MountReason): Editor | null {
    const entry = this.entries.get(block);
    if (!entry) return null;
    if (!entry.editor) {
      if (!entry.mountable || (reason === 'idle' && this.screenReader)) return null;
      this.attach(block, entry, entry.mountable.mount());
    }
    entry.used = ++this.clock;
    const editor = entry.editor!;
    if (target) {
      place(editor, target, entry);
      this.setActive(block);
    }
    this.enforceCap();
    return editor;
  }

  editor(block: BlockId): Editor | null {
    return this.entries.get(block)?.editor ?? null;
  }

  active(): { block: BlockId; editor: Editor } | null {
    const editor = this.focused === null ? null : this.editor(this.focused);
    return this.focused !== null && editor ? { block: this.focused, editor } : null;
  }

  onActiveChange(listener: (block: BlockId | null) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  demote(block: BlockId): void {
    const entry = this.entries.get(block);
    if (this.screenReader || !entry?.editor || !entry.mountable || !this.demotable(block, entry)) return;
    const { from, to } = entry.editor.state.selection;
    entry.remembered = { anchor: from, head: to };
    entry.stop?.();
    entry.stop = null;
    entry.editor = null;
    entry.mountable.unmount();
  }

  setScreenReader(on: boolean): void {
    this.screenReader = on;
    if (on) this.cancelIdle();
    else this.scheduleIdle();
  }

  register(block: BlockId, mountable: Mountable): () => void {
    const entry: Entry = { mountable, editor: null, used: 0, remembered: null, stop: null };
    this.entries.set(block, entry);
    this.observer?.observe(mountable.root);
    return () => {
      this.observer?.unobserve(mountable.root);
      if (this.entries.get(block) !== entry) return;
      this.forget(block, entry);
      if (entry.editor) mountable.unmount();
    };
  }

  adopt(block: BlockId, editor: Editor): void {
    const entry: Entry = { mountable: null, editor: null, used: ++this.clock, remembered: null, stop: null };
    this.entries.set(block, entry);
    this.attach(block, entry, editor);
  }

  release(block: BlockId): void {
    const entry = this.entries.get(block);
    if (!entry) return;
    this.forget(block, entry);
    if (!entry.mountable) entry.editor?.destroy();
  }

  mountedCount(): number {
    return [...this.entries.values()].filter((entry) => entry.editor).length;
  }

  watch(viewport: HTMLElement): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const margin = `${Math.round(viewport.clientHeight / 2)}px`;
    this.observer = new IntersectionObserver(this.onIntersect, { root: viewport, rootMargin: `${margin} 0px` });
    for (const entry of this.entries.values()) if (entry.mountable) this.observer.observe(entry.mountable.root);
  }

  destroy(): void {
    this.observer?.disconnect();
    this.cancelIdle();
    for (const [block, entry] of [...this.entries]) {
      this.forget(block, entry);
      if (entry.mountable && entry.editor) entry.mountable.unmount();
      else entry.editor?.destroy();
    }
  }

  private attach(block: BlockId, entry: Entry, editor: Editor): void {
    entry.editor = editor;
    const onFocus = () => this.setActive(block);
    const onBlur = () => {
      const { from, to } = editor.state.selection;
      entry.remembered = { anchor: from, head: to };
      if (this.focused === block) this.setActive(null);
    };
    editor.on('focus', onFocus);
    editor.on('blur', onBlur);
    entry.stop = () => {
      editor.off('focus', onFocus);
      editor.off('blur', onBlur);
    };
  }

  private forget(block: BlockId, entry: Entry): void {
    entry.stop?.();
    entry.stop = null;
    this.entries.delete(block);
    this.near.delete(block);
    if (this.focused === block) this.setActive(null);
  }

  private setActive(block: BlockId | null): void {
    if (this.focused === block) return;
    this.focused = block;
    this.listeners.forEach((listener) => listener(block));
  }

  /** Off screen, unfocused, not the active block, and nothing unsent. */
  private demotable(block: BlockId, entry: Entry): boolean {
    if (this.focused === block || this.near.has(block)) return false;
    const root = entry.mountable?.root;
    if (!root || root.contains(root.ownerDocument.activeElement)) return false;
    return !entry.mountable!.dirty();
  }

  private enforceCap(): void {
    if (this.screenReader) return;
    const mounted = [...this.entries].filter(([block, entry]) => entry.editor && block !== this.focused);
    let extra = mounted.length - POOL_CAP;
    if (extra <= 0) return;
    const candidates = mounted
      .filter(([block, entry]) => entry.mountable && this.demotable(block, entry))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [block] of candidates) {
      if (extra <= 0) break;
      this.demote(block);
      extra -= 1;
    }
  }

  private readonly onIntersect = (records: IntersectionObserverEntry[]) => {
    for (const record of records) {
      const block = (record.target as HTMLElement).dataset.block;
      if (!block) continue;
      if (record.isIntersecting) this.near.add(block);
      else this.near.delete(block);
    }
    this.scheduleIdle();
  };

  private scheduleIdle(): void {
    if (this.idle || this.screenReader || ![...this.near].some((block) => !this.editor(block))) return;
    const run = (deadline: { timeRemaining(): number }) => {
      this.idle = 0;
      this.mountOneIdle(deadline);
    };
    this.idle = this.view.requestIdleCallback
      ? this.view.requestIdleCallback(run)
      : this.view.setTimeout(() => run({ timeRemaining: () => 8 }), 50);
  }

  private cancelIdle(): void {
    if (!this.idle) return;
    if (this.view.cancelIdleCallback) this.view.cancelIdleCallback(this.idle);
    else this.view.clearTimeout(this.idle);
    this.idle = 0;
  }

  /** One editor per idle slice, for the nearest block in view without one, unless input is waiting. */
  private mountOneIdle(deadline: { timeRemaining(): number }): void {
    const pending = (this.view.navigator as Navigator & Scheduling).scheduling?.isInputPending?.() ?? false;
    if (this.screenReader || pending || deadline.timeRemaining() < 4) return this.scheduleIdle();
    const waiting = [...this.near].filter((block) => !this.editor(block) && this.entries.get(block)?.mountable);
    const top = (block: BlockId) => this.entries.get(block)!.mountable!.root.getBoundingClientRect().top;
    const nearest = waiting.sort((a, b) => Math.abs(top(a)) - Math.abs(top(b)))[0];
    if (nearest) this.mount(nearest, null, 'idle');
    this.scheduleIdle();
  }
}

export function createEditorPool(view: Window = window): PagePool {
  return new Pool(view);
}
