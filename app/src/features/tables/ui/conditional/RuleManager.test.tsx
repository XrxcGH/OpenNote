import { screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, renderUi, setViewport } from '../../../../test';
import { RuleManager } from './RuleManager';
import type { ManagedRule } from './manage';

const rules: ManagedRule[] = [
  { id: 'c1', summary: 'Cell value is greater than "5"', ranges: 'column A', stop: false },
  { id: 'c2', summary: 'Blank cells', ranges: 'column B', stop: true },
];

const open = (list: ManagedRule[] = rules) => {
  const handlers = { onScope: vi.fn(), onMove: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), onDone: vi.fn() };
  const view = renderUi(
    <main>
      <RuleManager rules={list} scope="table" {...handlers} />
    </main>,
  );
  return { ...handlers, ...view };
};

describe('RuleManager', () => {
  it('lists the rules in order with their ranges, and has no accessibility violations', async () => {
    const { container } = open();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Cell value is greater than "5"');
    expect(items[0].textContent).toContain('Applies to column A');
    await expectNoAxeViolations(container);
  });

  it('reports raise, lower, stop, delete, and scope changes', async () => {
    const h = open();
    await userEvent.click(screen.getAllByRole('button', { name: 'Lower priority' })[0]);
    expect(h.onMove).toHaveBeenCalledWith({ ruleId: 'c1' }, 1);
    await userEvent.click(screen.getAllByRole('button', { name: 'Raise priority' })[1]);
    expect(h.onMove).toHaveBeenCalledWith({ ruleId: 'c2' }, -1);
    await userEvent.click(screen.getAllByRole('switch', { name: 'Stop if true' })[0]);
    expect(h.onStop).toHaveBeenCalledWith({ ruleId: 'c1' }, true);
    expect(screen.getAllByRole('switch', { name: 'Stop if true' })[1]).toBeChecked();
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete rule' })[1]);
    expect(h.onRemove).toHaveBeenCalledWith({ ruleId: 'c2' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show rules for' }), 'page');
    expect(h.onScope).toHaveBeenCalledWith('page');
  });

  it('the first rule cannot go up and the last cannot go down', () => {
    open();
    expect(screen.getAllByRole('button', { name: 'Raise priority' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Lower priority' })[1]).toBeDisabled();
  });

  it('says so when there are no rules, and fits a phone', async () => {
    await setViewport(320, 640);
    const { container } = open([]);
    expect(screen.getByText('There are no conditional formatting rules here.')).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('reports the table with a rule on the page scope, since rule IDs repeat across tables', async () => {
    const h = open([
      { id: 'c1', summary: 'One', ranges: 'column A', stop: false, tableId: 'tA', tableLabel: 'Table 1' },
      { id: 'c1', summary: 'Two', ranges: 'column A', stop: false, tableId: 'tB', tableLabel: 'Table 2' },
    ]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete rule' })[1]);
    expect(h.onRemove).toHaveBeenCalledWith({ ruleId: 'c1', tableId: 'tB' });
  });

  it('keeps a rule inside its table: no move across a table boundary on the page scope', () => {
    open([
      { id: 'c1', summary: 'One', ranges: 'column A', stop: false, tableId: 'tA', tableLabel: 'Table 1' },
      { id: 'c1', summary: 'Two', ranges: 'column A', stop: false, tableId: 'tB', tableLabel: 'Table 2' },
    ]);
    const down = screen.getAllByRole('button', { name: 'Lower priority' });
    const up = screen.getAllByRole('button', { name: 'Raise priority' });
    expect(down[0]).toBeDisabled();
    expect(up[1]).toBeDisabled();
  });

  it('says so when a formula does not read', () => {
    open([{ id: 'c1', summary: 'Formula', ranges: 'column A', stop: false, problem: true }]);
    expect(screen.getByRole('alert').textContent).toContain('cannot be read');
  });
});
