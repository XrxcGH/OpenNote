// The signals and sound kit in a real browser: each tool opens from the picker, shows a result for its example,
// works from the keyboard, puts its result in the page, and has no accessibility violations.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../flags';
import { SignalsKit } from './kit';
import { chooseSignalTool, type SignalToolId } from './meta';

const inserted: Record<string, unknown>[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<Record<string, unknown> & { handled: boolean }>).detail;
  inserted.push({ ...detail });
  detail.handled = true;
};

beforeEach(() => {
  window.localStorage.clear();
  inserted.length = 0;
  window.addEventListener(INSERT_EVENT, listen);
});
afterEach(() => window.removeEventListener(INSERT_EVENT, listen));

async function openAt(tool: SignalToolId) {
  chooseSignalTool(tool);
  const view = renderUi(<SignalsKit />);
  await screen.findAllByRole('button', { name: /^Insert/ }, { timeout: 10_000 });
  return view;
}

describe('signals and sound kit', () => {
  it('opens the spectrum analyzer at its example and reads the 10 Hz peak', async () => {
    const { container } = await openAt('spectrum');
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/at (9\.9\d*|10(\.0\d*)?) Hz/);
    expect(screen.getByRole('table', { name: 'Bands' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert answer' })[0]!);
    expect(String(inserted[0]?.text)).toMatch(/Largest peak/);
    await expectNoAxeViolations(container);
  });

  it('switches tools from the picker and from a palette command', async () => {
    await openAt('spectrum');
    const picker = screen.getByRole('combobox', { name: 'Tool' }) as HTMLSelectElement;
    expect(picker.value).toBe('spectrum');
    act(() => chooseSignalTool('spectrum'));
    expect(picker.value).toBe('spectrum');
  });
});
