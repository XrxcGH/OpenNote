import { describe, expect, it } from 'vitest';
import {
  captionedSvg,
  captionLines,
  figureFileName,
  figureSources,
  pngSize,
  readDpi,
  svgSize,
  withDpi,
  wrapCaption,
} from './figure';

const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="10" height="10"/></svg>';

describe('figure captions', () => {
  it('reads the size of a picture', () => {
    expect(svgSize(PICTURE)).toEqual({ width: 640, height: 360 });
    expect(svgSize('<svg viewBox="0 0 200 100"></svg>')).toEqual({ width: 200, height: 100 });
    expect(svgSize('<p>no</p>')).toBeNull();
  });

  it('wraps a caption at spaces', () => {
    expect(wrapCaption('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapCaption('unbreakableword', 5)).toEqual(['unbreakableword']);
  });

  it('numbers the caption and adds the source line', () => {
    const lines = captionLines({ number: 3, caption: 'Velocity over time', source: 'Lab 4' }, 640);
    expect(lines[0]).toBe('Figure 3. Velocity over time');
    expect(lines.at(-1)).toBe('Source: Lab 4');
  });

  it('puts the caption block under the picture and escapes it', () => {
    const svg = captionedSvg(PICTURE, { number: 2, caption: 'Rise & <fall>' });
    expect(svg).not.toBeNull();
    expect(svg).toContain('Figure 2. Rise &amp; &lt;fall&gt;');
    expect(svg).toContain('<title id="figure-title">Figure 2</title>');
    const size = svgSize(svg!);
    expect(size!.width).toBe(640);
    expect(size!.height).toBeGreaterThan(360);
    expect(captionedSvg('<p>no</p>', { number: 1, caption: 'x' })).toBeNull();
  });

  it('names the file from the number and caption', () => {
    expect(figureFileName({ number: 4, caption: 'Pressure vs. volume!' }, 'png')).toBe('figure-4-Pressure-vs-volume.png');
    expect(figureFileName({ number: 1, caption: '' }, 'svg')).toBe('figure-1.svg');
  });

  it('finds graphs and diagrams in Markdown', () => {
    const found = figureSources('text\n```graph\ny = x^2\n```\n\n```mermaid\nflowchart LR\nA-->B\n```\n```js\nx\n```');
    expect(found.map((f) => f.kind)).toEqual(['graph', 'diagram']);
    expect(found[0].preview).toBe('y = x^2');
  });
});

describe('figure PNG', () => {
  it('scales the pixel size by DPI and refuses huge pictures', () => {
    expect(pngSize({ width: 96, height: 48 }, 300)).toEqual({ width: 300, height: 150 });
    expect(pngSize({ width: 96, height: 48 }, 96)).toEqual({ width: 96, height: 48 });
    expect(pngSize({ width: 20000, height: 20000 }, 600)).toBeNull();
  });

  it('writes the DPI into a PNG header', () => {
    // A 1x1 PNG.
    const bytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    );
    expect(readDpi(bytes)).toBeNull();
    const tagged = withDpi(bytes, 300);
    expect(readDpi(tagged)).toBe(300);
    expect(tagged.length).toBe(bytes.length + 21);
    expect(withDpi(new Uint8Array([1, 2, 3]), 300)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
