// T3-16: Escape closes the open properties panel, whether or not focus is inside it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test/render';
import type { OpenPage } from '../../../services/pages/types';
import { PropertiesBar } from './PropertiesBar';

const stub = { initial: { view: {} }, onFrame: () => () => undefined, send: () => Promise.resolve() } as unknown as OpenPage;

beforeEach(() => localStorage.setItem('opennote.properties.open', 'true'));
afterEach(() => localStorage.removeItem('opennote.properties.open'));

const expanded = () => document.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded');

describe('the properties panel and Escape', () => {
  it('closes on Escape with focus outside the panel', async () => {
    renderUi(<PropertiesBar page={stub} />);
    expect(expanded()).toBe('true');
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{Escape}');
    expect(expanded()).toBe('false');
  });

  it('closes on Escape with focus on its fold button', async () => {
    renderUi(<PropertiesBar page={stub} />);
    document.querySelector<HTMLButtonElement>('button[aria-expanded]')!.focus();
    await userEvent.keyboard('{Escape}');
    expect(expanded()).toBe('false');
  });
});
