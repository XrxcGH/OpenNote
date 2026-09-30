// The main three-pane workspace: a new page, organizing notebooks, and search.

import {
  type Palette,
  type ThemeName,
  captionKeepOut,
  ink,
  keepOut,
  palette,
  rect,
  region,
  tag,
  text,
  textLines,
  NOTE,
} from '../lib/svg.ts';
import {
  BODY_TOP,
  EDITOR_W,
  EDITOR_X,
  WIDE,
  editorBackground,
  penPalette,
  standardWindow,
  windowAnnotations,
} from '../lib/chrome.ts';
import type { PageItem, TreeItem } from '../lib/chrome.ts';
import { type Screen, makeScreen } from './screen.ts';

const HOME_TOOLS = [
  { label: 'B' },
  { label: 'I' },
  { label: 'Heading ▾' },
  { label: '• List' },
  { label: '☐ To-do' },
  { label: 'Tag ▾' },
];

function tree(p: Palette): TreeItem[] {
  return [
    { label: 'Biology 101', depth: 0, kind: 'notebook', color: p.pen('Fern') },
    { label: 'Lectures', depth: 1, kind: 'section', color: p.pen('Fern'), selected: true },
    { label: 'Labs', depth: 1, kind: 'section', color: p.pen('Amber') },
    { label: 'Exam prep', depth: 1, kind: 'group' },
    { label: 'Midterm', depth: 2, kind: 'section', color: p.pen('Plum') },
    { label: 'Final', depth: 2, kind: 'section', color: p.pen('Indigo') },
    { label: 'Work', depth: 0, kind: 'notebook', color: p.pen('Brick') },
    { label: 'Meetings', depth: 1, kind: 'section', color: p.pen('Brick') },
    { label: 'Projects', depth: 1, kind: 'section', color: p.pen('Walnut') },
    { label: 'Personal', depth: 0, kind: 'notebook', color: p.pen('Plum') },
  ];
}

const PAGES: PageItem[] = [
  { title: 'Cell structure', meta: 'Sep 28 · 3 recordings' },
  { title: 'Membranes', meta: 'Sep 28', depth: 1 },
  { title: 'Mitosis', meta: 'Sep 23' },
  { title: 'Meiosis', meta: 'Sep 21' },
  { title: 'Photosynthesis', meta: 'Sep 16' },
];

function window(p: Palette, pages: PageItem[], breadcrumb: string): string[] {
  return standardWindow(p, {
    title: { breadcrumb },
    tab: 'Home',
    tools: HOME_TOOLS,
    tree: tree(p),
    pagesHeading: 'Lectures',
    pages,
  });
}

/** Typed notes plus a hand-drawn diagram, used behind overlays, and in the organize view. */
export function samplePage(p: Palette, x: number, y: number): string {
  const muted = p.c('text.muted');
  return [
    text(x, y, 'Cell structure', { size: 30, weight: 600, fill: p.c('text.primary') }),
    text(x, y + 26, 'Sunday, Sep 28, 2026 · 10:05 AM', { size: 13, fill: muted }),
    text(x, y + 72, 'Organelles', { size: 20, weight: 600, fill: p.c('text.primary') }),
    textLines(x, y + 90, [380, 420, 350, 300], p.c('border.control')),
    ink(`M${x + 470} ${y + 150}c30-60 150-60 170 0s-30 90-90 90-100-30-80-90z`, p.pen('Indigo')),
    ink(`M${x + 540} ${y + 185}a22 18 0 1 0 1 0`, p.pen('Brick')),
    ink(`M${x + 600} ${y + 140}l60-40`, p.pen('Ink'), 2),
    text(x + 664, y + 100, 'nucleus', { size: 18, fill: p.pen('Ink'), italic: true, font: 'reading' }),
    text(x, y + 190, 'Key terms', { size: 20, weight: 600, fill: p.c('text.primary') }),
    rect({ x: x - 2, y: y + 204, w: 150, h: 20 }, { fill: p.highlighter('Honey'), r: 3 }),
    textLines(x, y + 211, [140, 360, 330], p.c('border.control')),
  ].join('');
}

function newPageContent(p: Palette): string[] {
  const x = EDITOR_X + 64;
  const y = BODY_TOP + 88;
  return [
    editorBackground(p),
    text(x, y, 'Untitled page', { size: 30, weight: 600, fill: p.c('text.muted') }),
    text(x, y + 28, 'Wednesday, Sep 30, 2026 · 9:41 AM', { size: 13, fill: p.c('text.muted') }),
    rect({ x, y: y + 64, w: 2, h: 22 }, { fill: p.c('accent.primary') }),
    text(x + 12, y + 81, 'Start typing, or pick up the pen. Type / to add a table, chart, math or recording.', {
      size: 15,
      fill: p.c('text.muted'),
    }),
    penPalette(p, EDITOR_X + (EDITOR_W - 300) / 2, WIDE.height - 72),
  ];
}

export function newPage(theme: ThemeName): Screen {
  const p = palette(theme);
  const body = [
    ...window(
      p,
      [{ title: 'Untitled page', meta: 'Today, 9:41 AM', selected: true }, ...PAGES],
      'Biology 101  ›  Lectures  ›  Untitled page',
    ),
    ...newPageContent(p),
    ...windowAnnotations(),
    region({ x: WIDE.sidebar + 2, y: BODY_TOP + 520, w: WIDE.pages - 4, h: 60 }, 'Pages 300 (resizable 240–420)'),
    region({ x: EDITOR_X + 48, y: BODY_TOP + 40, w: 720, h: 150 }, 'Page text: 48 px inset, lines ≤ 72 characters'),
    region(
      { x: EDITOR_X + 2, y: BODY_TOP + 250, w: EDITOR_W - 4, h: 60 },
      'Page area: at least 480 wide, fills the rest',
    ),
    keepOut(
      { x: EDITOR_X + (EDITOR_W - 300) / 2 - 12, y: WIDE.height - 84, w: 324, h: 72 },
      'Pen palette home (movable)',
      [EDITOR_X + (EDITOR_W - 300) / 2 - 12, WIDE.height - 96],
    ),
  ];
  const suffix = theme === 'dark' ? '-dark' : '';
  return makeScreen({
    file: `03-new-page${suffix}.svg`,
    title: `A new page (${theme} theme)`,
    background: p.c('surface.app'),
    body,
  });
}

function dragCard(p: Palette, x: number, y: number): string {
  return [
    rect({ x, y, w: 190, h: 50 }, { fill: p.c('surface.raised'), stroke: p.c('accent.primary'), r: 8, shadow: true }),
    text(x + 14, y + 22, 'Mitosis', { size: 14, weight: 500, fill: p.c('text.primary') }),
    text(x + 14, y + 40, 'Move 1 page to Final', { size: 12, fill: p.c('text.link') }),
    ink(`M${x - 10} ${y - 16}l0 18 5-5 4 8 3-1-4-8 7 0z`, p.c('text.primary'), 1.5),
  ].join('');
}

function contextMenu(p: Palette, x: number, y: number): string {
  const items = [
    'Open in new window',
    'Move to…',
    'Make subpage',
    'Duplicate',
    'Copy link to page',
    'Export…',
    'Delete',
  ];
  const parts = [
    rect(
      { x, y, w: 210, h: items.length * 32 + 12 },
      { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 10, shadow: true },
    ),
  ];
  items.forEach((item, i) => {
    const color = item === 'Delete' ? p.c('status.danger') : p.c('text.primary');
    if (i === 1) parts.push(rect({ x: x + 6, y: y + 8 + i * 32, w: 198, h: 30 }, { fill: p.c('surface.hover'), r: 6 }));
    parts.push(text(x + 16, y + 28 + i * 32, item, { size: 13, fill: color }));
  });
  return parts.join('');
}

export function organize(): Screen {
  const p = palette('light');
  const items = tree(p).map((item) => (item.label === 'Final' ? { ...item, drop: true } : item));
  const pages = PAGES.map((page) =>
    page.title === 'Mitosis'
      ? { ...page, ghost: true }
      : page.title === 'Cell structure'
        ? { ...page, selected: true }
        : page,
  );
  const rowY = (label: string) => BODY_TOP + 48 + items.findIndex((i) => i.label === label) * 32;
  const body = [
    ...standardWindow(p, {
      title: { breadcrumb: 'Biology 101  ›  Lectures  ›  Cell structure' },
      tab: 'Home',
      tools: HOME_TOOLS,
      tree: items,
      pagesHeading: 'Lectures',
      pages,
    }),
    editorBackground(p),
    samplePage(p, EDITOR_X + 64, BODY_TOP + 88),
    dragCard(p, 150, rowY('Final') + 22),
    contextMenu(p, WIDE.sidebar + 180, BODY_TOP + 250),
    region({ x: 2, y: BODY_TOP + 40, w: WIDE.sidebar - 4, h: 28 }, ''),
    region({ x: 2, y: WIDE.height - 104, w: WIDE.sidebar - 4, h: 28 }, ''),
    tag(20, WIDE.height - 116, 'Auto-scroll strips (28) at both ends while dragging', NOTE.region),
    region({ x: 4, y: rowY('Midterm') - 2, w: WIDE.sidebar - 8, h: 66 }, ''),
    tag(WIDE.sidebar + 180, BODY_TOP + 500, 'Right-click or long-press a page', NOTE.region),
    tag(20, BODY_TOP + 400, 'Drop target fills with the accent', NOTE.region),
    tag(20, BODY_TOP + 424, 'Rows 32 (44 on touch), indent 16 per level', NOTE.region),
  ];
  return makeScreen({
    file: '04-organize.svg',
    title: 'Organizing notebooks, sections and pages',
    background: p.c('surface.app'),
    body,
  });
}

interface Result {
  title: string;
  where: string;
  kind: string;
}

function searchPalette(p: Palette, x: number, y: number): string {
  const results: Result[] = [
    { title: 'Mitosis', where: 'Biology 101 › Lectures · "stages of mitosis"', kind: 'Page' },
    { title: 'Cell structure', where: 'Handwriting: "mitosis → 2 cells"', kind: 'Ink' },
    { title: 'Lecture 5 recording', where: 'At 04:12: "…during mitosis the spindle…"', kind: 'Audio' },
    { title: 'Insert chart', where: 'Command · Ctrl+Alt+C', kind: 'Command' },
  ];
  const parts = [
    rect({ x, y, w: 680, h: 390 }, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 14, shadow: true }),
    text(x + 20, y + 38, '⌕  mitosis', { size: 18, fill: p.c('text.primary') }),
    rect({ x: x + 104, y: y + 20, w: 2, h: 24 }, { fill: p.c('accent.primary') }),
    ...['All', 'Pages', 'Handwriting', 'Recordings', 'Commands'].map((chip, i) => {
      const cx = x + 20 + i * 108;
      const on = i === 0;
      return (
        rect(
          { x: cx, y: y + 60, w: 98, h: 28 },
          { fill: on ? p.c('accent.primarySubtle') : 'none', stroke: p.c('border.subtle'), r: 14 },
        ) + text(cx + 49, y + 79, chip, { size: 13, fill: p.c(on ? 'text.link' : 'text.secondary'), anchor: 'middle' })
      );
    }),
  ];
  results.forEach((r, i) => parts.push(resultRow(p, r, x, y + 104 + i * 60, i === 0)));
  parts.push(
    text(x + 20, y + 372, '↑ ↓ move   ·   Enter open   ·   Ctrl+Enter open in new window   ·   Esc close', {
      size: 12,
      fill: p.c('text.muted'),
    }),
  );
  return parts.join('');
}

function resultRow(p: Palette, r: Result, x: number, y: number, active: boolean): string {
  return [
    active ? rect({ x: x + 8, y, w: 664, h: 54 }, { fill: p.c('surface.selected'), r: 8 }) : '',
    text(x + 20, y + 22, r.title, { size: 15, weight: 600, fill: p.c('text.primary') }),
    text(x + 20, y + 42, r.where, { size: 13, fill: p.c('text.secondary') }),
    text(x + 660, y + 32, r.kind, { size: 12, fill: p.c('text.muted'), anchor: 'end' }),
  ].join('');
}

export function search(): Screen {
  const p = palette('light');
  const x = (WIDE.width - 680) / 2;
  const body = [
    ...window(
      p,
      PAGES.map((page, i) => ({ ...page, selected: i === 0 })),
      'Biology 101  ›  Lectures  ›  Cell structure',
    ),
    editorBackground(p),
    samplePage(p, EDITOR_X + 64, BODY_TOP + 88),
    rect(
      { x: 0, y: WIDE.title, w: WIDE.width, h: WIDE.height - WIDE.title },
      { fill: p.c('text.primary'), opacity: 0.28 },
    ),
    searchPalette(p, x, 90),
    region({ x: x - 6, y: 84, w: 692, h: 402 }, ''),
    tag(x, 516, 'Search and commands (Ctrl+K): 680 wide, 90 from the top', NOTE.region),
    tag(
      x,
      540,
      'Results update within 100 ms while typing, across typed text, handwriting and transcripts',
      NOTE.region,
    ),
    region({ x: 1, y: 1, w: WIDE.width - 140, h: 38 }, ''),
    tag(700, 64, 'Title bar is never dimmed: dragging and window buttons keep working', NOTE.region),
    captionKeepOut(WIDE.width),
  ];
  return makeScreen({
    file: '07-search.svg',
    title: 'Search and the command palette',
    background: p.c('surface.app'),
    body,
  });
}
