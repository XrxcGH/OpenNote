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
import type { EditorHost, MathActionResult, MathRenderer, VisualMathField } from '../host';
import { META_COMMAND } from '../meta';
import { GRAPH_LANGUAGE } from './graphFence';
import { createPenPad } from './mathPen';
import type { PenPad } from './mathPen';
import { MathBlock, MathInline } from '../schema/nodes';
import styles from './content.module.css';
import drawn from './mathDrawn.module.css';

const views = new WeakMap<Element, MathView>();
const MODE_KEY = 'opennote.math.visual';

/** Whether the person last edited equations visually. A choice kept in the browser, and visual until they pick LaTeX. */
function prefersVisual(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) !== 'latex';
  } catch {
    return true;
  }
}

function rememberMode(visual: boolean): void {
  try {
    localStorage.setItem(MODE_KEY, visual ? 'visual' : 'latex');
  } catch {
    // The choice lasts until the page is closed.
  }
}

type Field = HTMLInputElement | HTMLTextAreaElement | (HTMLElement & { value: string });

/** What a command can do to an equation: Simplify, Solve, or open its graph. */
export type MathActionKind = 'simplify' | 'solve' | 'graph' | 'steps';

class MathView implements NodeView {
  dom: HTMLElement;
  private shown: HTMLElement;
  private answer: HTMLElement | null = null;
  /** The steps under the field, while they are shown. */
  private stepsList: HTMLElement | null = null;
  /** The Graph button over a selected equation. */
  private graphButton: HTMLButtonElement | null = null;
  private field: Field | null = null;
  private visual: VisualMathField | null = null;
  private toggle: HTMLButtonElement | null = null;
  private penButton: HTMLButtonElement | null = null;
  private pad: PenPad | null = null;
  private swapping = false;
  /** Handwriting is being read, so the field keeps its place while a dialog may take focus. */
  private recognizing = false;
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
    // A click selects the whole equation, so it offers its graph; a double click goes on to open it.
    this.dom.addEventListener('click', (event) => {
      const pos = this.getPos();
      if (this.field || pos === undefined || (event.target instanceof Node && this.graphButton?.contains(event.target)))
        return;
      const { state } = this.editor;
      if (!(state.selection instanceof NodeSelection && state.selection.from === pos))
        this.editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
    });
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
    this.showAnswer(drawing?.ok ? (this.renderer?.live?.(source) ?? null) : null);
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

  /** The live answer after the drawn equation, such as "x = 4", or none. */
  private showAnswer(answer: string | null): void {
    if (answer === null) {
      this.answer?.remove();
      this.answer = null;
      this.dom.removeAttribute('aria-description');
      return;
    }
    if (!this.answer) {
      this.answer = document.createElement('span');
      this.answer.className = drawn.answer;
      this.answer.setAttribute('aria-hidden', 'true');
      this.answer.dataset.mathAnswer = '';
      this.dom.append(this.answer);
    }
    this.answer.textContent = answer;
    this.dom.setAttribute('aria-description', t('mathTools.live.answer', { answer }));
  }

  /** Shows or hides the steps for what is in the field, under the panel's buttons. */
  private toggleSteps(button?: HTMLButtonElement): boolean {
    void this.showSteps(button);
    return Boolean(this.renderer?.steps && this.holder && this.field);
  }

  private async showSteps(button?: HTMLButtonElement): Promise<void> {
    const steps = this.renderer?.steps;
    const holder = this.holder;
    const field = this.field;
    if (!steps || !holder || !field) return;
    if (this.stepsList) {
      this.stepsList.remove();
      this.stepsList = null;
      button?.setAttribute('aria-expanded', 'false');
      return;
    }
    const view = await steps(this.visual ? this.visual.value : field.value);
    // The equation may have closed while the steps were worked out.
    if (this.holder !== holder || this.stepsList) return;
    const list = document.createElement('section');
    list.className = drawn.steps;
    list.dataset.mathSteps = '';
    list.setAttribute('aria-live', 'polite');
    if (!view.ok) {
      list.textContent = view.message;
    } else {
      const heading = document.createElement('h4');
      heading.textContent = view.title;
      const items = document.createElement('ol');
      for (const step of view.steps) {
        const item = document.createElement('li');
        const rule = document.createElement('span');
        rule.className = drawn.stepRule;
        rule.textContent = step.rule;
        const math = document.createElement('span');
        const drawing = this.draw(step.latex);
        if (drawing?.ok) math.innerHTML = drawing.html;
        else math.textContent = step.latex;
        item.append(rule, math);
        items.append(item);
      }
      list.append(heading, items);
    }
    holder.append(list);
    this.stepsList = list;
    button?.setAttribute('aria-expanded', 'true');
  }

  /** The equation is selected: it offers its graph, when it has one. */
  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    const graph = this.renderer?.graph;
    if (!graph || this.field || this.graphButton || graph.source(this.source()) === null) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = drawn.graphButton;
    button.textContent = t('mathTools.graphPopup.graph');
    button.setAttribute('aria-label', t('mathTools.graphPopup.graphThis'));
    button.dataset.mathGraph = '';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => this.openGraph());
    this.graphButton = button;
    this.dom.append(button);
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
    this.graphButton?.remove();
    this.graphButton = null;
  }

  /** Opens the graph of the equation beside it. False when the page offers no graph or the equation has none. */
  openGraph(): boolean {
    const graph = this.renderer?.graph;
    const latex = this.field ? (this.visual ? this.visual.value : this.field.value) : this.source();
    if (!graph || graph.source(latex) === null) return false;
    graph.open(latex, this.dom, (source) => this.insertGraphAfter(source));
    return true;
  }

  /** Puts a graph block after the block this equation is in, as one undo step. */
  private insertGraphAfter(source: string): void {
    const pos = this.getPos();
    const type = this.editor.schema.nodes.codeBlock;
    if (pos === undefined || !type || !this.editor.isEditable) return;
    const { state } = this.editor;
    const $pos = state.doc.resolve(pos);
    const after = $pos.depth > 0 ? $pos.after(1) : pos + this.node.nodeSize;
    const block = type.create({ language: GRAPH_LANGUAGE }, state.schema.text(source));
    this.editor.view.dispatch(state.tr.insert(after, block).setMeta(META_COMMAND, true));
  }

  /** Opens the source field. */
  open(): void {
    if (this.field || !this.editor.isEditable) return;
    this.graphButton?.remove();
    this.graphButton = null;
    const field = this.plainField(this.source());
    this.field = field;
    // The paragraph stops clipping its drawing while the equation is open, so the preview and actions that float under
    // the equation are seen and can be pressed (blocks.module.css).
    this.dom.setAttribute('data-math-editing', '');
    this.shown.hidden = true;
    if (this.answer) this.answer.hidden = true;
    this.dom.append(field);
    if (this.renderer) this.addPreview(field);
    field.focus();
    field.select();
  }

  private plainField(value: string): HTMLInputElement | HTMLTextAreaElement {
    const field = document.createElement(this.display ? 'textarea' : 'input');
    field.className = styles.mathField;
    field.value = value;
    field.setAttribute('aria-label', t('editor.math.field'));
    this.wire(field);
    return field;
  }

  private wire(field: Field): void {
    field.addEventListener('keydown', (event) => this.onKey(event as KeyboardEvent));
    field.addEventListener('input', () => this.showPreview());
    // Tab moves on to Simplify and Solve in the panel under the field; leaving the equation entirely saves it.
    field.addEventListener('blur', (event) => {
      if (this.swapping || this.recognizing) return;
      if (!this.holder?.contains((event as FocusEvent).relatedTarget as Node | null)) this.close(true);
    });
  }

  /** Swaps the open field for the visual editor or back, keeping what was typed. */
  private async swap(toVisual: boolean): Promise<void> {
    const old = this.field;
    const make = this.renderer?.visual;
    if (!old) return;
    const value = this.visual ? this.visual.value : old.value;
    let next: Field;
    let visual: VisualMathField | null = null;
    if (toVisual) {
      if (!make) return;
      try {
        visual = await make.create({ value, label: t('editor.math.visualField'), display: this.display });
      } catch {
        this.host.announce(t('editor.math.visualFailed'));
        return;
      }
      if (this.field !== old) return;
      next = visual.element as Field;
      next.classList.add(styles.mathField);
      this.wire(next);
    } else {
      next = this.plainField(value);
    }
    // The old field leaves without saving, because the new one holds the same equation.
    this.swapping = true;
    old.replaceWith(next);
    this.swapping = false;
    this.field = next;
    this.visual = visual;
    rememberMode(toVisual);
    this.updateToggle();
    this.showPreview();
    next.focus();
    if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) next.select();
  }

  /** Opens the writing area under the equation. */
  private openPad(holder: HTMLElement): void {
    const recognize = this.renderer?.pen?.recognize;
    if (!recognize || this.pad || !this.visual) return;
    const pad = createPenPad(() => {
      const strokes = pad.strokes();
      const visual = this.visual;
      if (strokes.length === 0 || !visual) return;
      // Reading handwriting may ask the person to turn it on first, and that dialog takes focus from the field. The
      // field stays open meanwhile, or the equation would close and save before the answer came back.
      this.recognizing = true;
      void recognize(strokes)
        .finally(() => {
          this.recognizing = false;
        })
        .then((latex) => {
          if (!latex || !this.visual) {
            this.host.announce(t('intelMore.math.penNone'));
            return;
          }
          visual.insert(latex);
          pad.clear();
          this.showPreview();
        });
    });
    this.pad = pad;
    holder.classList.add(drawn.holderPadOpen);
    holder.append(pad.element);
  }

  private closePad(): void {
    this.pad?.element.parentElement?.classList.remove(drawn.holderPadOpen);
    this.pad?.element.remove();
    this.pad = null;
  }

  private updateToggle(): void {
    if (this.toggle) this.toggle.textContent = t(this.visual ? 'editor.math.useLatex' : 'editor.math.useVisual');
    if (this.penButton) this.penButton.hidden = !this.visual;
    if (!this.visual) this.closePad();
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
    if (this.renderer?.visual) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = drawn.toggle;
      // A press must not take focus from the field, or the field would close and save.
      toggle.addEventListener('mousedown', (event) => event.preventDefault());
      toggle.addEventListener('click', () => void this.swap(!this.visual));
      this.toggle = toggle;
      holder.append(toggle);
      if (this.renderer.pen) {
        const pen = document.createElement('button');
        pen.type = 'button';
        pen.className = drawn.toggle;
        pen.textContent = t('intelMore.math.penWrite');
        pen.addEventListener('mousedown', (event) => event.preventDefault());
        pen.addEventListener('click', () => (this.pad ? this.closePad() : this.openPad(holder)));
        this.penButton = pen;
        holder.append(pen);
      }
      this.updateToggle();
    }
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
    if (this.renderer?.steps) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = drawn.toggle;
      button.textContent = t('mathTools.steps.button');
      button.setAttribute('aria-expanded', 'false');
      // A press must not take focus from the field, or the field would close and save.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.toggleSteps(button));
      holder.append(button);
    }
    const graph = this.renderer?.graph;
    if (graph) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = drawn.toggle;
      button.textContent = t('mathTools.graphPopup.graph');
      button.setAttribute('aria-label', t('mathTools.graphPopup.graphThis'));
      // A press must not take focus from the field, or the field would close and save.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        if (!this.openGraph()) this.host.announce(t('mathTools.graphPopup.none'));
      });
      holder.append(button);
    }
    this.preview = preview;
    this.problem = problem;
    this.holder = holder;
    field.after(holder);
    this.showPreview();
    if (this.renderer?.visual && prefersVisual() && !this.visual) void this.swap(true);
  }

  private showPreview(): void {
    const { field, preview, problem } = this;
    if (!field || !preview || !problem) return;
    const drawing = this.draw(this.visual ? this.visual.value : field.value);
    field.setAttribute('aria-invalid', String(drawing !== null && !drawing.ok));
    preview.hidden = !drawing?.ok;
    if (drawing?.ok) preview.innerHTML = drawing.html;
    problem.textContent = drawing && !drawing.ok ? t('smart.math.problem', { message: drawing.message }) : '';
  }

  /** True while this equation is still on the page of that editor. */
  usableIn(editor: Editor): boolean {
    return !this.gone && this.editor === editor && this.dom.isConnected;
  }

  /** Opens the field if needed and runs Simplify or Solve on it, as the buttons in the panel do. Graph opens the graph. */
  runAction(kind: MathActionKind): boolean {
    if (kind === 'graph') return this.openGraph();
    this.open();
    if (kind === 'steps')
      return this.toggleSteps(this.holder?.querySelector<HTMLButtonElement>('[aria-expanded]') ?? undefined);
    const actions = this.renderer?.actions;
    if (!this.field || !actions) return false;
    this.act(actions[kind]);
    return true;
  }

  /** Runs Simplify or Solve on what is in the field, and says what happened. */
  private act(run: (latex: string) => MathActionResult): void {
    const field = this.field;
    if (!field) return;
    const result = run(this.visual ? this.visual.value : field.value);
    if (result.ok) {
      if (this.visual) this.visual.value = result.latex;
      else field.value = result.latex;
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
    this.dom.removeAttribute('data-math-editing');
    const source = this.visual ? this.visual.value : field.value;
    rememberClosed(this);
    if (save && this.visual && source.trim() !== '')
      this.host.announce(t('editor.math.spoken', { text: this.visual.spoken() }));
    this.closePad();
    this.visual = null;
    this.toggle = null;
    this.penButton = null;
    field.remove();
    this.holder?.remove();
    this.preview = this.problem = this.holder = null;
    this.stepsList = null;
    this.shown.hidden = false;
    if (this.answer) this.answer.hidden = false;
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
    // The Graph button over a selected equation is pressed, not the equation.
    if (this.graphButton && event.target instanceof Node && this.graphButton.contains(event.target)) return true;
    if (this.field === null) return false;
    // Keys and focus inside the field and its panel (Tab to Simplify and Solve, writing in the pen pad) are not the
    // editor's: it would take focus and close the equation.
    const target = event.target instanceof Node ? event.target : null;
    return target === this.field || Boolean(target && this.holder?.contains(target));
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
export function runMathAction(editor: Editor, kind: MathActionKind): boolean {
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
              const block = type.create({ source: match[1].trim() });
              const { tr } = state;
              tr.replaceWith($from.before(), $from.after(), block);
              // The caret goes on to a new line below, so what is typed next is text, not the equation, and Enter
              // there does not open the equation editor (Beta 5 walk W2-11).
              const after = $from.before() + block.nodeSize;
              tr.insert(after, type.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
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
