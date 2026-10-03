// AutoCorrect (ARCHITECTURE.md section 18.3; owner: WP4). When a word ends, with a space, punctuation, or Enter,
// the word before is replaced from the person's list, or the built-in one when theirs is empty. Arrows, symbols,
// dashes, and about thirty common typos are built in.
//
// Each correction is an automatic change, its own undo step, and Backspace right after it reverts it. Nothing
// changes in code, links, or math, or while composing.
import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost } from '../host';
import { canAutoChange, markAutoChange, typeThenChange } from './autoChange';

export interface Replacement {
  from: string;
  to: string;
}

const TYPOS: readonly [string, string][] = [
  ['teh', 'the'],
  ['adn', 'and'],
  ['taht', 'that'],
  ['thier', 'their'],
  ['recieve', 'receive'],
  ['recieved', 'received'],
  ['beleive', 'believe'],
  ['seperate', 'separate'],
  ['definately', 'definitely'],
  ['occured', 'occurred'],
  ['occurence', 'occurrence'],
  ['untill', 'until'],
  ['wich', 'which'],
  ['becuase', 'because'],
  ['beacuse', 'because'],
  ['acheive', 'achieve'],
  ['accomodate', 'accommodate'],
  ['adress', 'address'],
  ['begining', 'beginning'],
  ['calender', 'calendar'],
  ['commited', 'committed'],
  ['enviroment', 'environment'],
  ['existance', 'existence'],
  ['goverment', 'government'],
  ['independant', 'independent'],
  ['neccessary', 'necessary'],
  ['noticable', 'noticeable'],
  ['publically', 'publicly'],
  ['tommorow', 'tomorrow'],
  ['truely', 'truly'],
  ['wierd', 'weird'],
  ['youre', 'you’re'],
];

/** The built-in list, which a person's own list replaces once they edit it. */
export const DEFAULT_REPLACEMENTS: readonly Replacement[] = [
  { from: '->', to: '→' },
  { from: '<-', to: '←' },
  { from: '=>', to: '⇒' },
  { from: '<=>', to: '⇔' },
  { from: '(c)', to: '©' },
  { from: '(r)', to: '®' },
  { from: '(tm)', to: '™' },
  { from: '--', to: '–' },
  { from: '...', to: '…' },
  ...TYPOS.map(([from, to]) => ({ from, to })),
];

/** The characters that end a word. */
const ENDS = /^[\s.,;:!?)\]}"”’]$/;

/** The replacement for the token before a word end, keeping a capital for typos: "Teh" becomes "The". */
export function correctionFor(token: string, list: readonly Replacement[]): string | null {
  const exact = list.find((entry) => entry.from === token);
  if (exact) return exact.to;
  const lower = token.toLowerCase();
  const folded = list.find((entry) => /^[a-z]+$/.test(entry.from) && entry.from === lower);
  if (!folded) return null;
  if (token === token.toUpperCase() && token.length > 1) return folded.to.toUpperCase();
  return token[0] === token[0].toUpperCase() ? folded.to[0].toUpperCase() + folded.to.slice(1) : folded.to;
}

function listOf(host: EditorHost): readonly Replacement[] | null {
  const { autocorrect } = host.settings();
  if (!autocorrect.enabled || !host.flag('page.typingHelpers')) return null;
  return autocorrect.entries.length > 0 ? autocorrect.entries : DEFAULT_REPLACEMENTS;
}

/** The token that ends at `pos`: back to the last space in the textblock. */
function tokenBefore(state: EditorState, pos: number): { from: number; text: string } | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 40), $pos.parentOffset, undefined, '￼');
  const text = /(\S+)$/.exec(before)?.[1];
  return text && !text.includes('￼') ? { from: pos - text.length, text } : null;
}

/** The correction for the word ending at `pos`, as an automatic change, or null. */
function correctionAt(state: EditorState, pos: number, list: readonly Replacement[]) {
  const token = tokenBefore(state, pos);
  if (!token) return null;
  // The longest suffix of the token that has a correction: "(c)" in "x(c)", "teh" in "(teh".
  for (let start = 0; start < token.text.length; start += 1) {
    const piece = token.text.slice(start);
    const to = correctionFor(piece, list);
    if (to === null || (start > 0 && /\w/.test(token.text[start - 1]) && /^\w/.test(piece))) continue;
    const from = token.from + start;
    const tr = state.tr.insertText(to, from, pos);
    return { tr, meta: { from, to: pos, text: to } };
  }
  return null;
}

function onWordEnd(view: EditorView, host: EditorHost, from: number, to: number, text: string): boolean {
  if (!ENDS.test(text) || from !== to || !canAutoChange(view, from)) return false;
  const list = listOf(host);
  if (!list || !correctionAt(view.state, from, list)) return false;
  typeThenChange(view, { from, to, text }, (state) => correctionAt(state, from, list));
  return true;
}

/** Enter ends a word too: correct first, as its own change, and let Enter go on. */
function onEnter(view: EditorView, host: EditorHost): boolean {
  const { from, empty } = view.state.selection;
  const list = listOf(host);
  if (!empty || !list || !canAutoChange(view, from)) return false;
  const made = correctionAt(view.state, from, list);
  if (made) view.dispatch(markAutoChange(made.tr, made.meta));
  return false;
}

export const autocorrectKey = new PluginKey('opennoteAutocorrect');

export function autocorrectExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'opennoteAutocorrect',
      // After the Markdown shortcuts, which see the same keys first, and before Enter splits the block.
      priority: 950,
      addProseMirrorPlugins: () => [
        new Plugin({
          key: autocorrectKey,
          props: {
            handleTextInput: (view, from, to, text) => onWordEnd(view, host, from, to, text),
            handleKeyDown: (view, event) =>
              event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && onEnter(view, host),
          },
        }),
      ],
    }),
  ];
}
