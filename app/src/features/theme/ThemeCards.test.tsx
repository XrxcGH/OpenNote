import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ThemePreference } from '../../platform/types';
import { expectFocus, expectNoAxeViolations, renderApp, renderUi } from '../../test';
import { ThemeCards } from './ThemeCards';

function Harness({ onChange }: { onChange(value: ThemePreference): void }) {
  const [value, setValue] = useState<ThemePreference>('system');
  return (
    <ThemeCards
      value={value}
      systemCaption="Preselected because Windows is set to Light."
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('ThemeCards', () => {
  it('is a radio group named Theme with a caption for each card', async () => {
    const { container } = renderUi(<Harness onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((card) => card.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(radio('Light').getAttribute('aria-describedby')).toBeTruthy();
    expect(radio('Light').textContent).toContain('Always light');
    expect(radio('Dark').textContent).toContain('Always dark');
    expect(radio('Match Windows').textContent).toContain('Preselected because Windows is set to Light.');
    await expectNoAxeViolations(container);
  });

  it('keeps the previews out of the accessibility tree and the tab order', () => {
    renderUi(<Harness onChange={() => {}} />);
    for (const card of screen.getAllByRole('radio')) {
      const preview = card.querySelector('[aria-hidden="true"]');
      expect(preview?.hasAttribute('inert')).toBe(true);
      expect(preview?.querySelector('a, button, input, [tabindex]')).toBeNull();
    }
    expect(document.querySelectorAll('[data-theme-scope="light"]').length).toBe(2);
    expect(document.querySelectorAll('[data-theme-scope="dark"]').length).toBe(2);
  });
});

describe('choosing a theme card', () => {
  it('selects on a click and on an arrow key, and ignores a held key', async () => {
    const onChange = vi.fn();
    renderUi(<Harness onChange={onChange} />);
    fireEvent.click(radio('Dark'));
    expect(onChange).toHaveBeenLastCalledWith('dark');
    radio('Dark').focus();
    fireEvent.keyDown(radio('Dark'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('light');
    await expectFocus(radio('Light'));
    onChange.mockClear();
    fireEvent.keyDown(radio('Light'), { key: 'ArrowRight', repeat: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says the choice applies when a Windows contrast theme is off', async () => {
    await renderApp({ boot: { os: { contrast: true } } });
    renderUi(<Harness onChange={() => {}} />);
    expect(
      screen.getByText(
        "A Windows contrast theme is on, so Windows sets the colors. Your choice applies when it's off.",
      ),
    ).toBeTruthy();
    fireEvent.click(radio('Dark'));
    expect(radio('Dark').getAttribute('aria-checked')).toBe('true');
  });
});
