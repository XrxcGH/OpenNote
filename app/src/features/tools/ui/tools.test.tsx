// The tool windows in a real browser (Phase 10). Each opens as a dialog that follows the theme, with no axe
// violations. Timers add, run, and pause. The calculator answers and explains a mistake in words. Upcoming reads a
// due date from plain words and files the task under it.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { CalculatorTool } from './CalculatorTool';
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
    expect(document.getElementById('calc-result')!.textContent).toBe('= 3.10685596119');
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
    expect(screen.getByRole('tab', { name: 'Graphing' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('application', { name: /Graph of 1 function/ })).toBeTruthy();
  });
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
