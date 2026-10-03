// Math on page lines (Productivity and study tools): `rent = 1,200` on one line and `rent * 12 =` on another, and the
// second line shows its answer after the equals sign. Units work as well (`5 mi in km =`). An equation such as
// `y = x^2` gets a "Graph this" button that hands it to the grapher. The answers are drawn beside the text and are
// never part of it, so the page's words and its Markdown stay as typed. The editor holds one block of text, so the
// lines of that block share their variables.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../../../strings/t';
import { evaluateNotes } from '../calculator';
import type { NotesRegion } from '../calculator';
import { INSERT_EVENT } from '../flags';
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
  return { decimal, group: group === ' ' || group === ' ' ? ' ' : group };
}

interface Line {
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
      lines.push({ end: pos + 1 + node.content.size, text: node.textBetween(0, node.content.size, undefined, LEAF) });
    return false;
  });
  return lines;
}

function graphThis(text: string): void {
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: { graph: text, handled: false } }));
}

function answerWidget(text: string): HTMLElement {
  const span = document.createElement('span');
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

export function notesDecorations(doc: PMNode, region: NotesRegion): DecorationSet {
  if (doc.textContent.length > MAX_CHARS || !doc.textContent.includes('=')) return DecorationSet.empty;
  const lines = linesOf(doc);
  const results = evaluateNotes(
    lines.map((line) => line.text),
    { region },
  );
  const found: Decoration[] = [];
  results.forEach((result, index) => {
    const line = lines[index];
    if (result.kind === 'result' || (result.kind === 'define' && result.shown)) {
      found.push(
        Decoration.widget(line.end, () => answerWidget(result.text), { side: 1, key: `a${index}:${result.text}` }),
      );
    } else if (result.kind === 'equation') {
      found.push(
        Decoration.widget(line.end, () => graphWidget(line.text.trim()), { side: 1, key: `g${index}:${line.text}` }),
      );
    }
  });
  return DecorationSet.create(doc, found);
}

const key = new PluginKey<DecorationSet>('opennoteNotes');

export function notesExtension(): Extension {
  const region = regionOfBrowser();
  return Extension.create({
    name: 'opennoteNotes',
    addProseMirrorPlugins: () => [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => notesDecorations(state.doc, region),
          apply: (tr, old) => (tr.docChanged ? notesDecorations(tr.doc, region) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ],
  });
}
