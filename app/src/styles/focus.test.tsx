import { screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { expectFocus, renderUi } from '../test';

const CONTROLS = [
  ['button', 'Button'],
  ['link', 'Link'],
  ['textbox', 'Field'],
  ['combobox', 'Choice'],
  ['textbox', 'Notes'],
  ['group', 'Focusable group'],
  ['checkbox', 'Check'],
] as const;

function Controls() {
  return (
    <main>
      <button type="button">Button</button>
      <a href="#target">Link</a>
      <input aria-label="Field" />
      <select aria-label="Choice">
        <option>One</option>
      </select>
      <textarea aria-label="Notes" />
      <div tabIndex={0} role="group" aria-label="Focusable group">
        Group
      </div>
      <input type="checkbox" aria-label="Check" />
    </main>
  );
}

/** The resolved color of a token, in the form getComputedStyle reports colors. */
function resolved(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

describe('the focus ring', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`is a 2 px outline with a 2 px gap in focus.ring on every kind of control in the ${theme} theme`, async () => {
      renderUi(<Controls />, { theme });
      const ring = resolved('--color-focus-ring');
      for (const [role, name] of CONTROLS) {
        await userEvent.tab();
        const element = screen.getByRole(role, { name });
        await expectFocus(element);
        const style = getComputedStyle(element);
        expect(style.outlineStyle, name).toBe('solid');
        expect(style.outlineWidth, name).toBe('2px');
        expect(style.outlineOffset, name).toBe('2px');
        expect(style.outlineColor, name).toBe(ring);
      }
    });
  }

  it('is never a box shadow, which Windows contrast themes remove', async () => {
    renderUi(<Controls />);
    await userEvent.tab();
    expect(getComputedStyle(screen.getByRole('button', { name: 'Button' })).boxShadow).toBe('none');
  });

  it('stays off for a mouse press on a button', async () => {
    renderUi(<Controls />);
    const button = screen.getByRole('button', { name: 'Button' });
    await userEvent.click(button);
    await expectFocus(button);
    expect(getComputedStyle(button).outlineStyle).toBe('none');
  });

  it('shows on a text field however it got focus', async () => {
    renderUi(<Controls />);
    const field = screen.getByRole('textbox', { name: 'Field' });
    await userEvent.click(field);
    await expectFocus(field);
    expect(getComputedStyle(field).outlineStyle).toBe('solid');
  });
});
