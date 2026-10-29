import { beforeEach, describe, expect, it } from 'vitest';
import { getLocation, navigate } from '../../app/location';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes';
import { INITIAL_QOL, qolStore } from '../../state/qol';
import { sessionStore } from '../../state/session';
import { treeStore } from '../tree';
import { closeActiveTab, closeTab, openInNewTab, reopenClosed, stepTab, tabTitle, trackTabs } from './tabs';

const id = (value: string) => value as NodeId;

function page(value: string, title: string): NodeSummary {
  return {
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
  };
}

const place = (pageId: string) => ({
  view: 'workspace' as const,
  notebookId: id('n1'),
  sectionId: id('s1'),
  pageId: id(pageId),
});

const notesWith = (known: readonly string[]) =>
  ({
    get: (value: NodeId) => Promise.resolve(known.includes(value) ? page(value, value) : null),
  }) as unknown as NotesService;

describe('tabs', () => {
  beforeEach(() => {
    qolStore.set(INITIAL_QOL);
    sessionStore.set((state) => ({ ...state, location: place('a'), back: [], forward: [] }));
    treeStore.set((state) => ({
      ...state,
      nodes: { a: page('a', 'Alpha'), b: page('b', 'Beta'), c: page('c', 'Gamma') },
    }));
  });

  it('starts a strip with the current place and the new one, and goes to the new one', () => {
    openInNewTab(place('b'));
    const { tabs, activeTab } = qolStore.get();
    expect(tabs.map((tab) => tab.location.pageId)).toEqual(['a', 'b']);
    expect(tabs[1].id).toBe(activeTab);
    expect(getLocation()).toMatchObject({ pageId: 'b' });
  });

  it('puts a new tab right after the active one', () => {
    openInNewTab(place('b'));
    stepTab(-1);
    openInNewTab(place('c'));
    expect(qolStore.get().tabs.map((tab) => tab.location.pageId)).toEqual(['a', 'c', 'b']);
  });

  it('lets the active tab follow the location', () => {
    openInNewTab(place('b'));
    const stop = trackTabs();
    navigate(place('c'));
    stop();
    expect(qolStore.get().tabs.map((tab) => tab.location.pageId)).toEqual(['a', 'c']);
  });

  it('closes a tab, moves to its neighbor, and keeps it on the recently closed list', () => {
    openInNewTab(place('b'));
    openInNewTab(place('c'));
    closeActiveTab();
    const state = qolStore.get();
    expect(state.tabs.map((tab) => tab.location.pageId)).toEqual(['a', 'b']);
    expect(getLocation()).toMatchObject({ pageId: 'b' });
    expect(state.closedTabs.map((closed) => closed.title)).toEqual(['Gamma']);
  });

  it('never closes the last tab', () => {
    openInNewTab(place('b'));
    closeTab(qolStore.get().tabs[0].id);
    closeActiveTab();
    expect(qolStore.get().tabs).toHaveLength(1);
  });

  it('reopens the newest closed tab, skipping pages that are gone', async () => {
    openInNewTab(place('b'));
    openInNewTab(place('c'));
    closeActiveTab();
    closeActiveTab();
    expect(qolStore.get().closedTabs.map((closed) => closed.title)).toEqual(['Beta', 'Gamma']);
    expect(await reopenClosed(notesWith(['c']))).toBe(true);
    expect(getLocation()).toMatchObject({ pageId: 'c' });
    expect(qolStore.get().closedTabs).toEqual([]);
    expect(await reopenClosed(notesWith([]))).toBe(false);
  });

  it('names a tab for its page, else its section or notebook', () => {
    expect(tabTitle(place('a'))).toBe('Alpha');
    expect(tabTitle({ ...place('zzz'), pageId: null, sectionId: id('nope'), notebookId: id('nope') })).toBe(
      'Untitled page',
    );
  });
});
