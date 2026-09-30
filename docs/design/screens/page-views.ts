// Page views: the paginated (print layout) view with charts, and a page during audio recording.

import {
  type Palette,
  circle,
  ink,
  keepOut,
  line,
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
  EDITOR_X,
  WIDE,
  commandBar,
  editorBackground,
  iconButton,
  standardWindow,
  titleBar,
  windowAnnotations,
} from '../lib/chrome.ts';
import { type Screen, makeScreen } from './screen.ts';

const SCALE = 0.62;
const PAGE = { w: Math.round(816 * SCALE), h: Math.round(1056 * SCALE), margin: Math.round(96 * SCALE) };
const RAIL = 48;
const PAGE_X = RAIL + (WIDE.width - RAIL - PAGE.w) / 2;
const PAGE_Y = BODY_TOP + 28;

const VIEW_TOOLS = [
  { label: 'Infinite' },
  { label: 'Pages', active: true },
  { label: 'Letter ▾' },
  { label: 'Margins: Normal ▾' },
  { label: 'Paper: Lined ▾' },
  { label: '+ Page break' },
  { label: '100% ▾' },
];

function rail(p: Palette): string {
  return [
    rect({ x: 0, y: BODY_TOP, w: RAIL, h: WIDE.height - BODY_TOP }, { fill: p.c('surface.app') }),
    line([RAIL, BODY_TOP], [RAIL, WIDE.height], p.c('border.subtle')),
    ...['☰', '▤', '⌕'].map((glyph, i) => iconButton(p, 8, BODY_TOP + 12 + i * 44, glyph, i === 1)),
  ].join('');
}

function sheet(p: Palette, y: number, number: number): string {
  const ruled = [];
  for (let ly = y + PAGE.margin + 40; ly < y + PAGE.h - PAGE.margin; ly += 20)
    ruled.push(line([PAGE_X, ly], [PAGE_X + PAGE.w, ly], p.c('border.subtle')));
  return [
    rect({ x: PAGE_X, y, w: PAGE.w, h: PAGE.h }, { fill: p.c('surface.page'), shadow: true }),
    ...ruled,
    y + PAGE.h - 24 < WIDE.height
      ? text(PAGE_X + PAGE.w / 2, y + PAGE.h - 24, String(number), {
          size: 11,
          fill: p.c('text.muted'),
          anchor: 'middle',
        })
      : '',
  ].join('');
}

function dataTable(p: Palette, x: number, y: number): string {
  const rows = [
    ['Light (lux)', 'Trial 1', 'Trial 2'],
    ['1,000', '4', '5'],
    ['5,000', '11', '12'],
    ['10,000', '18', '17'],
    ['20,000', '19', '20'],
  ];
  const parts = [
    rect({ x, y, w: 386, h: rows.length * 22 }, { fill: p.c('surface.page'), stroke: p.c('border.control') }),
  ];
  rows.forEach((row, r) => {
    if (r > 0) parts.push(line([x, y + r * 22], [x + 386, y + r * 22], p.c('border.subtle')));
    row.forEach((cell, c) =>
      parts.push(
        text(x + 10 + c * 128, y + 15 + r * 22, cell, {
          size: 11,
          weight: r === 0 ? 600 : 400,
          fill: p.c('text.primary'),
        }),
      ),
    );
  });
  return parts.join('');
}

function barChart(p: Palette, x: number, y: number): string {
  const values = [4.5, 11.5, 17.5, 19.5];
  const parts = [
    text(x, y, 'O₂ bubbles per minute', { size: 12, weight: 600, fill: p.c('text.primary') }),
    line([x + 30, y + 16], [x + 30, y + 150], p.c('border.control')),
    line([x + 30, y + 150], [x + 380, y + 150], p.c('border.control')),
  ];
  values.forEach((v, i) => {
    const h = v * 6.4;
    parts.push(rect({ x: x + 60 + i * 80, y: y + 150 - h, w: 44, h }, { fill: p.c('accent.primary'), r: 3 }));
    parts.push(
      text(x + 82 + i * 80, y + 166, ['1k', '5k', '10k', '20k'][i], {
        size: 11,
        fill: p.c('text.secondary'),
        anchor: 'middle',
      }),
    );
  });
  parts.push(ink(`M${x + 300} ${y + 10}c20 0 40 4 50 20`, p.pen('Brick'), 2.5));
  parts.push(text(x + 250, y + 8, 'plateau!', { size: 15, fill: p.pen('Brick'), italic: true, font: 'reading' }));
  return parts.join('');
}

function pageOneContent(p: Palette): string {
  const x = PAGE_X + PAGE.margin;
  const y = PAGE_Y + PAGE.margin;
  return [
    text(x, y + 22, 'Photosynthesis lab', { size: 22, weight: 600, fill: p.c('text.primary') }),
    text(x, y + 40, 'Tuesday, Sep 16, 2026', { size: 11, fill: p.c('text.muted') }),
    textLines(x, y + 60, [380, 340, 360], p.c('border.control'), 20),
    dataTable(p, x, y + 124),
    barChart(p, x, y + 262),
    textLines(x, y + 454, [370, 300], p.c('border.control'), 20),
  ].join('');
}

export function paginated(): Screen {
  const p = palette('light');
  const page2 = PAGE_Y + PAGE.h + 28;
  const x = PAGE_X + PAGE.margin;
  const side = PAGE_X + PAGE.w + 32;
  const body = [
    titleBar(p, { breadcrumb: 'Biology 101  ›  Labs  ›  Photosynthesis lab' }),
    commandBar(p, 'View', VIEW_TOOLS),
    rail(p),
    rect({ x: RAIL, y: BODY_TOP, w: WIDE.width - RAIL, h: WIDE.height - BODY_TOP }, { fill: p.c('surface.sunken') }),
    sheet(p, PAGE_Y, 1),
    pageOneContent(p),
    sheet(p, page2, 2),
    text(x, page2 + PAGE.margin + 22, 'Discussion', { size: 22, weight: 600, fill: p.c('text.primary') }),
    text(PAGE_X + PAGE.w / 2, page2 - 10, 'Page 2 of 3', { size: 12, fill: p.c('text.muted'), anchor: 'middle' }),
    keepOut({ x: PAGE_X, y: PAGE_Y, w: PAGE.w, h: PAGE.margin }, 'Print margin 1 in: content stays inside', [
      side,
      PAGE_Y + 34,
    ]),
    keepOut({ x: PAGE_X, y: PAGE_Y + PAGE.h - PAGE.margin, w: PAGE.w, h: PAGE.margin }, ''),
    keepOut({ x: PAGE_X, y: PAGE_Y + PAGE.margin, w: PAGE.margin, h: PAGE.h - 2 * PAGE.margin }, ''),
    keepOut(
      { x: PAGE_X + PAGE.w - PAGE.margin, y: PAGE_Y + PAGE.margin, w: PAGE.margin, h: PAGE.h - 2 * PAGE.margin },
      '',
    ),
    region({ x: PAGE_X - 6, y: PAGE_Y - 6, w: PAGE.w + 12, h: PAGE.h + 12 }, 'Letter 8.5×11 in, shown at 62%'),
    tag(side, PAGE_Y + 210, 'Smart table: sort, filter, formulas', NOTE.region),
    tag(side, PAGE_Y + 330, 'Chart block: redraws when the table changes', NOTE.region),
    tag(side, page2 - 6, 'Gap between sheets = page break; blocks never split', NOTE.region),
    tag(8, WIDE.height - 20, 'Panes collapse to a 48 px rail', NOTE.region),
    tag(PAGE_X - 330, BODY_TOP + 60, 'View tab: Infinite ↔ Pages switch, paper and breaks', NOTE.region),
  ];
  return makeScreen({
    file: '05-paginated-view.svg',
    title: 'Paginated view with page breaks, a table and a chart',
    background: p.c('surface.app'),
    body,
  });
}

const TRANSCRIPT_W = 320;

function recordingBar(p: Palette): string {
  const x = EDITOR_X;
  const w = WIDE.width - EDITOR_X;
  const y = BODY_TOP;
  const wave = Array.from({ length: 20 }, (_, i) =>
    rect(
      { x: x + 370 + i * 6, y: y + 24 - ((i * 7) % 11), w: 3, h: ((i * 7) % 11) * 2 + 2 },
      { fill: p.c('text.muted'), r: 1.5 },
    ),
  );
  return [
    rect({ x, y, w, h: 48 }, { fill: p.c('surface.raised') }),
    line([x, y + 48], [x + w, y + 48], p.c('border.subtle')),
    circle(x + 24, y + 24, 7, p.c('status.recording')),
    text(x + 40, y + 29, 'Recording', { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(x + 122, y + 29, '12:48', { size: 14, fill: p.c('text.primary'), font: 'mono' }),
    text(x + 180, y + 29, 'Microphone + system audio', { size: 12, fill: p.c('text.muted') }),
    ...wave,
    button(p, x + w - 300, y + 10, '❚❚ Pause'),
    button(p, x + w - 206, y + 10, '■ Stop'),
    button(p, x + w - 112, y + 10, 'Transcript', true),
  ].join('');
}

function button(p: Palette, x: number, y: number, label: string, active = false): string {
  const fill = active ? p.c('accent.primarySubtle') : 'none';
  return (
    rect({ x, y, w: 88, h: 28 }, { fill, stroke: p.c('border.control'), r: 8 }) +
    text(x + 44, y + 19, label, { size: 12, fill: p.c(active ? 'text.link' : 'text.primary'), anchor: 'middle' })
  );
}

function transcript(p: Palette): string {
  const x = WIDE.width - TRANSCRIPT_W;
  const y = BODY_TOP + 48;
  const entries = [
    ['Speaker 1 · 12:02', [250, 270, 180]],
    ['Speaker 2 · 12:10', [240, 120]],
    ['Speaker 1 · 12:31', [260, 250, 210]],
    ['Speaker 1 · 12:47', [200]],
  ] as const;
  const parts = [
    rect({ x, y, w: TRANSCRIPT_W, h: WIDE.height - y }, { fill: p.c('surface.app') }),
    line([x, y], [x, WIDE.height], p.c('border.subtle')),
    text(x + 20, y + 32, 'Transcript', { size: 15, weight: 600, fill: p.c('text.primary') }),
    text(x + 20, y + 52, 'Runs on this device', { size: 12, fill: p.c('text.muted') }),
  ];
  let ty = y + 88;
  for (const [who, lines] of entries) {
    parts.push(text(x + 20, ty, who, { size: 12, weight: 600, fill: p.c('text.secondary') }));
    parts.push(textLines(x + 20, ty + 10, [...lines], p.c('border.control')));
    ty += 34 + lines.length * 16;
  }
  return parts.join('');
}

function recordingNotes(p: Palette): string {
  const x = EDITOR_X + 72;
  const y = BODY_TOP + 120;
  const gutter = (ty: number, t: string) =>
    text(EDITOR_X + 16, ty, t, { size: 11, fill: p.c('text.link'), font: 'mono' });
  return [
    text(x, y, 'Lecture 6: Enzymes', { size: 30, weight: 600, fill: p.c('text.primary') }),
    text(x, y + 26, 'Today · 12:00 PM · Recording linked', { size: 13, fill: p.c('text.muted') }),
    gutter(y + 76, '12:02'),
    textLines(x, y + 70, [400, 360, 300], p.c('border.control')),
    gutter(y + 140, '12:10'),
    ink(`M${x} ${y + 260}l0-110M${x} ${y + 260}l230 0`, p.pen('Ink'), 2),
    ink(`M${x + 10} ${y + 250}c60-10 80-90 120-95s60 20 90 25`, p.pen('Indigo')),
    text(x + 150, y + 150, 'Vmax', { size: 16, fill: p.pen('Indigo'), italic: true, font: 'reading' }),
    gutter(y + 300, '12:31'),
    textLines(x, y + 294, [380, 340], p.c('border.control')),
    gutter(y + 350, '12:47'),
    rect({ x: x - 2, y: y + 338, w: 260, h: 20 }, { fill: p.highlighter('Mint'), r: 3 }),
    textLines(x, y + 345, [250], p.c('border.control')),
  ].join('');
}

export function recording(): Screen {
  const p = palette('light');
  const pages = [
    { title: 'Lecture 6: Enzymes', meta: 'Recording now', selected: true },
    { title: 'Lecture 5: Proteins', meta: 'Sep 25 · 1 recording' },
  ];
  const tree = [
    { label: 'Biology 101', depth: 0, kind: 'notebook' as const, color: p.pen('Fern') },
    { label: 'Lectures', depth: 1, kind: 'section' as const, color: p.pen('Fern'), selected: true },
  ];
  const body = [
    ...standardWindow(p, {
      title: { breadcrumb: 'Biology 101  ›  Lectures  ›  Lecture 6: Enzymes' },
      tab: 'Home',
      tools: [{ label: '● Record', active: true }, { label: 'B' }, { label: 'I' }, { label: '• List' }],
      tree,
      pagesHeading: 'Lectures',
      pages,
    }),
    editorBackground(p),
    recordingBar(p),
    recordingNotes(p),
    transcript(p),
    ...windowAnnotations(),
    region({ x: EDITOR_X + 2, y: BODY_TOP + 2, w: WIDE.width - EDITOR_X - 4, h: 44 }, ''),
    tag(EDITOR_X + 72, BODY_TOP + 70, 'Recording bar 48, pinned above the page; never covers the title', NOTE.region),
    region({ x: EDITOR_X + 4, y: BODY_TOP + 176, w: 52, h: 290 }, ''),
    tag(
      EDITOR_X + 16,
      BODY_TOP + 540,
      'Time gutter 56: tap a time, or any stroke later, to play from that moment',
      NOTE.region,
    ),
    region(
      { x: WIDE.width - TRANSCRIPT_W + 2, y: BODY_TOP + 460, w: TRANSCRIPT_W - 4, h: 60 },
      'Transcript panel 320 (optional)',
    ),
  ];
  return makeScreen({
    file: '06-recording.svg',
    title: 'Recording audio linked to notes',
    background: p.c('surface.app'),
    body,
  });
}
