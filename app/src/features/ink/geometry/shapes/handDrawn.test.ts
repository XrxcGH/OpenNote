// Shape recognition against the hand-drawn corpus (handDrawn.ts): every shape the recognizer knows, drawn the way a
// hand draws, and letters, words, and scribbles that must stay ink (Beta 6 bug 11). A held pen asks for every shape; a
// lifted pen with ink-to-shape on asks for the basic ones, unless the stroke is small and quick writing
// (handwriting.ts), which is checked as the pen does. Over three seeds, at least 95% of shapes must come back as what
// was meant, each shape at least 85% on every seed, and at most 2% of writing may become a shape.
import { describe, expect, it } from 'vitest';
import { smallAndQuick } from './handwriting';
import { recognizeShape } from './recognize';
import { inkCorpus, shapeCorpus, type Drawing, type Ending } from './handDrawn';

/** Drawings of each shape and of each kind of writing, for each way of ending the stroke and each seed. */
const COUNT = 60;
const SEEDS = [1, 2, 3];
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
    // A lifted pen leaves small, quick writing as ink before it looks for a shape, at 100% zoom.
    const kind =
      ending === 'lift' && smallAndQuick(d.points, 1)
        ? null
        : (recognizeShape(d.points, OPTIONS[ending])?.shape.kind ?? null);
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
    const seeds = SEEDS.map((seed) => ({
      seed,
      shapes: tally(
        shapeCorpus(COUNT, ending, seed).filter((d) => ending === 'hold' || !d.extraOnly),
        ending,
      ),
      ink: tally(inkCorpus(COUNT, ending, seed), ending),
    }));
    const pooled = (key: 'shapes' | 'ink'): Map<string, Tally> => {
      const out = new Map<string, Tally>();
      for (const run of seeds)
        for (const [name, row] of run[key]) {
          const sum = out.get(name) ?? { right: 0, total: 0, answers: new Map<string, number>() };
          sum.right += row.right;
          sum.total += row.total;
          for (const [k, n] of row.answers) sum.answers.set(k, (sum.answers.get(k) ?? 0) + n);
          out.set(name, sum);
        }
      return out;
    };

    it(`names at least 95% of shapes right with the pen ${pen}`, () => {
      console.info(report(`shapes, pen ${ending}, seeds ${SEEDS.join(' ')}`, pooled('shapes')));
      expect(share(pooled('shapes'), 'right')).toBeGreaterThanOrEqual(0.95);
      // No one shape may fall far behind the rest, on any seed.
      for (const { seed, shapes } of seeds)
        for (const [name, row] of shapes)
          expect(row.right / row.total, `${name}, seed ${seed}`).toBeGreaterThanOrEqual(0.85);
    });

    it(`turns at most 2% of writing and scribbles into shapes with the pen ${pen}`, () => {
      console.info(report(`writing, pen ${ending}, seeds ${SEEDS.join(' ')}`, pooled('ink')));
      expect(share(pooled('ink'), 'wrong')).toBeLessThanOrEqual(0.02);
    });
  }
});
