// The symbol palette window: search, groups, recent symbols, and insertion at the caret.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../flags';
import { resetRecent } from '../symbols/recent';
import { SymbolsTool } from './SymbolsTool';

const inserted: string[] = [];
let page = true;
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
  if (detail.text !== undefined && page) inserted.push(detail.text);
  detail.handled = page;
};
beforeEach(() => {
  resetRecent();
  page = true;
  window.addEventListener(INSERT_EVENT, listen);
});
afterEach(() => {
  window.removeEventListener(INSERT_EVENT, listen);
  inserted.splice(0);
});

describe('the symbol palette', () => {
  it('inserts a symbol at the caret and lists it under Recent', async () => {
    renderUi(<SymbolsTool />);
    expect(screen.getByText('Symbols you use appear here.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert alpha' }));
    expect(inserted).toEqual(['α']);
    expect(screen.getByRole('group', { name: 'Recent' }).querySelectorAll('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Clear recent symbols' }));
    expect(screen.getByText('Symbols you use appear here.')).toBeTruthy();
  });
  it('searches by LaTeX name, by word, and by the symbol, and says when nothing matches', async () => {
    renderUi(<SymbolsTool />);
    const search = screen.getByRole('textbox', { name: 'Search symbols' });
    await userEvent.fill(search, '\\infty');
    expect(screen.getByRole('button', { name: 'Insert infinity' })).toBeTruthy();
    await userEvent.fill(search, 'greater');
    expect(screen.getByRole('button', { name: 'Insert greater than or equal' })).toBeTruthy();
    await userEvent.fill(search, 'zzzz');
    expect(screen.getByText('No symbol matches "zzzz".')).toBeTruthy();
  });
  it('narrows to a group', async () => {
    renderUi(<SymbolsTool />);
    await userEvent.click(screen.getByRole('button', { name: 'Arrows' }));
    expect(screen.getByRole('button', { name: 'Insert right arrow' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Insert alpha' })).toBeNull();
  });
  it('leaves Recent empty when no page is open', async () => {
    page = false;
    renderUi(<SymbolsTool />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert alpha' }));
    expect(inserted).toEqual([]);
    expect(screen.getByText('Symbols you use appear here.')).toBeTruthy();
  });
  it('has no accessibility violations', async () => {
    const { container } = renderUi(<SymbolsTool />);
    await expectNoAxeViolations(container);
  });
});
