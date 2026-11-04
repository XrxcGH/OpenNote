import { describe, expect, it } from 'vitest';
import type { CommandBarItem } from '../../registries/types';
import { INSERT_GROUPS, inBarOrder } from './barOrder';

const item = (tab: CommandBarItem['tab'], group: string, id = `${tab}.${group}`): CommandBarItem => ({
  id,
  tab,
  group,
  command: id,
  priority: 50,
});

describe('the Insert tab order', () => {
  it('publishes the fixed groups in the planned order whatever order they register in', () => {
    const shuffled = [3, 9, 0, 6, 1, 8, 4, 2, 7, 5].map((i) => item('insert', INSERT_GROUPS[i]));
    expect(inBarOrder(shuffled).map((entry) => entry.group)).toEqual([...INSERT_GROUPS]);
    expect(INSERT_GROUPS).toEqual([
      'table',
      'codeCell',
      'codeProject',
      'equation',
      'symbol',
      'footnote',
      'endnote',
      'comment',
      'pageBreak',
      'columnBreak',
    ]);
  });

  it('keeps other groups in registration order ahead of the fixed ones, and other tabs untouched', () => {
    const items = [
      item('insert', 'comment'),
      item('insert', 'blocks', 'a'),
      item('home', 'comment'),
      item('insert', 'table'),
      item('insert', 'text', 'b'),
      item('insert', 'blocks', 'c'),
    ];
    expect(inBarOrder(items).map((entry) => entry.id)).toEqual([
      'a',
      'c',
      'home.comment',
      'b',
      'insert.table',
      'insert.comment',
    ]);
  });
});
