// How each mark range is written: with delimiters (`**`, `*`, `~~`, `==`) or with the HTML tags of SPEC 7.4.
// SPEC 7.7: where a delimiter would not open or close under CommonMark's rules for that position, the writer uses
// the matching tag for that range.
//
// Every character that starts or ends a delimiter, a tag, or a link is punctuation. The class of a neighbor
// therefore does not depend on how the neighbor is written. The one exception is a run of `*` from strong and
// emphasis, which reads as a single run. Decisions start with every delimiter and fall back to tags until
// nothing changes.
import type { Mark } from '@tiptap/pm/model';
import { canClose, canCloseHighlight, canOpen, canOpenHighlight, edgeClass } from './flanking';
import type { CharClass } from './flanking';
import type { Plan, Range } from './marksPlan';

export type Style = 'delim' | 'tag';

const DELIMITERS: Readonly<Record<string, string>> = { bold: '**', italic: '*', strike: '~~' };
const TAGS: Readonly<Record<string, string>> = {
  bold: 'strong',
  italic: 'em',
  strike: 'del',
  underline: 'u',
  highlight: 'mark',
  subscript: 'sub',
  superscript: 'sup',
};

/** Honey, the default highlight color, is the only one with a delimiter form. */
export function isPlainHighlight(mark: Mark): boolean {
  return mark.type.name === 'highlight' && !mark.attrs.color;
}

/** Whether a mark has a delimiter form at all. */
export function hasDelimiter(mark: Mark): boolean {
  return mark.type.name in DELIMITERS || isPlainHighlight(mark);
}

function isStar(mark: Mark): boolean {
  return mark.type.name === 'bold' || mark.type.name === 'italic';
}

function delimiterOf(mark: Mark): string {
  return isPlainHighlight(mark) ? '==' : DELIMITERS[mark.type.name];
}

function openTag(mark: Mark): string {
  const name = mark.type.name;
  if (name === 'highlight' && mark.attrs.color) return `<mark data-color="${mark.attrs.color as string}">`;
  if (name === 'textColor') return `<span data-color="${mark.attrs.color as string}">`;
  if (name === 'textSize') return `<span data-size="${mark.attrs.size as string}">`;
  return `<${TAGS[name]}>`;
}

function closeTag(mark: Mark): string {
  const name = mark.type.name;
  return name === 'textColor' || name === 'textSize' ? '</span>' : `</${TAGS[name]}>`;
}

const ENTITY_LIKE = /&(?=#?[A-Za-z0-9]+;)/g;

/** SPEC 7.5: bare when it holds no spaces, parentheses, angle brackets, backslashes, or control characters. */
export function formatDestination(href: string): string {
  const text = href.replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const bare = text !== '' && !/[\s()<>\\\p{Cc}]/u.test(text);
  const body = (bare ? text : text.replace(/[<>\\]/g, '\\$&')).replace(ENTITY_LIKE, '\\&');
  return bare ? body : `<${body}>`;
}

export function openToken(range: Range, style: Style): string {
  const mark = range.mark;
  if (mark.type.name === 'link') return '[';
  return style === 'delim' ? delimiterOf(mark) : openTag(mark);
}

export function closeToken(range: Range, style: Style): string {
  const mark = range.mark;
  if (mark.type.name === 'link') return `](${formatDestination(mark.attrs.href as string)})`;
  return style === 'delim' ? delimiterOf(mark) : closeTag(mark);
}

type Styles = ReadonlyMap<Range, Style>;

function isStarDelimiter(range: Range, styles: Styles): boolean {
  return isStar(range.mark) && styles.get(range) === 'delim';
}

/** The class of the character next to a token. Another token beside it is punctuation. */
function neighbor(seq: readonly Range[], at: number, step: -1 | 1, styles: Styles, fallback: CharClass): CharClass {
  const joins = isStarDelimiter(seq[at], styles);
  for (let i = at + step; i >= 0 && i < seq.length; i += step) {
    if (!(joins && isStarDelimiter(seq[i], styles))) return 'punct';
  }
  return fallback;
}

interface Sides {
  readonly prev: CharClass;
  readonly next: CharClass;
}

function sidesAt(plan: Plan, outputs: readonly string[], range: Range, styles: Styles, opening: boolean): Sides {
  const at = opening ? range.open : range.close;
  const { closes, opens } = plan.boundaries[at];
  const seq = [...closes, ...opens];
  const index = opening ? closes.length + opens.indexOf(range) : closes.indexOf(range);
  const before = at > 0 ? edgeClass(outputs[at - 1], 'last') : 'ws';
  const after = at < outputs.length ? edgeClass(outputs[at], 'first') : 'ws';
  return {
    prev: neighbor(seq, index, -1, styles, before),
    next: neighbor(seq, index, 1, styles, after),
  };
}

function delimiterWorks(plan: Plan, outputs: readonly string[], range: Range, styles: Styles): boolean {
  const open = sidesAt(plan, outputs, range, styles, true);
  const close = sidesAt(plan, outputs, range, styles, false);
  if (isPlainHighlight(range.mark)) {
    return canOpenHighlight(open.prev, open.next) && canCloseHighlight(close.prev, close.next);
  }
  // A `*` that opens right where another `*` closes would join its run, so it is written as a tag.
  const joinsRun = isStar(range.mark) && plan.boundaries[range.open].closes.some((r) => isStarDelimiter(r, styles));
  return !joinsRun && canOpen(open.prev, open.next) && canClose(close.prev, close.next);
}

/** Chooses delimiters or tags for every range. `outputs` are the written forms of the leaves. */
export function decideStyles(plan: Plan, outputs: readonly string[]): Map<Range, Style> {
  const styles = new Map<Range, Style>();
  for (const range of plan.ranges) styles.set(range, hasDelimiter(range.mark) ? 'delim' : 'tag');
  for (let changed = true; changed;) {
    changed = false;
    for (const range of plan.ranges) {
      if (styles.get(range) === 'delim' && !delimiterWorks(plan, outputs, range, styles)) {
        styles.set(range, 'tag');
        changed = true;
      }
    }
  }
  return styles;
}
