// fast-check generators for text block documents, for the round-trip property tests. They build canonical
// documents. No two lists of one kind sit side by side. No empty paragraph sits between blocks. No marked range
// starts or ends on whitespace. No hard break sits at the edge of a paragraph. The writer round-trips exactly those.
import * as fc from 'fast-check';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { CALLOUT_TYPES, FOLDS, HIGHLIGHT_COLORS, TEXT_SIZES } from '../schema/specs';
import { isSpaceChar } from './flanking';

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

const markFactories: readonly fc.Arbitrary<Mark>[] = [
  fc.constant(marks.bold.create()),
  fc.constant(marks.italic.create()),
  fc.constant(marks.strike.create()),
  fc.constant(marks.underline.create()),
  fc.constant(marks.highlight.create()),
  fc.constantFrom(...HIGHLIGHT_COLORS).map((color) => marks.highlight.create({ color })),
  // checks-disable-next-line brand-consistency: document content, not interface styling
  fc.constantFrom('ink', 'red', '#aa0000', '#00AAff').map((color) => marks.textColor.create({ color })),
  fc.constantFrom(...TEXT_SIZES).map((size) => marks.textSize.create({ size })),
  fc.constant(marks.subscript.create()),
  fc.constant(marks.superscript.create()),
  fc.constantFrom(...HREFS).map((href) => marks.link.create({ href })),
];

const markSet = fc
  .subarray([...markFactories.keys()], { maxLength: 3 })
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
  return { kind: 'text', text: set.length > 0 ? trimmed(text) : text, marks: set };
});

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
