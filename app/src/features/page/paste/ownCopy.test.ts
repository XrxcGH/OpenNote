// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes here are test inputs or CSS for other apps, not design values.
// OpenNote reads its own copy back exactly, and Merge formatting on it drops the formatting (ADR 0084).
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { clipboardSerializer } from '../../../editor/clipboard/serializer';
import { textSchema } from '../../../editor/schema/schema';
import { sanitizePaste } from './sanitize';

const { marks, nodes } = textSchema;

function copyHtml(blocks: PMNode[]): HTMLElement {
  const root = document.createElement('div');
  root.append(clipboardSerializer(textSchema).serializeFragment(nodes.doc.create(null, blocks).content));
  return root;
}

const georgia = () => [
  marks.font.create({ font: 'Georgia' }),
  marks.textSize.create({ size: '13' }),
  marks.textColor.create({ color: '#c00000' }),
];

function pasted(root: HTMLElement, mode?: 'mergeFormatting') {
  root.firstElementChild?.setAttribute('data-pm-slice', '1 1 []');
  const result = sanitizePaste({ html: root.innerHTML }, { fidelity: true, mode });
  const piece = result.pieces[0];
  if (piece.kind !== 'text') throw new Error('expected text');
  return { result, doc: piece.doc };
}

describe('a paste from OpenNote', () => {
  it('is read back as the same marks and paragraph format', () => {
    const block = nodes.paragraph.create(
      { align: 'justify', before: 3, indent: { start: 18, first: -9 } },
      textSchema.text('Round trip', georgia()),
    );
    const { result, doc } = pasted(copyHtml([block]));
    expect(result.source).toBe('opennote');
    expect(result.choice).toBe('keepSource');
    const read = doc.firstChild!;
    expect(read.attrs).toMatchObject({ align: 'justify', before: 3, indent: { start: 18, first: -9 } });
    expect(read.firstChild!.marks.map((mark) => mark.type.name).sort()).toEqual(['font', 'textColor', 'textSize']);
    expect(read.firstChild!.marks.find((mark) => mark.type.name === 'textSize')?.attrs.size).toBe('13');
  });

  it('merge formatting on a paste from OpenNote drops fonts, sizes, colors, and paragraph formats', () => {
    const block = nodes.paragraph.create({ align: 'center' }, textSchema.text('Merge me', georgia()));
    const { doc } = pasted(copyHtml([block]), 'mergeFormatting');
    expect(doc.firstChild!.attrs.align).toBeNull();
    expect(doc.firstChild!.firstChild!.marks).toHaveLength(0);
  });
});
