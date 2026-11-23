import { afterEach, describe, expect, it } from 'vitest';
import { focusedPanel, forgetPanel, trackPanel } from './focused';

function box(): { panel: HTMLElement; button: HTMLButtonElement; text: HTMLElement; palette: HTMLInputElement } {
  const panel = document.body.appendChild(document.createElement('div'));
  const button = panel.appendChild(document.createElement('button'));
  const text = document.body.appendChild(document.createElement('div'));
  text.tabIndex = 0;
  text.dataset.scope = 'editor';
  text.dataset.block = 'text1';
  const palette = document.body.appendChild(document.createElement('input'));
  return { panel, button, text, palette };
}

afterEach(() => {
  document.body.innerHTML = '';
  forgetPanel();
});

describe('the focused panel block', () => {
  it('names the panel that has focus, and keeps it when the palette takes focus', () => {
    const { panel, button, palette } = box();
    trackPanel(panel, 'cell1', false);
    button.focus();
    expect(focusedPanel()).toEqual({ block: 'cell1', readOnly: false });
    palette.focus();
    expect(focusedPanel()).toEqual({ block: 'cell1', readOnly: false });
  });

  it('forgets the panel when a text block takes focus, and reports a read-only page', () => {
    const { panel, button, text } = box();
    trackPanel(panel, 'cell1', true);
    button.focus();
    expect(focusedPanel()?.readOnly).toBe(true);
    text.focus();
    expect(focusedPanel()).toBeNull();
  });
});
