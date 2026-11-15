// Set language and "Do not check spelling" (lane text:language-direction, text DESIGN.md 2.1 and 2.2). A selection
// gets a `lang` mark on its text. A caret inside a run with its own language changes that run. Any other caret
// sets the language of the paragraphs it is in, as the paragraph mark's language. The language "zxx" means "do not
// check spelling", which the spell checker never sends.
import type { Editor } from '@tiptap/core';
import type { Mark, MarkType } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { setParagraphAttr } from '../../../editor/extensions/direction';
import { NO_PROOF } from '../../../editor/extensions/spellingText';
import { PARA_NODES } from '../../../editor/paragraph/attributes';
import { t } from '../../../strings/t';
import type { MenuAnchor, MenuItemSpec } from '../../../ui';
import { languageName } from './languages';

const LANG_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

const langType = (state: EditorState): MarkType | undefined => state.schema.marks.lang;

/**
 * A tag in the form the file format keeps: language in lower case, script in title case, region in upper case
 * (text DESIGN.md 2.1). Null when it is not a language tag.
 */
export function canonicalTag(tag: string): string | null {
  const parts = tag.trim().replace(/_/g, '-').split('-');
  const shaped = parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase();
      return part.toUpperCase();
    })
    .join('-');
  return LANG_TAG.test(shaped) ? shaped : null;
}

/** The language at the selection: the `lang` mark at its start, else its paragraph's, else null (the page's). */
export function selectionLanguage(state: EditorState): string | null {
  const type = langType(state);
  const { $from, empty } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : ($from.nodeAfter?.marks ?? $from.marks());
  const mark = type && marks.find((item) => item.type === type);
  if (mark) return String(mark.attrs.lang);
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (PARA_NODES.has(node.type.name) && typeof node.attrs.lang === 'string') return node.attrs.lang;
  }
  return null;
}

/**
 * The `lang` run the caret is in, as selectionLanguage reads it: the stored marks when they hold a language, else
 * the whole run of text around the caret that carries the same `lang` mark. Null when the caret has no run language.
 */
function caretLangRun(
  state: EditorState,
  type: MarkType,
): { from: number; to: number; stored?: readonly Mark[] } | null {
  const { $from } = state.selection;
  if (state.storedMarks) {
    return state.storedMarks.some((mark) => mark.type === type)
      ? { from: $from.pos, to: $from.pos, stored: state.storedMarks }
      : null;
  }
  const mark = $from.marks().find((item) => item.type === type);
  if (!mark) return null;
  const parent = $from.parent;
  const start = $from.start();
  const offset = $from.parentOffset;
  let found: { from: number; to: number } | null = null;
  let open = -1;
  const close = (end: number) => {
    if (open !== -1 && !found && open <= offset && offset <= end) found = { from: start + open, to: start + end };
    open = -1;
  };
  parent.forEach((child, pos) => {
    if (mark.isInSet(child.marks)) {
      if (open === -1) open = pos;
    } else close(pos);
  });
  close(parent.content.size);
  return found;
}

/**
 * Sets the language of the selection, or of the caret's paragraphs. Null returns the text to the page's language.
 * Returns false when nothing can take a language, such as a code block.
 */
export function setLanguage(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  tag: string | null,
): boolean {
  const lang = tag === null ? null : tag === NO_PROOF ? NO_PROOF : canonicalTag(tag);
  if (tag !== null && lang === null) return false;
  const type = langType(state);
  if (state.selection.empty) {
    // A caret inside a run with its own language changes that run, since the run's language wins over the
    // paragraph's. Otherwise the caret sets its paragraphs' language.
    const run = type ? caretLangRun(state, type) : null;
    if (!run || !type) return setParagraphAttr(state, dispatch, 'lang', lang);
    if (dispatch) {
      const tr = state.tr;
      if (run.stored) {
        const marks = run.stored.filter((mark) => mark.type !== type);
        tr.setStoredMarks(lang === null ? marks : [...marks, type.create({ lang })]);
      } else {
        tr.removeMark(run.from, run.to, type);
        if (lang !== null) tr.addMark(run.from, run.to, type.create({ lang }));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  if (!type) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { $from, $to } of state.selection.ranges) {
      tr.removeMark($from.pos, $to.pos, type);
      if (lang !== null) tr.addMark($from.pos, $to.pos, type.create({ lang }));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Turns "Do not check spelling" on or off for the selection, or for the caret's paragraphs. */
export function toggleNoProof(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  return setLanguage(state, dispatch, selectionLanguage(state) === NO_PROOF ? null : NO_PROOF);
}

/** The menu's languages: the page's, the installed checkers', and the one in use, each once, by name. */
export function languageChoices(
  page: readonly string[],
  installed: readonly string[],
  current: string | null,
): string[] {
  const tags = [...page, ...installed, ...(current && current !== NO_PROOF ? [current] : [])];
  const seen = new Set<string>();
  const unique = tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => languageName(a).localeCompare(languageName(b), 'en-US'));
}

/** The Language menu's items for an editor. Choosing one sets it and says so. */
export function languageItems(editor: Editor, tags: readonly string[], say: (text: string) => void): MenuItemSpec[] {
  const current = selectionLanguage(editor.state);
  const choose = (tag: string | null) => () => {
    if (!setLanguage(editor.state, editor.view.dispatch, tag)) return;
    if (tag === null) say(t('textLanguage.setToPage'));
    else if (tag === NO_PROOF) say(t('textLanguage.noProofOn'));
    else say(t('textLanguage.setTo', { name: languageName(tag) }));
  };
  return [
    {
      id: 'page',
      label: t('textLanguage.pageLanguage'),
      kind: 'radio',
      checked: current === null,
      onSelect: choose(null),
    },
    ...tags.map((tag): MenuItemSpec => ({
      id: `lang.${tag}`,
      label: languageName(tag),
      kind: 'radio',
      checked: current?.toLowerCase() === tag.toLowerCase(),
      onSelect: choose(tag),
    })),
    {
      id: 'noProof',
      label: t('textLanguage.noProof'),
      kind: 'checkbox',
      checked: current === NO_PROOF,
      separatorBefore: true,
      onSelect: choose(current === NO_PROOF ? null : NO_PROOF),
    },
  ];
}

/** Where the menu opens: under the caret. */
export function caretAnchor(editor: Editor): MenuAnchor {
  const coords = editor.view.coordsAtPos(editor.state.selection.head);
  return { x: coords.left, y: coords.bottom };
}
