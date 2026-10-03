// The table toolbar in a real browser (PLAN.md section 10.5): no axe violations in either theme, arrow keys move
// between its buttons, a command that doesn't apply says so without leaving the tab order, and the column width
// field takes only widths in range.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { TableOp } from '../../../editor/commands/tables';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { TableToolbar } from './TableToolbar';
import type { TableToolbarProps } from './TableToolbar';
import styles from './tables.module.css';

/** The toolbar shows while its table is the current one, as on the page. */
function shown(toolbarProps: TableToolbarProps) {
  return (
    <div className={styles.wrapper} data-current="" style={{ marginBlockStart: 120 }}>
      <TableToolbar {...toolbarProps} />
    </div>
  );
}

function props(overrides: Partial<TableToolbarProps> = {}): TableToolbarProps {
  return {
    can: (op: TableOp) => op.op !== 'deleteColumn',
    header: true,
    run: vi.fn(),
    more: vi.fn(),
    width: 160,
    widthOpen: false,
    openWidth: vi.fn(),
    closeWidth: vi.fn(),
    ...overrides,
  };
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Table tools' });

describe('the table toolbar', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(shown(props({ widthOpen: true })), { theme });
      await expectNoAxeViolations(container);
    });
  }

  it('moves focus between its buttons with arrow keys, Home, and End', async () => {
    renderUi(shown(props()));
    const first = screen.getByRole('button', { name: 'Add row above' });
    first.focus();
    fireEvent.keyDown(toolbar(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add row below' }));
    fireEvent.keyDown(toolbar(), { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More table commands' }));
    fireEvent.keyDown(toolbar(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);
    expect(toolbar().querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
  });

  it('runs a command, marks the header row, and keeps commands that do not apply focusable', () => {
    const run = vi.fn();
    renderUi(shown(props({ run })));
    fireEvent.click(screen.getByRole('button', { name: 'Add column right' }));
    expect(run).toHaveBeenCalledWith({ op: 'columnRight' });
    expect(screen.getByRole('button', { name: 'Header row' }).getAttribute('aria-pressed')).toBe('true');
    const disabled = screen.getByRole('button', { name: 'Delete column' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disabled);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('applies a width in range and refuses one out of range', async () => {
    const closeWidth = vi.fn();
    renderUi(shown(props({ widthOpen: true, closeWidth })));
    const field = screen.getByRole('textbox', { name: 'Column width' });
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
    await userEvent.clear(field);
    await userEvent.type(field, '9{Enter}');
    expect(closeWidth).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    await userEvent.clear(field);
    await userEvent.type(field, '240{Enter}');
    expect(closeWidth).toHaveBeenLastCalledWith(240);
    await userEvent.keyboard('{Escape}');
    expect(closeWidth).toHaveBeenLastCalledWith(null);
  });
});
