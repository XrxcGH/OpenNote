// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PaletteResult } from '../../registries/types';
import { withoutDisabledTwins } from './commandsProvider';

const result = (id: string, title: string, disabled?: boolean): PaletteResult =>
  ({ id, group: 'commands', title, score: 1, disabled, run: () => undefined }) as PaletteResult;

describe('withoutDisabledTwins', () => {
  it('keeps the working command of two with one title', () => {
    const list = [result('object.delete', 'Delete', true), result('tree.trash', 'Delete'), result('x', 'Other', true)];
    expect(withoutDisabledTwins(list).map((one) => one.id)).toEqual(['tree.trash', 'x']);
  });

  it('keeps both when neither works', () => {
    const list = [result('a', 'Delete', true), result('b', 'Delete', true)];
    expect(withoutDisabledTwins(list)).toHaveLength(2);
  });
});
