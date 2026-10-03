// Shared pieces of the OpenNote window at the "wide" size class (docs/BRAND.md section 6).

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

export const WIDE = { width: 1440, height: 900, title: 40, command: 44, sidebar: 272, pages: 300 };
export const BODY_TOP = WIDE.title + WIDE.command;
export const EDITOR_X = WIDE.sidebar + WIDE.pages;
export const EDITOR_W = WIDE.width - EDITOR_X;
const CAPTION_W = 138;

export interface TitleBarOptions {
  breadcrumb?: string;
  status?: string;
  update?: boolean;
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
    parts.push(text(122, 25, o.breadcrumb ?? '', { size: 13, fill: p.c('text.secondary') }));
    parts.push(iconButton(p, right - 44, 4, p.theme === 'light' ? '☾' : '☀'));
    parts.push(text(right - 56, 25, o.status ?? '✓ Saved', { size: 12, fill: p.c('text.secondary'), anchor: 'end' }));
  }
  if (o.update) parts.push(updateChip(p, right - 236));
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
}

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
  parts.push(line([290, y + 10], [290, y + 34], p.c('border.subtle')));
  let x = 306;
  for (const tool of tools) {
    const w = tool.label.length * 7 + 20;
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
    x += w + 6;
  }
  return parts.join('');
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
    text(20, BODY_TOP + 30, 'NOTEBOOKS', { size: 11, weight: 700, fill: p.c('text.muted') }),
    iconButton(p, WIDE.sidebar - 44, BODY_TOP + 10, '+'),
  ];
  items.forEach((item, i) => parts.push(treeRow(p, item, BODY_TOP + 48 + i * 32)));
  parts.push(text(20, WIDE.height - 52, 'Trash', { size: 13, fill: p.c('text.secondary') }));
  parts.push(text(20, WIDE.height - 20, '⚙ Settings', { size: 13, fill: p.c('text.secondary') }));
  return parts.join('');
}

function treeRow(p: Palette, item: TreeItem, y: number): string {
  const x = 20 + item.depth * 16;
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
  if (item.kind === 'group') {
    parts.push(text(x, y + 20, `▾ ${item.label}`, { size: 13, fill: p.c('text.secondary') }));
    return parts.join('');
  }
  const color = item.color ?? p.c('accent.primary');
  const chip =
    item.kind === 'notebook'
      ? rect({ x, y: y + 9, w: 12, h: 12 }, { fill: color, r: 3 })
      : circle(x + 6, y + 15, 4, color);
  const weight = item.kind === 'notebook' ? 600 : 400;
  parts.push(chip, text(x + 20, y + 20, item.label, { size: 13, weight, fill: p.c('text.primary') }));
  return parts.join('');
}

export interface PageItem {
  title: string;
  meta: string;
  depth?: number;
  selected?: boolean;
  ghost?: boolean;
}

export function pageList(p: Palette, heading: string, pages: PageItem[]): string {
  const x = WIDE.sidebar;
  const parts = [
    rect({ x, y: BODY_TOP, w: WIDE.pages, h: WIDE.height - BODY_TOP }, { fill: p.c('surface.app') }),
    line([EDITOR_X, BODY_TOP], [EDITOR_X, WIDE.height], p.c('border.subtle')),
    text(x + 20, BODY_TOP + 34, heading, { size: 17, weight: 600, fill: p.c('text.primary') }),
    rect({ x: x + WIDE.pages - 84, y: BODY_TOP + 16, w: 68, h: 28 }, { stroke: p.c('border.control'), r: 8 }),
    text(x + WIDE.pages - 50, BODY_TOP + 35, '+ Page', { size: 13, fill: p.c('text.primary'), anchor: 'middle' }),
  ];
  pages.forEach((page, i) => parts.push(pageRow(p, page, BODY_TOP + 60 + i * 56)));
  return parts.join('');
}

function pageRow(p: Palette, page: PageItem, y: number): string {
  const x = WIDE.sidebar + 20 + (page.depth ?? 0) * 16;
  const parts: string[] = [];
  if (page.selected)
    parts.push(rect({ x: WIDE.sidebar + 8, y, w: WIDE.pages - 16, h: 50 }, { fill: p.c('surface.selected'), r: 6 }));
  const color = page.ghost ? p.c('text.muted') : p.c('text.primary');
  parts.push(text(x, y + 22, page.title, { size: 14, weight: 500, fill: color }));
  parts.push(text(x, y + 40, page.meta, { size: 12, fill: p.c('text.muted') }));
  return parts.join('');
}

export function editorBackground(p: Palette, token = 'surface.page'): string {
  return rect({ x: EDITOR_X, y: BODY_TOP, w: EDITOR_W, h: WIDE.height - BODY_TOP }, { fill: p.c(token) });
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
  pagesHeading: string;
  pages: PageItem[];
}

/** The full three-pane window without the page content. */
export function standardWindow(p: Palette, o: ChromeOptions): string[] {
  return [
    titleBar(p, o.title),
    commandBar(p, o.tab, o.tools),
    sidebar(p, o.tree),
    pageList(p, o.pagesHeading, o.pages),
  ];
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
