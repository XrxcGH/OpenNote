// fast-check generators for text block documents, for the round-trip property tests. They build canonical
// documents. No two lists of one kind sit side by side. No empty paragraph sits between blocks. No marked range
// starts or ends on whitespace. No hard break sits at the edge of a paragraph. The writer round-trips exactly those.
import * as fc from 'fast-check';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import {
  BOX_STYLES,
  CALLOUT_TYPES,
  FOLDS,
  HIGHLIGHT_COLORS,
  OTF_FEATURES,
  PEN_COLORS,
  TEXT_SIZES,
  UNDERLINE_STYLES,
} from '../schema/specs';
import { isSpaceChar } from './flanking';
import { showsOnSpaces } from './leaves';

const { nodes, marks } = textSchema;

const LETTERS = ['a', 'b', 'c', 'x', 'y', 'Z', '1', '2', '9', '\u00e9', '\u{1F600}', '\u00a0'];
const PUNCTUATION = [...'*_~=#>-+.)(!$[]{}<>|&;\\`:\'"/?%@^,'];
const FRAGMENTS = [
  '&amp;',
  '&#35;',
  '<u>',
  '</u>',
  '[!note]',
  '[ ]',
  '$$',
  '```',
  '1.',
  '==',
  '**',
  '~~',
  '#tag',
  '- ',
  '> ',
];

const char = fc.oneof(
  { weight: 10, arbitrary: fc.constantFrom(...LETTERS) },
  { weight: 4, arbitrary: fc.constantFrom(' ', ' ', '\t') },
  { weight: 5, arbitrary: fc.constantFrom(...PUNCTUATION) },
  { weight: 1, arbitrary: fc.constantFrom(...FRAGMENTS) },
);

const words = fc.array(char, { minLength: 1, maxLength: 8 }).map((parts) => parts.join(''));

/** Text with no whitespace at either end, which is what a mark may wrap. */
function trimmed(text: string): string {
  const chars = Array.from(text);
  while (chars.length > 0 && isSpaceChar(chars[0])) chars.shift();
  while (chars.length > 0 && isSpaceChar(chars[chars.length - 1])) chars.pop();
  return chars.length > 0 ? chars.join('') : 'x';
}

const HREFS = [
  'https://example.com',
  'https://example.com/a?b=1&c=2',
  'https://example.com/a b',
  'https://example.com/f(x)',
  'https://example.com/<x>\\y',
  'https://example.com/?a=1&amp;b=2',
  'mailto:a@example.com',
  'opennote:page/01m3sabc31y0rfa24eeh6j4ky4#01m3sabc32dwqknfawtgwtsgcj',
  'ftp://example.com/file',
  'file:///C:/notes/a.txt',
  'tel:+15551234',
  'notes.md',
  'https://example.com/caf\u00e9',
];

/** Colors of every kind of Appendix D.7. */
// checks-disable-next-line brand-consistency: document content, not interface styling
const COLORS = ['ink', 'walnut', 'mint', 'honey', '#aa0000', '#00aaff', 'theme:accent1', 'theme:background'];
const IDS = ['01m3sbcmt0000000000000c001', '01m3sbcmt0000000000000c002', '7zzzzzzzzzzzzzzzzzzzzzzzzz'];
/** Tags of a later version, which stay foreign marks (R-INL-7). */
const FOREIGN_TAGS = [
  '<span data-glow="soft">',
  '<span data-glow="hard">',
  '<span data-a="1" data-b="x y">',
  '<u data-x="1">',
  '<ins data-by="later">',
  '<s data-x="a*b_c[d]\\e">',
  '<mark data-color="honey">',
  '<span data-size="0.5">',
  '<del data-line="single">',
  '<span lang="en-us">',
];
const pick = <T>(list: readonly T[]) => fc.constantFrom(...list);
const points = (min: number, max: number, step: number) =>
  fc
    .integer({ min: Math.ceil(min / step), max: Math.floor(max / step) })
    .map((n) => String(Number((n * step).toFixed(2))));

/** One generator for each mark of SPEC 7.10, with values from its grammar. */
const markFactories: readonly fc.Arbitrary<Mark>[] = [
  fc.constant(marks.bold.create()),
  fc.constant(marks.italic.create()),
  fc.constantFrom(null, 'double').map((line) => marks.strike.create({ line })),
  fc
    .tuple(fc.option(pick(UNDERLINE_STYLES.slice(1)), { nil: null }), fc.option(pick(COLORS), { nil: null }))
    .map(([line, color]) => marks.underline.create({ line, color })),
  fc.constant(marks.highlight.create()),
  fc
    // checks-disable-next-line brand-consistency: document content, not interface styling
    .constantFrom(...HIGHLIGHT_COLORS, '#ffee00', 'fern', 'theme:accent2')
    .map((color) => marks.highlight.create({ color })),
  // checks-disable-next-line brand-consistency: document content, not interface styling
  fc.constantFrom(...PEN_COLORS, '#aa0000', 'rose', 'theme:text').map((color) => marks.textColor.create({ color })),
  fc.oneof(pick(TEXT_SIZES), points(1, 1638, 0.5)).map((size) => marks.textSize.create({ size })),
  fc.constant(marks.subscript.create()),
  fc.constant(marks.superscript.create()),
  fc.constantFrom(...HREFS).map((href) => marks.link.create({ href })),
  pick(['start', 'end']).map((float) => marks.float.create({ float })),
  pick(IDS).map((comment) => marks.comment.create({ comment })),
  pick(IDS).map((ins) => marks.insertion.create({ ins })),
  pick(IDS).map((del) => marks.deletion.create({ del })),
  pick(IDS).map((fmt) => marks.formatChange.create({ fmt })),
  pick(['rtl', 'ltr']).map((dir) => marks.dir.create({ dir })),
  pick(['en', 'fr-CA', 'zh-Hant-TW', 'es-419', 'zxx']).map((lang) => marks.lang.create({ lang })),
  pick(['citation', 'quote2', 'u-key-term']).map((style) => marks.charStyle.create({ style })),
  pick(['100', '200', '300', '500', '600', '800', '900']).map((weight) => marks.weight.create({ weight })),
  pick(COLORS).map((shade) => marks.shade.create({ shade })),
  pick(['Georgia', 'Noto Sans JP 2', 'Mincho \u660e\u671d', '+body', '+mono', 'X']).map((font) =>
    marks.font.create({ font }),
  ),
  pick(['small', 'all']).map((caps) => marks.caps.create({ caps })),
  points(-1584, 1584, 0.05)
    .filter((t) => t !== '0')
    .map((tracking) => marks.tracking.create({ tracking })),
  fc
    .integer({ min: 1, max: 600 })
    .filter((n) => n !== 100)
    .map((n) => marks.scale.create({ scale: String(n) })),
  points(-1584, 1584, 0.5)
    .filter((h) => h !== '0')
    .map((shift) => marks.shift.create({ shift })),
  fc.oneof(fc.constant('0'), points(1, 1638, 0.5)).map((kern) => marks.kern.create({ kern })),
  fc
    .subarray([...OTF_FEATURES], { minLength: 1, maxLength: 3 })
    .map((list) => marks.otf.create({ otf: [...list].sort().join(' ') })),
  pick(['emboss', 'engrave', 'outline', 'shadow', 'outline shadow', 'emboss shadow']).map((effect) =>
    marks.effect.create({ effect }),
  ),
  fc
    .tuple(pick(BOX_STYLES), fc.option(pick(COLORS), { nil: null }))
    .map(([style, color]) => marks.box.create({ style, color })),
  pick(FOREIGN_TAGS).map((tag) => marks.foreign.create({ tag })),
];

const markSet = fc
  .subarray([...markFactories.keys()], { maxLength: 4 })
  .chain((picked) =>
    fc
      .tuple(...picked.map((i) => markFactories[i]))
      .map((list) => list.reduce<readonly Mark[]>((set, mark) => mark.addToSet(set), [])),
  );

type Segment =
  { kind: 'text'; text: string; marks: readonly Mark[] } | { kind: 'break' } | { kind: 'node'; node: PMNode };

const textSegment = fc.tuple(words, markSet, fc.boolean()).map(([text, set, code]): Segment => {
  // A link at the start of a paragraph with `]:` in its code reads as a reference definition. Markdown has no
  // way around that, so the generator leaves `]` out of code.
  if (code) return { kind: 'text', text: text.replace(/]/g, ')'), marks: marks.code.create().addToSet(set) };
  // R-WS-1: marks that show on spaces keep the spaces at their edges, so only the others need trimmed text.
  return { kind: 'text', text: set.some((mark) => !showsOnSpaces(mark)) ? trimmed(text) : text, marks: set };
});

const footnoteSegment = fc
  .tuple(pick(IDS), markSet)
  .map(([id, set]): Segment => ({ kind: 'node', node: nodes.footnoteRef.create({ id }, null, set) }));

const mathSource = fc.stringMatching(/^[a-z0-9^+=-]{1,6}$/);

const imageSegment = fc
  .tuple(fc.constantFrom('asset:01m3sabc31y0rfa24eeh6j4ky4', 'https://example.com/x.png'), words, markSet)
  .map(([src, alt, set]): Segment => ({
    kind: 'node',
    node: nodes.image.create({ src, alt: alt.replace(/\t/g, ' ') }, null, set),
  }));

const mathSegment = mathSource.map((source): Segment => ({ kind: 'node', node: nodes.mathInline.create({ source }) }));

const segment = fc.oneof(
  { weight: 10, arbitrary: textSegment },
  { weight: 1, arbitrary: fc.constant<Segment>({ kind: 'break' }) },
  { weight: 1, arbitrary: imageSegment },
  { weight: 1, arbitrary: mathSegment },
  { weight: 1, arbitrary: footnoteSegment },
);

/** Inline nodes. A break is kept only between two other pieces. */
function inlineContent(segments: readonly Segment[], allowBreaks: boolean): PMNode[] {
  const pieces = segments.filter((piece) => allowBreaks || piece.kind !== 'break');
  const built = pieces
    .filter((piece, i) => piece.kind !== 'break' || (i > 0 && i < pieces.length - 1 && pieces[i - 1].kind !== 'break'))
    .map((piece) => {
      if (piece.kind === 'break') return nodes.hardBreak.create();
      if (piece.kind === 'node') return piece.node;
      return textSchema.text(piece.text, piece.marks);
    });
  while (built.at(-1)?.type.name === 'hardBreak') built.pop();
  return built.length > 0 ? built : [textSchema.text('x')];
}

const paragraphContent = fc.array(segment, { minLength: 1, maxLength: 6 }).map((s) => inlineContent(s, true));
const lineContent = fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => inlineContent(s, false));

const isList = (node: PMNode) => node.type.name === 'bulletList' || node.type.name === 'orderedList';

/** Puts a paragraph between two lists of one kind, which would otherwise read back as one list. */
function separateLists(blocks: PMNode[]): PMNode[] {
  return blocks.flatMap((block, i) => {
    const before = blocks[i - 1];
    const apart = before && isList(block) && before.type === block.type;
    return apart ? [nodes.paragraph.create(null, textSchema.text('x')), block] : [block];
  });
}

const fence = fc
  .array(fc.constantFrom('a', ' ', '`', '```', '~', '$$', '', '  x', '\t'), { maxLength: 4 })
  .map((l) => l.join('\n'));

export interface Blocks {
  readonly block: fc.Arbitrary<PMNode>;
  readonly doc: fc.Arbitrary<PMNode>;
}

/** Documents of any supported block, to a nesting depth of three. */
export function documents(): Blocks {
  const { block } = fc.letrec<{ block: PMNode; blocks: PMNode[] }>((tie) => ({
    blocks: fc.array(tie('block'), { minLength: 1, maxLength: 3 }).map(separateLists),
    block: fc.oneof(
      { depthSize: 'small', maxDepth: 3 },
      { weight: 6, arbitrary: paragraphContent.map((c) => nodes.paragraph.create(null, c)) },
      {
        weight: 3,
        arbitrary: fc
          .tuple(fc.integer({ min: 1, max: 6 }), lineContent)
          .map(([level, c]) => nodes.heading.create({ level }, c)),
      },
      {
        weight: 1,
        arbitrary: fc
          .tuple(fc.option(fc.constantFrom('js', 'c++', 'a-b.c'), { nil: null }), fence)
          .map(([language, text]) => nodes.codeBlock.create({ language }, text === '' ? null : textSchema.text(text))),
      },
      { weight: 1, arbitrary: fc.constant(nodes.horizontalRule.create()) },
      {
        weight: 1,
        arbitrary: fc
          .array(mathSource, { minLength: 1, maxLength: 2 })
          .map((l) => nodes.mathBlock.create({ source: l.join('\n') })),
      },
      { weight: 3, arbitrary: listOf(tie('blocks'), false) },
      { weight: 3, arbitrary: listOf(tie('blocks'), true) },
      { weight: 2, arbitrary: tie('blocks').map((b) => nodes.blockquote.create(null, b)) },
      {
        weight: 2,
        arbitrary: fc
          .tuple(
            fc.constantFrom(...CALLOUT_TYPES, 'custom'),
            fc.constantFrom(...FOLDS),
            lineContent,
            fc.oneof(fc.constant([] as PMNode[]), tie('blocks')),
          )
          .map(([type, fold, title, body]) =>
            nodes.callout.create({ type, fold }, [nodes.calloutTitle.create(null, title), ...body]),
          ),
      },
    ),
  }));
  return {
    block,
    doc: fc.array(block, { minLength: 1, maxLength: 4 }).map((b) => nodes.doc.create(null, separateLists(b))),
  };
}

function listOf(body: fc.Arbitrary<PMNode[]>, ordered: boolean): fc.Arbitrary<PMNode> {
  const item = fc
    .tuple(fc.constantFrom(null, false, true), paragraphContent, fc.oneof(fc.constant([] as PMNode[]), body))
    .map(([checked, lead, rest]) =>
      nodes.listItem.create({ checked }, [nodes.paragraph.create(null, lead), ...separateLists(rest)]),
    );
  return fc
    .tuple(fc.array(item, { minLength: 1, maxLength: 3 }), fc.integer({ min: 0, max: 12 }))
    .map(([items, start]) =>
      ordered ? nodes.orderedList.create({ start }, items) : nodes.bulletList.create(null, items),
    );
}

/** Markdown-like strings, for checking that any input parses and that writing it is stable. */
export const markdownSource: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(...LETTERS, ' ', '\n', '\n\n', '  ') },
      { weight: 8, arbitrary: fc.constantFrom(...PUNCTUATION) },
      {
        weight: 4,
        arbitrary: fc.constantFrom(
          ...FRAGMENTS,
          '**',
          '*',
          '==',
          '~~',
          '`',
          '```',
          '> ',
          '- ',
          '1. ',
          '- [ ] ',
          '[x](y)',
          '![a](asset:1)',
          '<mark>',
          '</mark>',
          '<span data-size="small">',
          '<span data-font="Georgia">',
          '<span data-glow="soft">',
          '<u data-line="wave">',
          '</u>',
          '</span>',
          '[^01m3sbcmt0000000000000c001]',
          '$x$',
          '\\\n',
          '    ',
        ),
      },
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(''));

/**
 * How many runs a property gets: `FC_RUNS` when set (100,000 in the nightly job), 1,000 in CI as the Phase 4 plan
 * asks of every pull request, and `local` on a developer's machine, where several suites share the processor.
 */
export function propertyRuns(local: number): number {
  const forced = Number(process.env.FC_RUNS);
  if (Number.isInteger(forced) && forced > 0) return forced;
  return process.env.CI ? Math.max(1000, local) : local;
}
