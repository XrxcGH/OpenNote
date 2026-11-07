// checks-disable-file brand-consistency: the test colors are inputs to the code under test, not design colors
import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, renderUi, setViewport } from '../../test';
import { ColorPalette } from './ColorPalette';
import { recentColors, setRecentStorage } from './recent';

let saved = '{}';
beforeEach(() => {
  saved = '{}';
  setRecentStorage({ read: () => saved, write: (text) => (saved = text) });
});

const open = (props: Partial<Parameters<typeof ColorPalette>[0]> = {}) => {
  const onPick = vi.fn();
  const view = renderUi(
    <main>
      <ColorPalette scheme="light" notebookId="nb" onPick={onPick} {...props} />
    </main>,
  );
  return { onPick, ...view };
};

async function typeHex(text: string) {
  const field = screen.getByRole('textbox', { name: 'Hex' });
  await userEvent.clear(field);
  await userEvent.type(field, text);
}

async function applyHex(text: string) {
  if (!screen.queryByRole('textbox', { name: 'Hex' })) {
    await userEvent.click(screen.getByRole('button', { name: 'More colors' }));
  }
  await typeHex(text);
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
}

describe('ColorPalette', () => {
  it('names every swatch and passes axe', async () => {
    const { container } = open();
    expect(screen.getByRole('button', { name: 'Indigo, lighter 40%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Walnut, darker 50%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Paper, lighter 80%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dark red' })).toBeTruthy();
    for (const button of container.querySelectorAll('button')) {
      expect((button.getAttribute('aria-label') ?? button.textContent ?? '').trim()).not.toBe('');
    }
    await expectNoAxeViolations(container);
  });

  it('passes axe with More colors open, in the dark theme', async () => {
    const { container } = open({ scheme: 'dark' });
    await userEvent.click(screen.getByRole('button', { name: 'More colors' }));
    await expectNoAxeViolations(container);
  });

  it('reports Automatic, No color, a theme color and a tint', async () => {
    const { onPick } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Automatic' }));
    await userEvent.click(screen.getByRole('button', { name: 'No color' }));
    await userEvent.click(screen.getByRole('button', { name: 'Indigo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Indigo, lighter 40%' }));
    expect(onPick.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'auto' },
      { kind: 'none' },
      { kind: 'color', value: 'theme:accent1' },
      { kind: 'color', value: '#8295c2' },
    ]);
  });

  it('leaves out Automatic and No color when asked', () => {
    open({ automatic: false, noColor: false });
    expect(screen.queryByRole('button', { name: 'Automatic' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No color' })).toBeNull();
  });

  it('parses typed colors and explains a bad one', async () => {
    const { onPick } = open();
    await applyHex('rgb(253, 230, 138)');
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'color', value: '#fde68a' });
    await typeHex('blue-ish');
    expect(screen.getByText('Enter a color as #RRGGBB.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    await typeHex('FDE68A');
    expect(screen.queryByText('Enter a color as #RRGGBB.')).toBeNull();
  });

  it('shows a contrast badge that follows the color', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'More colors' }));
    await typeHex('#000000');
    expect(screen.getByRole('status').textContent).toContain('passes');
    await typeHex('#eeeeee');
    expect(screen.getByRole('status').textContent).toContain('low');
  });

  it('lists three applied custom colors, newest first, when reopened', async () => {
    const first = open();
    await applyHex('#111111');
    await applyHex('#222222');
    await applyHex('#333333');
    first.unmount();
    expect(recentColors('nb')).toEqual(['#333333', '#222222', '#111111']);
    open();
    const group = screen.getByRole('group', { name: 'Recent colors' });
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Recent color #333333', 'Recent color #222222', 'Recent color #111111']);
  });

  it('moves with the arrow keys, keeps one tab stop, and applies with Enter', async () => {
    const { onPick, container } = open();
    expect(container.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    screen.getByRole('button', { name: 'Automatic' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('No color');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Ink');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Brick, lighter 80%');
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].kind).toBe('color');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Paper, lighter 80%');
  });

  it('does not scroll sideways at 400 percent zoom (320 CSS pixels)', async () => {
    await setViewport(320, 640);
    const { container } = open();
    await userEvent.click(screen.getByRole('button', { name: 'More colors' }));
    const root = container.firstElementChild as HTMLElement;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  });
});

describe('More colors number fields', () => {
  it('lets a person clear a field and type, committing on blur', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'More colors' }));
    const red = screen.getByRole('spinbutton', { name: 'Red' }) as HTMLInputElement;
    fireEvent.change(red, { target: { value: '' } });
    expect(red.value).toBe('');
    fireEvent.change(red, { target: { value: '200' } });
    fireEvent.blur(red);
    expect(red.value).toBe('200');
  });

  it('keeps a typed hue on a gray, and does not shift a color on commit', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'More colors' }));
    await typeHex('#000000');
    const field = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
    const set = async (name: string, value: string) => {
      const input = field(name);
      await userEvent.clear(input);
      await userEvent.type(input, `${value}{Enter}`);
    };
    await set('Hue', '200');
    expect(field('Hue').value).toBe('200');
    await set('Saturation', '100');
    await set('Lightness', '50');
    expect(field('Hue').value).toBe('200');
    expect((screen.getByRole('textbox', { name: 'Hex' }) as HTMLInputElement).value).toBe('#00aaff');
    await typeHex('#2f4f9a');
    const before = field('Hue').value;
    await set('Hue', before);
    expect((screen.getByRole('textbox', { name: 'Hex' }) as HTMLInputElement).value).toBe('#2f4f9a');
  });

  it('starts the single Tab stop on the chosen swatch', () => {
    open({ current: '#e03131' });
    expect(screen.getByRole('button', { name: 'Red' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('button', { name: 'Automatic' }).getAttribute('tabindex')).toBe('-1');
  });

  it('picks theme tokens by default and hex with themeTokens off', async () => {
    const a = open();
    await userEvent.click(screen.getByRole('button', { name: 'Indigo' }));
    expect(a.onPick).toHaveBeenCalledWith({ kind: 'color', value: 'theme:accent1' });
    a.unmount();
    const b = open({ themeTokens: false });
    await userEvent.click(screen.getByRole('button', { name: 'Indigo' }));
    expect(b.onPick.mock.calls[0][0].value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
