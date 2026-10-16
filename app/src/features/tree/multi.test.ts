import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeId, NodeSummary } from '../../services/notes';
import { clearMulti, multiStore, rangeBetween, selectedNodes, toggled } from './multi';
import type { Row } from './rows';
import { treeStore } from './store';

const id = (value: string) => value as NodeId;

function node(value: string, kind: NodeSummary['kind'] = 'page'): NodeSummary {
  return {
    id: id(value),
    kind,
    parentId: id('s1'),
    title: value,
    color: null,
    pageLevel: 0,
    childCount: 0,
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-01T00:00:00Z',
    readOnly: false,
  };
}

const row = (value: string, kind: NodeSummary['kind'] = 'page'): Row => ({
  id: id(value),
  node: node(value, kind),
  level: 1,
  posinset: 1,
  setsize: 1,
  parentId: null,
});

describe('multi-select', () => {
  beforeEach(() => {
    clearMulti();
    treeStore.set((state) => ({ ...state, nodes: { a: node('a'), b: node('b'), c: node('c') } }));
  });

  it('adds and removes ids in the order they were chosen', () => {
    expect(toggled([id('a')], id('b'))).toEqual(['a', 'b']);
    expect(toggled([id('a'), id('b')], id('a'))).toEqual(['b']);
  });

  it('selects the rows between two ids in either direction, of one kind', () => {
    const rows = [row('a'), row('b'), row('x', 'section'), row('c')];
    expect(rangeBetween(rows, id('a'), id('c'))).toEqual(['a', 'b', 'c']);
    expect(rangeBetween(rows, id('c'), id('b'))).toEqual(['b', 'c']);
    expect(rangeBetween(rows, id('gone'), id('c'))).toEqual(['c']);
  });

  it('answers with the selection only when it holds two rows and the target is in it', () => {
    multiStore.set({ tree: 'pages', ids: [id('a')], anchor: id('a') });
    expect(selectedNodes()).toBeNull();
    multiStore.set({ tree: 'pages', ids: [id('a'), id('b')], anchor: id('a') });
    expect(selectedNodes()?.map((n) => n.id)).toEqual(['a', 'b']);
    expect(selectedNodes(undefined, id('b'))).toHaveLength(2);
    expect(selectedNodes(undefined, id('c'))).toBeNull();
  });
});
