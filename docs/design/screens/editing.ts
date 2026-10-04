// The page itself, as built in beta 4. The wireframes cover the formatting buttons in the Home tab, the Draw tab,
// the View tab, smart tables with charts, math and the grapher, the search panel, and the linked pages pane.

import {
  type Palette,
  NOTE,
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
} from '../lib/svg.ts';
import {
  BODY_TOP,
  DRAW_TOOLS,
  EDITOR_X,
  HOME_TOOLS,
  INSERT_TOOLS,
  VIEW_TOOLS,
  WIDE,
  editorBackground,
  pageHeader,
  propertiesChip,
  standardWindow,
  windowAnnotations,
} from '../lib/chrome.ts';
import type { Tool } from '../lib/chrome.ts';
import { button, card, chip, field, scrim } from '../lib/parts.ts';
import { type Screen, makeScreen } from './screen.ts';
import { PAGES, tree } from './workspace.ts';

const X = EDITOR_X + 48;
const CRUMB = 'Biology 101 › Lectures › Mitosis';

function win(p: Palette, tab: string, tools: Tool[], page = 'Mitosis', crumb = CRUMB): string[] {
  return standardWindow(p, {
    title: { breadcrumb: crumb },
    tab,
    tools,
    tree: tree(p),
    pages: PAGES.map((item) => ({ ...item, selected: item.title === page })),
  });
}

function finish(file: string, title: string, p: Palette, body: string[]): Screen {
  return makeScreen({ file, title, background: p.c('surface.app'), body });
}

/** Typed notes as the page shows them: a heading, a sentence, a list, and a page link. */
function notes(p: Palette, x: number, y: number): string {
  const body = { size: 15, fill: p.c('text.primary'), font: 'reading' as const };
  const bullets = [
    'Prophase: the chromosomes coil up and the nuclear envelope breaks down',
    'Metaphase: the chromosomes line up along the middle of the cell',
    'Anaphase: the sister chromatids pull apart',
    'Telophase: two new nuclei form',
  ];
  return [
    text(x, y, 'Phases of mitosis', { size: 22, weight: 700, fill: p.c('text.primary'), font: 'reading' }),
    line([x, y + 10], [x + 660, y + 10], p.c('border.subtle')),
    text(x, y + 44, 'A cell divides in four steps, and each one has a job.', body),
    ...bullets
      .map((item, i) => [
        circle(x + 8, y + 76 + i * 28, 3, p.c('accent.clay')),
        text(x + 24, y + 81 + i * 28, item, body),
      ])
      .flat(),
    text(x, y + 212, 'Question for Thursday: how does this differ from', body),
    text(x + 324, y + 212, '[[Meiosis]]', { ...body, fill: p.c('text.link') }),
    text(x + 404, y + 212, '?', body),
  ].join('');
}

function pageFrame(p: Palette): string[] {
  return [
    editorBackground(p),
    propertiesChip(p, WIDE.width - 52, BODY_TOP + 8),
    pageHeader(p, X, BODY_TOP + 64, 'Mitosis'),
  ];
}

/** A menu: a raised list with one row highlighted. */
function menu(p: Palette, x: number, y: number, w: number, items: string[], hot = -1, checked = -1): string {
  const parts = [
    rect(
      { x, y, w, h: items.length * 32 + 12 },
      { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 10, shadow: true },
    ),
  ];
  items.forEach((item, i) => {
    if (i === hot)
      parts.push(rect({ x: x + 6, y: y + 6 + i * 32, w: w - 12, h: 30 }, { fill: p.c('surface.hover'), r: 6 }));
    parts.push(
      text(x + 34, y + 27 + i * 32, item, { size: 13, fill: p.c('text.primary') }),
      i === checked ? text(x + 16, y + 27 + i * 32, '●', { size: 11, fill: p.c('accent.primary') }) : '',
    );
  });
  return parts.join('');
}

export function pageEditor(): Screen {
  const p = palette('light');
  const y = BODY_TOP + 200;
  const slash = menu(
    p,
    X + 40,
    y + 250,
    250,
    ['Heading', 'Bulleted list', 'Insert table', 'Insert equation', 'Insert graph'],
    2,
  );
  const body = [
    ...win(p, 'Home', HOME_TOOLS),
    ...pageFrame(p),
    notes(p, X, y - 36),
    text(X, y + 200, '/table', { size: 15, fill: p.c('text.primary'), font: 'reading' }),
    slash,
    ...windowAnnotations(),
    region({ x: 478, y: WIDE.title + 4, w: 420, h: 36 }, ''),
    tag(880, BODY_TOP + 118, 'Formatting buttons: Bold to Highlight', NOTE.region),
    tag(1000, BODY_TOP + 130, 'Properties chip: tags and page details', NOTE.region),
    tag(X + 380, y + 250, 'Slash menu: type / for any block', NOTE.region),
    tag(X + 680, y + 120, 'Type [[ to link a page', NOTE.region),
    tag(EDITOR_X + 12, WIDE.height - 28, 'Status line: words and reading time', NOTE.region),
  ];
  return finish('17-page-editor.svg', 'The page editor with the formatting buttons', p, body);
}

/** Ink on the page: a highlighter band, a circled link, an arrow, and a pencil sketch. */
function inkMarks(p: Palette, x: number, y: number): string {
  return [
    rect({ x: x - 6, y: y - 22, w: 214, h: 30 }, { fill: p.highlighter('Honey'), r: 4, opacity: 0.55 }),
    ink(`M${x + 308} ${y + 203}a56 16 0 1 0 112 0a56 16 0 1 0-112 0`, p.pen('Indigo'), 3),
    ink(`M${x + 340} ${y + 226}c-40 20-80 34-116 44m0 0l22-4m-22 4l8-20`, p.pen('Fern'), 3),
    ink(`M${x + 20} ${y + 300}c0-50 40-80 90-80s90 30 90 80-40 70-90 70-90-20-90-70z`, p.pen('Walnut'), 2.5),
    ink(`M${x + 110} ${y + 222}v146M${x + 36} ${y + 300}c20-20 30 20 50 0s30 20 50 0 30 20 50 0`, p.pen('Walnut'), 2),
    ink(`M${x + 250} ${y + 300}c20-14 30 14 50 0s30 14 50 0 30 14 50 0 30 14 50 0`, p.pen('Ink'), 2.5),
  ].join('');
}

export function drawTab(): Screen {
  const p = palette('light');
  const y = BODY_TOP + 200;
  const items = [
    'Lasso select',
    'Insert space',
    'Ruler',
    'Add text to shape',
    'Ink to shape',
    'Replay ink',
    'Describe drawing',
    'Zoom writing box',
    'Canvas lock',
    'Pen',
  ];
  const pens = ['Ink', 'Indigo', 'Brick', 'Fern', 'Walnut'];
  const strip = [
    rect(
      { x: 880, y: WIDE.height - 150, w: 520, h: 78 },
      { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 12, shadow: true },
    ),
    text(896, WIDE.height - 122, 'At 1600 px and wider the bar also holds:', { size: 12, fill: p.c('text.secondary') }),
    ...pens.map((pen, i) =>
      circle(910 + i * 34, WIDE.height - 96, 9, p.pen(pen), i === 1 ? p.c('accent.primary') : undefined),
    ),
    circle(910 + 5 * 34, WIDE.height - 96, 9, p.highlighter('Honey')),
    text(1180, WIDE.height - 91, 'Color', { size: 13, fill: p.c('text.primary') }),
    text(1240, WIDE.height - 91, 'Width', { size: 13, fill: p.c('text.primary') }),
  ];
  const body = [
    ...win(p, 'Draw', DRAW_TOOLS),
    ...pageFrame(p),
    notes(p, X, y - 36),
    inkMarks(p, X, y - 36 + 4),
    menu(p, 1170, BODY_TOP + 2, 234, items, 9),
    ...strip,
    ...windowAnnotations(),
    tag(X, BODY_TOP + 580, 'Ink sits over the text: Select and type keeps typing and clicking working', NOTE.region),
    tag(
      X,
      BODY_TOP + 606,
      'Highlighter, pens, and pencil in their palette colors; strokes are saved with the page',
      NOTE.region,
    ),
    tag(X, BODY_TOP + 632, 'More holds what does not fit; Pen opens the slots', NOTE.region),
  ];
  return finish('18-draw-tab.svg', 'The Draw tab with ink on a page', p, body);
}

export function viewTab(): Screen {
  const p = palette('light');
  const y = BODY_TOP + 200;
  const rules: string[] = [];
  for (let ly = BODY_TOP + 120; ly < WIDE.height - 40; ly += 28)
    rules.push(line([EDITOR_X, ly], [EDITOR_X + 832 - 36, ly], p.c('border.subtle')));
  const items = [
    'Blank',
    'Lined, narrow',
    'Lined, college',
    'Lined, wide',
    'Grid, 5 mm',
    'Grid, quarter inch',
    'Grid, 1 cm',
    'Dot grid',
  ];
  const body = [
    ...win(p, 'View', VIEW_TOOLS),
    ...pageFrame(p),
    ...rules,
    notes(p, X, y - 36),
    menu(p, 1170, BODY_TOP + 2, 234, items, 2, 2),
    ...windowAnnotations(),
    tag(X, BODY_TOP + 560, 'Lined, grid, and dot paper: typed text sits on the rules like handwriting', NOTE.region),
    tag(X, BODY_TOP + 620, 'Pane buttons show and hide the notebooks and pages panes', NOTE.region),
    tag(X, BODY_TOP + 590, 'Infinite canvas or pages with breaks; Paper picks Letter, A4, A5, or Legal', NOTE.region),
  ];
  return finish('19-view-tab.svg', 'The View tab with lined paper', p, body);
}

function table(p: Palette, x: number, y: number): string {
  const rows = [
    ['Month', 'Sales', 'Cost'],
    ['Jan', '120', '80'],
    ['Feb', '150', '90'],
    ['Mar', '90', '70'],
  ];
  const parts = [
    rect({ x, y, w: 360, h: rows.length * 30 }, { fill: p.c('surface.page'), stroke: p.c('border.control') }),
  ];
  parts.push(rect({ x, y, w: 360, h: 30 }, { fill: p.c('surface.sunken'), stroke: p.c('border.control') }));
  rows.forEach((r, i) => {
    if (i > 0) parts.push(line([x, y + i * 30], [x + 360, y + i * 30], p.c('border.control')));
    r.forEach((cell, c) =>
      parts.push(
        text(c === 0 ? x + 12 : x + c * 120 + 108, y + 20 + i * 30, cell, {
          size: 13,
          weight: i === 0 ? 700 : 400,
          fill: p.c('text.primary'),
          anchor: c === 0 ? 'start' : 'end',
        }),
      ),
    );
  });
  parts.push(
    line([x + 120, y], [x + 120, y + 120], p.c('border.control')),
    line([x + 240, y], [x + 240, y + 120], p.c('border.control')),
  );
  return parts.join('');
}

function barChart(p: Palette, x: number, y: number): string {
  const sales = [120, 150, 90];
  const cost = [80, 90, 70];
  const parts = [
    text(x, y, 'Sales, Cost by Month', { size: 13, weight: 600, fill: p.c('text.primary') }),
    text(x + 560, y, 'Chart options', { size: 12, fill: p.c('text.link'), anchor: 'end' }),
    text(x + 660, y, 'Remove chart', { size: 12, fill: p.c('text.link'), anchor: 'end' }),
    line([x + 30, y + 16], [x + 30, y + 190], p.c('border.control')),
    line([x + 30, y + 190], [x + 660, y + 190], p.c('border.control')),
  ];
  ['Jan', 'Feb', 'Mar'].forEach((m, i) => {
    const gx = x + 80 + i * 200;
    parts.push(
      rect({ x: gx, y: y + 190 - sales[i], w: 60, h: sales[i] }, { fill: p.pen('Indigo'), r: 2 }),
      rect({ x: gx + 64, y: y + 190 - cost[i], w: 60, h: cost[i] }, { fill: p.pen('Amber'), r: 2 }),
      text(gx + 62, y + 208, m, { size: 11, fill: p.c('text.secondary'), anchor: 'middle' }),
    );
  });
  parts.push(
    rect({ x: x + 240, y: y + 224, w: 12, h: 12 }, { fill: p.pen('Indigo'), r: 2 }),
    text(x + 258, y + 235, 'Sales', { size: 12, fill: p.c('text.primary') }),
    rect({ x: x + 320, y: y + 224, w: 12, h: 12 }, { fill: p.pen('Amber'), r: 2 }),
    text(x + 338, y + 235, 'Cost', { size: 12, fill: p.c('text.primary') }),
  );
  return parts.join('');
}

export function tablesCharts(): Screen {
  const p = palette('light');
  const y = BODY_TOP + 130;
  const dataMenu = menu(p, X + 392, y + 70, 190, ['Sort', 'Filter', 'Insert chart', 'Table only'], 2);
  const body = [
    ...win(p, 'Home', HOME_TOOLS, 'Membranes', 'Biology 101 › Lectures › Membranes'),
    editorBackground(p),
    propertiesChip(p, WIDE.width - 52, BODY_TOP + 8),
    pageHeader(p, X, BODY_TOP + 64, 'Membranes', 'Changed Sep 28, 2026'),
    table(p, X, y),
    text(X, y + 150, 'Data', { size: 12, fill: p.c('text.link') }),
    text(X + 60, y + 150, 'A1', { size: 12, fill: p.c('text.muted') }),
    barChart(p, X, y + 200),
    dataMenu,
    ...windowAnnotations(),
    tag(X + 392, y + 34, 'A cell starting with = is a formula', NOTE.region),
    tag(X + 392, y + 226, 'Data menu: sort, filter, and insert chart', NOTE.region),
    tag(X, y + 470, 'Chart redraws when the table changes', NOTE.region),
    tag(X, y + 496, 'Named for screen readers, with a legend; patterns on request', NOTE.region),
  ];
  return finish('20-tables-charts.svg', 'A smart table with a formula and its chart', p, body);
}

function graph(p: Palette, x: number, y: number, w: number, h: number): string {
  const parts = [rect({ x, y, w, h }, { fill: p.c('surface.page'), stroke: p.c('border.control') })];
  for (let gx = x; gx <= x + w; gx += 30) parts.push(line([gx, y], [gx, y + h], p.c('border.subtle')));
  for (let gy = y; gy <= y + h; gy += 30) parts.push(line([x, gy], [x + w, gy], p.c('border.subtle')));
  const cy = y + h / 2;
  parts.push(
    line([x, cy], [x + w, cy], p.c('text.secondary')),
    line([x + w / 2, y], [x + w / 2, y + h], p.c('text.secondary')),
  );
  let d = '';
  for (let i = 0; i <= 120; i += 1) {
    const px = x + (w * i) / 120;
    const py = cy - Math.sin(((i / 120) * 6 - 3) * 2.1) * (h * 0.32);
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  parts.push(ink(d, p.pen('Indigo'), 2.5));
  return parts.join('');
}

export function mathGrapher(): Screen {
  const p = palette('light');
  const y = BODY_TOP + 130;
  const reading = { size: 15, fill: p.c('text.primary'), font: 'reading' as const };
  const body = [
    ...win(p, 'Insert', INSERT_TOOLS, 'Membranes', 'Biology 101 › Lectures › Membranes'),
    editorBackground(p),
    propertiesChip(p, WIDE.width - 52, BODY_TOP + 8),
    pageHeader(p, X, BODY_TOP + 64, 'Membranes', 'Changed Sep 28, 2026'),
    text(X, y, 'The area under the parabola from 0 to 1 is', reading),
    text(X + 330, y, '∫₀¹ x² dx = ⅓', { ...reading, italic: true }),
    text(X, y + 52, 'Display equation', { size: 12, fill: p.c('text.muted') }),
    text(X + 300, y + 76, '∫₀¹ x² dx = ⅓', {
      size: 24,
      fill: p.c('text.primary'),
      font: 'reading',
      italic: true,
      anchor: 'middle',
    }),
    rect({ x: X, y: y + 112, w: 700, h: 30 }, { fill: p.c('surface.sunken'), r: 4 }),
    text(X + 12, y + 132, 'y = sin(x)', { size: 13, fill: p.c('text.primary'), font: 'mono' }),
    rect({ x: X, y: y + 154, w: 700, h: 32 }, { stroke: p.c('border.control'), r: 6 }),
    circle(X + 14, y + 170, 6, p.pen('Indigo')),
    text(X + 30, y + 175, 'y = a sin(x)', { size: 13, fill: p.c('text.primary'), font: 'mono' }),
    text(X + 350, y + 206, 'Add a function', { size: 13, fill: p.c('text.link'), anchor: 'middle' }),
    graph(p, X, y + 222, 700, 250),
    text(X, y + 496, 'Value of a', { size: 12, fill: p.c('text.secondary') }),
    rect({ x: X + 80, y: y + 490, w: 220, h: 4 }, { fill: p.c('border.subtle'), r: 2 }),
    circle(X + 190, y + 492, 8, p.c('accent.primary')),
    ...windowAnnotations(),
    tag(X + 100, y + 544, 'Alt+= writes an equation in a sentence', NOTE.region),
    tag(X + 100, y + 570, 'Type /equation for display math, shown with KaTeX', NOTE.region),
    tag(X + 100, y + 596, 'The block text is the whole graph', NOTE.region),
    tag(X + 100, y + 622, 'A slider appears for each extra letter', NOTE.region),
    tag(X + 100, y + 648, 'Arrow keys pan; + and − zoom; Shift+arrows read values', NOTE.region),
  ];
  return finish('21-math-grapher.svg', 'An equation and the function grapher', p, body);
}

export function searchPanel(): Screen {
  const p = palette('light');
  const x = 372;
  const y = 90;
  const toggle = (label: string, cx: number) => [
    text(cx, y + 138, label, { size: 13, fill: p.c('text.primary') }),
    rect({ x: cx + label.length * 7 + 10, y: y + 124, w: 40, h: 22 }, { fill: p.c('border.control'), r: 11 }),
    circle(cx + label.length * 7 + 21, y + 135, 8, p.c('surface.page')),
  ];
  const body = [
    ...win(p, 'Home', HOME_TOOLS),
    editorBackground(p),
    pageHeader(p, X, BODY_TOP + 64, 'Mitosis'),
    textLines(X, BODY_TOP + 130, [520, 470, 500, 420, 480], p.c('border.control'), 24),
    scrim(p),
    card(p, { x, y, w: 700, h: 560 }, 'Search'),
    text(x + 24, y + 62, 'Find words in every page. Press Enter to open the highlighted page.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
    field(p, x + 24, y + 76, 652, 'chromosomes'),
    ...toggle('Regular expression', x + 24),
    ...toggle('Titles only', x + 280),
    field(p, x + 460, y + 118, 100, 'Any tag', true),
    field(p, x + 568, y + 118, 108, 'Any time', true),
    text(x + 24, y + 186, 'Save this search', { size: 13, weight: 600, fill: p.c('text.link') }),
    text(x + 24, y + 216, 'Replace…', { size: 13, weight: 600, fill: p.c('text.link') }),
    rect(
      { x: x + 24, y: y + 244, w: 330, h: 120 },
      { fill: p.c('surface.selected'), stroke: p.c('accent.primary'), r: 8, width: 2 },
    ),
    text(x + 40, y + 272, 'Mitosis', { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(x + 40, y + 296, 'Prophase: the', { size: 12, fill: p.c('text.secondary') }),
    text(x + 40 + 78, y + 296, 'chromosomes', { size: 12, weight: 700, fill: p.c('text.primary') }),
    text(x + 40 + 156, y + 296, 'coil up and', { size: 12, fill: p.c('text.secondary') }),
    text(x + 40, y + 316, 'the nuclear envelope breaks down', { size: 12, fill: p.c('text.secondary') }),
    rect({ x: x + 372, y: y + 244, w: 304, h: 290 }, { fill: p.c('surface.page'), stroke: p.c('border.subtle'), r: 8 }),
    text(x + 388, y + 276, 'Mitosis', { size: 16, weight: 700, fill: p.c('text.primary') }),
    text(x + 388, y + 296, 'Changed Sep 30, 2026', { size: 11, fill: p.c('text.muted') }),
    textLines(x + 388, y + 322, [250, 230, 220, 180], p.c('border.control'), 20),
    rect({ x: x + 388, y: y + 396, w: 96, h: 18 }, { fill: p.highlighter('Honey'), r: 3, opacity: 0.6 }),
    textLines(x + 388, y + 402, [90, 200, 150], p.c('border.control'), 20),
    text(x + 24, y + 392, '1 result', { size: 12, fill: p.c('text.muted') }),
    region({ x: x - 6, y: y - 6, w: 712, h: 572 }, ''),
    tag(x, 680, 'Ctrl+Shift+F opens it from anywhere', NOTE.region),
    tag(x, 706, 'Words must all match; quotes, OR, and a minus sign refine it', NOTE.region),
    tag(x, 732, 'Also tag:name, title:word, type:table, and after:7d', NOTE.region),
    tag(x, 758, 'The matched word is bold, so color is never the only signal', NOTE.region),
    tag(x, 784, 'A preview of the page sits beside the results', NOTE.region),
    captionKeepOutOnly(),
  ];
  return finish('22-search-panel.svg', 'The search panel with results and a preview', p, body);
}

function captionKeepOutOnly(): string {
  return keepOut({ x: WIDE.width - 138, y: 0, w: 138, h: 40 }, 'Window buttons 138×40', [WIDE.width - 176, 58]);
}

export function linkedPages(): Screen {
  const p = palette('light');
  const px = WIDE.width - 340;
  const body = [
    ...win(p, 'Home', HOME_TOOLS, 'Meiosis', 'Biology 101 › Lectures › Meiosis'),
    editorBackground(p),
    propertiesChip(p, WIDE.width - 52, BODY_TOP + 8),
    pageHeader(p, X, BODY_TOP + 64, 'Meiosis', 'Changed Sep 21, 2026'),
    text(X + 12, BODY_TOP + 160, 'Start writing', { size: 15, fill: p.c('text.muted'), font: 'reading' }),
    rect({ x: px, y: BODY_TOP, w: 340, h: WIDE.height - BODY_TOP }, { fill: p.c('surface.raised') }),
    line([px, BODY_TOP], [px, WIDE.height], p.c('border.subtle')),
    text(px + 20, BODY_TOP + 34, 'Linked pages', { size: 16, weight: 600, fill: p.c('text.primary') }),
    text(px + 320, BODY_TOP + 34, 'Close', { size: 13, fill: p.c('text.link'), anchor: 'end' }),
    text(px + 20, BODY_TOP + 70, '1 page links here', { size: 12, weight: 600, fill: p.c('text.secondary') }),
    text(px + 20, BODY_TOP + 96, 'Mitosis', { size: 14, weight: 600, fill: p.c('text.link') }),
    text(px + 20, BODY_TOP + 118, 'Question: how does this differ from Meiosis?', {
      size: 12,
      fill: p.c('text.secondary'),
    }),
    text(px + 20, BODY_TOP + 164, 'Pages that mention this title', {
      size: 12,
      weight: 600,
      fill: p.c('text.secondary'),
    }),
    text(px + 20, BODY_TOP + 190, 'Membranes', { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(px + 20, BODY_TOP + 212, 'Meiosis is the other kind of cell division.', {
      size: 12,
      fill: p.c('text.secondary'),
    }),
    button(p, px + 20, BODY_TOP + 228, 80, 'Link', 'secondary'),
    ...windowAnnotations(),
    tag(X, BODY_TOP + 260, 'Ctrl+Alt+G shows the pages that link here', NOTE.region),
    tag(X, BODY_TOP + 286, 'Link turns a plain mention of the title into a [[page link]]', NOTE.region),
    tag(X, BODY_TOP + 312, 'The pane follows the page that is open; Escape closes it', NOTE.region),
    region({ x: px + 4, y: BODY_TOP + 4, w: 332, h: 280 }, ''),
    chip(p, X, BODY_TOP + 340, 'Typing [[ lists pages', false, 170),
  ];
  return finish('23-linked-pages.svg', 'The linked pages pane', p, body);
}
