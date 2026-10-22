// A 3D graph saved as a picture in a real browser: the PNG has the PNG signature, twice the export SVG's size, a
// name and alt text that names its function; a graph that plots nothing gives no picture.
import { describe, expect, it } from 'vitest';
import { exportGraph } from '../exportRenderers';
import { graphPicture } from './picture';

/** The width and height a PNG's IHDR chunk records. */
function pngSize(bytes: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(bytes);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('a graph as a picture', () => {
  it('saves z = sin(x)*cos(y) as a PNG at twice the export size', async () => {
    const source = 'z = sin(x)*cos(y)';
    const svg = exportGraph(source)!;
    expect(svg).toContain('<polygon ');
    const width = Number(/width="(\d+)"/.exec(svg)![1]);
    const height = Number(/height="(\d+)"/.exec(svg)![1]);

    const picture = (await graphPicture(source))!;
    expect(picture).not.toBeNull();
    expect(picture.mime).toBe('image/png');
    expect(picture.name).toBe('Graph.png');
    expect(picture.alt).toContain('sin(x)*cos(y)');
    expect([...new Uint8Array(picture.bytes, 0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(picture.bytes)).toEqual({ width: width * 2, height: height * 2 });
  });

  it('honors the scale it is given', async () => {
    const one = (await graphPicture('z = x^2 + y^2', 1))!;
    const svg = exportGraph('z = x^2 + y^2')!;
    expect(pngSize(one.bytes).width).toBe(Number(/width="(\d+)"/.exec(svg)![1]));
  });

  it('gives no picture for a graph that plots nothing', async () => {
    expect(await graphPicture('')).toBeNull();
  });
});
