// Change case (owner: text:editor-commands; text DESIGN.md 4.1). It rewrites the text, so it is one text change.
// Each run is cased in its own language: the run's `lang` mark, else its paragraph's `lang`, so Turkish text
// uppercases i to a dotted capital I. Shift+F3 cycles UPPERCASE, lowercase, and Sentence case or Capitalize Each Word.
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { fromChange } from './command';
import type { Command } from './command';

export const CASE_MODES = ['sentence', 'lower', 'upper', 'title', 'toggle'] as const;
export type CaseMode = (typeof CASE_MODES)[number];

/** A run of selected text, with the language it is cased in. */
export interface CaseRun {
  text: string;
  lang?: string;
}

const IN_WORD = /[\p{L}\p{M}\p{N}'’]/u;
const LETTER = /\p{L}/u;
const SENTENCE_END = /[.!?]/;

/** A language tag as a locale, or undefined for none and for "no language" (zxx). */
function localeOf(lang: string | undefined): string | undefined {
  if (!lang || lang === 'zxx') return undefined;
  try {
    return Intl.getCanonicalLocales(lang)[0];
  } catch {
    return undefined;
  }
}

const upper = (char: string, locale?: string) => char.toLocaleUpperCase(locale);
const lower = (char: string, locale?: string) => char.toLocaleLowerCase(locale);

/**
 * The runs with their case changed. Sentence case capitalizes the first letter after the start and after `.`, `!`,
 * or `?` followed by a space, and lowercases the rest; Capitalize Each Word does the same at each word's start.
 */
export function changeCaseRuns(runs: readonly CaseRun[], mode: CaseMode): string[] {
  let capNext = true;
  let ended = false;
  let previous = '';
  return runs.map(({ text, lang }) => {
    const locale = localeOf(lang);
    let out = '';
    for (const char of text) {
      if (mode === 'upper') out += upper(char, locale);
      else if (mode === 'lower') out += lower(char, locale);
      else if (mode === 'toggle') out += lower(char, locale) === char ? upper(char, locale) : lower(char, locale);
      else if (mode === 'title') out += IN_WORD.test(previous) ? lower(char, locale) : upper(char, locale);
      else {
        if (/\s/u.test(char) && ended) capNext = true;
        if (LETTER.test(char) && capNext) {
          out += upper(char, locale);
          capNext = false;
        } else out += lower(char, locale);
        if (SENTENCE_END.test(char)) ended = true;
        else if (!/\s/u.test(char)) ended = false;
      }
      previous = char;
    }
    return out;
  });
}

/** One string's case changed, in one language. */
export function changeCaseText(text: string, mode: CaseMode, lang?: string): string {
  return changeCaseRuns([{ text, lang }], mode)[0];
}

/** What Shift+F3 does next: UPPERCASE from mixed text, lowercase from UPPERCASE, and from lowercase Sentence case
 * when the text ends a sentence, else Capitalize Each Word. Null without letters. */
export function nextCycleMode(text: string): CaseMode | null {
  const letters = [...text].filter((char) => LETTER.test(char)).join('');
  if (letters === '') return null;
  if (letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return 'lower';
  if (letters === letters.toLowerCase()) return SENTENCE_END.test(text.trim().slice(-1)) ? 'sentence' : 'title';
  return 'upper';
}

interface Segment {
  from: number;
  to: number;
  node: PMNode;
  text: string;
  lang?: string;
}

/** The selected text, run by run. A caret takes the word around it, as Word does. */
function segments(state: EditorState | Transaction): { from: number; to: number; parts: Segment[] } {
  let { from, to } = state.selection;
  if (from === to) {
    const $at = state.doc.resolve(from);
    const text = $at.parent.textContent;
    let start = $at.parentOffset;
    let end = start;
    while (start > 0 && IN_WORD.test(text[start - 1])) start -= 1;
    while (end < text.length && IN_WORD.test(text[end])) end += 1;
    from = $at.start() + start;
    to = $at.start() + end;
  }
  const parts: Segment[] = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code === true) return !node.isText;
    const runLang = node.marks.find((mark) => mark.type.name === 'lang')?.attrs.lang as string | undefined;
    const paraLang = typeof parent?.attrs.lang === 'string' ? parent.attrs.lang : undefined;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    const text = (node.text ?? '').slice(start - pos, end - pos);
    parts.push({ from: start, to: end, node, text, lang: runLang ?? paraLang });
    return false;
  });
  return { from, to, parts };
}

/** Rewrites the selected text in a case mode, keeping every run's marks. False when nothing changes. */
export function changeCaseChange(mode: CaseMode | 'cycle'): (tr: Transaction) => boolean {
  return (tr) => {
    const { from, to, parts } = segments(tr);
    const texts = parts.map((part) => part.text);
    const chosen = mode === 'cycle' ? nextCycleMode(texts.join('')) : mode;
    if (!chosen) return false;
    const cased = changeCaseRuns(
      parts.map((part, i) => ({ text: texts[i], lang: part.lang })),
      chosen,
    );
    let changed = false;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (cased[i] === texts[i]) continue;
      tr.replaceWith(parts[i].from, parts[i].to, tr.doc.type.schema.text(cased[i], parts[i].node.marks));
      changed = true;
    }
    if (!changed) return false;
    tr.setSelection(TextSelection.create(tr.doc, from, tr.mapping.map(to)));
    return true;
  };
}

/** Change case in a mode, or `'cycle'` for Shift+F3. */
export function changeCase(mode: CaseMode | 'cycle'): Command {
  return fromChange(changeCaseChange(mode));
}
