import { describe, expect, it } from 'vitest';
import type { Canvas, CanvasNode } from './model';
import { align, cardKind, cardText, edgePoint, exportJson, importJson, pageOf, parseCanvas, readCanvas, removeCards, viewPatch } from './model';

const node = (id: string, x = 0, y = 0, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  type: 'text',
  x,
  y,
  width: 100,
  height: 50,
  text: id,
  ...extra,
});

const canvas: Canvas = {
  nodes: [node('a', 300, 0), node('b', 0, 0), node('c', 150, 200), node('d', 400, 210)],
  edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', label: 'leads to' }],
};

describe('canvas model', () => {
  it('names the kinds of card', () => {
    expect(cardKind(node('n'))).toBe('note');
    expect(cardKind(node('p', 0, 0, { type: 'file', file: 'opennote://page/abcdefgh' }))).toBe('page');
    expect(pageOf(node('p', 0, 0, { type: 'file', file: 'opennote://page/abcdefgh' }))).toBe('abcdefgh');
    expect(cardKind(node('i', 0, 0, { type: 'file', file: 'C:\\pics\\cat.png' }))).toBe('image');
    expect(cardKind(node('f', 0, 0, { type: 'file', file: 'notes/chapter.PDF' }))).toBe('pdf');
    expect(cardKind(node('w', 0, 0, { type: 'link', url: 'https://example.com' }))).toBe('web');
    expect(cardKind(node('g', 0, 0, { type: 'group', label: 'Plans' }))).toBe('group');
  });

  it('shows a page card by the title of its page', () => {
    const page = node('p', 0, 0, { type: 'file', file: 'opennote://page/abcdefgh' });
    expect(cardText(page, new Map([['abcdefgh', 'Biology']]))).toBe('Biology');
  });

  it('lines cards up in a row, a column, or a grid', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const row = align(canvas, ids, 'row').nodes;
    expect(new Set(row.map((n) => n.y))).toEqual(new Set([0]));
    expect(row.map((n) => n.x).sort((p, q) => p - q)).toEqual([0, 124, 248, 372]);
    const column = align(canvas, ids, 'column').nodes;
    expect(new Set(column.map((n) => n.x))).toEqual(new Set([0]));
    const grid = align(canvas, ids, 'grid').nodes;
    expect(new Set(grid.map((n) => n.x)).size).toBe(2);
    expect(new Set(grid.map((n) => n.y)).size).toBe(2);
    expect(align(canvas, ['a'], 'row')).toBe(canvas);
  });

  it('removes a card with its arrows', () => {
    const next = removeCards(canvas, ['b']);
    expect(next.nodes.map((n) => n.id)).toEqual(['a', 'c', 'd']);
    expect(next.edges).toEqual([]);
  });

  it('round-trips through JSON Canvas text and refuses what is not a canvas', () => {
    expect(importJson(exportJson(canvas))).toEqual(canvas);
    expect(importJson('not json')).toBeNull();
    const messy = parseCanvas({
      nodes: [{ id: 'x', type: 'text', x: 'far', text: 5 }, { id: 'x', type: 'text' }, { id: 'y', type: 'video' }, 3],
      edges: [{ id: 'e', fromNode: 'x', toNode: 'gone' }],
    });
    expect(messy.nodes).toHaveLength(1);
    expect(messy.nodes[0].x).toBe(0);
    expect(messy.edges).toEqual([]);
  });

  it('stores the canvas in the view, and removes the key when it is empty', () => {
    expect(viewPatch(canvas)).toEqual({ canvas });
    expect(viewPatch({ nodes: [], edges: [] })).toEqual({ canvas: null });
    expect(readCanvas({ canvas }).nodes).toHaveLength(4);
    expect(readCanvas(undefined).nodes).toEqual([]);
  });

  it('starts an arrow at the edge of a card', () => {
    const point = edgePoint(node('a', 0, 0), { x: 500, y: 25 });
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(25);
  });
});
