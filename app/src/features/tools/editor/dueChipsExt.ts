// Due dates on a page's checkboxes and tagged lines (Productivity and study tools): the date the line ends with is
// read with the same parser as Upcoming and shown beside the line as a button. Pressing it opens a date picker, and
// the chosen date replaces the date words in the line. The chip is drawn beside the text and is not part of it.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../../../strings/t';
import { dateKey, findDue, parseDateKey } from '../upcoming';
import type { Due } from '../upcoming';
import { datePart, dueCandidate, formatDue } from '../upcoming/pageDue';
import styles from './editor.module.css';

const LEAF = '\u0000';
const MAX_CHARS = 30_000;

interface Found {
  /** The position of the text block's first character. */
  start: number;
  end: number;
  text: string;
  phrase: string;
  due: Due;
}

function dueText(due: Due): string {
  const day = new Date(due.date.year, due.date.month - 1, due.date.day);
  const date = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!due.time) return date;
  const time = new Date(2000, 0, 1, due.time.hour, due.time.minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date}, ${time}`;
}

/** The text blocks that end in a date and belong to a checkbox item or carry a tag. */
export function findDuesIn(doc: PMNode, now: number, timeZone: string): Found[] {
  if (doc.textContent.length > MAX_CHARS) return [];
  const found: Found[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    const text = node.textBetween(0, node.content.size, undefined, LEAF);
    const task =
      parent?.type.name === 'listItem' && parent.attrs.checked !== null && parent.attrs.checked !== undefined;
    const candidate = dueCandidate(task ? `- [ ] ${text}` : text);
    if (!candidate || candidate.text === '') return false;
    const due = findDue(candidate.text, { now, timeZone });
    const phrase = due ? datePart(due.phrase) : '';
    if (due && text.lastIndexOf(phrase) !== -1) {
      found.push({ start: pos + 1, end: pos + 1 + node.content.size, text, phrase, due: due.due });
    }
    return false;
  });
  return found;
}

function replaceDate(view: EditorView, item: Found, picked: string): void {
  const date = parseDateKey(picked);
  if (!date) return;
  const at = item.text.lastIndexOf(item.phrase);
  // The text may have changed while the picker was open, so the phrase is looked for again.
  const now = view.state.doc.textBetween(item.start, Math.min(item.end, view.state.doc.content.size), undefined, LEAF);
  const from = item.start + (now === item.text ? at : now.lastIndexOf(item.phrase));
  if (from < item.start) return;
  const tr = view.state.tr.insertText(formatDue({ date, time: item.due.time }), from, from + item.phrase.length);
  view.dispatch(tr);
  view.focus();
}

function chip(view: EditorView, item: Found): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = styles.chip;
  button.contentEditable = 'false';
  const label = dueText(item.due);
  button.textContent = label;
  button.setAttribute('aria-label', t('study.dueDates.pick', { date: label }));
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'date';
    input.value = dateKey(item.due.date);
    input.className = styles.picker;
    input.setAttribute('aria-label', t('study.dueDates.open'));
    button.after(input);
    const done = () => input.remove();
    input.addEventListener('change', () => {
      replaceDate(view, item, input.value);
      done();
    });
    input.addEventListener('blur', () => setTimeout(done, 200));
    input.focus();
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  });
  return button;
}

const key = new PluginKey<DecorationSet>('opennoteDueChips');

function chips(doc: PMNode, view: EditorView | null): DecorationSet {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const found = findDuesIn(doc, Date.now(), zone);
  return DecorationSet.create(
    doc,
    found.map((item) =>
      Decoration.widget(item.end, (editorView) => chip(editorView ?? view!, item), {
        side: 1,
        key: `d${item.start}:${item.phrase}:${dateKey(item.due.date)}`,
      }),
    ),
  );
}

export function dueChipsExtension(): Extension {
  return Extension.create({
    name: 'opennoteDueChips',
    addProseMirrorPlugins: () => [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => chips(state.doc, null),
          apply: (tr, old) => (tr.docChanged ? chips(tr.doc, null) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ],
  });
}
