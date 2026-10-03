import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings } from '../../state/settings';
import { announcements, expectNoAxeViolations, renderApp } from '../../test';
import AppearanceSection from './AppearanceSection';

beforeEach(() => localStorage.clear());

const root = document.documentElement;
const group = (name: string) => screen.getByRole('radiogroup', { name });
const choose = (groupName: string, name: string) => {
  const radios = [...group(groupName).querySelectorAll<HTMLElement>('[role="radio"]')];
  const target = radios.find((radio) => radio.textContent?.startsWith(name));
  if (!target) throw new Error(`No "${name}" in "${groupName}"`);
  fireEvent.click(target);
};

async function renderSection(options: Parameters<typeof renderApp>[0] = {}) {
  await renderApp(options);
  return render(<AppearanceSection />);
}

describe('the Appearance section', () => {
  it('shows each setting as a labeled group with its current choice selected', async () => {
    await renderSection();
    const names = ['Theme', 'Page color in dark mode', 'Text size', 'Interface size', 'Reduce motion'];
    for (const name of [...names, 'Size of buttons and rows']) expect(group(name)).toBeTruthy();
    const checked = (name: string) => group(name).querySelector('[aria-checked="true"]')?.textContent;
    expect(checked('Theme')).toContain('Match Windows');
    expect(checked('Page color in dark mode')).toBe('Match the theme');
    expect(checked('Text size')).toBe('100%');
    expect(checked('Interface size')).toBe('100%');
    expect(checked('Reduce motion')).toBe('Match Windows');
    expect(checked('Size of buttons and rows')).toBe('Automatic');
  });

  it('changes the theme, and saves it', async () => {
    await renderSection({ boot: { os: { dark: false } } });
    choose('Theme', 'Dark');
    await expect.poll(() => root.dataset.theme).toBe('dark');
    expect(getSettings().appearance.theme).toBe('dark');
    expect(announcements()).toEqual([]);
  });

  it('applies page color, motion, and density at once', async () => {
    await renderSection();
    choose('Page color in dark mode', 'Always paper white');
    expect(getSettings().appearance.pageColor).toBe('paper');
    await expect.poll(() => root.dataset.pageColor).toBe('paper');
    choose('Reduce motion', 'Always reduce motion');
    await expect.poll(() => root.dataset.motion).toBe('reduce');
    choose('Size of buttons and rows', 'Large');
    await expect.poll(() => root.dataset.density).toBe('touch');
    choose('Size of buttons and rows', 'Standard');
    await expect.poll(() => root.dataset.density).toBe('mouse');
  });
});

describe('the sizes in the Appearance section', () => {
  it('sets the text size and the interface size separately', async () => {
    await renderSection();
    choose('Text size', '125%');
    expect(getSettings().appearance.textSize).toBe(125);
    expect(announcements()).toEqual(['Text size 125%']);
    choose('Interface size', '150%');
    await expect.poll(() => getSettings().appearance.uiScale).toBe(150);
    await expect.poll(() => root.style.getPropertyValue('--ui-scale')).toBe('1.5');
    expect(getSettings().appearance.textSize).toBe(125);
  });

  it('passes axe in both themes', async () => {
    const { container } = await renderSection({ theme: 'dark' });
    await expectNoAxeViolations(container);
    choose('Theme', 'Light');
    await expect.poll(() => root.dataset.theme).toBe('light');
    await expectNoAxeViolations(container);
  });
});
