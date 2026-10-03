// Links (owner: WP4): finding the link at the caret, adding or changing one, and removing it. Destinations follow
// SPEC 7.5: web, mail, OpenNote, and asset links are live, other schemes are kept and never opened, and script
// schemes never become links.
import { getMarkRange } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { isBlockedHref, linkKind, schemeOf } from '../schema/constants';
import type { LinkKind } from '../schema/constants';
import { fromChange } from './command';
import type { Command } from './command';

export interface LinkAt {
  from: number;
  to: number;
  href: string;
  text: string;
  kind: LinkKind;
}

/** The link around the caret, or the one the selection lies inside. */
export function linkAt(state: EditorState): LinkAt | null {
  const type = state.schema.marks.link;
  const { $from, from, to } = state.selection;
  const range = getMarkRange($from, type) ?? (from === to ? null : getMarkRange(state.doc.resolve(from + 1), type));
  if (!range || range.from > from || range.to < to) return null;
  const mark = state.doc
    .resolve(range.from + 1)
    .marks()
    .find((candidate) => candidate.type === type);
  const href = (mark?.attrs.href as string | undefined) ?? '';
  return { ...range, href, text: state.doc.textBetween(range.from, range.to), kind: linkKind(href) };
}

const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const BARE_HOST = /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/;

/**
 * The destination as typed, made into a link: "example.com" gets https, "name@example.com" gets mailto, and
 * script schemes are refused (null).
 */
export function normalizeHref(input: string): string | null {
  const href = input.trim();
  if (href === '' || /\s/.test(href) || isBlockedHref(href)) return null;
  if (schemeOf(href) !== null && !/^[\w-]+\.[\w.-]+:\d/.test(href)) return href;
  if (EMAIL.test(href)) return `mailto:${href}`;
  if (BARE_HOST.test(href)) return `https://${href}`;
  return href.startsWith('/') || href.startsWith('#') ? null : `https://${href}`;
}

/**
 * Links the selection to `href`. With a caret in a link, it changes that link; with a bare caret, it inserts
 * `text` (or the address itself) as a new link. Changing `text` on an existing link replaces its words.
 */
export function setLink(href: string, text?: string): Command {
  return (state, dispatch) => {
    const normalized = normalizeHref(href);
    if (!normalized) return false;
    const existing = linkAt(state);
    return fromChange((tr) => {
      const type = tr.doc.type.schema.marks.link;
      const mark = type.create({ href: normalized });
      let { from, to } = tr.selection;
      if (existing && from === to) ({ from, to } = existing);
      const words = text?.trim();
      if (from === to || (words && words !== tr.doc.textBetween(from, to))) {
        const marks = mark.addToSet(type.removeFromSet(tr.doc.resolve(from).marks()));
        const node = tr.doc.type.schema.text(words || normalized, marks);
        tr.replaceWith(from, to, node);
        to = from + node.nodeSize;
      } else {
        tr.removeMark(from, to, type);
        tr.addMark(from, to, mark);
      }
      tr.setSelection(TextSelection.create(tr.doc, to));
      tr.setStoredMarks(type.removeFromSet(tr.doc.resolve(to).marks()));
      return true;
    })(state, dispatch);
  };
}

/** Removes the link at the caret, or every link in the selection, keeping the words. */
export function removeLink(): Command {
  return (state, dispatch) => {
    const existing = linkAt(state);
    const { from, to } = state.selection;
    const range = from === to ? existing : { from, to };
    if (!range) return false;
    let found = false;
    state.doc.nodesBetween(range.from, range.to, (node) => {
      if (node.marks.some((mark) => mark.type.name === 'link')) found = true;
      return !found;
    });
    if (!found) return false;
    return fromChange((tr) => {
      tr.removeMark(range.from, range.to, tr.doc.type.schema.marks.link);
      return true;
    })(state, dispatch);
  };
}
