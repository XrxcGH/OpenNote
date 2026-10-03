// Math kept as source until Phase 10 renders it (ARCHITECTURE.md section 8.2; owner: WP4). Each atom shows its
// source as written, `$...$` inline and `$$` fences for display math, and opens a small source field on Enter or
// a double-click. Enter or leaving the field saves it as one undo step, Shift+Enter starts a new line of display
// math, and Escape puts the old source back.
import type { Editor, Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import type { EditorHost } from '../host';
import { META_COMMAND } from '../meta';
import { MathBlock, MathInline } from '../schema/nodes';
import styles from './content.module.css';

const views = new WeakMap<Element, MathView>();

class MathView implements NodeView {
  dom: HTMLElement;
  private shown: HTMLElement;
  private field: HTMLInputElement | HTMLTextAreaElement | null = null;

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
    private display: boolean,
  ) {
    this.dom = document.createElement(display ? 'div' : 'span');
    this.dom.className = display ? styles.mathBlock : styles.mathInline;
    this.dom.setAttribute(display ? 'data-math-block' : 'data-math', '');
    this.shown = document.createElement('code');
    this.dom.append(this.shown);
    this.dom.addEventListener('dblclick', () => this.open());
    views.set(this.dom, this);
    this.render();
  }

  private source(): string {
    return this.node.attrs.source as string;
  }

  private render(): void {
    const source = this.source();
    this.shown.textContent = this.display ? `$$\n${source}\n$$` : `$${source}$`;
    this.dom.setAttribute(this.display ? 'data-math-block' : 'data-math', source);
    this.dom.setAttribute('aria-label', t(this.display ? 'editor.math.block' : 'editor.math.inline', { source }));
  }

  /** Opens the source field. */
  open(): void {
    if (this.field || !this.editor.isEditable) return;
    const field = document.createElement(this.display ? 'textarea' : 'input');
    field.className = styles.mathField;
    field.value = this.source();
    field.setAttribute('aria-label', t('editor.math.field'));
    field.addEventListener('keydown', (event) => this.onKey(event as KeyboardEvent));
    field.addEventListener('blur', () => this.close(true));
    this.field = field;
    this.shown.hidden = true;
    this.dom.append(field);
    field.focus();
    field.select();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close(false);
    } else if (event.key === 'Enter' && !(this.display && event.shiftKey)) {
      event.preventDefault();
      this.close(true);
    }
  }

  private close(save: boolean): void {
    const field = this.field;
    if (!field) return;
    this.field = null;
    const source = field.value;
    field.remove();
    this.shown.hidden = false;
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.editor;
    const tr = state.tr;
    if (save && source !== this.source()) {
      tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, source }).setMeta(META_COMMAND, true);
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + this.node.nodeSize)));
    this.editor.view.dispatch(tr);
    this.editor.view.focus();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.field) this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.field !== null && event.target === this.field;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    views.delete(this.dom);
  }
}

/** Enter on a selected math atom opens its source field. */
function openSelected(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || !selection.node.type.name.startsWith('math')) return false;
  const dom = editor.view.nodeDOM(selection.from);
  const view = dom instanceof Element ? views.get(dom) : undefined;
  view?.open();
  return Boolean(view);
}

export function mathBlockExtensions(_host: EditorHost): Extensions {
  return [
    MathBlock.extend({
      addNodeView:
        () =>
        ({ node, editor, getPos }) =>
          new MathView(node, editor, getPos, true),
      addKeyboardShortcuts() {
        return { Enter: () => openSelected(this.editor) };
      },
    }),
  ];
}

export function mathInlineExtensions(_host: EditorHost): Extensions {
  return [
    MathInline.extend({
      addNodeView:
        () =>
        ({ node, editor, getPos }) =>
          new MathView(node, editor, getPos, false),
      addKeyboardShortcuts() {
        return { Enter: () => openSelected(this.editor) };
      },
    }),
  ];
}
