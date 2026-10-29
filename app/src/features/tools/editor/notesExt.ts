// Math on page lines (Productivity and study tools): `rent = 1,200` on one line and `rent * 12 =` on another, and the
// second line shows its answer after the equals sign. Units work as well (`5 mi in km =`). An equation such as
// `y = x^2` gets a "Graph this" button that hands it to the grapher. The answers are drawn beside the text and are
// never part of it, so the page's words and its Markdown stay as typed. The editor holds one block of text, so the
// lines of that block share their variables.
//
// On the line being typed, an equation with one unknown such as
// `2x + 3 = 11` shows its solution in gray, and Tab adds it as a line of its own (`x = 4`) that later lines can use.
// Calculus works the same way: `d/dx(x^3) =`, `∫ x^2 dx =`, `lim_(x→0) sin(x)/x =`, and `Σ_(n=1)^10 n^2 =` show their
// answer in gray on the line being typed, and Tab adds it after the equals sign. The calculus code loads the first
// time a line looks like calculus, and f'(x) uses a function defined on an earlier line.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../../../strings/t';
import { evaluateNotes } from '../calculator';
import type { NotesRegion } from '../calculator';
import { INSERT_EVENT } from '../flags';
import { announce } from '../../../ui';
import { LIVE_MATH_EVENT, lineAnswersOn, liveSolveOn } from './liveMath';
import { sigFigMode, watchSigFigMode } from '../science/mode';
import { sigFigAnswers } from '../science/notes';
import type { KnownFunction } from '../../math';
import { joinScope, linesBefore, refreshOthers, scopeOf } from './pageScope';
import type { Box } from './pageScope';
import styles from './editor.module.css';

const LEAF = '\u0000';
/** Longer text is left alone, so typing in a huge block stays quick. */
const MAX_CHARS = 30_000;

/** The decimal and group marks of the person's region, from the browser's locale. */
export function regionOfBrowser(): NotesRegion {
  const tag = typeof navigator === 'undefined' || !navigator.language ? 'en-US' : navigator.language;
  const parts = new Intl.NumberFormat(tag).formatToParts(1234567.5);
  const decimal = parts.find((part) => part.type === 'decimal')?.value === ',' ? ',' : '.';
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  return { decimal, group: group === '\u00a0' || group === '\u202f' ? ' ' : group };
}

interface Line {
  /** The position of the line's first character. */
  start: number;
  /** The position after the line's last character. */
  end: number;
  text: string;
}

/** The text blocks of the editor, in order, except code. */
function linesOf(doc: PMNode): Line[] {
  const lines: Line[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!node.type.spec.code)
      lines.push({
        start: pos + 1,
        end: pos + 1 + node.content.size,
        text: node.textBetween(0, node.content.size, undefined, LEAF),
      });
    return false;
  });
  return lines;
}

function graphThis(text: string): void {
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: { graph: text, handled: false } }));
}

function answerWidget(text: string, title?: string): HTMLElement {
  const span = document.createElement('span');
  if (title) span.title = title;
  span.className = styles.answer;
  span.contentEditable = 'false';
  span.dataset.noteAnswer = '';
  span.textContent = ` ${text}`;
  return span;
}

function graphWidget(equation: string): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = styles.graph;
  button.contentEditable = 'false';
  button.textContent = t('study.notes.graph');
  button.setAttribute('aria-label', t('study.notes.graphThis', { equation }));
  // Keep the editor's focus and selection: the button acts, and the caret stays where it was.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => graphThis(equation));
  return button;
}

function ghostWidget(answer: string, sameLine = false): HTMLElement {
  const span = document.createElement('span');
  span.className = styles.ghost;
  span.contentEditable = 'false';
  span.dataset.noteGhost = '';
  span.textContent = ` ${answer}`;
  span.title = t(sameLine ? 'mathTools.live.calculusGhost' : 'mathTools.live.ghost', { answer });
  const key = document.createElement('kbd');
  key.className = styles.ghostKey;
  key.textContent = 'Tab';
  span.append(key);
  return span;
}

/** A solution offered on the line being typed: where it shows, its text, and the line Tab adds. */
export interface Ghost {
  at: number;
  text: string;
  /** The definition Tab adds, such as "x = 4", or the text itself when there are several answers. */
  insert: string;
  /** True when Tab adds the answer after the equals sign on the same line, as for a derivative. */
  sameLine?: boolean;
}

type Calculus = Awaited<ReturnType<typeof import('../../math').loadCalculus>>;
let calculus: Calculus | null = null;
let loadingCalculus = false;

/** A line that looks like a calculus question: d/dx, ∂/∂x, ∫, int, lim, Σ, sum, or f'(x). */
const CALCULUS = /^\s*(?:d[²³^\d]*\/d|∂|∫|int(?![a-z])|lim(?![a-z])|[Σ∑]|sum(?![a-z])|[a-zA-Z](?:'|′)+\s*\()/;

/** Loads the calculus code once, then asks every page box to work out its lines again. */
function loadCalculus(): void {
  if (loadingCalculus) return;
  loadingCalculus = true;
  void import('../../math')
    .then((math) => math.loadCalculus())
    .then((module) => {
      calculus = module;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIVE_MATH_EVENT));
    });
}

/** The answer to a calculus line that ends in "=", or null. */
function calculusAnswer(text: string, functions: ReadonlyMap<string, KnownFunction>): string | null {
  if (!CALCULUS.test(text) || !text.trimEnd().endsWith('=')) return null;
  if (!calculus) {
    loadCalculus();
    return null;
  }
  return calculus.suggestion(text, { mode: 'text', functions: (name) => functions.get(name) })?.text ?? null;
}

export interface NotesState {
  set: DecorationSet;
  ghost: Ghost | null;
}

const EMPTY: NotesState = { set: DecorationSet.empty, ghost: null };

/** The index of the line the caret is in, when the selection is a caret. */
function caretLine(lines: readonly Line[], caret: number | null): number | undefined {
  if (caret === null) return undefined;
  const index = lines.findIndex((line) => caret >= line.start && caret <= line.end);
  return index < 0 ? undefined : index;
}

/**
 * The answers for a box, and the solution offered on the caret's line. `before` is the lines of the page's earlier
 * boxes, which lend their variables. `caret` is the caret's place, or null for no caret (or no solving).
 */
export function notesState(
  doc: PMNode,
  region: NotesRegion,
  before: readonly string[] = [],
  caret: number | null = null,
): NotesState {
  if (doc.textContent.length > MAX_CHARS || !doc.textContent.includes('=')) return EMPTY;
  const lines = linesOf(doc);
  const solveAt = caretLine(lines, caret);
  const texts = [...before, ...lines.map((line) => line.text)];
  const all = evaluateNotes(texts, {
    region,
    ...(solveAt === undefined ? {} : { solveLine: before.length + solveAt }),
  });
  const results = all.slice(before.length);
  // Significant-figures mode rounds a question's answer by the rules, and the rule is its tooltip.
  const rounded = sigFigMode() ? sigFigAnswers(texts, all, region, before.length) : null;
  const found: Decoration[] = [];
  let ghost: Ghost | null = null;
  const functions = new Map<string, KnownFunction>();
  all.slice(0, before.length).forEach((result) => result.kind === 'function' && functions.set(result.name, result));
  results.forEach((result, index) => {
    const line = lines[index];
    if (result.kind === 'function') functions.set(result.name, result);
    const derived = result.kind === 'error' ? calculusAnswer(line.text, functions) : null;
    if (derived !== null && index === solveAt) {
      ghost = { at: line.end, text: derived, insert: derived, sameLine: true };
      found.push(
        Decoration.widget(line.end, () => ghostWidget(derived, true), { side: 1, key: `c${index}:${derived}` }),
      );
    } else if (derived !== null) {
      found.push(Decoration.widget(line.end, () => answerWidget(derived), { side: 1, key: `a${index}:${derived}` }));
    } else if (result.kind === 'solve') {
      ghost = { at: line.end, text: result.text, insert: result.text };
      found.push(
        Decoration.widget(line.end, () => ghostWidget(result.text), { side: 1, key: `s${index}:${result.text}` }),
      );
    } else if (result.kind === 'result' || (result.kind === 'define' && result.shown)) {
      const sig = rounded?.get(before.length + index);
      found.push(
        Decoration.widget(line.end, () => answerWidget(sig?.text ?? result.text, sig?.rule), {
          side: 1,
          key: `a${index}:${sig?.text ?? result.text}`,
        }),
      );
    } else if (result.kind === 'equation') {
      found.push(
        Decoration.widget(line.end, () => graphWidget(line.text.trim()), { side: 1, key: `g${index}:${line.text}` }),
      );
    }
  });
  return { set: DecorationSet.create(doc, found), ghost };
}

/** The answers for a box, with no solving. */
export function notesDecorations(doc: PMNode, region: NotesRegion, before: readonly string[] = []): DecorationSet {
  return notesState(doc, region, before).set;
}

/**
 * Adds the offered solution as a line of its own after its equation, with the caret at its end; or, for a calculus
 * answer, after the equals sign on the same line.
 */
export function acceptGhost(view: EditorView, ghost: Ghost): boolean {
  const { state } = view;
  const $at = state.doc.resolve(ghost.at);
  if (!$at.parent.isTextblock || $at.parentOffset !== $at.parent.content.size) return false;
  if (ghost.sameLine) {
    const spaced = state.doc.textBetween(ghost.at - 1, ghost.at) === ' ' ? ghost.insert : ` ${ghost.insert}`;
    view.dispatch(state.tr.insertText(spaced, ghost.at).scrollIntoView());
    return true;
  }
  const tr = state.tr.split(ghost.at).insertText(ghost.insert);
  view.dispatch(tr.scrollIntoView());
  return true;
}

const key = new PluginKey<NotesState>('opennoteNotes');
const REFRESH = 'opennoteNotesRefresh';

/** The state for an editor: nothing when answers are turned off, and solving only for a caret. */
function compute(state: EditorState, region: NotesRegion, before: readonly string[]): NotesState {
  if (!lineAnswersOn()) return EMPTY;
  const caret = liveSolveOn() && state.selection.empty ? state.selection.from : null;
  return notesState(state.doc, region, before, caret);
}

export function notesExtension(): Extension {
  const region = regionOfBrowser();
  return Extension.create({
    name: 'opennoteNotes',
    addProseMirrorPlugins: () => {
      // What this box knows of its page: set when the editor is on screen, empty until then.
      let root: Element | null = null;
      let box: Box | null = null;
      const before = () => (root !== null && box !== null ? linesBefore(root, box) : []);
      return [
        new Plugin<NotesState>({
          key,
          state: {
            init: (_config, state) => compute(state, region, []),
            apply: (tr, old, _before, state) =>
              tr.docChanged || tr.getMeta(REFRESH) || (tr.selectionSet && liveSolveOn())
                ? compute(state, region, before())
                : old,
          },
          props: {
            decorations: (state) => key.getState(state)?.set,
            handleKeyDown: (view, event) => {
              if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
              const ghost = key.getState(view.state)?.ghost;
              const { selection } = view.state;
              if (!ghost || !selection.empty || selection.from !== ghost.at) return false;
              if (!acceptGhost(view, ghost)) return false;
              announce(t('mathTools.live.added', { answer: ghost.insert }));
              return true;
            },
          },
          view: (view) => {
            const self: Box = {
              element: view.dom,
              lines: () => linesOf(view.state.doc).map((line) => line.text),
              refresh: () => {
                if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(REFRESH, true));
              },
            };
            box = self;
            let leave: (() => void) | null = null;
            const join = () => {
              const next = scopeOf(view.dom);
              if (next === root) return;
              leave?.();
              root = next;
              leave = next === null ? null : joinScope(next, self);
              if (next !== null) self.refresh();
            };
            // The editor is placed in its block after it is made, so look for the page a moment later.
            const timer = setTimeout(join, 0);
            const changed = () => self.refresh();
            window.addEventListener(LIVE_MATH_EVENT, changed);
            const stopWatching = watchSigFigMode(() => self.refresh());
            return {
              update: (updated, prev) => {
                if (updated.state.doc === prev.doc) return;
                if (root !== null) queueMicrotask(() => root !== null && refreshOthers(root, self));
              },
              destroy: () => {
                clearTimeout(timer);
                window.removeEventListener(LIVE_MATH_EVENT, changed);
                stopWatching();
                leave?.();
                root = null;
                box = null;
              },
            };
          },
        }),
      ];
    },
  });
}
