// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes are test inputs or CSS for other apps, not design values.
// Hostile and slow input (ADR 0084): a page cannot pass itself off as OpenNote's copy, a long number cannot hang the
// formatting reader, and a long formatted copy stays fast. Word's double underline and Docs' line spacing are read.
import { describe, expect, it } from 'vitest';
import { clipboardSerializer, mergeSpans } from '../../../editor/clipboard/serializer';
import { textSchema } from '../../../editor/schema/schema';
import { points } from './normalize/keep';
import { sanitizePaste } from './sanitize';

const { marks, nodes } = textSchema;
const word = '<meta name="Generator" content="Microsoft Word 15">';
const run = (html: string, mode?: 'keepSource' | 'mergeFormatting') =>
  sanitizePaste({ html }, { fidelity: true, mode, defaults: { web: 'mergeFormatting' } as never });
const text = (result: ReturnType<typeof run>) => {
  const piece = result.pieces[0];
  if (piece.kind !== 'text') throw new Error('expected text');
  return piece.doc;
};

describe('a page that claims to be OpenNote', () => {
  const hostile =
    '<p title=" data-pm-slice=1" data-paste-para=\'{"align":"center"}\'>Visible</p>' +
    '<p style="display:none">Hidden</p><nav>Menu</nav><p aria-hidden="true">Aria</p>';

  it('is not OpenNote when the attribute only appears in an attribute value', () => {
    const result = run(hostile);
    expect(result.source).toBe('web');
    expect(result.choice).toBe('mergeFormatting');
    expect(text(result).textContent).toBe('Visible');
    expect(text(result).firstChild!.attrs.align).toBeNull();
  });

  it('is not OpenNote with the slice attribute alone, as any ProseMirror app writes it', () => {
    const result = run(`<p data-pm-slice="1 1 []" data-paste-para='{"align":"center"}'>Other app</p><nav>Menu</nav>`);
    expect(result.source).toBe('web');
    expect(text(result).firstChild!.attrs.align).toBeNull();
  });

  it('still gets the web hygiene when it does carry both attributes', () => {
    const result = run(
      '<p data-pm-slice="1 1 []" data-opennote-copy="1">Own</p><p style="display:none">Hidden</p><nav>Menu</nav>' +
        '<img src="https://t.example/p.gif" width="1" height="1">',
    );
    expect(result.source).toBe('opennote');
    expect(text(result).textContent).toBe('Own');
    expect(result.images).toHaveLength(0);
  });
});

describe('long numbers in formatting values', () => {
  it('are rejected in a few milliseconds', () => {
    const digits = `${'1'.repeat(1_000_000)}x`;
    const started = performance.now();
    expect(points(digits)).toBeNull();
    const result = run(
      `${word}<p style="margin-left:${digits}pt;line-height:${digits}"><span style="font-size:${digits}">Hi</span></p>`,
      'keepSource',
    );
    expect(text(result).textContent).toBe('Hi');
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('still read ordinary lengths', () => {
    expect(points('12pt')).toBe(12);
    expect(points('1in')).toBe(72);
    expect(points('.5pt')).toBe(0.5);
    expect(points('3.pt')).toBe(3);
  });
});

describe('Word and Docs formatting', () => {
  it('reads text-underline:double as a double underline', () => {
    const result = run(`${word}<p><u><span style="text-underline:double">Twice</span></u></p>`, 'keepSource');
    const json = JSON.stringify(text(result).toJSON());
    expect(json).toContain('"line":"double"');
  });

  it('copy writes text-underline:double beside text-decoration-style', () => {
    const doc = nodes.paragraph.create(null, textSchema.text('x', [marks.underline.create({ line: 'double' })]));
    const root = document.createElement('div');
    root.append(clipboardSerializer(textSchema).serializeFragment(nodes.doc.create(null, [doc]).content));
    expect(root.innerHTML).toMatch(/text-underline:\s*double/);
    expect(root.innerHTML).toMatch(/text-decoration-style:\s*double/);
  });

  it('reads a unitless line-height as a multiple', () => {
    const result = run(
      '<meta name="Generator" content="Google Docs"><p style="line-height:1.38">Docs</p>',
      'keepSource',
    );
    expect(text(result).firstChild!.attrs.line).toEqual({ rule: 'multiple', value: 1.38 });
  });
});

describe('copying a long formatted note', () => {
  it('merges 10,000 runs without restarting', () => {
    const root = document.createElement('div');
    const p = root.appendChild(document.createElement('p'));
    for (let i = 0; i < 10_000; i++) {
      const a = p.appendChild(document.createElement('span'));
      a.setAttribute('data-font', 'Georgia');
      const b = a.appendChild(document.createElement('span'));
      b.setAttribute('data-size', '13');
      const c = b.appendChild(document.createElement('span'));
      c.setAttribute('data-color', '#c00000');
      c.textContent = 'w';
    }
    const started = performance.now();
    mergeSpans(root);
    expect(performance.now() - started).toBeLessThan(3000);
    const first = root.querySelector('span')!;
    expect(first.querySelector('span')).toBeNull();
    expect(first.getAttribute('data-font')).toBe('Georgia');
    expect(first.getAttribute('data-size')).toBe('13');
    expect(first.getAttribute('data-color')).toBe('#c00000');
  });
});
