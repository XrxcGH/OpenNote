// The social preview image (1280 by 640): the product name and tagline beside the desk by the window and a
// real-looking workspace. brand/social-preview.png is rendered from the SVG this writes.

import { type Palette, arrow, circle, ink, line, onEllipse, palette, rect, text } from './lib/svg.ts';
import { ambientCanvas, logo } from './lib/chrome.ts';
import { deskScene, plantPot } from './lib/drawings.ts';

const WIN = { x: 600, y: 72, w: 640, h: 496 };
const SIDE = 112;
const PAGES = 132;
const BAR = 34;

const TREE: [string, number, string, boolean?][] = [
  ['Biology 101', 0, 'Fern'],
  ['Lectures', 1, 'Fern', true],
  ['Labs', 1, 'Amber'],
  ['Work', 0, 'Brick'],
  ['Personal', 0, 'Plum'],
  ['Recipes', 0, 'Amber'],
  ['Travel', 0, 'Indigo'],
];

const PAGE_LIST: [string, string, boolean?][] = [
  ['Cell structure', 'Sep 28, 2026'],
  ['Membranes', 'Sep 28, 2026'],
  ['Mitosis', 'Sep 23, 2026', true],
  ['Meiosis', 'Sep 21, 2026'],
  ['Photosynthesis', 'Sep 16, 2026'],
];

function titleAndTabs(p: Palette): string {
  const { x, y, w } = WIN;
  const tabs = ['Home', 'Insert', 'Draw', 'View'];
  const tools = ['Record', 'Options', 'Bold', 'Italic', 'Underline', 'Highlight'];
  const parts = [
    rect({ x, y, w, h: BAR * 2 }, { fill: p.c('surface.app') }),
    logo(p, x + 12, y + 7),
    text(x + 38, y + 22, 'OpenNote', { size: 12, weight: 600, fill: p.c('text.primary') }),
    circle(x + 142, y + 18, 3.5, p.pen('Fern')),
    text(x + 152, y + 22, 'Biology 101 › Lectures › Mitosis', { size: 11, fill: p.c('text.secondary') }),
    text(x + w - 16, y + 22, '☁ Saved', { size: 11, fill: p.c('text.secondary'), anchor: 'end' }),
    line([x, y + BAR * 2], [x + w, y + BAR * 2], p.c('border.subtle')),
  ];
  tabs.forEach((tab, i) => {
    const tx = x + 16 + i * 52;
    parts.push(
      text(tx, y + BAR + 22, tab, {
        size: 12,
        weight: i === 0 ? 600 : 400,
        fill: p.c(i === 0 ? 'text.primary' : 'text.secondary'),
      }),
    );
    if (i === 0) parts.push(rect({ x: tx, y: y + BAR + 28, w: 30, h: 2.5 }, { fill: p.c('accent.primary'), r: 1 }));
  });
  let tx = x + 232;
  for (const tool of tools) {
    parts.push(text(tx, y + BAR + 22, tool, { size: 11, fill: p.c('text.primary') }));
    tx += tool.length * 6.4 + 22;
  }
  return parts.join('');
}

function panes(p: Palette): string {
  const top = WIN.y + BAR * 2;
  const h = WIN.h - BAR * 2;
  const parts = [
    rect({ x: WIN.x, y: top, w: SIDE + PAGES, h }, { fill: p.c('surface.app') }),
    line([WIN.x + SIDE, top], [WIN.x + SIDE, top + h], p.c('border.subtle')),
    line([WIN.x + SIDE + PAGES, top], [WIN.x + SIDE + PAGES, top + h], p.c('border.subtle')),
  ];
  TREE.forEach(([label, depth, pen, selected], i) => {
    const ty = top + 10 + i * 26;
    if (selected)
      parts.push(rect({ x: WIN.x + 6, y: ty, w: SIDE - 12, h: 24 }, { fill: p.c('surface.selected'), r: 5 }));
    parts.push(
      depth === 0
        ? rect({ x: WIN.x + 16, y: ty + 7, w: 10, h: 10 }, { fill: p.pen(pen), r: 2.5 })
        : circle(WIN.x + 30, ty + 12, 3.5, p.pen(pen)),
      text(WIN.x + (depth === 0 ? 32 : 38), ty + 16, label, { size: 11, fill: p.c('text.primary') }),
    );
  });
  parts.push(
    text(WIN.x + 14, top + h - 14, 'Trash', { size: 11, fill: p.c('text.secondary') }),
    plantPot(p, WIN.x + SIDE - 54, top + h - 14),
  );
  PAGE_LIST.forEach(([title, date, selected], i) => {
    const py = top + 10 + i * 46;
    if (selected)
      parts.push(rect({ x: WIN.x + SIDE + 6, y: py, w: PAGES - 12, h: 42 }, { fill: p.c('surface.selected'), r: 5 }));
    parts.push(
      text(WIN.x + SIDE + 16, py + 18, title, { size: 11, weight: 500, fill: p.c('text.primary') }),
      text(WIN.x + SIDE + 16, py + 33, date, { size: 11, fill: p.c('text.muted') }),
    );
  });
  return parts.join('');
}

function page(p: Palette): string {
  const left = WIN.x + SIDE + PAGES;
  const top = WIN.y + BAR * 2;
  const w = WIN.x + WIN.w - left;
  const h = WIN.h - BAR * 2;
  const x = left + 28;
  const body = { size: 12, fill: p.c('text.primary'), font: 'reading' as const };
  const bullets = [
    'Prophase: the chromosomes coil up',
    'Metaphase: they line up in the middle',
    'Anaphase: the sister chromatids pull apart',
  ];
  const bars = [72, 56, 40];
  return [
    rect({ x: left, y: top, w, h }, { fill: p.c('surface.page') }),
    text(x, top + 44, 'Mitosis', { size: 26, weight: 700, fill: p.c('text.primary'), font: 'reading' }),
    rect({ x, y: top + 54, w: 36, h: 2 }, { fill: p.c('accent.clay') }),
    text(x, top + 72, 'Changed Sep 23, 2026', { size: 11, fill: p.c('text.muted') }),
    rect({ x: x - 4, y: top + 90, w: 150, h: 22 }, { fill: p.highlighter('Honey'), r: 3, opacity: 0.6 }),
    text(x, top + 106, 'Phases of mitosis', { size: 15, weight: 700, fill: p.c('text.primary'), font: 'reading' }),
    ...bullets.flatMap((item, i) => [
      circle(x + 4, top + 134 + i * 22, 2.5, p.c('accent.clay')),
      text(x + 16, top + 138 + i * 22, item, body),
    ]),
    ink(`M${x + 246} ${top + 150}a46 14 0 1 0 92 0a46 14 0 1 0-92 0`, p.pen('Indigo'), 2.2, 'circled'),
    arrow(
      onEllipse(x + 292, top + 150, 46, 14, 100),
      [x + 284, top + 200],
      [x + 240, top + 196],
      [x + 196, top + 198],
      p.pen('Fern'),
    ),
    ...bars.map((bh, i) =>
      rect(
        { x: x + 12 + i * 34, y: top + 330 - bh, w: 24, h: bh },
        { fill: p.pen(i === 1 ? 'Amber' : 'Indigo'), r: 2 },
      ),
    ),
    line([x, top + 330], [x + 120, top + 330], p.c('border.control')),
    text(x, top + 224, 'Sales, Cost by Month', { size: 11, weight: 600, fill: p.c('text.primary') }),
    ink(`M${x + 170} ${top + 330}c20-10 30-90 60-92s40 40 70 12`, p.pen('Brick'), 2.4),
    text(x + 214, top + 218, 'peak!', { size: 14, fill: p.pen('Brick'), italic: true, font: 'reading' }),
    text(left + 12, top + h - 8, '57 words · 1 min read', { size: 11, fill: p.c('text.muted') }),
  ].join('');
}

export function socialPreview(): string {
  const p = palette('light');
  const tagline = { size: 28, fill: p.c('text.secondary') };
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640" role="img" aria-labelledby="title" data-safe-margin="40">`,
    `<title id="title">OpenNote: writing, drawing, and recording in one open-source notebook</title>`,
    `<defs><filter id="lift" x="-10%" y="-10%" width="120%" height="130%">`,
    `<feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#2B2521" flood-opacity="0.18"/></filter></defs>`,
    ambientCanvas(p, { x: 0, y: 0, w: 1280, h: 640 }),
    `<g font-family="'Atkinson Hyperlegible Next', 'Segoe UI', 'DejaVu Sans', sans-serif">`,
    text(80, 150, 'OpenNote', { size: 80, weight: 700, fill: p.c('text.primary') }),
    text(80, 206, 'Writing, drawing, and recording', tagline),
    text(80, 244, 'in one open-source notebook.', tagline),
    text(80, 300, 'Local-first  ·  Works offline  ·  Free and open source', {
      size: 19,
      weight: 700,
      fill: p.c('accent.primary'),
    }),
    `</g>`,
    `<g data-important="desk by the window">${deskScene(p, 80, 372, 1.3)}</g>`,
    `<g filter="url(#lift)" data-important="workspace">`,
    rect(WIN, { fill: p.c('surface.app'), stroke: p.c('border.subtle'), r: 14 }),
    `<clipPath id="win"><rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" rx="14"/></clipPath>`,
    `<g clip-path="url(#win)" font-family="'Atkinson Hyperlegible Next', 'Segoe UI', 'DejaVu Sans', sans-serif">`,
    titleAndTabs(p),
    panes(p),
    page(p),
    `</g></g>`,
    `</svg>`,
    '',
  ].join('\n');
}
