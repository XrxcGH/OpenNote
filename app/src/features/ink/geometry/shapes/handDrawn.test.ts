// Shape recognition against the hand-drawn corpus (handDrawn.ts): every shape the recognizer knows, drawn the way a
// hand draws, and letters, words, and scribbles that must stay ink (Beta 6 bug 11). A held pen asks for every shape; a
// lifted pen with ink-to-shape on asks for the basic ones. At least 95% of shapes must come back as what was meant,
// and at most 2% of writing may become a shape.
import { describe, expect, it } from 'vitest';
import { recognizeShape } from './recognize';
import { inkCorpus, shapeCorpus, type Drawing, type Ending } from './handDrawn';

/** Drawings of each shape and of each kind of writing, for each way of ending the stroke. */
const COUNT = 60;
/** The options the pen passes: hold-to-shape asks for every shape, ink-to-shape on lift for the basic ones. */
const OPTIONS: Record<Ending, { minSize: number; width: number; extra: boolean }> = {
  hold: { minSize: 16, width: 2, extra: true },
  lift: { minSize: 16, width: 2, extra: false },
};

interface Tally {
  right: number;
  total: number;
  answers: Map<string, number>;
}

function tally(drawings: readonly Drawing[], ending: Ending): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const d of drawings) {
    const kind = recognizeShape(d.points, OPTIONS[ending])?.shape.kind ?? null;
    const row = out.get(d.name) ?? { right: 0, total: 0, answers: new Map<string, number>() };
    row.total++;
    if (kind === d.expect) row.right++;
    else row.answers.set(kind ?? 'ink', (row.answers.get(kind ?? 'ink') ?? 0) + 1);
    out.set(d.name, row);
  }
  return out;
}

const share = (rows: Map<string, Tally>, key: 'right' | 'wrong'): number => {
  let right = 0;
  let total = 0;
  for (const row of rows.values()) {
    right += row.right;
    total += row.total;
  }
  return key === 'right' ? right / total : 1 - right / total;
};

function report(title: string, rows: Map<string, Tally>): string {
  const lines = [...rows].map(([name, row]) => {
    const wrong = [...row.answers].map(([k, n]) => `${k} x${n}`).join(', ');
    return `  ${name.padEnd(22)} ${String(row.right).padStart(3)}/${row.total} ${wrong}`;
  });
  const right = (share(rows, 'right') * 100).toFixed(1);
  return `${title}\n${lines.join('\n')}\n  SHARE ${title}: ${right}% right`;
}

describe('shape recognition on hand-drawn strokes', () => {
  for (const ending of ['hold', 'lift'] as const) {
    const pen = ending === 'hold' ? 'held' : 'lifted';
    const shapes = tally(
      shapeCorpus(COUNT, ending).filter((d) => ending === 'hold' || !d.extraOnly),
      ending,
    );
    const ink = tally(inkCorpus(COUNT, ending), ending);

    it(`names at least 95% of shapes right with the pen ${pen}`, () => {
      console.info(report(`shapes, pen ${ending}`, shapes));
      expect(share(shapes, 'right')).toBeGreaterThanOrEqual(0.95);
      // No one shape may fall far behind the rest.
      for (const [name, row] of shapes) expect(row.right / row.total, name).toBeGreaterThanOrEqual(0.85);
    });

    it(`turns at most 2% of writing and scribbles into shapes with the pen ${pen}`, () => {
      console.info(report(`writing, pen ${ending}`, ink));
      expect(share(ink, 'wrong')).toBeLessThanOrEqual(0.02);
    });
  }
});
