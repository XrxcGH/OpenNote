// Practice mode hides the steps of a worked problem and shows them one at a time, from the keyboard or the buttons.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { shownMounted } from '../../page';
import type { MountedPage } from '../../page';
import { PracticeTool } from './PracticeTool';

let current = '';
vi.mock('../pageText', () => ({ shownMarkdown: () => Promise.resolve(current) }));

const PAGE = `# Beam

## Given
A 4 m beam carries 10 kN at its middle.

## Solution
1. Sum the moments about A.
2. Solve for the reaction at B.
3. Sum the vertical forces.

## Answer
Each support carries 5 kN.
`;

function show(markdown: string | null): void {
  current = markdown ?? '';
  shownMounted.set(markdown === null ? null : ({ page: { id: 'p1' } } as unknown as MountedPage));
}

beforeEach(() => show(PAGE));
afterEach(() => show(null));

describe('practice mode', () => {
  it('starts with every step hidden and keeps their words out of the window', async () => {
    renderUi(<PracticeTool />);
    expect(await screen.findByText('Step 1 is hidden.')).toBeTruthy();
    expect(screen.getByText('The answer is hidden.')).toBeTruthy();
    expect(screen.queryByText(/Sum the moments/)).toBeNull();
    expect(screen.getByText(/A 4 m beam/)).toBeTruthy();
    expect(screen.getByText('0 of 3 steps shown.')).toBeTruthy();
  });

  it('shows one step at a time from the keyboard, then the answer', async () => {
    renderUi(<PracticeTool />);
    const area = await screen.findByRole('group', { name: 'Practice mode' });
    area.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByText(/Sum the moments/)).toBeTruthy();
    expect(screen.queryByText(/Solve for the reaction/)).toBeNull();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText(/Solve for the reaction/)).toBeTruthy();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText(/Each support carries/)).toBeTruthy();
    expect(screen.getByText('Every step and the answer are shown.')).toBeTruthy();
  });

  it('hides the last step and starts over', async () => {
    renderUi(<PracticeTool />);
    const area = await screen.findByRole('group', { name: 'Practice mode' });
    area.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}');
    expect(screen.queryByText(/Solve for the reaction/)).toBeNull();
    await userEvent.keyboard('{ArrowRight}{Home}');
    expect(screen.queryByText(/Sum the moments/)).toBeNull();
    expect(screen.getByText('0 of 3 steps shown.')).toBeTruthy();
  });

  it('works with the buttons and has no accessibility violations', async () => {
    const { container } = renderUi(<PracticeTool />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show next step' }));
    expect(screen.getByText('1 of 3 steps shown.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText('0 of 3 steps shown.')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('says so when the page has no worked solution', async () => {
    show('Just some notes.');
    renderUi(<PracticeTool />);
    expect(await screen.findByText(/no worked solution to practice/)).toBeTruthy();
  });
});
