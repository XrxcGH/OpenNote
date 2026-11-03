import { afterEach, describe, expect, it } from 'vitest';
import { keepTreeFocus } from './keepFocus';

function tree(): HTMLElement {
  const element = document.body.appendChild(document.createElement('div'));
  element.setAttribute('role', 'tree');
  element.tabIndex = -1;
  for (const name of ['one', 'two']) {
    const row = element.appendChild(document.createElement('div'));
    row.setAttribute('role', 'treeitem');
    row.id = name;
    row.tabIndex = name === 'one' ? 0 : -1;
  }
  return element;
}

afterEach(() => document.body.replaceChildren());

describe('keepTreeFocus', () => {
  it('puts focus back on a tree row when the change removed the focused row', async () => {
    const element = tree();
    const two = element.querySelector<HTMLElement>('#two');
    two?.focus();
    await keepTreeFocus(async () => two?.remove());
    expect(document.activeElement?.id).toBe('one');
  });

  it('leaves focus alone when it is still on something', async () => {
    const element = tree();
    const outside = document.body.appendChild(document.createElement('button'));
    element.querySelector<HTMLElement>('#one')?.focus();
    await keepTreeFocus(async () => outside.focus());
    expect(document.activeElement).toBe(outside);
  });
});
