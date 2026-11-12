import { screen, within } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableExtraHost } from '../../../page';
import { expectNoAxeViolations } from '../../../../test';
import { addHost } from '../toolbar/hosts';
import { changeRule, openRuleManager, rulesFor } from './open';
import { deleteRule, moveRule } from './manage';

const K = (n: number) => `01m3sbcmt0000000000000k${String(n).padStart(3, '0')}`;
const R = (n: number) => `01m3sbcmt0000000000000r${String(n).padStart(3, '0')}`;

const table = {
  header: false,
  columns: [{ id: K(1) }, { id: K(2) }],
  rows: [1, 2, 3].map((n) => ({ id: R(n), cells: {} })),
};

const sheetA = () => ({
  conditional: {
    c1: { ranges: [{ col: K(1) }], order: 1, type: 'cell', op: 'greater', a: '5' },
    c2: { ranges: [{ col: K(2) }], order: 2, type: 'blank' },
  },
});
const sheetB = () => ({ conditional: { c1: { ranges: [{ col: K(2) }], order: 1, type: 'blank' } } });

const removers: (() => void)[] = [];
afterEach(() => removers.splice(0).forEach((remove) => remove()));

/** A table block's host with no editor selection in a cell, so the manager opens on the whole table. */
function host(block: string, sheet: Record<string, unknown>) {
  const patch = vi.fn(async (_data: Record<string, unknown>) => true);
  const fake = {
    block,
    page: 'page-1',
    element: document.createElement('div'),
    editor: { state: { selection: { $from: { depth: 0 } } } },
    data: () => ({ ...table, sheet }),
    table: () => table,
    patch,
  } as unknown as TableExtraHost;
  removers.push(addHost(fake));
  return { fake, patch };
}

describe('the conditional formatting command', () => {
  it('lists the rules of the table, and of every table on the page by its place', () => {
    const a = host('block-a', sheetA());
    host('block-b', sheetB());
    expect(rulesFor(a.fake, 'table', null).map((r) => r.id)).toEqual(['c1', 'c2']);
    const page = rulesFor(a.fake, 'page', null);
    expect(page.map((r) => [r.tableId, r.id, r.tableLabel])).toEqual([
      ['block-a', 'c1', 'Table 1'],
      ['block-a', 'c2', 'Table 1'],
      ['block-b', 'c1', 'Table 2'],
    ]);
  });

  it('writes a change to the table the rule belongs to, as one patch', async () => {
    const a = host('block-a', sheetA());
    const b = host('block-b', sheetB());
    expect(await changeRule(a.fake, { ruleId: 'c1', tableId: 'block-b' }, deleteRule)).toBe(true);
    expect(a.patch).not.toHaveBeenCalled();
    expect(b.patch).toHaveBeenCalledTimes(1);
    expect(b.patch.mock.calls[0][0]).toHaveProperty('sheet');
    // Raising the first rule changes nothing, so nothing is written.
    expect(await changeRule(a.fake, { ruleId: 'c1' }, (s, id) => moveRule(s, id, -1))).toBe(false);
    expect(a.patch).not.toHaveBeenCalled();
  });

  it('opens the manager in a dialog that deletes a rule and closes on Done', async () => {
    const a = host('block-a', sheetA());
    const closed = openRuleManager(a.fake);
    const dialog = await screen.findByRole('dialog', { name: 'Conditional formatting rules' });
    await expectNoAxeViolations(dialog);
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Delete rule' })[0]);
    expect(a.patch).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await closed;
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
