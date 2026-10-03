// Markdown shortcuts while typing (ARCHITECTURE.md section 8.3; owner: WP4). Typing "# " makes a heading, "- " a
// bulleted list, "**words**" bold text, and so on. Ours add "[ ] " and "[x] " for tasks, "> [!note] " for callouts,
// and "==words==" for highlights.
//
// Each conversion is an automatic change: the typed character goes in as typing, and the conversion is its own
// undo step. Nothing converts while composing, in code, in links, or when Settings turns the shortcuts off.
import type { MarkType, Node as PMNode, NodeType } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost } from '../host';
import type { AutoChangeMeta } from '../meta';
import { canAutoChange, markAutoChange, typeThenChange } from './autoChange';

/** How far back a rule looks, as prosemirror-inputrules does. */
const MAX_MATCH = 500;
const OBJECT = '￼';

type Made = { tr: Transaction; meta: AutoChangeMeta } | null;

interface Rule {
  match: RegExp;
  /** Whether it applies only to a whole paragraph's text: block rules. */
  block?: boolean;
  /** The change, on the state after typing. `start` and `end` bound the matched text; `end` is the caret. */
  apply(state: EditorState, match: RegExpExecArray, start: number, end: number): Transaction | null;
}

/** The paragraph at `pos` can become `type`, or be wrapped in it. */
function textblockCan(state: EditorState, pos: number, type: NodeType | undefined): type is NodeType {
  if (!type) return false;
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.name !== 'paragraph') return false;
  const index = $pos.index(-1);
  return $pos.node(-1).canReplaceWith(index, index + 1, type);
}

function setBlock(type: string, attrs: Record<string, unknown> = {}): Rule['apply'] {
  return (state, _match, start, end) => {
    const nodeType = state.schema.nodes[type];
    if (!textblockCan(state, start, nodeType)) return null;
    const tr = state.tr.delete(start, end);
    const at = tr.mapping.map(start);
    return tr.setBlockType(at, at, nodeType, attrs);
  };
}

function wrap(
  type: string,
  attrs: (match: RegExpExecArray) => Record<string, unknown> | null = () => null,
): Rule['apply'] {
  return (state, match, start, end) => {
    const wrapper = state.schema.nodes[type] as NodeType | undefined;
    if (!wrapper || state.doc.resolve(start).parent.type.name !== 'paragraph') return null;
    const tr = state.tr.delete(start, end);
    const $start = tr.doc.resolve(tr.mapping.map(start));
    const range = $start.blockRange();
    const wrapping = range && findWrapping(range, wrapper, attrs(match));
    if (!range || !wrapping) return null;
    return tr.wrap(range, wrapping);
  };
}

/** "[ ] " or "[x] ": checks the list item it starts, or makes a checklist of the paragraph. */
const task: Rule['apply'] = (state, match, start, end) => {
  const checked = match[1] !== ' ';
  const $start = state.doc.resolve(start);
  const item = $start.depth > 1 ? $start.node(-1) : null;
  if (item?.type.name === 'listItem' && $start.index(-1) === 0) {
    if (item.attrs.checked !== null) return null;
    return state.tr.delete(start, end).setNodeMarkup($start.before(-1), undefined, { ...item.attrs, checked });
  }
  const tr = wrap('bulletList')(state, match, start, end);
  if (!tr) return null;
  const $item = tr.doc.resolve(tr.mapping.map(start));
  const itemPos = $item.before(-1);
  return tr.setNodeMarkup(itemPos, undefined, { ...$item.node(-1).attrs, checked });
};

/** "[!type] " in a quote's first paragraph turns the quote into a callout of that type, with an empty title. */
const callout: Rule['apply'] = (state, match, start, end) => {
  const $start = state.doc.resolve(start);
  const schema = state.schema;
  if (!schema.nodes.callout || $start.depth < 2 || $start.node(-1).type.name !== 'blockquote') return null;
  if ($start.index(-1) !== 0) return null;
  const quote = $start.node(-1);
  const quotePos = $start.before(-1);
  const rest: PMNode[] = [];
  const first = quote.firstChild!;
  const titleContent = first.content.cut(end - start);
  quote.forEach((child, _offset, index) => void (index > 0 && rest.push(child)));
  const node = schema.nodes.callout.create({ type: match[1].toLowerCase(), fold: match[2] ?? '' }, [
    schema.nodes.calloutTitle.create(null, titleContent),
    ...rest,
  ]);
  const tr = state.tr.replaceWith(quotePos, quotePos + quote.nodeSize, node);
  return tr.setSelection(TextSelection.create(tr.doc, quotePos + 2));
};

/** "```lang " replaces the paragraph with a code block in that language. */
const fence: Rule['apply'] = (state, match, start, end) => {
  const type = state.schema.nodes.codeBlock;
  if (!textblockCan(state, start, type) || end - start !== state.doc.resolve(start).parent.content.size) return null;
  const tr = state.tr.delete(start, end);
  const at = tr.mapping.map(start);
  return tr.setBlockType(at, at, type, { language: match[1] || null });
};

/** "---" replaces the paragraph with a divider and a paragraph to type in after it. */
const divider: Rule['apply'] = (state, _match, start, end) => {
  const rule = state.schema.nodes.horizontalRule;
  const $start = state.doc.resolve(start);
  if (!textblockCan(state, start, rule) || end - start !== $start.parent.content.size) return null;
  const from = $start.before();
  const tr = state.tr.replaceWith(
    from,
    $start.after(),
    Fragment.from([rule.create(), state.schema.nodes.paragraph.create()]),
  );
  return tr.setSelection(TextSelection.create(tr.doc, from + 2));
};

const escape = (text: string) => text.replace(/[*^$|?+.()[\]{}\\]/g, '\\$&');

/** A mark from text between delimiters: the delimiters go, and the text inside gets the mark. */
function markRule(open: string, name: string): Rule {
  const d = escape(open);
  return {
    match: new RegExp(`(?:^|[\\s(])(${d}(?!\\s)([^${escape(open[0])}]+)${d})$`),
    apply(state, match, start, end) {
      const type = state.schema.marks[name] as MarkType | undefined;
      if (!type || !state.doc.resolve(end).parent.type.allowsMarkType(type) || /\s$/.test(match[2])) return null;
      const tr = state.tr.delete(end - open.length, end).delete(start, start + open.length);
      tr.addMark(start, start + match[2].length, type.create());
      return tr.removeStoredMark(type);
    },
  };
}

export const MARKDOWN_RULES: readonly Rule[] = [
  {
    match: /^(#{1,6})\s$/,
    block: true,
    apply: (state, match, start, end) => setBlock('heading', { level: match[1].length })(state, match, start, end),
  },
  { match: /^\[!([A-Za-z]+)\]([+-]?)\s$/, block: true, apply: callout },
  { match: /^>\s$/, block: true, apply: wrap('blockquote') },
  { match: /^\[([ xX])\]\s$/, block: true, apply: task },
  { match: /^[-+*]\s$/, block: true, apply: wrap('bulletList') },
  { match: /^(\d{1,9})[.)]\s$/, block: true, apply: wrap('orderedList', (match) => ({ start: Number(match[1]) })) },
  { match: /^```([\w+#-]*)\s$/, block: true, apply: fence },
  { match: /^(?:---|—-|___\s|\*\*\*\s)$/, block: true, apply: divider },
  markRule('**', 'bold'),
  markRule('__', 'bold'),
  markRule('~~', 'strike'),
  markRule('==', 'highlight'),
  markRule('*', 'italic'),
  markRule('_', 'italic'),
  markRule('`', 'code'),
];

/** The rule that typing `text` at `from` triggers, with its match and the range it covers after typing. */
export function findRule(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): { rule: Rule; match: RegExpExecArray; start: number; end: number } | null {
  const $from = state.doc.resolve(from);
  if (from !== to && $from.parent !== state.doc.resolve(to).parent) return null;
  const offset = $from.parentOffset;
  const before = $from.parent.textBetween(Math.max(0, offset - MAX_MATCH), offset, undefined, OBJECT);
  const end = from + text.length;
  for (const rule of MARKDOWN_RULES) {
    if (rule.block && before.length !== offset) continue;
    const match = rule.match.exec(before + text);
    if (!match) continue;
    const start = rule.block ? $from.start() : end - match[1].length;
    return { rule, match, start, end };
  }
  return null;
}

/** Types `text` and applies the rule it triggers, if any. Returns whether a rule ran. */
export function applyMarkdownShortcut(view: EditorView, from: number, to: number, text: string): boolean {
  const found = findRule(view.state, from, to, text);
  if (!found || !canAutoChange(view, from)) return false;
  const { rule, match, start, end } = found;
  typeThenChange(view, { from, to, text }, (state): Made => {
    const tr = rule.apply(state, match, start, end);
    return tr ? { tr, meta: { from: start, to: end, text: '' } } : null;
  });
  return true;
}

/** Enter after "```lang" makes a code block too, as in most Markdown editors. */
export function fenceOnEnter(view: EditorView): boolean {
  const { $from, empty } = view.state.selection;
  const fenced = /^```([\w+#-]*)$/.exec($from.parent.textContent);
  if (!empty || !fenced || $from.parentOffset !== $from.parent.content.size || !canAutoChange(view, $from.pos)) {
    return false;
  }
  const tr = fence(view.state, fenced, $from.start(), $from.pos);
  if (!tr) return false;
  view.dispatch(markAutoChange(tr, { from: $from.start(), to: $from.pos, text: '' }).scrollIntoView());
  return true;
}

export const markdownShortcutsKey = new PluginKey('opennoteMarkdownShortcuts');

export function markdownShortcutsPlugin(host: EditorHost): Plugin {
  return new Plugin({
    key: markdownShortcutsKey,
    props: {
      handleTextInput(view, from, to, text) {
        if (!host.settings().markdownShortcuts) return false;
        return applyMarkdownShortcut(view, from, to, text);
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
        return host.settings().markdownShortcuts && fenceOnEnter(view);
      },
    },
  });
}
