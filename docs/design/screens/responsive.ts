// How the layout adapts: the four size classes, and the phone (compact) screens.

import {
  type Box,
  type Palette,
  circle,
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
import { type Screen, makeScreen } from './screen.ts';

interface Pane {
  label: string;
  share: number;
  token: string;
}

interface SizeClass {
  name: string;
  range: string;
  frame: Box;
  panes: Pane[];
  notes: string[];
}

function schematic(p: Palette, s: SizeClass): string {
  const { frame } = s;
  const parts = [
    text(frame.x, frame.y - 40, s.name, { size: 20, weight: 600, fill: p.c('text.primary') }),
    text(frame.x, frame.y - 16, s.range, { size: 13, fill: p.c('text.secondary') }),
    rect(frame, { fill: p.c('surface.app'), stroke: p.c('border.control'), r: 10, width: 2 }),
    rect({ x: frame.x, y: frame.y, w: frame.w, h: 22 }, { fill: p.c('surface.sunken'), r: 10 }),
  ];
  let x = frame.x + 6;
  for (const pane of s.panes) {
    const w = (frame.w - 12) * pane.share - 4;
    parts.push(
      rect({ x, y: frame.y + 28, w, h: frame.h - 34 }, { fill: p.c(pane.token), stroke: p.c('border.subtle'), r: 6 }),
    );
    parts.push(
      text(x + w / 2, frame.y + frame.h / 2, pane.label, {
        size: 13,
        weight: 600,
        fill: p.c('text.secondary'),
        anchor: 'middle',
      }),
    );
    x += w + 4;
  }
  s.notes.forEach((note, i) =>
    parts.push(text(frame.x, frame.y + frame.h + 28 + i * 20, note, { size: 13, fill: p.c('text.primary') })),
  );
  return parts.join('');
}

const FRAME_Y = 120;

const CLASSES: SizeClass[] = [
  {
    name: 'Compact',
    range: 'Under 600 px (phones)',
    frame: { x: 40, y: FRAME_Y, w: 200, h: 400 },
    panes: [{ label: 'One pane', share: 1, token: 'surface.page' }],
    notes: ['One pane at a time', 'Bottom toolbar', 'Pages open in Reading view'],
  },
  {
    name: 'Medium',
    range: '600 to 839 px',
    frame: { x: 300, y: FRAME_Y, w: 320, h: 400 },
    panes: [
      { label: 'Pages', share: 0.4, token: 'surface.app' },
      { label: 'Page', share: 0.6, token: 'surface.page' },
    ],
    notes: ['Page list beside the page', 'Notebooks in a slide-over drawer'],
  },
  {
    name: 'Expanded',
    range: '840 to 1,199 px',
    frame: { x: 680, y: FRAME_Y, w: 330, h: 400 },
    panes: [
      { label: 'Notebooks', share: 0.3, token: 'surface.app' },
      { label: 'Page', share: 0.7, token: 'surface.page' },
    ],
    notes: ['Notebooks beside the page', 'Page list opens as an overlay'],
  },
  {
    name: 'Wide',
    range: '1,200 px and up',
    frame: { x: 1070, y: FRAME_Y, w: 330, h: 400 },
    panes: [
      { label: 'Books', share: 0.24, token: 'surface.app' },
      { label: 'Pages', share: 0.26, token: 'surface.app' },
      { label: 'Page', share: 0.5, token: 'surface.page' },
    ],
    notes: ['Three panes: 272 + 300 + page', 'Every pane resizes and collapses'],
  },
];

export function sizeClasses(): Screen {
  const p = palette('light');
  const body = [
    text(40, 44, 'Layouts follow the window width, not the device type. Frames are not to scale.', {
      size: 15,
      fill: p.c('text.secondary'),
    }),
    ...CLASSES.map((s) => schematic(p, s)),
    tag(
      40,
      640,
      'Pen palette, command bar and dialogs adapt with the same breakpoints (BRAND.md section 6)',
      NOTE.region,
    ),
  ];
  return makeScreen({
    file: '09-size-classes.svg',
    title: 'Layouts for each size class',
    background: p.c('surface.page'),
    body,
    height: 680,
  });
}

const PHONE = { w: 390, h: 844, status: 47, home: 34, bar: 64 };

function phoneFrame(p: Palette, x: number, y: number): string[] {
  return [
    rect({ x: x - 10, y: y - 10, w: PHONE.w + 20, h: PHONE.h + 20 }, { fill: '#1A1714', r: 52 }),
    rect({ x, y, w: PHONE.w, h: PHONE.h }, { fill: p.c('surface.app'), r: 42 }),
    text(x + 36, y + 32, '9:41', { size: 15, weight: 600, fill: p.c('text.primary') }),
    rect({ x: x + PHONE.w / 2 - 67, y: y + PHONE.h - 14, w: 134, h: 5 }, { fill: p.c('text.primary'), r: 2.5 }),
  ];
}

function bottomBar(p: Palette, x: number, y: number, items: [string, string][], active: number): string {
  const top = y + PHONE.h - PHONE.home - PHONE.bar;
  const parts = [rect({ x, y: top, w: PHONE.w, h: PHONE.bar }, { fill: p.c('surface.raised') })];
  items.forEach(([glyph, label], i) => {
    const cx = x + (PHONE.w / items.length) * (i + 0.5);
    const color = p.c(i === active ? 'text.link' : 'text.secondary');
    parts.push(
      text(cx, top + 28, glyph, { size: 18, fill: color, anchor: 'middle' }),
      text(cx, top + 48, label, { size: 11, fill: color, anchor: 'middle' }),
    );
  });
  return parts.join('');
}

function notebookList(p: Palette, x: number, y: number): string[] {
  const books: [string, string, string][] = [
    ['Biology 101', '24 pages · edited today', 'Fern'],
    ['Work', '51 pages · yesterday', 'Brick'],
    ['Personal', '12 pages · Sep 20', 'Plum'],
    ['Recipes', '8 pages · Aug 2', 'Amber'],
    ['Travel', '5 pages · Jul 14', 'Indigo'],
  ];
  const parts = [
    ...phoneFrame(p, x, y),
    text(x + 20, y + 90, 'Notebooks', { size: 28, weight: 600, fill: p.c('text.primary') }),
    text(x + PHONE.w - 28, y + 88, '⌕', { size: 20, fill: p.c('text.secondary'), anchor: 'end' }),
  ];
  books.forEach(([name, meta, pen], i) => {
    const ry = y + 120 + i * 68;
    parts.push(rect({ x: x + 20, y: ry + 14, w: 36, h: 44 }, { fill: p.pen(pen), r: 6 }));
    parts.push(
      text(x + 70, ry + 32, name, { size: 16, weight: 600, fill: p.c('text.primary') }),
      text(x + 70, ry + 52, meta, { size: 13, fill: p.c('text.muted') }),
      text(x + PHONE.w - 24, ry + 42, '›', { size: 20, fill: p.c('text.muted'), anchor: 'end' }),
    );
  });
  const fabY = y + PHONE.h - PHONE.home - PHONE.bar - 44;
  parts.push(
    circle(x + PHONE.w - 48, fabY, 28, p.c('accent.primary')),
    text(x + PHONE.w - 48, fabY + 9, '+', { size: 26, fill: p.c('text.onAccent'), anchor: 'middle' }),
  );
  parts.push(
    bottomBar(
      p,
      x,
      y,
      [
        ['▦', 'Notebooks'],
        ['⌕', 'Search'],
        ['◷', 'Recent'],
        ['⚙', 'Settings'],
      ],
      0,
    ),
  );
  return parts;
}

function readingView(p: Palette, x: number, y: number): string[] {
  const parts = [
    ...phoneFrame(p, x, y),
    rect({ x, y: y + 100, w: PHONE.w, h: PHONE.h - 100 - PHONE.home - PHONE.bar }, { fill: p.c('surface.page') }),
  ];
  parts.push(
    text(x + 16, y + 80, '‹ Lectures', { size: 16, fill: p.c('text.link') }),
    text(x + PHONE.w - 24, y + 80, '⋯', { size: 20, fill: p.c('text.secondary'), anchor: 'end' }),
  );
  parts.push(text(x + 24, y + 144, 'Cell structure', { size: 24, weight: 600, fill: p.c('text.primary') }));
  parts.push(
    rect({ x: x + 24, y: y + 160, w: 200, h: 30 }, { stroke: p.c('border.control'), r: 15 }),
    rect({ x: x + 26, y: y + 162, w: 98, h: 26 }, { fill: p.c('accent.primarySubtle'), r: 13 }),
  );
  parts.push(
    text(x + 75, y + 180, 'Reading', { size: 13, fill: p.c('text.link'), anchor: 'middle' }),
    text(x + 174, y + 180, 'Canvas', { size: 13, fill: p.c('text.secondary'), anchor: 'middle' }),
  );
  parts.push(
    text(x + 24, y + 230, 'Organelles', { size: 18, weight: 600, fill: p.c('text.primary') }),
    textLines(x + 24, y + 244, [330, 340, 290, 310], p.c('border.control'), 18),
  );
  parts.push(
    ink(`M${x + 90} ${y + 400}c30-60 150-60 170 0s-30 90-90 90-100-30-80-90z`, p.pen('Indigo')),
    ink(`M${x + 160} ${y + 435}a22 18 0 1 0 1 0`, p.pen('Brick')),
  );
  parts.push(
    text(x + 24, y + 540, 'Key terms', { size: 18, weight: 600, fill: p.c('text.primary') }),
    textLines(x + 24, y + 554, [320, 280], p.c('border.control'), 18),
  );
  parts.push(
    bottomBar(
      p,
      x,
      y,
      [
        ['Aa', 'Type'],
        ['✎', 'Pen'],
        ['●', 'Record'],
        ['⋯', 'More'],
      ],
      1,
    ),
  );
  return parts;
}

export function phone(): Screen {
  const light = palette('light');
  const dark = palette('dark');
  const ax = 210;
  const bx = 720;
  const y = 28;
  const body = [
    ...notebookList(light, ax, y),
    ...readingView(dark, bx, y),
    keepOut({ x: ax, y, w: PHONE.w, h: PHONE.status }, 'Status bar 47', [ax - 130, y + 30]),
    keepOut({ x: ax, y: y + PHONE.h - PHONE.home, w: PHONE.w, h: PHONE.home }, 'Home indicator 34', [
      ax - 150,
      y + PHONE.h - 12,
    ]),
    keepOut({ x: bx, y: y + 100, w: 20, h: 600 }, 'Back-gesture edge 20', [bx + 24, y + 720]),
    keepOut({ x: bx, y: y + PHONE.h - PHONE.home, w: PHONE.w, h: PHONE.home }, ''),
    region({ x: ax + 2, y: y + PHONE.h - PHONE.home - PHONE.bar, w: PHONE.w - 4, h: PHONE.bar }, ''),
    tag(ax - 205, y + PHONE.h - PHONE.home - 30, 'Bottom bar 64, targets 44+', NOTE.region),
    region({ x: bx + 22, y: y + 210, w: PHONE.w - 40, h: 370 }, ''),
    tag(bx + PHONE.w + 24, y + 228, 'One column, 24 px margins', NOTE.region),
    tag(bx + PHONE.w + 24, y + 180, 'Canvas shows the original layout', NOTE.region),
    tag(bx + PHONE.w + 24, y + 252, 'Pen active: finger scrolls, pen draws', NOTE.region),
    tag(ax + PHONE.w + 24, y + 120, 'Light theme', NOTE.region),
    tag(bx + PHONE.w + 24, y + 120, 'Dark theme', NOTE.region),
  ];
  return makeScreen({
    file: '10-phone.svg',
    title: 'Phone: notebook list and a page in Reading view',
    background: light.c('surface.sunken'),
    body,
  });
}
