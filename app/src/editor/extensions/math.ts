// Math in text (ARCHITECTURE.md section 8.2; owners: WP4, then the Phase 10 lane). Each atom shows its source as
// written, `$...$` inline and `$$` fences for display math, until the page's host can draw LaTeX. Then it shows the
// drawn equation, with MathML behind it for screen readers. Enter or a double-click opens a source field with a
// live preview and the LaTeX problem, if any. Enter or leaving the field saves it as one undo step, Shift+Enter
// starts a new line of display math, and Escape puts the old source back.
import { InputRule, type Editor, type Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import type { EditorHost, MathActionResult, MathRenderer } from '../host';
import { META_COMMAND } from '../meta';
import { MathBlock, MathInline } from '../schema/nodes';
import styles from './content.module.css';
import drawn from './mathDrawn.module.css';

const views = new WeakMap<Element, MathView>();

class MathView implements NodeView {
  dom: HTMLElement;
  private shown: HTMLElement;
  private field: HTMLInputElement | HTMLTextAreaElement | null = null;
  private preview: HTMLElement | null = null;
  private problem: HTMLElement | null = null;
  private holder: HTMLElement | null = null;
  private renderer: MathRenderer | null = null;
  private gone = false;

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
    private display: boolean,
    private host: EditorHost,
  ) {
    this.dom = document.createElement(display ? 'div' : 'span');
    this.dom.className = display ? styles.mathBlock : styles.mathInline;
    this.dom.setAttribute(display ? 'data-math-block' : 'data-math', '');
    this.shown = document.createElement('span');
    this.dom.append(this.shown);
    this.dom.addEventListener('dblclick', () => this.open());
    views.set(this.dom, this);
    this.render();
    host.math?.()?.then(
      (renderer) => {
        if (this.gone) return;
        this.renderer = renderer;
        this.render();
        if (this.field && !this.preview) this.addPreview(this.field);
      },
      () => undefined,
    );
  }

  private source(): string {
    return this.node.attrs.source as string;
  }

  /** The drawing of some source, or null when the renderer isn't loaded or there is nothing to draw. */
  private draw(source: string) {
    return this.renderer && source.trim() !== '' ? this.renderer.render(source, this.display) : null;
  }

  private render(): void {
    const source = this.source();
    const drawing = this.draw(source);
    this.dom.setAttribute(this.display ? 'data-math-block' : 'data-math', source);
    this.dom.setAttribute('aria-label', t(this.display ? 'editor.math.block' : 'editor.math.inline', { source }));
    this.dom.classList.toggle(drawn.invalid, drawing !== null && !drawing.ok);
    if (drawing && !drawing.ok) this.dom.title = drawing.message;
    else this.dom.removeAttribute('title');
    if (drawing?.ok) {
      this.dom.setAttribute('role', 'math');
      this.shown.className = drawn.drawn;
      this.shown.innerHTML = drawing.html;
      return;
    }
    this.dom.removeAttribute('role');
    this.shown.className = '';
    this.shown.textContent = this.display ? `$$\n${source}\n$$` : `$${source}$`;
  }

  /** Opens the source field. */
  open(): void {
    if (this.field || !this.editor.isEditable) return;
    const field = document.createElement(this.display ? 'textarea' : 'input');
    field.className = styles.mathField;
    field.value = this.source();
    field.setAttribute('aria-label', t('editor.math.field'));
    field.addEventListener('keydown', (event) => this.onKey(event as KeyboardEvent));
    field.addEventListener('input', () => this.showPreview());
    // Tab moves on to Simplify and Solve in the panel under the field; leaving the equation entirely saves it.
    field.addEventListener('blur', (event) => {
      if (!this.holder?.contains((event as FocusEvent).relatedTarget as Node | null)) this.close(true);
    });
    this.field = field;
    this.shown.hidden = true;
    this.dom.append(field);
    if (this.renderer) this.addPreview(field);
    field.focus();
    field.select();
  }

  private addPreview(field: HTMLElement): void {
    // The preview, the problem, and the actions sit together: under the field for display math, and floating
    // under it for an inline equation, so nothing in them is covered by the others.
    const holder = document.createElement('div');
    holder.className = this.display ? drawn.holderBlock : drawn.holderInline;
    // The paragraph's paint containment would clip the floating panel; blocks.module.css lifts it while this is open.
    holder.setAttribute('data-math-holder', '');
    holder.addEventListener('focusout', (event) => {
      const to = event.relatedTarget as Node | null;
      if (!holder.contains(to) && to !== this.field) this.close(true);
    });
    const preview = document.createElement('div');
    preview.className = drawn.preview;
    const problem = document.createElement('div');
    problem.className = drawn.problem;
    problem.setAttribute('role', 'status');
    holder.append(preview, problem);
    const actions = this.renderer?.actions;
    if (actions) {
      const bar = document.createElement('div');
      bar.className = drawn.actions;
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', t('smart.math.actions'));
      for (const kind of ['simplify', 'solve'] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = t(`smart.math.${kind}`);
        // A press must not take focus from the field, or the field would close and save.
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => this.act(actions[kind]));
        bar.append(button);
      }
      holder.append(bar);
    }
    this.preview = preview;
    this.problem = problem;
    this.holder = holder;
    field.after(holder);
    this.showPreview();
  }

  private showPreview(): void {
    const { field, preview, problem } = this;
    if (!field || !preview || !problem) return;
    const drawing = this.draw(field.value);
    field.setAttribute('aria-invalid', String(drawing !== null && !drawing.ok));
    preview.hidden = !drawing?.ok;
    if (drawing?.ok) preview.innerHTML = drawing.html;
    problem.textContent = drawing && !drawing.ok ? t('smart.math.problem', { message: drawing.message }) : '';
  }

  /** True while this equation is still on the page of that editor. */
  usableIn(editor: Editor): boolean {
    return !this.gone && this.editor === editor && this.dom.isConnected;
  }

  /** Opens the field if needed and runs Simplify or Solve on it, as the buttons in the panel do. */
  runAction(kind: 'simplify' | 'solve'): boolean {
    this.open();
    const actions = this.renderer?.actions;
    if (!this.field || !actions) return false;
    this.act(actions[kind]);
    return true;
  }

  /** Runs Simplify or Solve on what is in the field, and says what happened. */
  private act(run: (latex: string) => MathActionResult): void {
    const field = this.field;
    if (!field) return;
    const result = run(field.value);
    if (result.ok) {
      field.value = result.latex;
      this.showPreview();
      this.host.announce(t('smart.math.done'));
    } else this.host.announce(t(`smart.math.${result.reason}`));
    field.focus();
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
    rememberClosed(this);
    field.remove();
    this.holder?.remove();
    this.preview = this.problem = this.holder = null;
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
    // Keys and focus inside the field and its panel (Tab to Simplify and Solve) are not the editor's.
    const target = event.target as Node | null;
    return this.field !== null && (target === this.field || Boolean(this.holder?.contains(target)));
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.gone = true;
    views.delete(this.dom);
  }
}

/** Enter on a selected math atom opens its source field. */
function openSelected(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || !selection.node.type.name.startsWith('math')) return false;
  return openMathAt(editor, selection.from);
}

/** Opens the source field of the math atom at `pos`. False when there is none. */
export function openMathAt(editor: Editor, pos: number): boolean {
  const dom = editor.view.nodeDOM(pos);
  const view = dom instanceof Element ? views.get(dom) : undefined;
  view?.open();
  return Boolean(view);
}

/** The equation whose field closed last: opening the palette closes the field and moves the caret, so Simplify and
 * Solve from Ctrl+K act on this one when none is selected. */
let lastClosed: MathView | null = null;
function rememberClosed(view: MathView): void {
  lastClosed = view;
}

/** Simplify or Solve for the selected equation, the one just before the caret, or the one edited last. */
export function runMathAction(editor: Editor, kind: 'simplify' | 'solve'): boolean {
  const { selection } = editor.state;
  let pos: number | null = null;
  if (selection instanceof NodeSelection && selection.node.type.name.startsWith('math')) pos = selection.from;
  else {
    const before = selection.$from.nodeBefore;
    if (before?.type.name.startsWith('math')) pos = selection.from - before.nodeSize;
  }
  if (pos !== null) {
    const dom = editor.view.nodeDOM(pos);
    const view = dom instanceof Element ? views.get(dom) : undefined;
    if (view) return view.runAction(kind);
  }
  return lastClosed?.usableIn(editor) ? lastClosed.runAction(kind) : false;
}

export function mathBlockExtensions(host: EditorHost): Extensions {
  return [
    MathBlock.extend({
      addNodeView:
        () =>
        ({ node, editor, getPos }) =>
          new MathView(node, editor, getPos, true, host),
      addKeyboardShortcuts() {
        return { Enter: () => openSelected(this.editor) };
      },
      // Typing $$x^2$$ alone on a line makes display math.
      addInputRules() {
        const type = this.type;
        return [
          new InputRule({
            find: /^\$\$([^$]+)\$\$$/,
            handler: ({ state, range, match }) => {
              const $from = state.doc.resolve(range.from);
              if ($from.parent.type.name !== 'paragraph' || match[1].trim() === '') return null;
              state.tr.replaceWith($from.before(), $from.after(), type.create({ source: match[1].trim() }));
            },
          }),
        ];
      },
    }),
  ];
}

export function mathInlineExtensions(host: EditorHost): Extensions {
  return [
    MathInline.extend({
      addNodeView:
        () =>
        ({ node, editor, getPos }) =>
          new MathView(node, editor, getPos, false, host),
      addKeyboardShortcuts() {
        return { Enter: () => openSelected(this.editor) };
      },
      // Typing $x^2$ makes an equation; "$5 and $" stays text because the source can't end in a space.
      addInputRules() {
        const type = this.type;
        return [
          new InputRule({
            find: /(?<![$\w\\])\$([^$\s](?:[^$]*[^$\s])?)\$$/,
            handler: ({ state, range, match }) => {
              state.tr.replaceWith(range.from, range.to, type.create({ source: match[1] }));
            },
          }),
        ];
      },
    }),
  ];
}
