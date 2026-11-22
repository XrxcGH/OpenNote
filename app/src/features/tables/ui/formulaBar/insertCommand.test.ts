import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../../../registries';
import type { TableExtraHost } from '../../../page';
import { addBar, INSERT_FUNCTION_COMMAND, registerInsertFunction } from './insertCommand';

describe('Insert function (Shift+F3) in a cell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a command of both table modes that opens the bar of the focused table', () => {
    const undo = registerInsertFunction();
    const def = commands.get(INSERT_FUNCTION_COMMAND);
    expect(def?.keys).toEqual(['Shift+F3']);
    expect(def?.scope).toBe('editor.table');

    const cell = {};
    vi.stubGlobal('document', { activeElement: cell });
    const insert = vi.fn();
    const element = { contains: (node: unknown) => node === cell };
    const remove = addBar({ host: { element } as unknown as TableExtraHost, insert });
    expect(def?.when?.({} as never)).toBe(true);
    void def?.run({} as never, undefined);
    expect(insert).toHaveBeenCalledTimes(1);

    // Focus outside every table with a bar: the chord keeps its other meaning.
    vi.stubGlobal('document', { activeElement: {} });
    expect(def?.when?.({} as never)).toBe(false);
    remove();
    undo();
  });
});
