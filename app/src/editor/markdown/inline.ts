// The canonical Markdown of one paragraph, heading, or title (SPEC 7.3, 7.6, and 7.7). Text is escaped as one line
// of code points, so that an escape depends on the text around it and never on how marks split that text.
import { Fragment, Mark } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { LABEL, cleanText, escapeCodePoints } from './escape';
import type { EscapeMode, Seams } from './escape';
import { collectLeaves, dropEdgeBreaks, isCode, trimMarkEdges } from './leaves';
import type { Leaf } from './leaves';
import { parseInlineNodes } from './parse';
import { planRanges } from './marksPlan';
import type { Plan, Range } from './marksPlan';
import {
  closeToken,
  decideStyles,
  destinationText,
  formatDestination,
  isPlainHighlight,
  openToken,
} from './marksStyle';
import type { Style } from './marksStyle';

/** A placeholder in the escape view for what is not escaped text: code spans, images, and math. */
const ATOM = '\uE000';

/** SPEC 7.7: the smallest backtick run that does not appear in the text as a run of exactly that length. */
export function codeSpan(text: string): string {
  const used = new Set((text.match(/`+/g) ?? []).map((run) => run.length));
  let size = 1;
  while (used.has(size)) size++;
  const fence = '`'.repeat(size);
  const padded = text.startsWith('`') || text.endsWith('`') || (/^ .* $/.test(text) && /[^ ]/.test(text));
  return padded ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** An image description as one line, cleaned like any other text that leaves the editor (SPEC 7.7). */
const altText = (alt: string) => cleanText(alt).replace(/\s*\n\s*/g, ' ');

/** An image or inline math. */
function atomSource(node: PMNode): string {
  if (node.type.name === 'mathInline') return `$${cleanText(node.attrs.source as string)}$`;
  const alt = escapeCodePoints(Array.from(altText(node.attrs.alt as string)), LABEL).join('');
  return `![${alt}](${formatDestination(node.attrs.src as string)})`;
}

function viewOf(leaf: Leaf): string[] {
  if (leaf.kind === 'break') return ['\n'];
  if (leaf.kind === 'text' && !isCode(leaf)) return Array.from(leaf.text);
  return [ATOM];
}

/** Where markup sits in the escape view, so that a `_` or `=` beside it is escaped. */
function seamsOf(plan: Plan, starts: readonly number[]): Seams {
  const highlights = new Set<number>();
  const marks = new Set<number>();
  plan.boundaries.forEach(({ closes, opens }, at) => {
    if (closes.length + opens.length > 0) marks.add(starts[at]);
    if ([...closes, ...opens].some((range: Range) => isPlainHighlight(range.mark))) highlights.add(starts[at]);
  });
  return { highlights, marks };
}

/** What each leaf is written as, with its text escaped. */
function leafOutputs(leaves: readonly Leaf[], plan: Plan, mode: EscapeMode): string[] {
  const views = leaves.map(viewOf);
  const starts: number[] = [];
  let total = 0;
  for (const view of views) {
    starts.push(total);
    total += view.length;
  }
  starts.push(total);
  const escaped = escapeCodePoints(views.flat(), mode, seamsOf(plan, starts));
  return leaves.map((leaf, i) => {
    if (leaf.kind === 'break') return '\\\n';
    if (leaf.kind === 'atom') return atomSource(leaf.node);
    return isCode(leaf) ? codeSpan(leaf.text) : escaped.slice(starts[i], starts[i + 1]).join('');
  });
}

function render(plan: Plan, outputs: readonly string[], styles: ReadonlyMap<Range, Style>): string {
  let text = '';
  plan.boundaries.forEach(({ closes, opens }, at) => {
    for (const range of closes) text += closeToken(range, styles.get(range) ?? 'tag');
    for (const range of opens) {
      const open = openToken(range, styles.get(range) ?? 'tag');
      if (open === '[' && bangIsBare(text)) text = `${text.slice(0, -1)}\\!`;
      text += open;
    }
    if (at < outputs.length) text += outputs[at];
  });
  return text;
}

/** A `!` right before a link's `[` would read as an image. (SPEC 7.6 has no row for this yet.) */
function bangIsBare(text: string): boolean {
  const slashes = /\\*$/.exec(text.slice(0, -1))?.[0].length ?? 0;
  return text.endsWith('!') && slashes % 2 === 0;
}

/** Attributes as the writer writes them: their text cleaned of what Markdown never holds. */
function writtenAttrs(attrs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out = { ...attrs };
  for (const key of ['href', 'src']) if (typeof out[key] === 'string') out[key] = destinationText(out[key]);
  if (typeof out.alt === 'string') out.alt = altText(out.alt);
  if (typeof out.source === 'string') out.source = cleanText(out.source);
  return out;
}

/** The same marks in textSchema, which the reader builds. Editors use their own schema instance. */
function readerMarks(marks: readonly Mark[]): readonly Mark[] {
  return Mark.setFrom(marks.map((mark) => textSchema.marks[mark.type.name].create(writtenAttrs(mark.attrs))));
}

/** The nodes that the leaves stand for, to check that the written text reads back as the same content. */
function expectedNodes(leaves: readonly Leaf[]): PMNode[] {
  return leaves.map((leaf) => {
    const marks = readerMarks(leaf.marks);
    if (leaf.kind === 'break') return textSchema.nodes.hardBreak.create(null, null, marks);
    if (leaf.kind === 'text') return textSchema.text(leaf.text, marks);
    return textSchema.nodes[leaf.node.type.name].create(writtenAttrs(leaf.node.attrs), null, marks);
  });
}

function readsBack(text: string, leaves: readonly Leaf[]): boolean {
  return Fragment.fromArray(parseInlineNodes(text)).eq(Fragment.fromArray(expectedNodes(leaves)));
}

/**
 * The Markdown of an inline container. A heading or title passes `singleLine`, so a break becomes a space.
 * Delimiters are checked against the reader, because CommonMark's matching rules (the rule of 3, and runs that
 * can both open and close) can pair delimiters that each pass the flanking test. If the text would read back
 * differently, every range is written with tags instead, which always reads back exactly.
 */
export function serializeInline(container: PMNode, mode: EscapeMode, singleLine = false): string {
  const leaves = trimMarkEdges(dropEdgeBreaks(collectLeaves(container, singleLine)));
  const plan = planRanges(leaves);
  const outputs = leafOutputs(leaves, plan, mode);
  const styles = decideStyles(plan, outputs);
  const text = render(plan, outputs, styles);
  if (![...styles.values()].includes('delim') || readsBack(text, leaves)) return text;
  return render(plan, outputs, new Map());
}
