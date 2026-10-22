// The tool windows in a real browser (Phase 10). Each opens as a dialog that follows the theme, with no axe
// violations. Timers add, run, and pause. The calculator answers and explains a mistake in words. Upcoming reads a
// due date from plain words and files the task under it.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { CalculatorTool } from './CalculatorTool';
import { PoppedTool } from './PoppedTool';
import { TimersTool, clockText } from './TimersTool';
import { ToolWindow } from './ToolWindow';
import { UpcomingTool } from './UpcomingTool';
import { TOOLS } from './tools';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const tool = (id: string) => TOOLS.find((one) => one.id === id)!;

function framed(id: 'timers' | 'calculator' | 'upcoming', body: React.ReactNode) {
  return (
    <ToolWindow tool={tool(id)} index={0} pinned={false} onPin={() => undefined} onClose={() => undefined}>
      {body}
    </ToolWindow>
  );
}

describe('the tool windows', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`have no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(
        <>
          {framed('timers', <TimersTool />)}
          {framed('upcoming', <UpcomingTool />)}
        </>,
        { theme },
      );
      await expectNoAxeViolations(container);
    });
  }

  it('name the window and move by keyboard from its title', () => {
    renderUi(framed('timers', <TimersTool />));
    const dialog = screen.getByRole('dialog', { name: 'Timers' });
    const header = within(dialog).getByLabelText(/^Move Timers/);
    const before = dialog.getBoundingClientRect().left;
    header.focus();
    fireEvent.keyDown(header, { key: 'ArrowLeft' });
    expect(Math.round(before - dialog.getBoundingClientRect().left)).toBe(16);
  });
});

describe('clockText', () => {
  it('writes minutes and seconds, and hours when there are any', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(61_000)).toBe('1:01');
    expect(clockText(3_661_000)).toBe('1:01:01');
    expect(clockText(500)).toBe('0:01');
  });
});

describe('timers', () => {
  it('adds a countdown, starts it, pauses it, and resets it', async () => {
    renderUi(<TimersTool />);
    expect(screen.getByText('No timers yet. Add one below.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add timer' }));
    expect(screen.getByRole('timer', { name: 'Timer 1' }).textContent).toBe('5:00');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('Running')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByText('Paused')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('Ready')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Timer 1' }));
    expect(screen.getByText('No timers yet. Add one below.')).toBeTruthy();
  });

  it('shows a focus timer as the time left in its phase, not the whole session', async () => {
    renderUi(<TimersTool />);
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'Focus');
    await userEvent.click(screen.getByRole('button', { name: 'Add timer' }));
    expect(screen.getByRole('timer', { name: 'Timer 1' }).textContent).toBe('25:00');
  });

  it('refuses a countdown with no time and says why', async () => {
    renderUi(<TimersTool />);
    await userEvent.fill(screen.getByLabelText('Minutes'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Add timer' }));
    expect(screen.getByRole('status').textContent).toBe('Choose a time of at least one second.');
  });

  it('keeps timers on the device', async () => {
    const first = renderUi(<TimersTool />);
    await userEvent.click(screen.getByRole('button', { name: 'Add timer' }));
    first.unmount();
    expect(localStorage.getItem('opennote.tools.timers')).toContain('Timer 1');
  });
});

describe('the calculator', () => {
  it('answers, keeps the answer in history, and uses it again', async () => {
    renderUi(<CalculatorTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Expression' }), '2pi * 3');
    await userEvent.keyboard('{Enter}');
    expect(document.getElementById('calc-result')!.textContent).toBe('= 18.8495559215');
    await userEvent.click(screen.getByRole('button', { name: 'Use 2pi * 3 again' }));
    expect((screen.getByRole('textbox', { name: 'Expression' }) as HTMLInputElement).value).toBe('2pi * 3');
  });

  it('converts units', async () => {
    renderUi(<CalculatorTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Expression' }), '5 km to mi');
    await userEvent.keyboard('{Enter}');
    expect(document.getElementById('calc-result')!.textContent).toBe('= 3.10685596119 mi');
    expect(screen.getAllByText('= 3.10685596119 mi').length).toBeGreaterThan(1);
  });

  it('explains a mistake in words and keeps the expression', async () => {
    renderUi(<CalculatorTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Expression' }), '1 / 0');
    await userEvent.keyboard('{Enter}');
    expect(document.getElementById('calc-result')!.textContent).toBe('Dividing by zero has no answer.');
    expect((screen.getByRole('textbox', { name: 'Expression' }) as HTMLInputElement).value).toBe('1 / 0');
  });

  it('switches between its tabs with the arrow keys', async () => {
    renderUi(<CalculatorTool />);
    const scientific = screen.getByRole('tab', { name: 'Scientific' });
    scientific.focus();
    fireEvent.keyDown(scientific, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Graphing 2D' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('application', { name: /Graph of 1 function/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Graphing 2D' }), { key: 'ArrowRight' });
    expect(await screen.findByRole('application', { name: '3D graph of 1 function' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Graphing 3D' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Matrix' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Matrix' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Matrix' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Basic' }).getAttribute('aria-selected')).toBe('true');
  });

  it('has every mode as a tab, in order', () => {
    renderUi(<CalculatorTool />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Basic',
      'Scientific',
      'Graphing 2D',
      'Graphing 3D',
      'Programmer',
      'Statistics',
      'Matrix',
    ]);
  });

  it('adds up on the basic keypad, changes sign, and keeps the answer in history', async () => {
    localStorage.setItem('opennote.tools.calculator.tab', JSON.stringify('basic'));
    renderUi(<CalculatorTool />);
    for (const key of ['1', '2', '+', '3']) await userEvent.click(screen.getByRole('button', { name: key }));
    await userEvent.click(screen.getByRole('button', { name: 'Change sign' }));
    expect((screen.getByRole('textbox', { name: 'Expression' }) as HTMLInputElement).value).toBe('-(12+3)');
    await userEvent.click(screen.getByRole('button', { name: 'Equals' }));
    expect(document.getElementById('calc-result')!.textContent).toBe('= -15');
    expect(screen.getByRole('button', { name: 'Use -(12+3) again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert answer into page' })).toBeTruthy();
  });

  it('works in hexadecimal on the programmer tab, with history, copy, and insert', async () => {
    localStorage.setItem('opennote.tools.calculator.tab', JSON.stringify('programmer'));
    renderUi(<CalculatorTool />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Base' }), '16');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Expression' }), 'FF + 1');
    await userEvent.keyboard('{Enter}');
    const bases = screen.getByLabelText('The answer in each base');
    expect(bases.textContent).toContain('Decimal256');
    expect(bases.textContent).toContain('Binary1 0000 0000');
    expect(screen.getByRole('button', { name: 'Use FF + 1 again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert answer into page' })).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Base' }), '2');
    expect((screen.getByRole('textbox', { name: 'Expression' }) as HTMLInputElement).value).toBe('100000000');
  });

  it('summarizes data and fits a line on the statistics tab', async () => {
    localStorage.setItem('opennote.tools.calculator.tab', JSON.stringify('statistics'));
    renderUi(<CalculatorTool />);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Data' }), '1 3\n2 5\n3 7');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    const table = screen.getByRole('table', { name: 'Statistics of the data' });
    expect(within(table).getByRole('row', { name: /Mean/ }).textContent).toBe('Mean2');
    expect(within(table).getByRole('row', { name: /Line of best fit/ }).textContent).toContain('y = 2x + 1');
    expect(screen.getByRole('button', { name: /Use 1 3/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeTruthy();
  });

  it('inverts and solves on the matrix tab, and explains a singular matrix', async () => {
    localStorage.setItem('opennote.tools.calculator.tab', JSON.stringify('matrix'));
    renderUi(<CalculatorTool />);
    await userEvent.click(screen.getByRole('button', { name: 'Solve A x = B' }));
    const result = screen.getByRole('table', { name: 'Result matrix' });
    expect(result.textContent).toBe('-44.5');
    await userEvent.click(screen.getByRole('button', { name: 'Determinant of A' }));
    expect(screen.getByText('= -2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert answer into page' })).toBeTruthy();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Matrix A' }), '1 2\n2 4');
    await userEvent.click(screen.getByRole('button', { name: 'Inverse of A' }));
    expect(screen.getByText('A has no inverse, so this has no single answer.')).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBe(2);
  });

  for (const mode of ['basic', 'scientific', 'graphing', 'graphing3d', 'programmer', 'statistics', 'matrix']) {
    it(`opens popped out on the ${mode} mode it was left on, with no axe violations`, async () => {
      localStorage.setItem('opennote.tools.calculator.tab', JSON.stringify(mode));
      const { container } = renderUi(<PoppedTool tool="calculator" />);
      const selected = await screen.findByRole('tab', { selected: true });
      expect(selected.id).toBe(`calc-tab-${mode}`);
      expect(container.querySelector(`#calc-panel-${mode}`)).not.toBeNull();
      await screen.findByRole('tabpanel');
      await expectNoAxeViolations(container);
    });
  }
});

describe('upcoming', () => {
  it('reads a due date from the words and shows it beside the task', async () => {
    renderUi(<UpcomingTool />);
    expect(screen.getByText(/Nothing due/)).toBeTruthy();
    await userEvent.fill(screen.getByLabelText('Task and when it is due'), 'Read chapter 4 in 3 days');
    await userEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    // The planner below holds lists of its own, so find the task's row from its title.
    const row = screen.getByText('Read chapter 4').closest('li') as HTMLElement;
    expect(within(row).getByTitle(/^\d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No date' })).toBeNull();
  });

  it('keeps a task with no date and says so', async () => {
    renderUi(<UpcomingTool />);
    await userEvent.fill(screen.getByLabelText('Task and when it is due'), 'Tidy the desk');
    await userEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    expect(screen.getByRole('heading', { name: 'No date' })).toBeTruthy();
    expect(screen.getByText('No date found. It is saved without one.')).toBeTruthy();
  });

  it('checks a task off and takes it from the list', async () => {
    renderUi(<UpcomingTool />);
    await userEvent.fill(screen.getByLabelText('Task and when it is due'), 'Tidy the desk');
    await userEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Done: Tidy the desk' }));
    expect(screen.queryByText('Tidy the desk')).toBeNull();
  });
});
