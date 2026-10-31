// The ORF map: the sequence as a ruler with six frame tracks, each open reading frame a bar in its frame, and the
// longest one in the accent tone. Positions are plus-strand bases, so both strands share one scale.
import type { Figure, Shape } from '../figure';
import { ticks } from '../plot';
import type { Orf } from './engine';

const LEFT = 44;
const RIGHT = 16;
const TRACK = 22;

export function orfMap(length: number, orfs: Orf[], width = 520): Figure {
  const scale = (pos: number) => LEFT + ((pos - 1) / Math.max(1, length - 1)) * (width - LEFT - RIGHT);
  const tracks = ['+1', '+2', '+3', '−1', '−2', '−3'];
  const top = 12;
  const shapes: Shape[] = [];
  tracks.forEach((name, i) => {
    const y = top + i * TRACK + (i >= 3 ? 26 : 0);
    shapes.push({ kind: 'text', x: LEFT - 8, y: y + 13, label: name, size: 11, anchor: 'end', tone: 'muted' });
    shapes.push({ kind: 'line', x1: LEFT, y1: y + 9, x2: width - RIGHT, y2: y + 9, stroke: 'faint', width: 1 });
  });
  const rulerY = top + 3 * TRACK + 6;
  shapes.push({ kind: 'line', x1: LEFT, y1: rulerY, x2: width - RIGHT, y2: rulerY, stroke: 'ink', width: 1.5 });
  for (const v of ticks(1, length, 6)) {
    if (v < 1) continue;
    shapes.push({ kind: 'line', x1: scale(v), y1: rulerY - 3, x2: scale(v), y2: rulerY + 3, stroke: 'ink', width: 1 });
    shapes.push({
      kind: 'text',
      x: scale(v),
      y: rulerY + 14,
      label: String(v),
      size: 10,
      anchor: 'middle',
      tone: 'muted',
    });
  }
  const longest = orfs.reduce(
    (best, orf) => (best === null || orf.codons > best.codons ? orf : best),
    null as Orf | null,
  );
  for (const orf of orfs) {
    const track = orf.strand === '+' ? orf.frame - 1 : orf.frame + 2;
    const y = top + track * TRACK + (track >= 3 ? 26 : 0) + 3;
    const a = scale(Math.min(orf.start, orf.end));
    const b = scale(Math.max(orf.start, orf.end));
    const tone = orf === longest ? 'accent' : orf.nested ? 'muted' : 'ink';
    shapes.push({ kind: 'rect', x: a, y, w: Math.max(2, b - a), h: 12, fill: tone, stroke: 'none', r: 2 });
  }
  return { width, height: top + 6 * TRACK + 38, shapes };
}
