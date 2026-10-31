// The helical wheel: residues placed 100 degrees apart, looking down the helix axis, joined in sequence order. Each
// is marked by its class with a shape as well as a tone, so the picture reads without color. Hydrophobic residues
// are filled, polar ones are rings, charged ones are squares with their sign, and glycine and proline are dashed.
import type { Figure, Shape } from '../figure';
import type { MolKey } from '../shared';
import { aaClass } from './engine';

const SIZE = 360;
const R = 120;
const DOT = 17;

function marker(aa: string, x: number, y: number, n: number): Shape[] {
  const cls = aaClass(aa);
  const shapes: Shape[] = [];
  if (cls === 'positive' || cls === 'negative') {
    shapes.push({
      kind: 'rect',
      x: x - DOT,
      y: y - DOT,
      w: 2 * DOT,
      h: 2 * DOT,
      r: 4,
      fill: 'paper',
      stroke: 'ink',
      width: 2.5,
    });
  } else {
    const fill = cls === 'hydrophobic' ? 'faint' : 'paper';
    const dash = cls === 'special' ? '3 3' : undefined;
    shapes.push({
      kind: 'circle',
      cx: x,
      cy: y,
      r: DOT,
      fill,
      stroke: cls === 'hydrophobic' ? 'accent' : 'ink',
      width: 2,
      ...(dash ? { dash } : {}),
    });
  }
  const sign = cls === 'positive' ? '+' : cls === 'negative' ? '−' : '';
  shapes.push({ kind: 'text', x, y: y + 5, label: `${aa}${sign}`, size: 14, anchor: 'middle', bold: true });
  shapes.push({ kind: 'text', x: x + DOT + 2, y: y - DOT + 4, label: String(n), size: 9, tone: 'muted' });
  return shapes;
}

/** The first `max` residues on a wheel; legend words are message keys. */
export function helicalWheel(seq: string, angles: number[], max = 18): Figure {
  const c = SIZE / 2;
  const shown = [...seq].slice(0, max);
  const at = (i: number) => {
    const a = ((angles[i]! - 90) * Math.PI) / 180;
    return { x: c + R * Math.cos(a), y: c + R * Math.sin(a) };
  };
  const shapes: Shape[] = [{ kind: 'circle', cx: c, cy: c, r: R, stroke: 'faint', width: 1 }];
  for (let i = 1; i < shown.length; i++) {
    const p = at(i - 1);
    const q = at(i);
    shapes.push({ kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: 'faint', width: 1 });
  }
  shown.forEach((aa, i) => {
    const p = at(i);
    shapes.push(...marker(aa, p.x, p.y, i + 1));
  });
  const legend: [MolKey, number, number, 'dot' | 'ring' | 'square' | 'dashed'][] = [
    ['protein.w.hydrophobic', 14, SIZE + 12, 'dot'],
    ['protein.w.polar', 190, SIZE + 12, 'ring'],
    ['protein.w.charged', 14, SIZE + 34, 'square'],
    ['protein.w.special', 190, SIZE + 34, 'dashed'],
  ];
  for (const [word, x, y, kind] of legend) {
    if (kind === 'square')
      shapes.push({ kind: 'rect', x: x - 7, y: y - 7, w: 14, h: 14, r: 2, fill: 'paper', stroke: 'ink', width: 2.5 });
    else {
      const fill = kind === 'dot' ? 'faint' : 'paper';
      shapes.push({
        kind: 'circle',
        cx: x,
        cy: y,
        r: 7,
        fill,
        stroke: kind === 'dot' ? 'accent' : 'ink',
        width: 2,
        ...(kind === 'dashed' ? { dash: '3 3' } : {}),
      });
    }
    shapes.push({ kind: 'text', x: x + 14, y: y + 4, label: { word }, size: 11 });
  }
  return { width: SIZE, height: SIZE + 50, shapes };
}
