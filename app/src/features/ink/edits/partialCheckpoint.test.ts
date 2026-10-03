// Review finding (high): after an interim checkpoint the engine puts the sent parts in the index, as the README says,
// and the session must not see them twice: once from the index and once from its own list of parts.
import { describe, expect, it } from 'vitest';
import { lineStroke } from '../geometry/fixtures';
import { createStrokeIndex } from '../geometry/strokeIndex';
import type { Stroke } from '../geometry/types';
import { createPartialEraseSession } from './eraseSession';

describe('a partial erase that checkpoints while it runs', () => {
  it('cuts each part once after its checkpoint lands in the index', () => {
    let counter = 0;
    const newId = () => `p${++counter}`;
    const index = createStrokeIndex([lineStroke('long', { x: 0, y: 0 }, { x: 600, y: 0 }, 120)]);
    const session = createPartialEraseSession<Stroke>(index, newId);
    const apply = (tx: { removed: string[]; added: Stroke[] }) => {
      tx.removed.forEach((id) => index.remove(id));
      tx.added.forEach((stroke) => index.put(stroke));
    };
    for (let k = 1; k <= 6; k++) {
      const x = k * 80;
      const change = session.move(
        [
          { x, y: -10 },
          { x, y: 10 },
        ],
        4,
      );
      expect(new Set(change.removed).size).toBe(change.removed.length);
      expect(change.removed).toHaveLength(1);
      apply(session.checkpoint());
    }
    apply(session.commit());
    // Every piece is its own part of the line: no two strokes in the index are copies of each other.
    const shapes = [...index.all()].map((stroke) => JSON.stringify(stroke.points));
    expect(new Set(shapes).size).toBe(shapes.length);
    expect(index.size).toBeLessThanOrEqual(14);
  });
});
