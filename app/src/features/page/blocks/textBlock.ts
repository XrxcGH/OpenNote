// The text block renderer (ARCHITECTURE.md section 7; owner after WP0: WP3). A text block opens as static DOM from
// its parsed Markdown, inside the element its editor will edit. The pool mounts the editor in place on pointer
// down, focus, a target, or in idle time, and demotes it back to static DOM when it is far away and idle. The
// editing root keeps its role, name, and focus through both, so assistive technology sees one node throughout.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { parseTextBlock } from '../../../editor/markdown';
import { renderStatic } from '../../../editor/schema/dom';
import type { BlockId, BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { PagePool } from '../pool/pool';
import { pageView } from '../runtime';
import { attachTextSync } from '../sync';
import type { PendingInsert, TextSyncHandle } from '../sync';
import layoutStyles from '../layout/layout.module.css';
import styles from './blocks.module.css';
import type { BlockRenderContext, BlockRendererDef, BlockView } from './types';

const drafts = new WeakMap<BlockJson, PendingInsert>();
const syncs = new WeakMap<Editor, TextSyncHandle>();
const ephemeral = new WeakSet<BlockJson>();

/** Fired on a draft's wrapper when it loses focus empty and untouched; the page removes it unsaved. */
export const DISCARD_DRAFT = 'opennote-discard-draft';

/** A text box that isn't in page.json yet. Its first change inserts it. */
export function markDraft(block: BlockJson, insert: PendingInsert): BlockJson {
  drafts.set(block, insert);
  return block;
}

/** A draft that disappears if it loses focus while still empty: a caret for a new text box. */
export function markEphemeral(block: BlockJson): BlockJson {
  ephemeral.add(block);
  return block;
}

/** The sync of a mounted text block's editor. */
export function syncOf(editor: Editor): TextSyncHandle | null {
  return syncs.get(editor) ?? null;
}

/** A view the block layer renders in two steps: a sized wrapper first, its content when it is near the viewport. */
export interface LazyBlockView extends BlockView {
  readonly rendered: boolean;
  render(): void;
}

export function isLazy(view: BlockView): view is LazyBlockView {
  return typeof (view as Partial<LazyBlockView>).render === 'function';
}

const markdownOf = (block: BlockJson) => (typeof block.data.markdown === 'string' ? block.data.markdown : '');

/** Whether a block sits at its own frame rather than in the flow. */
export function isFloating(block: BlockJson): boolean {
  return block.frame?.x !== undefined && block.frame?.y !== undefined;
}

/** Floating blocks sit at their frame; flowing ones stack in the column. */
export function placeBlock(element: HTMLElement, block: BlockJson): void {
  const frame = block.frame;
  const floating = isFloating(block);
  element.classList.toggle(styles.floating, floating);
  element.style.left = floating ? `${frame!.x}px` : '';
  element.style.top = floating ? `${frame!.y}px` : '';
  element.style.inlineSize = frame?.w !== undefined ? `${frame.w}px` : '';
  // A floating text box without a width is as wide as its content (ARCHITECTURE.md section 6.3).
  const text = floating && block.type === 'text';
  element.classList.toggle(layoutStyles.autoWidth, text && frame?.w === undefined);
  element.classList.toggle(layoutStyles.setWidth, text && frame?.w !== undefined);
}

/** The height an unrendered block holds: the one remembered on this device, or a guess from its Markdown. */
function heldHeight(page: BlockRenderContext['page'], block: BlockId, markdown: string): number {
  const remembered = pageView(page.id)?.heights?.[block];
  if (remembered) return remembered;
  const lines = markdown.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 72)), 0);
  return lines * 24;
}

function attributesOf(element: HTMLElement): [string, string][] {
  return [...element.attributes].map((attribute) => [attribute.name, attribute.value]);
}

function restoreAttributes(element: HTMLElement, saved: readonly [string, string][]): void {
  for (const name of element.getAttributeNames()) element.removeAttribute(name);
  for (const [name, value] of saved) element.setAttribute(name, value);
}

function editingRoot(block: BlockJson): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ProseMirror';
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.setAttribute('aria-label', t('page.block.textEditor'));
  root.setAttribute('spellcheck', 'false');
  root.setAttribute('autocapitalize', 'sentences');
  root.tabIndex = 0;
  root.dataset.scope = 'editor';
  root.dataset.block = block.id;
  return root;
}

class TextBlockView implements LazyBlockView {
  readonly element: HTMLElement;
  readonly editRoot: HTMLElement;
  rendered = false;
  private markdown: string;
  private doc: PMNode | null = null;
  private editor: Editor | null = null;
  private sync: TextSyncHandle | null = null;
  private draft: PendingInsert | null;
  private readonly ephemeral: boolean;
  private touched = false;
  private readonly saved: [string, string][];
  private readonly unregister: () => void;

  constructor(
    private block: BlockJson,
    private readonly ctx: BlockRenderContext,
  ) {
    this.markdown = markdownOf(block);
    this.draft = drafts.get(block) ?? null;
    this.ephemeral = ephemeral.has(block);
    this.element = document.createElement('div');
    this.element.className = styles.block;
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', t('page.block.text'));
    this.element.tabIndex = -1;
    this.element.dataset.blockId = block.id;
    const box = document.createElement('div');
    box.className = styles.text;
    box.style.setProperty('--placeholder', JSON.stringify(t('page.block.placeholder')));
    this.editRoot = editingRoot(block);
    this.editRoot.style.minBlockSize = `${heldHeight(ctx.page, block.id, this.markdown)}px`;
    this.saved = attributesOf(this.editRoot);
    box.append(this.editRoot);
    this.element.append(box);
    placeBlock(this.element, block);
    this.editRoot.addEventListener('focus', this.onFocus);
    this.unregister = (ctx.pool as PagePool).register(block.id, {
      root: this.editRoot,
      mount: () => this.mount(),
      unmount: () => this.unmount(),
      dirty: () => (this.sync?.dirty ?? false) || this.draft !== null,
    });
    // A new text box is ready for typing at once, with its placeholder showing.
    if (this.draft) ctx.pool.mount(block.id, null, 'target');
  }

  render(): void {
    if (this.rendered || this.editor) return;
    this.rendered = true;
    this.doc ??= parseTextBlock(this.markdown);
    renderStatic(this.doc, this.editRoot);
    this.editRoot.style.minBlockSize = '';
  }

  update(next: BlockJson): void {
    const markdown = markdownOf(next);
    this.block = next;
    placeBlock(this.element, next);
    if (this.editor || markdown === this.markdown) return;
    this.markdown = markdown;
    this.doc = null;
    if (!this.rendered) return;
    this.rendered = false;
    this.render();
  }

  measure() {
    const { element } = this;
    return { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
  }

  destroy(): void {
    this.editRoot.removeEventListener('focus', this.onFocus);
    this.unregister();
    this.element.remove();
  }

  private mount(): Editor {
    this.render();
    const doc = this.doc ?? parseTextBlock(this.markdown);
    const editor = createBlockEditor(this.editRoot, doc, { kind: 'text', block: this.block.id, host: this.ctx.host });
    const sync = attachTextSync(editor, this.block.id, this.ctx.sync, this.ctx.cache, this.markdown, this.draft);
    syncs.set(editor, sync);
    editor.on('update', this.onUpdate);
    editor.on('blur', this.onBlur);
    this.editor = editor;
    this.sync = sync;
    return editor;
  }

  private unmount(): void {
    const { editor, sync } = this;
    if (!editor || !sync) return;
    this.doc = editor.state.doc;
    this.markdown = sync.lastSent();
    this.draft = null;
    sync.detach();
    editor.off('update', this.onUpdate);
    editor.off('blur', this.onBlur);
    editor.destroy();
    this.editor = null;
    this.sync = null;
    const name = this.editRoot.getAttribute('aria-label');
    restoreAttributes(this.editRoot, this.saved);
    if (name) this.editRoot.setAttribute('aria-label', name);
    this.editRoot.style.minBlockSize = '';
    renderStatic(this.doc, this.editRoot);
  }

  private readonly onUpdate = () => {
    this.touched = true;
  };

  private readonly onBlur = () => {
    if (!this.ephemeral || this.touched || (this.editor?.state.doc.textContent ?? '') !== '') return;
    const discard = new CustomEvent(DISCARD_DRAFT, { bubbles: true, detail: this.block.id });
    queueMicrotask(() => this.element.dispatchEvent(discard));
  };

  /** Tab, a screen reader, or a script focused the static root: mount with the caret where it last was. */
  private readonly onFocus = () => {
    if (!this.editor) this.ctx.pool.mount(this.block.id, { kind: 'remembered' }, 'focus');
  };
}

export const textBlockRenderer: BlockRendererDef = {
  id: 'text',
  types: ['text'],
  priority: 0,
  create: (block, ctx) => new TextBlockView(block, ctx),
};
