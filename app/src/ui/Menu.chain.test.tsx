// A menu opened from another menu's item at the same button, as Draw > More > Shapes does (walk 10, T1-D03-8).
import { afterEach, describe, expect, it } from 'vitest';
import { openMenu } from './Menu';

afterEach(() => {
  for (const node of document.body.querySelectorAll('[role="region"], button')) node.remove();
});

const settle = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));

function openShapes(button: HTMLElement): void {
  void openMenu({ label: 'Shapes', anchor: button, items: [{ id: 'line', label: 'Line' }] });
}

describe('a menu opened from another menu at the same button', () => {
  it('stays at the button, not the top-left corner', async () => {
    const button = document.body.appendChild(document.createElement('button'));
    button.textContent = 'More';
    button.style.cssText = 'position: fixed; left: 400px; top: 200px; width: 60px; height: 30px;';
    const items = [{ id: 'shapes', label: 'Shapes', onSelect: () => openShapes(button) }];
    void openMenu({ label: 'More', anchor: button, returnFocus: button, items });
    await settle();
    document.querySelector<HTMLElement>('[role="menuitem"]')?.click();
    await settle();
    const shapes = document.querySelector<HTMLElement>('[role="menu"][aria-label="Shapes"]:not([data-exiting])');
    const box = shapes?.getBoundingClientRect();
    expect(box?.left).toBeGreaterThan(200);
    expect(box?.top).toBeGreaterThan(150);
  });
});
