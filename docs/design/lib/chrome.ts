// Shared pieces of the OpenNote window at the "wide" size class (docs/BRAND.md section 6), drawn as built in beta 4.
// They cover the title bar, the command bar, the notebooks and pages panes, and the page on the ambient canvas.

import {
  type Box,
  type Palette,
  captionKeepOut,
  circle,
  ink,
  keepOut,
  line,
  palette,
  rect,
  region,
  text,
  textLines,
} from './svg.ts';
import { plantPot } from './drawings.ts';

export const WIDE = { width: 1440, height: 900, title: 40, command: 44, sidebar: 272, pages: 300 };
export const BODY_TOP = WIDE.title + WIDE.command;
export const EDITOR_X = WIDE.sidebar + WIDE.pages;
export const EDITOR_W = WIDE.width - EDITOR_X;
const CAPTION_W = 138;
const STATUS_H = 22;

export interface TitleBarOptions {
  breadcrumb?: string;
  /** The color of the dot before the breadcrumb: the notebook's color. */
  dot?: string;
  status?: string;
  update?: boolean;
  /** While recording, the title bar shows this indicator, such as "Recording 12:48". */
  recording?: string;
  /** First-run screens show only the logo and window buttons. */
  minimal?: boolean;
}

export function titleBar(p: Palette, o: TitleBarOptions = {}): string {
  const right = WIDE.width - CAPTION_W;
  const parts = [
    rect({ x: 0, y: 0, w: WIDE.width, h: WIDE.title }, { fill: p.c('surface.app') }),
    logo(p, 14, 10),
    text(40, 25, 'OpenNote', { size: 13, weight: 600, fill: p.c('text.primary') }),
  ];
  if (!o.minimal) {
    parts.push(
      text(124, 26, '←', { size: 15, fill: p.c('text.secondary'), anchor: 'middle' }),
      text(160, 26, '→', { size: 15, fill: p.c('text.secondary'), anchor: 'middle' }),
      circle(196, 20, 4, o.dot ?? p.pen('Fern')),
      text(206, 25, o.breadcrumb ?? '', { size: 13, fill: p.c('text.secondary') }),
      text(right - 136, 25, o.status ?? '☁ Saved', { size: 12, fill: p.c('text.secondary'), anchor: 'end' }),
      iconButton(p, right - 120, 4, '▦'),
      iconButton(p, right - 84, 4, '⌕'),
      iconButton(p, right - 44, 4, p.theme === 'light' ? '☀' : '☾'),
    );
  }
  if (o.update) parts.push(updateChip(p, right - 360));
  if (o.recording) parts.push(recordingChip(p, right - 360, o.recording));
  ['—', '▢', '✕'].forEach((glyph, i) => {
    parts.push(text(right + 23 + i * 46, 25, glyph, { size: 13, fill: p.c('text.secondary'), anchor: 'middle' }));
  });
  return parts.join('');
}

function updateChip(p: Palette, x: number): string {
  return [
    rect({ x, y: 9, w: 104, h: 22 }, { fill: p.c('accent.primarySubtle'), r: 11 }),
    text(x + 52, 24, '↻ Update ready', { size: 12, weight: 600, fill: p.c('text.link'), anchor: 'middle' }),
  ].join('');
}

function recordingChip(p: Palette, x: number, label: string): string {
  return [
    rect({ x, y: 9, w: 132, h: 22 }, { fill: p.c('accent.primarySubtle'), r: 11 }),
    circle(x + 14, 20, 5, p.c('status.recording')),
    text(x + 26, 24, label, { size: 12, weight: 600, fill: p.c('text.link') }),
  ].join('');
}

export function logo(p: Palette, x: number, y: number): string {
  return [
    rect({ x, y, w: 16, h: 20 }, { fill: p.c('surface.page'), stroke: p.c('text.primary'), r: 3, width: 1.5 }),
    ink(`M${x + 3} ${y + 14}c2-6 5-7 6-3s3 4 5-2`, p.c('accent.primary'), 1.8),
  ].join('');
}

export function iconButton(p: Palette, x: number, y: number, glyph: string, active = false): string {
  const background = active ? rect({ x, y, w: 32, h: 32 }, { fill: p.c('accent.primarySubtle'), r: 8 }) : '';
  const color = active ? p.c('text.link') : p.c('text.secondary');
  return background + text(x + 16, y + 21, glyph, { size: 15, fill: color, anchor: 'middle' });
}

export interface Tool {
  label: string;
  active?: boolean;
  /** A thin divider, not a button. */
  sep?: boolean;
  /** A pen slot: a colored dot, named by the label for the drawing's sake only. */
  dot?: string;
}

export const HOME_TOOLS: Tool[] = [
  { label: 'Record' },
  { label: 'Options' },
  { label: '', sep: true },
  { label: 'Bold' },
  { label: 'Italic' },
  { label: 'Underline' },
  { label: 'Highlight' },
  { label: 'New page' },
  { label: 'New section' },
  { label: 'New notebook' },
  { label: '', sep: true },
  { label: 'Undo' },
  { label: 'More' },
];

export const INSERT_TOOLS: Tool[] = [
  { label: 'Link' },
  { label: 'Code block' },
  { label: 'Callout' },
  { label: 'Divider' },
  { label: 'Insert template' },
  { label: 'Attach file' },
  { label: 'Insert equation' },
  { label: 'Insert table' },
  { label: 'More' },
];

export const DRAW_TOOLS: Tool[] = [
  { label: 'Select and type', active: true },
  { label: 'Stroke eraser' },
  { label: 'Partial eraser' },
  { label: 'Lasso select' },
  { label: 'Insert space' },
  { label: 'Writing pen' },
  { label: 'More' },
];

export const VIEW_TOOLS: Tool[] = [
  { label: 'Notebooks pane', active: true },
  { label: 'Pages pane', active: true },
  { label: 'Pane widths' },
  { label: 'Infinite canvas', active: true },
  { label: 'Pages with breaks' },
  { label: '', sep: true },
  { label: 'Paper' },
  { label: 'Background' },
  { label: 'Focus mode' },
  { label: 'More' },
];

export function commandBar(p: Palette, active: string, tools: Tool[]): string {
  const y = WIDE.title;
  const parts = [
    rect({ x: 0, y, w: WIDE.width, h: WIDE.command }, { fill: p.c('surface.app') }),
    line([0, y + WIDE.command], [WIDE.width, y + WIDE.command], p.c('border.subtle')),
  ];
  ['Home', 'Insert', 'Draw', 'View'].forEach((tab, i) => {
    const x = 20 + i * 64;
    const isActive = tab === active;
    parts.push(
      text(x, y + 27, tab, {
        size: 14,
        weight: isActive ? 600 : 400,
        fill: p.c(isActive ? 'text.primary' : 'text.secondary'),
      }),
    );
    if (isActive) parts.push(rect({ x, y: y + 38, w: tab.length * 8, h: 3 }, { fill: p.c('accent.primary'), r: 1.5 }));
  });
  for (const { tool, x, w } of layoutTools(tools)) {
    if (tool.sep) {
      parts.push(line([x + 4, y + 10], [x + 4, y + 34], p.c('border.subtle')));
      continue;
    }
    if (tool.dot) {
      parts.push(circle(x + 13, y + 22, 6, tool.dot));
      continue;
    }
    const fill = tool.active ? p.c('accent.primarySubtle') : 'none';
    parts.push('<g data-fit="6" data-center="both">', rect({ x, y: y + 8, w, h: 28 }, { fill, r: 8 }));
    parts.push(
      text(x + w / 2, y + 27, tool.label, {
        size: 13,
        fill: p.c(tool.active ? 'text.link' : 'text.primary'),
        anchor: 'middle',
      }),
    );
    parts.push('</g>');
  }
  return parts.join('');
}

/** Where each command bar tool sits: its left edge and width, from the left of the tools at x = 290. */
export function layoutTools(tools: Tool[]): { tool: Tool; x: number; w: number }[] {
  let x = 290;
  return tools.map((tool) => {
    const w = tool.sep ? 12 : tool.dot ? 28 : tool.label.length * 7 + 20;
    const at = { tool, x, w };
    x += tool.sep || tool.dot ? w : w + 6;
    return at;
  });
}

export interface TreeItem {
  label: string;
  depth: number;
  kind: 'notebook' | 'group' | 'section';
  color?: string;
  selected?: boolean;
  drop?: boolean;
}

export function sidebar(p: Palette, items: TreeItem[]): string {
  const h = WIDE.height - BODY_TOP;
  const parts = [
    rect({ x: 0, y: BODY_TOP, w: WIDE.sidebar, h }, { fill: p.c('surface.app') }),
    line([WIDE.sidebar, BODY_TOP], [WIDE.sidebar, WIDE.height], p.c('border.subtle')),
  ];
  items.forEach((item, i) => {
    const open = items[i + 1] !== undefined && items[i + 1].depth > item.depth;
    parts.push(treeRow(p, item, BODY_TOP + 12 + i * 32, open));
  });
  parts.push(
    line([12, WIDE.height - 66], [WIDE.sidebar - 12, WIDE.height - 66], p.c('border.subtle')),
    trashLabel(p, 22, WIDE.height - 44),
    plantPot(p, WIDE.sidebar - 56, WIDE.height - 12),
  );
  return parts.join('');
}

function trashLabel(p: Palette, x: number, y: number): string {
  const c = p.c('text.secondary');
  return [
    rect({ x, y: y - 11, w: 11, h: 13 }, { stroke: c, r: 2 }),
    line([x - 2, y - 13], [x + 13, y - 13], c),
    text(x + 24, y, 'Trash', { size: 13, fill: c }),
  ].join('');
}

function treeRow(p: Palette, item: TreeItem, y: number, open: boolean): string {
  const x = 14 + item.depth * 16;
  const parts: string[] = [];
  if (item.selected)
    parts.push(rect({ x: 8, y, w: WIDE.sidebar - 16, h: 30 }, { fill: p.c('surface.selected'), r: 6 }));
  if (item.drop)
    parts.push(
      rect(
        { x: 8, y, w: WIDE.sidebar - 16, h: 30 },
        { fill: p.c('accent.primarySubtle'), stroke: p.c('accent.primary'), r: 6, width: 2 },
      ),
    );
  const muted = p.c('text.muted');
  if (item.kind === 'group') {
    parts.push(
      text(x + 8, y + 20, open ? '⌄' : '›', { size: 13, fill: muted, anchor: 'middle' }),
      rect({ x: x + 22, y: y + 10, w: 11, h: 11 }, { stroke: p.c('border.control'), r: 3 }),
      text(x + 38, y + 20, item.label, { size: 13, fill: p.c('text.primary') }),
    );
    return parts.join('');
  }
  const color = item.color ?? p.c('accent.primary');
  if (item.kind === 'notebook') {
    parts.push(
      text(x + 8, y + 20, open ? '⌄' : '›', { size: 13, fill: muted, anchor: 'middle' }),
      rect({ x: x + 22, y: y + 9, w: 12, h: 12 }, { fill: color, r: 3 }),
      text(x + 38, y + 20, item.label, { size: 13, fill: p.c('text.primary') }),
    );
    return parts.join('');
  }
  parts.push(
    circle(x + 27, y + 15, 4, color),
    text(x + 38, y + 20, item.label, { size: 13, fill: p.c('text.primary') }),
  );
  return parts.join('');
}

export interface PageItem {
  title: string;
  meta: string;
  depth?: number;
  selected?: boolean;
  ghost?: boolean;
}

export function pageList(p: Palette, pages: PageItem[]): string {
  const x = WIDE.sidebar;
  const parts = [
    rect({ x, y: BODY_TOP, w: WIDE.pages, h: WIDE.height - BODY_TOP }, { fill: p.c('surface.app') }),
    line([EDITOR_X, BODY_TOP], [EDITOR_X, WIDE.height], p.c('border.subtle')),
  ];
  pages.forEach((page, i) => parts.push(pageRow(p, page, BODY_TOP + 12 + i * 56)));
  return parts.join('');
}

function pageRow(p: Palette, page: PageItem, y: number): string {
  const x = WIDE.sidebar + 24 + (page.depth ?? 0) * 16;
  const parts: string[] = [];
  if (page.selected)
    parts.push(rect({ x: WIDE.sidebar + 12, y, w: WIDE.pages - 24, h: 56 }, { fill: p.c('surface.selected'), r: 6 }));
  const color = page.ghost ? p.c('text.muted') : p.c('text.primary');
  parts.push(text(x, y + 23, page.title, { size: 14, weight: 500, fill: color }));
  parts.push(text(x, y + 42, page.meta, { size: 12, fill: p.c('text.muted') }));
  return parts.join('');
}

/**
 * The page area: the ambient canvas, then the page card on it. A page on the infinite canvas fills the pane except
 * for a gutter of canvas at the right. Pass another token to get a plain fill, as the paginated view does.
 */
export function editorBackground(p: Palette, token = 'surface.page'): string {
  const area = { x: EDITOR_X, y: BODY_TOP, w: EDITOR_W, h: WIDE.height - BODY_TOP };
  if (token !== 'surface.page') return rect(area, { fill: p.c(token) });
  return [
    ambientCanvas(p, area),
    rect({ x: EDITOR_X, y: BODY_TOP, w: EDITOR_W - 36, h: area.h - STATUS_H }, { fill: p.c('surface.page') }),
    text(EDITOR_X + 12, WIDE.height - 7, '57 words · 1 min read', { size: 11, fill: p.c('text.muted') }),
  ].join('');
}

let canvasCount = 0;

/**
 * The ambient canvas behind a page card (docs/BRAND.md section 9). By day, window light pools from the top left
 * corner and a soft patch of it lies on the desk. In the evening, a dusk sky with a sunset band and a few stars.
 * It sits around the page card, never behind the writing.
 */
export function ambientCanvas(p: Palette, b: Box, poolOnly = false): string {
  const id = `ambient${++canvasCount}`;
  const top = p.c('ambient.canvasTop');
  const glow = p.c('ambient.glow');
  const base = rect(b, { fill: p.c('surface.sunken') });
  if (p.theme === 'light') {
    const patch = { cx: b.x + b.w - 190, cy: b.y + b.h - 150 };
    return [
      `<defs><radialGradient id="${id}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" `,
      `gradientTransform="translate(${b.x} ${b.y}) scale(${Math.round(b.w * 0.7)} ${Math.round(b.h * 0.8)})">`,
      `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${top}" stop-opacity="0"/></radialGradient>`,
      `<radialGradient id="${id}p"><stop offset="0" stop-color="${glow}"/>`,
      `<stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>`,
      base,
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#${id})"/>`,
      poolOnly
        ? ''
        : `<ellipse cx="${patch.cx}" cy="${patch.cy}" rx="210" ry="150" fill="url(#${id}p)" opacity="0.9"/>`,
    ].join('');
  }
  const stars = [
    [0.08, 0.1],
    [0.22, 0.28],
    [0.37, 0.07],
    [0.52, 0.2],
    [0.66, 0.09],
    [0.78, 0.31],
    [0.9, 0.14],
    [0.95, 0.4],
  ].map(([sx, sy]) => circle(Math.round(b.x + b.w * sx), Math.round(b.y + b.h * sy), 1.6, p.c('ambient.spark')));
  return [
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${p.c('ambient.canvasBottom')}"/></linearGradient>`,
    `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${glow}" stop-opacity="0"/><stop offset="1" stop-color="${glow}"/></linearGradient></defs>`,
    base,
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#${id})"/>`,
    poolOnly ? '' : `<rect x="${b.x}" y="${b.y + b.h - 150}" width="${b.w}" height="150" fill="url(#${id}s)"/>`,
    ...(poolOnly ? [] : stars),
  ].join('');
}

/** The page's title block: serif title, the short clay rule under it, and the changed date. */
export function pageHeader(p: Palette, x: number, y: number, title: string, changed = 'Changed Sep 23, 2026'): string {
  return [
    text(x, y, title, { size: 30, weight: 700, fill: p.c('text.primary'), font: 'reading' }),
    rect({ x, y: y + 12, w: 48, h: 2 }, { fill: p.c('accent.clay') }),
    text(x, y + 34, changed, { size: 11, fill: p.c('text.muted') }),
  ].join('');
}

/** The Properties chip at the top right of a page. */
export function propertiesChip(p: Palette, rightEdge: number, y: number): string {
  const w = 128;
  const x = rightEdge - w;
  return [
    rect({ x, y, w, h: 32 }, { fill: p.c('surface.page'), stroke: p.c('border.control'), r: 16 }),
    text(x + 16, y + 21, 'Properties', { size: 12, weight: 600, fill: p.c('text.primary') }),
    text(x + w - 16, y + 21, 'none', { size: 12, fill: p.c('text.muted'), anchor: 'end' }),
  ].join('');
}

export function penPalette(p: Palette, x: number, y: number): string {
  const parts = [
    rect({ x, y, w: 300, h: 48 }, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 24, shadow: true }),
  ];
  ['Ink', 'Indigo', 'Brick', 'Fern'].forEach((pen, i) => {
    const cx = x + 28 + i * 34;
    if (i === 0) parts.push(circle(cx, y + 24, 14, 'none', p.c('accent.primary')));
    parts.push(circle(cx, y + 24, 9, p.pen(pen)));
  });
  parts.push(rect({ x: x + 156, y: y + 16, w: 18, h: 16 }, { fill: p.highlighter('Honey'), r: 3 }));
  ['⌫', '◌', '⋯'].forEach((glyph, i) =>
    parts.push(text(x + 206 + i * 32, y + 30, glyph, { size: 16, fill: p.c('text.secondary'), anchor: 'middle' })),
  );
  return parts.join('');
}

export interface ChromeOptions {
  title: TitleBarOptions;
  tab: string;
  tools: Tool[];
  tree: TreeItem[];
  pages: PageItem[];
}

/** The full three-pane window without the page content. */
export function standardWindow(p: Palette, o: ChromeOptions): string[] {
  return [titleBar(p, o.title), commandBar(p, o.tab, o.tools), sidebar(p, o.tree), pageList(p, o.pages)];
}

/** Annotations every wide window shares: window buttons, drag area, and the three panes. */
export function windowAnnotations(): string[] {
  return [
    captionKeepOut(WIDE.width),
    region({ x: 540, y: 2, w: 520, h: 36 }, 'Title bar drag area: keep 200+ px empty'),
    region({ x: 2, y: BODY_TOP + 520, w: WIDE.sidebar - 4, h: 60 }, 'Notebooks 272 (resizable 220–400)'),
    keepOut({ x: WIDE.sidebar - 4, y: BODY_TOP + 640, w: 8, h: 100 }, 'Resize handle 8'),
    keepOut({ x: EDITOR_X - 4, y: BODY_TOP + 640, w: 8, h: 100 }, 'Resize handle 8'),
  ];
}

/** A tiny picture of the app in one theme, used on the theme cards. */
export function miniApp(b: Box, theme: 'light' | 'dark'): string {
  const t = palette(theme);
  const side = Math.round(b.w * 0.28);
  return [
    rect(b, { fill: t.c('surface.app') }),
    rect({ x: b.x + side, y: b.y + 10, w: b.w - side - 10, h: b.h - 10 }, { fill: t.c('surface.page'), r: 4 }),
    textLines(b.x + 8, b.y + 16, [side - 20, side - 26, side - 22], t.c('border.control'), 14),
    textLines(b.x + side + 12, b.y + 24, [b.w * 0.4, b.w * 0.5, b.w * 0.34], t.c('text.muted'), 14),
    circle(b.x + side + 20, b.y + b.h - 22, 6, t.c('accent.primary')),
  ].join('');
}
