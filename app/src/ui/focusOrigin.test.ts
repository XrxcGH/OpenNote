// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusFromScript } from './focusOrigin';

function press(key: string, target: Element = document.activeElement ?? document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('focusFromScript', () => {
  beforeEach(() => {
    // Forget the last input: the module starts with none, and a key press then a pointer press is a reset we can use.
    document.dispatchEvent(new Event('pointerdown'));
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('marks the element after a pointer press', () => {
    const button = mount('<button>Go</button>');
    document.dispatchEvent(new Event('pointerdown'));
    focusFromScript(button);
    expect(button.getAttribute('data-focus-origin')).toBe('pointer');
    expect(document.activeElement).toBe(button);
  });

  it('marks the element when there has been no input yet', async () => {
    vi.resetModules();
    const fresh = await import('./focusOrigin');
    const button = mount('<button>Go</button>');
    fresh.focusFromScript(button);
    expect(button.getAttribute('data-focus-origin')).toBe('pointer');
  });

  it('does not mark the element after a key press', () => {
    const button = mount('<button>Go</button>');
    press('a', document.body);
    focusFromScript(button);
    expect(button.hasAttribute('data-focus-origin')).toBe(false);
  });

  it.each(['Tab', 'ArrowDown', 'Escape'])('removes the mark on a button at %s', (key) => {
    const button = mount('<button>Go</button>');
    focusFromScript(button);
    press(key);
    expect(button.hasAttribute('data-focus-origin')).toBe(false);
  });

  it.each(['a', 'Enter', ' '])('keeps the mark on a button at %j', (key) => {
    const button = mount('<button>Go</button>');
    focusFromScript(button);
    press(key);
    expect(button.getAttribute('data-focus-origin')).toBe('pointer');
  });

  it('keeps the mark on a text input for arrows and letters, and removes it for Tab and Escape', () => {
    const input = mount('<input type="text" />');
    focusFromScript(input);
    for (const key of ['ArrowLeft', 'ArrowDown', 'x']) {
      press(key);
      expect(input.getAttribute('data-focus-origin')).toBe('pointer');
    }
    press('Tab');
    expect(input.hasAttribute('data-focus-origin')).toBe(false);
    document.dispatchEvent(new Event('pointerdown'));
    focusFromScript(input);
    expect(input.getAttribute('data-focus-origin')).toBe('pointer');
    press('Escape');
    expect(input.hasAttribute('data-focus-origin')).toBe(false);
  });

  it('removes the mark on blur', () => {
    const button = mount('<button>Go</button>');
    focusFromScript(button);
    button.blur();
    expect(button.hasAttribute('data-focus-origin')).toBe(false);
  });
});
