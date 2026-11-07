// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes here are test inputs or CSS for other apps, not design values.
// Copy writes inline CSS for Word and Docs beside the data attributes (ADR 0084), and OpenNote reads its own copy
// back exactly.
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { textSchema } from '../schema/schema';
import { clipboardSerializer } from './serializer';
import { markDeclarations, paraDeclarations } from './style';

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

describe('copy', () => {
  it('writes a run in Georgia 13 pt red as a span whose style holds all three', () => {
    const root = copyHtml([nodes.paragraph.create(null, textSchema.text('Hello', georgia()))]);
    const span = root.querySelector('span[style]') as HTMLElement;
    expect(span.textContent).toBe('Hello');
    const style = span.getAttribute('style') ?? '';
    expect(style).toContain('font-family:Georgia');
    expect(style).toContain('font-size:13pt');
    expect(style).toContain('color:#c00000');
    expect(root.querySelectorAll('span')).toHaveLength(1);
    expect(span.getAttribute('data-font')).toBe('Georgia');
    expect(span.getAttribute('data-size')).toBe('13');
    expect(span.getAttribute('data-color')).toBe('#c00000');
  });

  it('writes the highlight with the Word hint, the paragraph format, and a quoted family name', () => {
    const root = copyHtml([
      nodes.paragraph.create(
        { align: 'center', indent: { start: 36 }, after: 6, line: { rule: 'exact', value: 14 } },
        textSchema.text('Note', [
          marks.highlight.create({ color: '#ffff00' }),
          marks.font.create({ font: 'Times New Roman' }),
        ]),
      ),
    ]);
    const style = root.querySelector('p')?.getAttribute('style') ?? '';
    expect(style).toContain('text-align:center');
    expect(style).toContain('margin-left:36pt');
    expect(style).toContain('margin-bottom:6pt');
    expect(style).toContain('line-height:14pt');
    expect(root.querySelector('mark')?.getAttribute('style')).toContain('mso-highlight:yellow');
    expect(root.querySelector('span')?.getAttribute('style')).toContain("font-family:'Times New Roman'");
  });

  it('writes nothing extra for a paragraph with no formatting', () => {
    const root = copyHtml([nodes.paragraph.create(null, textSchema.text('Plain'))]);
    expect(root.innerHTML).toBe('<p>Plain</p>');
  });
});

describe('the declarations', () => {
  it('give the Word hints that jsdom would drop from a style attribute', () => {
    expect(markDeclarations('highlight', { color: '#ffff00' })).toEqual({
      'background-color': '#ffff00',
      'mso-highlight': 'yellow',
    });
    expect(paraDeclarations({ line: { rule: 'exact', value: 14 } })).toEqual({
      'line-height': '14pt',
      'mso-line-height-rule': 'exactly',
    });
    expect(paraDeclarations({ line: { rule: 'atLeast', value: 14 } })['mso-line-height-rule']).toBe('at-least');
  });

  it('turn a pen name into its color and skip a theme color', () => {
    expect(markDeclarations('textColor', { color: 'indigo' })).toEqual({ color: '#2f4f9a' });
    expect(markDeclarations('textColor', { color: 'theme:accent1' })).toEqual({});
  });

  it('write sizes and spacing in points', () => {
    expect(markDeclarations('textSize', { size: '10.5' })).toEqual({ 'font-size': '10.5pt' });
    expect(markDeclarations('tracking', { tracking: '1.5' })).toEqual({ 'letter-spacing': '1.5pt' });
    expect(paraDeclarations({ line: { rule: 'multiple', value: 1.15 }, before: 12 })).toEqual({
      'margin-top': '12pt',
      'line-height': '115%',
    });
  });
});
