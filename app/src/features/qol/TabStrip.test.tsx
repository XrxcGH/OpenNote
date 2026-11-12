import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../app/flags';
import type { NodeId, NodeSummary } from '../../services/notes';
import { INITIAL_QOL, qolStore } from '../../state/qol';
import { sessionStore } from '../../state/session';
import { renderUi } from '../../test';
import { treeStore } from '../tree';
import { TabStrip } from './TabStrip';
import { openInNewTab } from './tabs';

const id = (value: string) => value as NodeId;

const page = (value: string, title: string): NodeSummary => ({
  id: id(value),
  kind: 'page',
  parentId: id('s1'),
  title,
  color: null,
  pageLevel: 0,
  childCount: 0,
  created: '2026-01-01T00:00:00Z',
  modified: '2026-01-01T00:00:00Z',
  readOnly: false,
});

const place = (pageId: string) => ({
  view: 'workspace' as const,
  notebookId: id('n1'),
  sectionId: id('s1'),
  pageId: id(pageId),
});

const order = () => qolStore.get().tabs.map((tab) => tab.location.pageId);

describe('TabStrip', () => {
  beforeEach(() => {
    initFlags('dev', { 'qol.tabs': true });
    qolStore.set(INITIAL_QOL);
    sessionStore.set((state) => ({ ...state, location: place('a'), back: [], forward: [] }));
    treeStore.set((state) => ({
      ...state,
      nodes: { a: page('a', 'Alpha'), b: page('b', 'Beta'), c: page('c', 'Gamma') },
    }));
    openInNewTab(place('b'));
    openInNewTab(place('c'));
  });

  it('keeps every tab wide enough to read when many are open (walk bug N1-N03-7)', async () => {
    const extra = Array.from({ length: 24 }, (_, at) => page(`x${at}`, `Extra page ${at}`));
    treeStore.set((state) => ({
      ...state,
      nodes: { ...state.nodes, ...Object.fromEntries(extra.map((node) => [node.id, node])) },
    }));
    for (const node of extra) openInNewTab(place(node.id));
    renderUi(<TabStrip />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.length).toBe(27);
    const strip = screen.getByRole('tablist');
    for (const tab of tabs) expect(tab.parentElement!.getBoundingClientRect().width).toBeGreaterThanOrEqual(96);
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
  });

  it('closes a tab on a middle-click', () => {
    renderUi(<TabStrip />);
    const tab = screen.getByRole('tab', { name: 'Alpha' });
    fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(order()).toEqual(['b', 'c']);
  });

  it('opens a tab menu on right-click whose items act on that tab', async () => {
    renderUi(<TabStrip />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Alpha' }), { clientX: 10, clientY: 10, button: 2 });
    const menu = await screen.findByRole('menu', { name: 'Tab Alpha' });
    expect(menu).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Move tab right/ }));
    await waitFor(() => expect(order()).toEqual(['b', 'a', 'c']));
  });

  it('moves the active tab with Ctrl+Shift+Left', () => {
    renderUi(<TabStrip />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Gamma' }), { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });
    expect(order()).toEqual(['a', 'c', 'b']);
  });
});
