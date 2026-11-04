import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { runSpec } from './spec';
import type { ToolSpec } from './spec';

const fake = (run: ToolSpec['run']): ToolSpec => ({ id: 'jetengine', fields: [], run }) as unknown as ToolSpec;

describe('absurd inputs in the aerospace window', () => {
  it('reports a non-finite answer as a named problem', () => {
    const result = runSpec(
      fake(() => ({ rows: [{ id: 'thrust', value: Infinity }], steps: [] })),
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AeroError);
  });

  it('reports a RangeError from an engine as a named problem', () => {
    const result = runSpec(
      fake(() => {
        throw new RangeError('Invalid array length');
      }),
      {},
    );
    expect(result.ok).toBe(false);
  });
});
