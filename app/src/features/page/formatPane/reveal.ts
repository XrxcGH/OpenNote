// Reveal formatting (text DESIGN.md 4.1 and 5.3; Word's Shift+F1): the formatting at the caret with where each part
// comes from. A value the run sets itself is "direct", one the paragraph sets is "paragraph", and one that comes from
// the paragraph's named style says the style's name, such as "Georgia (style Heading 2)". A direct value hides the
// style's value for the same key, as it does on the page.
import type { Mark } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { paraAt } from '../../../editor/commands/paragraph';
import { t } from '../../../strings/t';
import { builtInLabel } from '../styles/gallery';
import { styleOfNode } from '../styles/commands';
import { styleLabel } from '../styles/model';
import { resolveStyle } from '../styles/resolve';
import type { StyleContext } from '../styles/resolve';
import { formatPoints } from './units';

export type RevealSource = 'direct' | 'paragraph' | 'style';

export interface RevealLine {
  /** The format, such as `font` or `bold`. */
  readonly key: string;
  readonly source: RevealSource;
  /** The style's name when the source is a style. */
  readonly style?: string;
  /** The line as shown: "Bold (direct)". */
  readonly text: string;
}

const WORDS: Readonly<Record<string, (value: string) => string>> = {
  font: (value) => t('textPane.reveal.what.font', { value }),
  sizePt: (value) => t('textPane.reveal.what.sizePt', { value }),
  size: (value) => t('textPane.reveal.what.size', { value }),
  weight: (value) => t('textPane.reveal.what.weight', { value }),
  bold: () => t('textPane.reveal.what.bold'),
  italic: () => t('textPane.reveal.what.italic'),
  underline: (value) => t('textPane.reveal.what.underline', { value }),
  strike: () => t('textPane.reveal.what.strike'),
  strikeDouble: () => t('textPane.reveal.what.strikeDouble'),
  textColor: (value) => t('textPane.reveal.what.textColor', { value }),
  highlight: (value) => t('textPane.reveal.what.highlight', { value }),
  caps: (value) => t('textPane.reveal.what.caps', { value }),
  tracking: (value) => t('textPane.reveal.what.tracking', { value }),
  scale: (value) => t('textPane.reveal.what.scale', { value }),
  shift: (value) => t('textPane.reveal.what.shift', { value }),
  kern: (value) => t('textPane.reveal.what.kern', { value }),
  effect: (value) => t('textPane.reveal.what.effect', { value }),
  otf: (value) => t('textPane.reveal.what.otf', { value }),
  subscript: () => t('textPane.reveal.what.subscript'),
  superscript: () => t('textPane.reveal.what.superscript'),
  lang: (value) => t('textPane.reveal.what.lang', { value }),
  dir: (value) => t('textPane.reveal.what.dir', { value }),
  align: (value) => t('textPane.reveal.what.align', { value }),
  indent: (value) => t('textPane.reveal.what.indent', { value }),
  before: (value) => t('textPane.reveal.what.before', { value }),
  after: (value) => t('textPane.reveal.what.after', { value }),
  line: (value) => t('textPane.reveal.what.line', { value }),
  outline: (value) => t('textPane.reveal.what.outline', { value }),
  keepNext: () => t('textPane.reveal.what.keepNext'),
  keepLines: () => t('textPane.reveal.what.keepLines'),
  tabs: (value) => t('textPane.reveal.what.tabs', { value }),
  border: () => t('textPane.reveal.what.border'),
  shade: () => t('textPane.reveal.what.shade'),
};

const what = (key: string, value = ''): string => (Object.hasOwn(WORDS, key) ? WORDS[key](value) : value);

/** Run marks by their attribute, and the key their line uses (the same keys a style's look has). */
const MARK_KEYS: Readonly<Record<string, { key: string; attr: string | null }>> = {
  font: { key: 'font', attr: 'font' },
  textSize: { key: 'sizePt', attr: 'size' },
  weight: { key: 'weight', attr: 'weight' },
  bold: { key: 'weight', attr: null },
  italic: { key: 'italic', attr: null },
  underline: { key: 'underline', attr: 'line' },
  strike: { key: 'strike', attr: 'line' },
  textColor: { key: 'textColor', attr: 'color' },
  highlight: { key: 'highlight', attr: 'color' },
  caps: { key: 'caps', attr: 'caps' },
  tracking: { key: 'tracking', attr: 'tracking' },
  scale: { key: 'scale', attr: 'scale' },
  shift: { key: 'shift', attr: 'shift' },
  kern: { key: 'kern', attr: 'kern' },
  effect: { key: 'effect', attr: 'effect' },
  otf: { key: 'otf', attr: 'otf' },
  subscript: { key: 'subscript', attr: null },
  superscript: { key: 'superscript', attr: null },
  lang: { key: 'lang', attr: 'lang' },
  dir: { key: 'dir', attr: 'dir' },
};

/** The words for one run format: `Georgia`, `13 pt`, `Bold`. */
function runWords(mark: Mark): string | null {
  const row = MARK_KEYS[mark.type.name];
  if (!row) return null;
  const raw = row.attr === null ? '' : String(mark.attrs[row.attr] ?? '');
  switch (mark.type.name) {
    case 'bold':
      return what('bold');
    case 'weight':
      return what('weight', raw);
    case 'textSize':
      return what('size', raw);
    case 'underline':
      return what('underline', raw === '' ? 'single' : raw);
    case 'strike':
      return what(raw === 'double' ? 'strikeDouble' : 'strike');
    default:
      return what(row.key, raw);
  }
}

/** The words for a style's look value of a key. */
function styleWords(key: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  switch (key) {
    case 'weight':
      return value === 700 ? what('bold') : value === 400 ? null : what('weight', String(value));
    case 'sizePt':
      return what('size', String(value));
    case 'italic':
      return value === true ? what('italic') : null;
    case 'underline':
    case 'strike':
    case 'caps':
      return value === 'none' ? null : what(key, String(value));
    case 'tracking':
      return value === 0 ? null : what(key, String(value));
    case 'textColor':
    case 'highlight':
    case 'font':
      return what(key, String(value));
    case 'align':
      return what('align', String(value));
    case 'before':
    case 'after':
      return what(key, String(value));
    case 'line':
      return what('line', JSON.stringify(value));
    default:
      return null;
  }
}

const RUN_STYLE_KEYS = [
  'font',
  'sizePt',
  'weight',
  'italic',
  'textColor',
  'highlight',
  'underline',
  'strike',
  'caps',
  'tracking',
];
const PARA_STYLE_ORDER = ['align', 'before', 'after', 'line'];

const marksAt = (state: EditorState): readonly Mark[] => {
  const { selection } = state;
  if (selection.empty) return state.storedMarks ?? selection.$from.marks();
  return selection.$from.nodeAfter?.marks ?? selection.$from.marks();
};

/** The paragraph's direct formatting as words, by key. */
function paragraphWords(state: EditorState): [string, string][] {
  const format = paraAt(state);
  const out: [string, string][] = [];
  if (format.align) out.push(['align', what('align', format.align)]);
  if (format.indent) {
    const { start, end, first } = format.indent;
    out.push(['indent', what('indent', `${formatPoints(start)}, ${formatPoints(end)}, ${formatPoints(first)}`)]);
  }
  if (format.before !== undefined) out.push(['before', what('before', String(format.before))]);
  if (format.after !== undefined) out.push(['after', what('after', String(format.after))]);
  if (format.line) out.push(['line', what('line', `${format.line.rule} ${formatPoints(format.line.value)}`)]);
  if (format.outline !== undefined) out.push(['outline', what('outline', String(format.outline))]);
  if (format.keepNext) out.push(['keepNext', what('keepNext')]);
  if (format.keepLines) out.push(['keepLines', what('keepLines')]);
  if (format.dir) out.push(['dir', what('dir', format.dir)]);
  if (format.tabs?.length) out.push(['tabs', what('tabs', String(format.tabs.length))]);
  if (format.border) out.push(['border', what('border')]);
  if (format.shade) out.push(['shade', what('shade')]);
  return out;
}

/** The effective formatting at the caret, run formats first, then the paragraph's, each with its source. */
export function revealFormatting(state: EditorState, ctx: StyleContext): RevealLine[] {
  const lines: RevealLine[] = [];
  const line = (key: string, words: string, source: RevealSource, style?: string): void => {
    const shown =
      source === 'style'
        ? t('textPane.reveal.fromStyle', { name: style ?? '' })
        : t(source === 'direct' ? 'textPane.reveal.direct' : 'textPane.reveal.paragraph');
    lines.push({ key, source, ...(style ? { style } : {}), text: `${words} (${shown})` });
  };
  const directKeys = new Set<string>();
  for (const mark of marksAt(state)) {
    const words = runWords(mark);
    if (words === null) continue;
    const key = MARK_KEYS[mark.type.name].key;
    directKeys.add(key);
    line(key, words, 'direct');
  }
  const block = state.selection.$from.parent;
  const name = styleOfNode(block);
  const resolved = resolveStyle(ctx, name);
  const label = styleLabel(name, ctx.page?.[name] ?? ctx.notebook[name] ?? ctx.app[name], builtInLabel);
  const paragraph = paragraphWords(state);
  const paragraphKeys = new Set(paragraph.map(([key]) => key));
  for (const key of [...RUN_STYLE_KEYS, ...PARA_STYLE_ORDER]) {
    if (directKeys.has(key) || paragraphKeys.has(key)) continue;
    const value = resolved.values[key as keyof typeof resolved.values];
    const words = styleWords(key, value);
    const set = resolved.own.has(key as never) || name !== 'normal';
    if (words !== null && set) line(key, words, 'style', label);
  }
  for (const [key, words] of paragraph) line(key, words, 'paragraph');
  return lines;
}

/** The lines as one sentence for the live region, or the plain message when there is nothing to reveal. */
export function revealText(lines: readonly RevealLine[]): string {
  return lines.length > 0 ? lines.map((entry) => entry.text).join('. ') : t('textPane.reveal.none');
}
