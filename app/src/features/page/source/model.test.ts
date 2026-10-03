import { describe, expect, it } from 'vitest';
import {
  buildSource,
  caretTarget,
  markerOf,
  parseMarker,
  parseSegments,
  planSource,
  sourceCaret,
  stripSyntax,
  tokenizeLine,
} from './model';
import type { SourceBlock } from './model';

const blocks: SourceBlock[] = [
  { id: 'a1', type: 'text', markdown: '# Cells\n\nAbout cells', label: '' },
  { id: 'i1', type: 'image', markdown: '', label: 'Leaf "cross-section"' },
  { id: 'a2', type: 'text', markdown: '- [ ] read', label: '' },
  { id: 'k1', type: 'ink', markdown: '', label: '' },
];

describe('Markdown source', () => {
  it('lays blocks out with markers, and objects as markers only', () => {
    const { source, lines } = buildSource(blocks);
    expect(source).toBe(
      [
        '<!-- text a1 -->',
        '# Cells',
        '',
        'About cells',
        '',
        '<!-- image i1 "Leaf cross-section" -->',
        '',
        '<!-- text a2 -->',
        '- [ ] read',
        '',
        '<!-- ink k1 -->',
      ].join('\n'),
    );
    expect(lines.get('a2')).toBe(7);
  });

  it('reads markers back, with or without a label', () => {
    expect(parseMarker(markerOf(blocks[1]))).toEqual({ kind: 'image', id: 'i1', label: 'Leaf cross-section' });
    expect(parseMarker('<!-- text new -->')).toEqual({ kind: 'text', id: 'new', label: '' });
    expect(parseMarker('<!-- just a comment -->')).toBeNull();
    expect(parseMarker('text')).toBeNull();
  });

  it('cuts the source into segments', () => {
    const segments = parseSegments(buildSource(blocks).source);
    expect(segments.map((s) => [s.marker?.id, s.content])).toEqual([
      ['a1', '# Cells\n\nAbout cells'],
      ['i1', ''],
      ['a2', '- [ ] read'],
      ['k1', ''],
    ]);
  });

  it('changes nothing when nothing was edited', () => {
    expect(planSource(buildSource(blocks).source, blocks)).toEqual([]);
  });

  it('edits the boxes whose Markdown changed, and only those', () => {
    const source = buildSource(blocks).source.replace('About cells', 'About **cells** and tissue');
    expect(planSource(source, blocks)).toEqual([
      { kind: 'setText', block: 'a1', markdown: '# Cells\n\nAbout **cells** and tissue' },
    ]);
  });

  it('adds a box for text written under a placeholder or a new marker, after the right block', () => {
    const source = buildSource(blocks).source.replace(
      '<!-- text a2 -->',
      'Caption for the leaf\n\n<!-- text new -->\nA new box\n\n<!-- text a2 -->',
    );
    const edits = planSource(source, blocks);
    expect(edits).toHaveLength(2);
    expect(edits[0]).toMatchObject({ kind: 'insert', markdown: 'Caption for the leaf', after: 'i1' });
    expect(edits[1]).toMatchObject({
      kind: 'insert',
      markdown: 'A new box',
      after: edits[0].kind === 'insert' ? edits[0].id : '',
    });
  });

  it('puts text before the first marker ahead of the first block and never deletes a block', () => {
    const edits = planSource(`Intro\n\n${buildSource(blocks).source}`, blocks);
    expect(edits).toEqual([expect.objectContaining({ kind: 'insert', markdown: 'Intro', after: null, before: 'a1' })]);
    // Dropping a placeholder or a whole box leaves the blocks as they are.
    expect(planSource('<!-- text a1 -->\n# Cells\n\nAbout cells', blocks)).toEqual([]);
  });

  it('clears a box whose Markdown was deleted but whose marker stayed', () => {
    const source = buildSource(blocks).source.replace('- [ ] read', '');
    expect(planSource(source, blocks)).toEqual([{ kind: 'setText', block: 'a2', markdown: '' }]);
  });
});

describe('colouring', () => {
  const text = (line: string) =>
    tokenizeLine(line)
      .map((t) => t.text)
      .join('');

  it('splits a line into pieces that put it back together', () => {
    for (const line of [
      '# Heading',
      '> quoted *text*',
      '  - [x] done `code` and [a](b)',
      '1. **bold** end',
      '',
      'plain',
    ]) {
      expect(text(line)).toBe(line);
    }
  });

  it('names the pieces', () => {
    expect(tokenizeLine('# Title').map((t) => t.kind)).toEqual(['marker', 'heading']);
    expect(tokenizeLine('<!-- image i1 -->')[0].kind).toBe('placeholder');
    expect(tokenizeLine('a **b** `c` [d](e)').map((t) => t.kind)).toEqual([
      'text',
      'strong',
      'text',
      'code',
      'text',
      'link',
    ]);
  });
});

describe('the caret between views', () => {
  const { source, lines } = buildSource(blocks);

  it('strips the syntax in front of the words', () => {
    expect(stripSyntax('  - [ ] read')).toEqual({ text: 'read', prefix: 8 });
    expect(stripSyntax('## Two')).toEqual({ text: 'Two', prefix: 3 });
    expect(stripSyntax('plain')).toEqual({ text: 'plain', prefix: 0 });
  });

  it('finds the line of a paragraph in its box, and a block from a line', () => {
    const at = sourceCaret(source, lines.get('a1')!, 'About cells', 6);
    expect(at).toEqual({ line: 3, column: 6 });
    expect(caretTarget(source, at.line, at.column)).toEqual({ block: 'a1', paragraph: 'About cells', offset: 6 });
    expect(sourceCaret(source, lines.get('a2')!, 'missing words', 0).line).toBe(lines.get('a2')! + 1);
  });
});
