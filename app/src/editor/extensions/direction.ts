// Paragraph direction, language, and hyphenation in the editor (lane text:language-direction, text DESIGN.md 2.2).
// Node decorations turn a paragraph's `dir`, `lang`, and `hyphenate` attributes into the element's `dir`, `lang`,
// and `hyphens`, so the stored attributes stay the only truth.
//
// Alignment is logical, as Word's buttons are. "Start" is the right edge of a right-to-left paragraph, and the
// decoration writes the physical side. A paragraph without `dir` stays left to right, even when it begins with
// Arabic or Hebrew: the direction is never guessed from the text (no `dir="auto"`).
//
// The editor's root gets the page's language, so automatic hyphenation and the screen reader's voice follow it. A
// run's or a paragraph's own `lang` overrides it. Registered through editorExtensions behind text.language.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorHost } from '../host';
import { PARA_NODES } from '../paragraph/attributes';
import { directionDom } from '../paragraph/directionDom';
import type { Direction } from '../paragraph/directionDom';
import { editorExtensions } from './kit';

export { directionDom, physicalAlign } from '../paragraph/directionDom';
export type { Direction, PhysicalAlign } from '../paragraph/directionDom';

export interface DirectionOptions {
  /** The page's default for automatic hyphenation. Default: off, as in Word and Docs. */
  hyphenate?: () => boolean;
  /** The page's language, for the editor's root. Null leaves the root without `lang`. */
  language?: () => string | null;
}

const key = new PluginKey<DecorationSet>('opennote.direction');

/** The decorations of the formatted paragraphs that overlap `[from, to)`. */
function decorate(doc: PMNode, from: number, to: number, hyphenate: boolean): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (PARA_NODES.has(node.type.name)) {
      const dom = directionDom(node.attrs, hyphenate);
      if (dom) out.push(Decoration.node(pos, pos + node.nodeSize, dom));
    }
    return !node.isTextblock;
  });
  return out;
}

/**
 * The part of `tr.doc` a change touched, in its positions: every replaced range, mapped to the end, and where the
 * documents differ (an attribute step replaces nothing). Null when nothing changed.
 */
function touched(tr: Transaction, prev: PMNode): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, rest.map(newStart, -1));
      to = Math.max(to, rest.map(newEnd, 1));
    });
  });
  const start = tr.doc.content.findDiffStart(prev.content);
  if (start !== null) {
    const end = tr.doc.content.findDiffEnd(prev.content);
    from = Math.min(from, start);
    to = Math.max(to, end ? end.a : start, start);
  }
  return from === Infinity ? null : { from, to };
}

/**
 * Maps the set through the change and redraws only the top-level blocks it touched. Mapping drops a node
 * decoration that a split or a join left across two nodes, so whole blocks are redrawn, never part of one.
 */
function update(tr: Transaction, old: DecorationSet, prev: PMNode, hyphenate: boolean): DecorationSet {
  const mapped = old.map(tr.mapping, tr.doc);
  const range = touched(tr, prev);
  if (!range) return mapped;
  const size = tr.doc.content.size;
  const start = tr.doc.resolve(Math.max(0, Math.min(range.from, size)));
  const end = tr.doc.resolve(Math.max(0, Math.min(range.to, size)));
  const from = start.depth > 0 ? start.before(1) : start.pos;
  const to = Math.min(size, Math.max(end.depth > 0 ? end.after(1) : end.pos, from + 1));
  const stale = mapped.find(from, to).filter((deco) => deco.from < to && deco.to > from);
  return mapped.remove(stale).add(tr.doc, decorate(tr.doc, from, to, hyphenate));
}

export function directionPlugin(options: DirectionOptions = {}): Plugin<DecorationSet> {
  const hyphenate = options.hyphenate ?? (() => false);
  const language = options.language ?? (() => null);
  // The page default the decorations were drawn with. When the page changes it, the next transaction redraws all.
  let drawn = hyphenate();
  const all = (doc: PMNode) => DecorationSet.create(doc, decorate(doc, 0, doc.content.size, drawn));
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => {
        drawn = hyphenate();
        return all(state.doc);
      },
      apply: (tr, old, before) => {
        const now = hyphenate();
        if (now !== drawn) {
          drawn = now;
          return all(tr.doc);
        }
        return tr.docChanged ? update(tr, old, before.doc, now) : old;
      },
    },
    props: {
      decorations: (state) => key.getState(state),
      attributes: (): Record<string, string> => {
        const lang = language();
        return lang ? { lang } : {};
      },
    },
  });
}

/** The page's language as the editor sees it: the first spelling language, the one Settings, Language chose. */
const pageLanguage = (host: EditorHost) => () => host.settings().spelling.languages[0] ?? null;

export function directionExtension(options: DirectionOptions = {}): Extension {
  return Extension.create({ name: 'opennoteDirection', addProseMirrorPlugins: () => [directionPlugin(options)] });
}

/** The paragraph-like nodes the selection touches: paragraphs, headings, and list items. */
function paragraphsIn(state: EditorState): { pos: number; node: PMNode }[] {
  const found: { pos: number; node: PMNode }[] = [];
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, Math.max($to.pos, $from.pos + 1), (node, pos) => {
      if (PARA_NODES.has(node.type.name)) found.push({ pos, node });
      return !node.isTextblock;
    });
  }
  return found;
}

/** Sets one paragraph attribute on every paragraph, heading, and list item the selection touches. */
export function setParagraphAttr(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  name: 'dir' | 'lang' | 'hyphenate',
  value: string | boolean | null,
): boolean {
  const targets = paragraphsIn(state).filter(({ node }) => name in node.attrs);
  if (!targets.length) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { pos, node } of targets) if (node.attrs[name] !== value) tr.setNodeAttribute(pos, name, value);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * Makes the selected paragraphs right to left or left to right. Left to right clears `dir`, the default, so a page
 * keeps no attribute it does not need. Alignment is logical, so it flips with the direction without a change.
 */
export function setParagraphDirection(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  dir: Direction,
): boolean {
  return setParagraphAttr(state, dispatch, 'dir', dir === 'rtl' ? 'rtl' : null);
}

/** The direction of the paragraph at the selection's head. */
export function paragraphDirection(state: EditorState): Direction {
  const { $head } = state.selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth);
    if (PARA_NODES.has(node.type.name) && node.attrs.dir != null) return node.attrs.dir === 'rtl' ? 'rtl' : 'ltr';
  }
  return 'ltr';
}

/** Whether automatic hyphenation is on for the paragraph at the selection's head. */
export function paragraphHyphenates(state: EditorState, pageHyphenate = false): boolean {
  const { $head } = state.selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth);
    if (PARA_NODES.has(node.type.name) && typeof node.attrs.hyphenate === 'boolean') return node.attrs.hyphenate;
  }
  return pageHyphenate;
}

if (!editorExtensions.get('text.direction')) {
  editorExtensions.register({
    id: 'text.direction',
    order: 410,
    flag: 'text.language',
    kinds: ['text', 'table'],
    create: (host) =>
      directionExtension({
        language: pageLanguage(host),
        hyphenate: () => host.pageSettings?.().text.hyphenate ?? false,
      }),
  });
}
