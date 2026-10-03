// TreeView in the browser: the tree pattern's roles and states, the key table, type-ahead, windowing that keeps
// focus, the "More actions" button, empty states, and axe in both themes and densities.

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getLocation } from '../../app/location';
import { expectFocus, expectNoAxeViolations, pressChord, renderApp } from '../../test';
import { sessionStore } from '../../state/session';

const notebooksTree = () => screen.getByRole('tree', { name: 'Notebooks' });
const pagesTree = () => screen.getByRole('tree', { name: 'Pages' });
const row = (tree: HTMLElement, name: string) => within(tree).getByRole('treeitem', { name });
const findRow = (tree: () => HTMLElement, name: string) =>
  expect.poll(() => within(tree()).queryByRole('treeitem', { name })).toBeTruthy();

async function renderTree(options: Parameters<typeof renderApp>[0] = {}) {
  const app = await renderApp(options);
  await findRow(notebooksTree, 'Biology 101');
  return app;
}

async function focusRow(tree: () => HTMLElement, name: string) {
  await findRow(tree, name);
  row(tree(), name).focus();
  await expectFocus(row(tree(), name));
}

describe('the tree pattern', () => {
  it('gives rows their level, position, set size, and expanded state', async () => {
    await renderTree();
    const biology = row(notebooksTree(), 'Biology 101');
    expect(biology.getAttribute('aria-level')).toBe('1');
    expect(biology.getAttribute('aria-posinset')).toBe('1');
    expect(biology.getAttribute('aria-setsize')).toBe('5');
    expect(biology.getAttribute('aria-expanded')).toBe('true');
    const labs = row(notebooksTree(), 'Labs');
    expect(labs.getAttribute('aria-level')).toBe('2');
    expect(labs.hasAttribute('aria-expanded')).toBe(false);
  });

  it('names each row by its title and describes its kind and color', async () => {
    await renderTree();
    const labs = row(notebooksTree(), 'Labs');
    const description = document.getElementById(labs.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Section, color Amber');
    expect(within(labs).getByRole('button', { name: 'More actions for Labs' }).tabIndex).toBe(-1);
  });

  it('keeps exactly one row in the tab order', async () => {
    await renderTree();
    const inTabOrder = within(notebooksTree())
      .getAllByRole('treeitem')
      .filter((item) => item.tabIndex === 0);
    expect(inTabOrder).toHaveLength(1);
  });
});

describe('keys', () => {
  it('moves with Up, Down, Home, and End, and selection follows focus', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Lectures');
    await pressChord('Down');
    await expectFocus(row(notebooksTree(), 'Labs'));
    await expect.poll(() => getLocation()).toMatchObject({ sectionId: 's-labs' });
    await pressChord('End');
    await expectFocus(row(notebooksTree(), 'Travel'));
    await pressChord('Home');
    await expectFocus(row(notebooksTree(), 'Biology 101'));
    await pressChord('Up');
    await expectFocus(row(notebooksTree(), 'Biology 101'));
  });

  it('opens and closes with Right and Left, and Left goes to the parent', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Work');
    await pressChord('Right');
    await findRow(notebooksTree, 'Meetings');
    expect(row(notebooksTree(), 'Work').getAttribute('aria-expanded')).toBe('true');
    await pressChord('Right');
    await expectFocus(row(notebooksTree(), 'Meetings'));
    await pressChord('Left');
    await expectFocus(row(notebooksTree(), 'Work'));
    await pressChord('Left');
    expect(row(notebooksTree(), 'Work').getAttribute('aria-expanded')).toBe('false');
    expect(sessionStore.get().expanded).not.toContain('n-work');
  });

  it('opens every sibling with *', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Work');
    await pressChord('*');
    await findRow(notebooksTree, 'Meetings');
    await findRow(notebooksTree, 'Trips');
  });

  it('opens a section with Enter and moves focus to its first page', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Lectures');
    await pressChord('Enter');
    await findRow(pagesTree, 'Cell structure');
    await expectFocus(row(pagesTree(), 'Cell structure'));
    expect(getLocation()).toMatchObject({ sectionId: 's-lectures' });
  });

  it('selects with Space without leaving the tree', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Labs');
    await pressChord('Space');
    await expect.poll(() => getLocation()).toMatchObject({ sectionId: 's-labs' });
    expect(row(notebooksTree(), 'Labs').getAttribute('aria-selected')).toBe('true');
    await expectFocus(row(notebooksTree(), 'Labs'));
  });

  it('finds rows by type-ahead, ignoring case and accents', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Biology 101');
    await pressChord('p');
    await expectFocus(row(notebooksTree(), 'Personal'));
    // The buffer clears after 700 ms without typing.
    await new Promise((resolve) => setTimeout(resolve, 800));
    await pressChord('e');
    await pressChord('x');
    await expectFocus(row(notebooksTree(), 'Exam prep'));
    await pressChord('Shift+M');
    await expectFocus(row(notebooksTree(), 'Exam prep'));
  });
});

describe('holding an arrow key', () => {
  it('opens only the page it stops on', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Lectures');
    await pressChord('Space');
    await findRow(pagesTree, 'Mitosis');
    await focusRow(pagesTree, 'Cell structure');
    const opened: string[] = [];
    const stop = sessionStore.subscribe(() => {
      const location = getLocation();
      const pageId = location.view === 'workspace' ? location.pageId : null;
      if (pageId && pageId !== opened[opened.length - 1]) opened.push(pageId);
    });
    // Key events that come faster than the 100 ms pause, as a held key's repeats do.
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    await expect.poll(() => getLocation()).toMatchObject({ pageId: 'p-photosynthesis' });
    stop();
    expect(opened).toEqual(['p-photosynthesis']);
  });
});

describe('pages', () => {
  it('nests subpages under their page with a date line', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Lectures');
    await pressChord('Space');
    await findRow(pagesTree, 'Membranes');
    const membranes = row(pagesTree(), 'Membranes');
    expect(membranes.getAttribute('aria-level')).toBe('2');
    expect(row(pagesTree(), 'Cell structure').getAttribute('aria-expanded')).toBe('true');
  });
});

describe('long trees', () => {
  it('windows past 300 rows and keeps the focused row mounted', async () => {
    const location = { view: 'workspace', notebookId: 'lg-n-1', sectionId: 'lg-s-1-1', pageId: null } as const;
    await renderApp({ fixture: 'large', boot: { state: { location } } });
    await expect.poll(() => screen.queryByRole('tree', { name: 'Pages' })).toBeTruthy();
    await expect.poll(() => within(pagesTree()).queryAllByRole('treeitem').length).toBeGreaterThan(0);
    const rendered = within(pagesTree()).getAllByRole('treeitem');
    expect(rendered.length).toBeLessThan(300);
    rendered[0].focus();
    await pressChord('End');
    await expect.poll(() => (document.activeElement as HTMLElement).getAttribute('aria-posinset')).toBe('1000');
  });
});

describe('empty states and accessibility', () => {
  it('says how to start when there are no notebooks', async () => {
    await renderApp({ fixture: 'empty' });
    await expect.poll(() => screen.queryByText('No notebooks yet. Choose New notebook to start one.')).toBeTruthy();
  });

  it('puts a bookshelf above the no-notebooks sentence, hidden from screen readers', async () => {
    const { container } = await renderApp({ fixture: 'empty' });
    const sentence = await screen.findByText('No notebooks yet. Choose New notebook to start one.');
    const art = container.querySelector('svg[viewBox="0 0 110 52"]');
    expect(art?.getAttribute('aria-hidden')).toBe('true');
    expect((art as Node).compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The empty pane has its own drawing, so the footer's plant leaves it alone.
    expect(container.querySelector('svg[viewBox="0 0 56 66"]')).toBeNull();
  });

  it('keeps a small plant in the notebooks pane footer beside Trash, hidden from screen readers', async () => {
    const { container } = await renderApp();
    await screen.findByRole('button', { name: 'Trash' });
    const plant = container.querySelector('svg[viewBox="0 0 56 66"]');
    expect(plant?.getAttribute('aria-hidden')).toBe('true');
    expect(plant?.closest('div')?.contains(screen.getByRole('button', { name: 'Trash' }))).toBe(true);
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const density of ['mouse', 'touch'] as const) {
      it(`has no axe violations in the ${theme} theme with ${density} density`, async () => {
        const { container } = await renderTree({ theme, density });
        await focusRow(notebooksTree, 'Lectures');
        await pressChord('Space');
        await findRow(pagesTree, 'Mitosis');
        await expectNoAxeViolations(container);
      });
    }
  }
});
