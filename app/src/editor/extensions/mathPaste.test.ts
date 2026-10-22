// @vitest-environment jsdom
// Pasting LaTeX makes equations: $…$, $$…$$, \(…\), \[…\], environments, and bare LaTeX.
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from '../commands/testing';
import type { TestEditor } from '../commands/testing';
import { looksLikeLatex, splitLatex } from './mathPaste';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

function paste(page: TestEditor, text: string): boolean {
  const { view } = page.editor;
  const event = { clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') } } as ClipboardEvent;
  return view.someProp('handlePaste', (handle) => handle(view, event, view.state.doc.slice(0, 0))) === true;
}

const summary = (page: TestEditor): string[] => {
  const out: string[] = [];
  page.editor.state.doc.descendants((node) => {
    if (node.type.name === 'mathInline' || node.type.name === 'mathBlock')
      out.push(`${node.type.name}:${node.attrs.source}`);
    else if (node.isText) out.push(`text:${node.text}`);
  });
  return out;
};

describe('splitting pasted text', () => {
  it('finds each kind of mark', () => {
    expect(splitLatex('so $x^2$ and \\(y\\) end')).toEqual([
      { kind: 'text', text: 'so ' },
      { kind: 'math', source: 'x^2', display: false },
      { kind: 'text', text: ' and ' },
      { kind: 'math', source: 'y', display: false },
      { kind: 'text', text: ' end' },
    ]);
    expect(splitLatex('$$\\int_0^1 x\\,dx$$')).toEqual([{ kind: 'math', source: '\\int_0^1 x\\,dx', display: true }]);
    expect(splitLatex('\\[a+b\\]')).toEqual([{ kind: 'math', source: 'a+b', display: true }]);
    const env = splitLatex('\\begin{align} a &= b \\\\ c &= d \\end{align}');
    expect(env).toHaveLength(1);
    expect(env?.[0]).toMatchObject({ kind: 'math', display: true });
  });

  it('leaves prices and ordinary text alone', () => {
    expect(splitLatex('It costs $5 and $6 today')).toBeNull();
    expect(splitLatex('Just some words.')).toBeNull();
    expect(splitLatex('Pay $ 5 and $ 6')).toBeNull();
  });

  it('takes bare LaTeX as one equation, and sentences as text', () => {
    expect(splitLatex('\\frac{a}{b}')).toEqual([{ kind: 'math', source: '\\frac{a}{b}', display: false }]);
    expect(splitLatex('x^{2} + y_{1}')).toEqual([{ kind: 'math', source: 'x^{2} + y_{1}', display: false }]);
    expect(looksLikeLatex('Use the \\alpha particle in the lab notebook please')).toBe(false);
    expect(looksLikeLatex('C:\\Users\\name\\Documents')).toBe(false);
  });
});

describe('pasting into a page', () => {
  it('makes inline equations between the words', () => {
    mounted = mountEditor('[]');
    expect(paste(mounted, 'Area is $\\pi r^2$ here')).toBe(true);
    expect(summary(mounted)).toEqual(['text:Area is ', 'mathInline:\\pi r^2', 'text: here']);
  });

  it('makes display math from $$…$$ pasted on an empty line', () => {
    mounted = mountEditor('[]');
    expect(paste(mounted, '$$E = mc^2$$')).toBe(true);
    expect(mounted.editor.state.doc.child(0).type.name).toBe('mathBlock');
    expect(mounted.editor.state.doc.child(0).attrs.source).toBe('E = mc^2');
  });

  it('makes bare LaTeX an equation and leaves other pastes to the editor', () => {
    mounted = mountEditor('[]');
    expect(paste(mounted, '\\sqrt{2}')).toBe(true);
    expect(summary(mounted)).toEqual(['mathInline:\\sqrt{2}']);
    expect(paste(mounted, 'plain words only')).toBe(false);
  });
});
