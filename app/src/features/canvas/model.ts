// The canvas of cards: an open board of cards joined by labeled arrows. It is stored in the open JSON Canvas format
// (jsoncanvas.org), as `view.canvas` of the page it belongs to, so it is saved, synced, and undone with the notebook
// and needs no change to the note format. Import and export are the same JSON as text.

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Notes. */
  text?: string;
  /** Pages (`opennote://page/<id>`), images, and PDFs. */
  file?: string;
  /** Web addresses. */
  url?: string;
  /** Groups. */
  label?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  toEnd?: 'none' | 'arrow';
  label?: string;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export type CardKind = 'page' | 'note' | 'image' | 'pdf' | 'web' | 'group';
export const CARD_KINDS: readonly CardKind[] = ['page', 'note', 'image', 'pdf', 'web', 'group'];
export type Alignment = 'row' | 'column' | 'grid';

export const GAP = 24;
export const MAX_NODES = 500;
export const CARD_SIZE = { width: 240, height: 120 } as const;
const PAGE_FILE = /^opennote:\/\/page\/([A-Za-z0-9_-]{6,64})$/;

export const emptyCanvas = (): Canvas => ({ nodes: [], edges: [] });

export function cardKind(node: CanvasNode): CardKind {
  if (node.type === 'text') return 'note';
  if (node.type === 'link') return 'web';
  if (node.type === 'group') return 'group';
  const file = node.file ?? '';
  if (PAGE_FILE.test(file)) return 'page';
  return /\.pdf($|[?#])/i.test(file) ? 'pdf' : 'image';
}

/** The page a page card points at. */
export const pageOf = (node: CanvasNode): string | null => PAGE_FILE.exec(node.file ?? '')?.[1] ?? null;

/** The words a card shows: its note, its page's title, its address, or its group's label. */
export function cardText(node: CanvasNode, titles: ReadonlyMap<string, string>): string {
  switch (cardKind(node)) {
    case 'note':
      return node.text ?? '';
    case 'page':
      return titles.get(pageOf(node) ?? '') ?? node.label ?? '';
    case 'web':
      return node.url ?? '';
    case 'group':
      return node.label ?? '';
    default:
      return (node.file ?? '').split(/[\\/]/).pop() ?? '';
  }
}

const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** The canvas in a page's `view`, tolerant of anything else that may be there. */
export function readCanvas(view: Record<string, unknown> | null | undefined): Canvas {
  return parseCanvas(view?.canvas);
}

/** A canvas from untrusted JSON: unknown node types, missing IDs, and edges to nothing are dropped. */
export function parseCanvas(raw: unknown): Canvas {
  const out = emptyCanvas();
  if (!raw || typeof raw !== 'object') return out;
  const { nodes, edges } = raw as { nodes?: unknown; edges?: unknown };
  const ids = new Set<string>();
  for (const item of (Array.isArray(nodes) ? nodes : []).slice(0, MAX_NODES)) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    const type = node.type;
    if (typeof node.id !== 'string' || ids.has(node.id)) continue;
    if (type !== 'text' && type !== 'file' && type !== 'link' && type !== 'group') continue;
    ids.add(node.id);
    const parsed: CanvasNode = {
      id: node.id,
      type,
      x: finite(node.x, 0),
      y: finite(node.y, 0),
      width: Math.max(40, finite(node.width, CARD_SIZE.width)),
      height: Math.max(30, finite(node.height, CARD_SIZE.height)),
    };
    for (const key of ['text', 'file', 'url', 'label'] as const) {
      const value = text(node[key]);
      if (value !== undefined) parsed[key] = value.slice(0, 5000);
    }
    out.nodes.push(parsed);
  }
  const edgeIds = new Set<string>();
  for (const item of Array.isArray(edges) ? edges : []) {
    if (!item || typeof item !== 'object') continue;
    const edge = item as Record<string, unknown>;
    if (typeof edge.id !== 'string' || edgeIds.has(edge.id)) continue;
    if (typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string') continue;
    if (!ids.has(edge.fromNode) || !ids.has(edge.toNode)) continue;
    edgeIds.add(edge.id);
    const label = text(edge.label);
    out.edges.push({ id: edge.id, fromNode: edge.fromNode, toNode: edge.toNode, ...(label ? { label: label.slice(0, 200) } : {}) });
  }
  return out;
}

/** The merge patch for `setPage` that stores the canvas. An empty canvas removes the key. */
export function viewPatch(canvas: Canvas): Record<string, unknown> {
  return { canvas: canvas.nodes.length === 0 ? null : canvas };
}

export const exportJson = (canvas: Canvas): string => JSON.stringify(canvas, null, 2);

/** The canvas in some JSON Canvas text, or null when the text is not JSON. */
export function importJson(source: string): Canvas | null {
  try {
    return parseCanvas(JSON.parse(source));
  } catch {
    return null;
  }
}

/** A new card where the last one ended, so cards added one after another do not pile up. */
export function place(canvas: Canvas, size: { width: number; height: number } = CARD_SIZE): { x: number; y: number } {
  const last = canvas.nodes[canvas.nodes.length - 1];
  if (!last) return { x: 40, y: 40 };
  const x = last.x + last.width + GAP;
  return x > 1000 ? { x: 40, y: last.y + size.height + GAP } : { x, y: last.y };
}

/** Lines the cards up in a row, a column, or a grid, in their reading order (top to bottom, then left to right). */
export function align(canvas: Canvas, ids: readonly string[], mode: Alignment): Canvas {
  const chosen = canvas.nodes
    .filter((node) => ids.includes(node.id))
    .sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
  if (chosen.length < 2) return canvas;
  const startX = Math.min(...chosen.map((node) => node.x));
  const startY = Math.min(...chosen.map((node) => node.y));
  const moved = new Map<string, { x: number; y: number }>();
  if (mode === 'row') {
    let x = startX;
    for (const node of [...chosen].sort((a, b) => a.x - b.x)) {
      moved.set(node.id, { x, y: startY });
      x += node.width + GAP;
    }
  } else if (mode === 'column') {
    let y = startY;
    for (const node of chosen) {
      moved.set(node.id, { x: startX, y });
      y += node.height + GAP;
    }
  } else {
    const columns = Math.ceil(Math.sqrt(chosen.length));
    const cellW = Math.max(...chosen.map((node) => node.width)) + GAP;
    const cellH = Math.max(...chosen.map((node) => node.height)) + GAP;
    chosen.forEach((node, index) => moved.set(node.id, { x: startX + (index % columns) * cellW, y: startY + Math.floor(index / columns) * cellH }));
  }
  return { ...canvas, nodes: canvas.nodes.map((node) => ({ ...node, ...(moved.get(node.id) ?? {}) })) };
}

/** The canvas without the cards, and without the arrows that joined them. */
export function removeCards(canvas: Canvas, ids: readonly string[]): Canvas {
  return {
    nodes: canvas.nodes.filter((node) => !ids.includes(node.id)),
    edges: canvas.edges.filter((edge) => !ids.includes(edge.fromNode) && !ids.includes(edge.toNode)),
  };
}

/** The middle of a card, for drawing an arrow to it. */
export const center = (node: CanvasNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });

/** Where a line from one card's middle to another's leaves the first card's edge. */
export function edgePoint(node: CanvasNode, toward: { x: number; y: number }): { x: number; y: number } {
  const c = center(node);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(node.width / 2 / Math.abs(dx || 1e-9), node.height / 2 / Math.abs(dy || 1e-9));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}
