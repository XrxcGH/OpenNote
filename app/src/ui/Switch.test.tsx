import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { expectFocus, expectNoAxeViolations, renderUi } from '../test';
import { Switch } from './Switch';
import type { SwitchProps } from './Switch';

function Fixture(props: Partial<SwitchProps>) {
  return (
    <main>
      <Switch label="Show the pages list" checked={false} onChange={() => {}} {...props} />
    </main>
  );
}

const toggle = () => screen.getByRole('switch');

describe('Switch rendering', () => {
  it('is a switch named by its label, with its state in aria-checked', () => {
    renderUi(<Fixture checked />);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Show the pages list' })).toBeTruthy();
  });

  it('is named by its label when it only shows an icon, and passes on its shortcut', () => {
    renderUi(
      <Fixture label="Dark mode" keyShortcuts="Control+Shift+D">
        <svg aria-hidden="true" width="20" height="20" />
      </Fixture>,
    );
    expect(screen.getByRole('switch', { name: 'Dark mode' }).getAttribute('aria-keyshortcuts')).toBe('Control+Shift+D');
  });

  it('meets 32 px with the mouse and 44 px with touch', () => {
    renderUi(<Fixture />);
    expect(toggle().getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    document.documentElement.dataset.density = 'touch';
    expect(toggle().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    delete document.documentElement.dataset.density;
  });

  it('moves the thumb to the end when on, so the state isn’t color alone', async () => {
    const { rerender } = renderUi(<Fixture checked={false} />);
    const thumb = () => toggle().querySelector('span > span') as HTMLElement;
    const off = thumb().getBoundingClientRect().x;
    rerender(<Fixture checked />);
    await expect.poll(() => thumb().getBoundingClientRect().x).toBeGreaterThan(off);
  });
});

describe('Switch keyboard', () => {
  it('toggles with Space and with Enter', async () => {
    const onChange = vi.fn();
    renderUi(<Fixture onChange={onChange} />);
    await userEvent.tab();
    await expectFocus(toggle());
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Enter}');
    expect(onChange.mock.calls).toEqual([[true], [true]]);
  });

  it('reports the opposite of its state when pressed', async () => {
    const onChange = vi.fn();
    renderUi(<Fixture checked onChange={onChange} />);
    await userEvent.click(toggle());
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does nothing when disabled with aria, but stays focusable and described', async () => {
    const onChange = vi.fn();
    renderUi(
      <Fixture disabled="aria" describedBy="why" onChange={onChange}>
        <span>Icon</span>
      </Fixture>,
    );
    toggle().focus();
    await userEvent.keyboard(' ');
    fireEvent.click(toggle());
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(toggle());
  });

  it('can’t be focused when disabled', () => {
    renderUi(<Fixture disabled />);
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Switch accessibility', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme, on and off, with and without an icon`, async () => {
      renderUi(
        <main>
          <Switch label="Show the pages list" checked onChange={() => {}} />
          <Switch label="Show the notebooks" checked={false} onChange={() => {}} />
          <Switch label="Dark mode" checked onChange={() => {}}>
            <svg aria-hidden="true" width="20" height="20" />
          </Switch>
          <Switch label="Match Windows" checked={false} disabled="aria" onChange={() => {}} />
        </main>,
        { theme },
      );
      await expectNoAxeViolations(document.body);
    });
  }
});
