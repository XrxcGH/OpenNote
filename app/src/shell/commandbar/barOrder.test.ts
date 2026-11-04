import { describe, expect, it } from 'vitest';
import '../../features';
import { commandBar } from '../../registries';
import type { CommandBarItem } from '../../registries/types';
import { INSERT_GROUPS, inBarOrder } from './barOrder';

const item = (
  tab: CommandBarItem['tab'],
  group: string,
  id: CommandBarItem['command'] = `${tab}.${group}`,
): CommandBarItem => ({
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
      'tables',
      'codeCell',
      'codeProject',
      'math',
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
      item('insert', 'blocks', 'insert.a'),
      item('home', 'comment'),
      item('insert', 'tables'),
      item('insert', 'text', 'insert.b'),
      item('insert', 'blocks', 'insert.c'),
    ];
    expect(inBarOrder(items).map((entry) => entry.id)).toEqual([
      'insert.a',
      'insert.c',
      'home.comment',
      'insert.b',
      'insert.tables',
      'insert.comment',
    ]);
  });
});

describe('the real Insert registrations', () => {
  it('puts Insert table ahead of Equation, as the plan orders them', () => {
    const ids = inBarOrder(commandBar.list().filter((entry) => entry.tab === 'insert')).map((entry) => entry.id);
    expect(ids).toContain('insert.table');
    expect(ids).toContain('insert.equation');
    expect(ids.indexOf('insert.table')).toBeLessThan(ids.indexOf('insert.equation'));
  });
});
