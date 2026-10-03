// Pointer drag in the browser, with simulated mouse, pen, and touch pointers: thresholds, the highlight, the
// label, the drop, Escape, the long press, and opening a collapsed container by hovering.

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test';
import type { NodeId } from '../../services/notes';

const notebooksTree = () => screen.getByRole('tree', { name: 'Notebooks' });
const pagesTree = () => screen.getByRole('tree', { name: 'Pages' });
const row = (tree: HTMLElement, name: string) => within(tree).getByRole('treeitem', { name });
const dragging = () => document.documentElement.dataset.dragging !== undefined;
const frames = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Kind = 'mouse' | 'pen' | 'touch';

function fire(target: Element, type: string, x: number, y: number, kind: Kind) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: kind === 'mouse' ? 1 : kind === 'pen' ? 2 : 3,
      pointerType: kind,
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}

/** A point inside a row, `fraction` of the way down it. */
function at(element: Element, fraction: number) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + 40, y: rect.top + rect.height * fraction };
}

async function startDrag(source: HTMLElement, kind: Kind = 'mouse') {
  const from = at(source, 0.5);
  fire(source, 'pointerdown', from.x, from.y, kind);
  if (kind === 'touch') await wait(600);
  fire(source, 'pointermove', from.x, from.y + 12, kind);
  await frames();
  return from;
}

async function moveTo(source: HTMLElement, point: { x: number; y: number }, kind: Kind = 'mouse') {
  fire(source, 'pointermove', point.x, point.y, kind);
  await frames();
}

async function renderTree() {
  const app = await renderApp();
  await expect.poll(() => screen.queryByRole('treeitem', { name: 'Labs' })).toBeTruthy();
  return app;
}

async function openLectures() {
  row(notebooksTree(), 'Lectures').click();
  await expect.poll(() => screen.queryByRole('treeitem', { name: 'Mitosis' })).toBeTruthy();
}

describe('dragging with a mouse', () => {
  it('starts after 4 px, marks the drop, and moves the section on release', async () => {
    const { notes } = await renderTree();
    const labs = row(notebooksTree(), 'Labs');
    const from = at(labs, 0.5);
    fire(labs, 'pointerdown', from.x, from.y, 'mouse');
    fire(labs, 'pointermove', from.x, from.y + 3, 'mouse');
    await frames();
    expect(dragging()).toBe(false);
    fire(labs, 'pointermove', from.x, from.y + 5, 'mouse');
    await frames();
    expect(dragging()).toBe(true);
    const exam = row(notebooksTree(), 'Exam prep');
    const below = at(exam, 0.95);
    await moveTo(labs, below);
    expect(exam.getAttribute('data-drop')).toBe('after');
    expect(document.body.textContent).toContain('Move "Labs" to Biology 101');
    fire(labs, 'pointerup', below.x, below.y, 'mouse');
    await expect
      .poll(async () => (await notes.listChildren('n-biology' as NodeId)).map((node) => node.title))
      .toEqual(['Lectures', 'Exam prep', 'Labs']);
    expect(dragging()).toBe(false);
    expect(screen.getByRole('status', { name: 'Notifications' }).textContent).toContain('Moved "Labs".');
  });

  it('cancels with Escape and leaves everything where it was', async () => {
    const { notes } = await renderTree();
    const labs = row(notebooksTree(), 'Labs');
    await startDrag(labs);
    await moveTo(labs, at(row(notebooksTree(), 'Exam prep'), 0.95));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(dragging()).toBe(false);
    expect(document.querySelector('[data-drop]')).toBeNull();
    const point = at(row(notebooksTree(), 'Exam prep'), 0.95);
    fire(labs, 'pointerup', point.x, point.y, 'mouse');
    await frames();
    expect((await notes.listChildren('n-biology' as NodeId)).map((node) => node.title)).toEqual([
      'Lectures',
      'Labs',
      'Exam prep',
    ]);
  });

  it('drops a page onto a section in the other tree, and says where it went', async () => {
    const { notes } = await renderTree();
    await openLectures();
    const mitosis = row(pagesTree(), 'Mitosis');
    await startDrag(mitosis);
    const labs = row(notebooksTree(), 'Labs');
    const middle = at(labs, 0.5);
    await moveTo(mitosis, middle);
    expect(labs.getAttribute('data-drop')).toBe('into');
    expect(document.body.textContent).toContain('Move 1 page to Labs');
    fire(mitosis, 'pointerup', middle.x, middle.y, 'mouse');
    await expect.poll(async () => (await notes.get('p-mitosis' as NodeId))?.parentId).toBe('s-labs');
    expect(screen.getByRole('status', { name: 'Notifications' }).textContent).toContain('Moved 1 page to Labs.');
  });

  it('shows no highlight over a place the row cannot go', async () => {
    await renderTree();
    await openLectures();
    const mitosis = row(pagesTree(), 'Mitosis');
    await startDrag(mitosis);
    await moveTo(mitosis, at(row(notebooksTree(), 'Work'), 0.5));
    expect(document.querySelector('[data-drop]')).toBeNull();
    expect(document.documentElement.style.cursor).toBe('not-allowed');
    fire(mitosis, 'pointerup', 0, 0, 'mouse');
  });

  it('opens a collapsed group after the pointer rests on it for 700 ms', async () => {
    await renderTree();
    const labs = row(notebooksTree(), 'Labs');
    await startDrag(labs);
    const exam = row(notebooksTree(), 'Exam prep');
    await moveTo(labs, at(exam, 0.5));
    expect(exam.getAttribute('aria-expanded')).toBe('false');
    await wait(800);
    await expect.poll(() => row(notebooksTree(), 'Exam prep').getAttribute('aria-expanded')).toBe('true');
    fire(labs, 'pointerup', 0, 0, 'mouse');
  });
});

describe('dragging with a pen or a finger', () => {
  it('needs 8 px with a pen', async () => {
    await renderTree();
    const labs = row(notebooksTree(), 'Labs');
    const from = at(labs, 0.5);
    fire(labs, 'pointerdown', from.x, from.y, 'pen');
    fire(labs, 'pointermove', from.x, from.y + 6, 'pen');
    await frames();
    expect(dragging()).toBe(false);
    fire(labs, 'pointermove', from.x, from.y + 9, 'pen');
    await frames();
    expect(dragging()).toBe(true);
    fire(labs, 'pointercancel', from.x, from.y, 'pen');
    expect(dragging()).toBe(false);
  });

  it('drags after a 500 ms press, but a swipe before it only scrolls', async () => {
    await renderTree();
    const labs = row(notebooksTree(), 'Labs');
    const from = at(labs, 0.5);
    fire(labs, 'pointerdown', from.x, from.y, 'touch');
    fire(labs, 'pointermove', from.x, from.y + 20, 'touch');
    await frames();
    expect(dragging()).toBe(false);
    fire(labs, 'pointerup', from.x, from.y + 20, 'touch');
    await startDrag(labs, 'touch');
    expect(dragging()).toBe(true);
    fire(labs, 'pointercancel', from.x, from.y, 'touch');
  });

  it('opens the context menu when a press is released without moving', async () => {
    await renderTree();
    const labs = row(notebooksTree(), 'Labs');
    const from = at(labs, 0.5);
    fire(labs, 'pointerdown', from.x, from.y, 'touch');
    await wait(600);
    fire(labs, 'pointerup', from.x, from.y, 'touch');
    expect(await screen.findByRole('menu', { name: 'Actions for Labs' })).toBeTruthy();
    expect(dragging()).toBe(false);
  });
});
