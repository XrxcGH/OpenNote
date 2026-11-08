import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { ValidationDialog } from './ValidationDialog';

const RANGES = [{ col: 'c1' }];

function open(current?: Record<string, unknown>) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onClear = vi.fn();
  renderUi(
    <ValidationDialog
      ranges={RANGES}
      rangeLabel="B2:B20"
      current={current as never}
      onSave={onSave}
      onCancel={onCancel}
      onClear={onClear}
    />,
  );
  return { onSave, onCancel, onClear };
}

describe('ValidationDialog', () => {
  it('has labeled controls and passes axe', async () => {
    open();
    expect(screen.getByLabelText('Allow')).toBeTruthy();
    expect(screen.getByLabelText('Minimum')).toBeTruthy();
    await expectNoAxeViolations(document.body);
  });

  it('saves a decimal rule between 0 and 100 with a stop alert message', () => {
    const { onSave } = open();
    fireEvent.change(screen.getByLabelText('Allow'), { target: { value: 'decimal' } });
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show an alert when the value is not valid' }));
    fireEvent.change(screen.getByLabelText('Alert text'), { target: { value: 'Enter 0 to 100.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      ranges: RANGES,
      kind: 'decimal',
      op: 'between',
      a: '0',
      b: '100',
      error: { title: '', text: 'Enter 0 to 100.' },
    });
  });

  it('does not save a rule with a missing value, and says what is missing', () => {
    const { onSave } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Fill in the value.');
  });

  it('shows the items of a list rule and clears the rule', () => {
    const { onClear } = open({ ranges: RANGES, kind: 'list', items: ['a', 'b'] });
    expect((screen.getByLabelText('Items, one per line') as HTMLTextAreaElement).value).toBe('a\nb');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalled();
  });
});
