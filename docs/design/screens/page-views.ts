// Page views: the paginated (print layout) view with charts, and a page during audio recording.

import {
  type Palette,
  arrow,
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
  HOME_TOOLS,
  VIEW_TOOLS,
  commandBar,
  editorBackground,
  iconButton,
  pageHeader,
  propertiesChip,
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
  parts.push(arrow([x + 316, y - 2], [x + 336, y - 8], [x + 354, y + 4], [x + 352, y + 22], p.pen('Brick'), 2.5));
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

function recordingBlock(p: Palette, x: number, y: number): string {
  const w = 720;
  const wave = Array.from({ length: 36 }, (_, i) =>
    rect(
      { x: x + 250 + i * 6, y: y + 40 - ((i * 7) % 11), w: 3, h: ((i * 7) % 11) * 2 + 2 },
      { fill: p.c('text.muted'), r: 1.5 },
    ),
  );
  return [
    rect({ x, y, w, h: 80 }, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 12 }),
    circle(x + 26, y + 40, 7, p.c('status.recording')),
    text(x + 44, y + 45, 'Recording', { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(x + 140, y + 45, '12:48', { size: 14, fill: p.c('text.primary'), font: 'mono' }),
    ...wave,
    pillButton(p, x + w - 190, y + 24, 80, 'Pause'),
    pillButton(p, x + w - 100, y + 24, 80, 'Stop'),
  ].join('');
}

function pillButton(p: Palette, x: number, y: number, w: number, label: string): string {
  return [
    '<g data-fit="6" data-center="both">',
    rect({ x, y, w, h: 32 }, { stroke: p.c('border.control'), r: 8 }),
    text(x + w / 2, y + 21, label, { size: 13, fill: p.c('text.primary'), anchor: 'middle' }),
    '</g>',
  ].join('');
}

function recordingNotes(p: Palette, x: number, y: number): string {
  const body = { size: 15, fill: p.c('text.primary'), font: 'reading' as const };
  return [
    text(x, y, 'Osmosis moves water across a membrane', body),
    text(x, y + 28, 'The cell swells when the water outside is purer than the water inside', body),
    ink(`M${x} ${y + 150}l0-80M${x} ${y + 150}l200 0`, p.pen('Ink'), 2),
    ink(`M${x + 10} ${y + 140}c50-10 70-60 100-64s50 14 80 18`, p.pen('Indigo')),
    text(x + 130, y + 80, 'Vmax', { size: 16, fill: p.pen('Indigo'), italic: true, font: 'reading' }),
    rect({ x: x - 2, y: y + 176, w: 300, h: 22 }, { fill: p.highlighter('Mint'), r: 3, opacity: 0.6 }),
    text(x, y + 192, 'Question for Thursday: how does this differ from diffusion?', body),
  ].join('');
}

export function recording(): Screen {
  const p = palette('light');
  const pages = [
    { title: 'Lecture 6: Enzymes', meta: 'Sep 30, 2026', selected: true },
    { title: 'Lecture 5: Proteins', meta: 'Sep 25, 2026' },
  ];
  const tree = [
    { label: 'Biology 101', depth: 0, kind: 'notebook' as const, color: p.pen('Fern') },
    { label: 'Lectures', depth: 1, kind: 'section' as const, color: p.pen('Fern'), selected: true },
  ];
  const x = EDITOR_X + 48;
  const body = [
    ...standardWindow(p, {
      title: { breadcrumb: 'Biology 101 › Lectures › Lecture 6: Enzymes', recording: 'Recording 12:48' },
      tab: 'Home',
      tools: [{ label: 'Pause', active: true }, { label: 'Stop' }, { label: 'Options' }, ...HOME_TOOLS.slice(2)],
      tree,
      pages,
    }),
    editorBackground(p),
    propertiesChip(p, WIDE.width - 52, BODY_TOP + 8),
    pageHeader(p, x, BODY_TOP + 64, 'Lecture 6: Enzymes', 'Changed Sep 30, 2026'),
    recordingBlock(p, x, BODY_TOP + 120),
    recordingNotes(p, x, BODY_TOP + 250),
    ...windowAnnotations(),
    region({ x: 1104, y: 6, w: 132, h: 28 }, ''),
    tag(900, 116, 'Title bar shows Recording and the time', NOTE.region),
    tag(x, BODY_TOP + 222, 'Recording block: takes the audio’s place in the page, never covers the title', NOTE.region),
    tag(x, BODY_TOP + 520, 'Writing and drawing while recording are time-stamped', NOTE.region),
    tag(x, BODY_TOP + 546, 'Later, Alt+click a word or stroke to hear when you wrote it', NOTE.region),
  ];
  return makeScreen({
    file: '06-recording.svg',
    title: 'Recording audio linked to notes',
    background: p.c('surface.app'),
    body,
  });
}
