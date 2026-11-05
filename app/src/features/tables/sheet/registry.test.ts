// The sheet's contribution registry. Lanes add commands, menu items, toolbar groups, and context menu entries. An
// ID taken twice is refused, and taking a contribution back removes all of it.
import { afterEach, describe, expect, it } from 'vitest';
import { commands, contextMenus } from '../../../registries';
import { SHEET_CONTEXT_MENU, contribute, sheetMenu, sheetToolbar } from './index';

let undo: (() => void)[] = [];
afterEach(() => {
  undo.forEach((take) => take());
  undo = [];
});

describe('the sheet contribution registry', () => {
  it('adds each kind where it belongs, in order, and takes it all back', () => {
    const take = contribute(
      {
        kind: 'command',
        lane: 'toolbar',
        command: { id: 'sheetTest.bold', title: 'tables.name', category: 'table', run: () => {} },
      },
      { kind: 'menuItem', item: { id: 'b', lane: 'merge', menu: 'format', command: 'x.b', group: 'g', order: 2 } },
      { kind: 'menuItem', item: { id: 'a', lane: 'merge', menu: 'format', command: 'x.a', group: 'g', order: 1 } },
      { kind: 'menuItem', item: { id: 'c', lane: 'data-tools', menu: 'data', command: 'x.c', group: 'g', order: 1 } },
      {
        kind: 'toolbarGroup',
        group: { id: 'font', lane: 'toolbar', label: 'tables.name', order: 1, commands: ['sheetTest.bold'] },
      },
      { kind: 'contextMenu', lane: 'merge', item: { id: 'sheetTest.merge', command: 'x.m', group: 'g', order: 1 } },
    );
    undo.push(take);
    expect(commands.get('sheetTest.bold')).toBeDefined();
    expect(sheetMenu('format').map((item) => item.id)).toEqual(['a', 'b']);
    expect(sheetMenu('data').map((item) => item.id)).toEqual(['c']);
    expect(sheetToolbar().map((group) => group.id)).toEqual(['font']);
    expect(contextMenus.get('sheetTest.merge')?.menu).toBe(SHEET_CONTEXT_MENU);
    take();
    expect(commands.get('sheetTest.bold')).toBeUndefined();
    expect(sheetMenu('format')).toEqual([]);
    expect(contextMenus.get('sheetTest.merge')).toBeUndefined();
  });

  it('refuses an ID already taken and leaves nothing of that contribution behind', () => {
    undo.push(
      contribute({
        kind: 'menuItem',
        item: { id: 'a', lane: 'merge', menu: 'format', command: 'x.a', group: 'g', order: 1 },
      }),
    );
    expect(() =>
      contribute(
        { kind: 'toolbarGroup', group: { id: 'font', lane: 'toolbar', label: 'tables.name', order: 1, commands: [] } },
        { kind: 'menuItem', item: { id: 'a', lane: 'merge', menu: 'format', command: 'x.a', group: 'g', order: 1 } },
      ),
    ).toThrow();
    expect(sheetToolbar()).toEqual([]);
  });
});
