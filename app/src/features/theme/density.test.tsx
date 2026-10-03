import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { updateSettings } from '../../state/settings';
import { renderApp } from '../../test';

beforeEach(() => localStorage.clear());

const density = () => document.documentElement.dataset.density;
const pointerUp = (pointerType: string) => fireEvent.pointerUp(window, { pointerType });

describe('density', () => {
  it('starts from the primary pointer and follows the last pointer on pointerup', async () => {
    await renderApp();
    expect(density()).toBe('mouse');
    fireEvent.pointerDown(window, { pointerType: 'touch' });
    expect(density()).toBe('mouse');
    pointerUp('touch');
    expect(density()).toBe('touch');
    pointerUp('pen');
    expect(density()).toBe('touch');
    pointerUp('mouse');
    expect(density()).toBe('mouse');
  });

  it('stays as chosen when set by hand', async () => {
    await renderApp({ settings: { appearance: { density: 'touch' } } });
    expect(density()).toBe('touch');
    pointerUp('mouse');
    expect(density()).toBe('touch');
    await updateSettings({ appearance: { density: 'mouse' } });
    pointerUp('touch');
    expect(density()).toBe('mouse');
    await updateSettings({ appearance: { density: 'auto' } });
    expect(density()).toBe('touch');
  });

  it('keeps the focused row where it was when the sizes change', async () => {
    await renderApp();
    const style = document.createElement('style');
    style.textContent = `
      [data-testid="list"] { block-size: 200px; overflow-y: auto; }
      [data-testid="list"] button { display: block; block-size: 40px; }
      [data-density="touch"] [data-testid="list"] button { block-size: 80px; }`;
    const list = document.createElement('div');
    list.dataset.testid = 'list';
    for (let i = 0; i < 30; i += 1) list.append(document.createElement('button'));
    document.body.append(style, list);
    const row = list.children[10] as HTMLElement;
    row.focus();
    list.scrollTop = 350;
    const offset = () => row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const before = offset();
    pointerUp('touch');
    await expect.poll(() => Math.abs(offset() - before)).toBeLessThan(1);
    expect(density()).toBe('touch');
    style.remove();
    list.remove();
  });
});
