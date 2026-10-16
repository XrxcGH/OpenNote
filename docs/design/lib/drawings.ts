// The app's drawings in the wireframes: the desk by the window, and the plant at the foot of the notebooks pane.
// Their outlines are the app's own (app/src/ui/illustrations/shapes.ts), and each part is drawn where DESK places
// it. Styles follow illustrations.module.css with the same tokens. Lines stay 1.5 px at every size, as in the app,
// so each part's group divides the width by its scale. Parts carry data-part names for the geometry tests.

import { BOOKS, CANDLE, DESK, NOTEBOOK, PLANT, WINDOW } from '../../../app/src/ui/illustrations/shapes.ts';
import type { Palette } from './svg.ts';

const LINE = 1.5;

const n = (value: number) => Math.round(value * 1000) / 1000;

interface Place {
  at: readonly [number, number];
  scale: number;
}

/** The line style every drawing shares: no fill unless a part asks for one, and round ends and joins. */
const lines = (stroke: string) => `fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round"`;

function shape(d: string, attrs: Record<string, string | number> = {}): string {
  const list = Object.entries(attrs).map(([name, value]) => ` ${name}="${value}"`);
  return `<path d="${d}"${list.join('')}/>`;
}

function dot(c: { cx: number; cy: number; r: number }, attrs: string): string {
  return `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" ${attrs}/>`;
}

/** A group for one part, placed at its spot with its lines at 1.5 px whatever the scale. */
function part(name: string, place: Place, outer: number, body: string[]): string {
  const [x, y] = place.at;
  const width = n(LINE / (outer * place.scale));
  const head = `<g data-part="${name}" transform="translate(${x} ${y}) scale(${place.scale})" stroke-width="${width}">`;
  return [head, ...body, '</g>'].join('');
}

function windowBody(p: Palette, id: string, outer: number): string[] {
  const day = p.theme === 'light';
  const moss = p.c('accent.primary');
  const stops = day
    ? [
        [0, 'accent.candleSubtle'],
        [0.35, 'accent.candleSubtle'],
        [0.6, 'art.candle'],
        [0.85, 'art.dusk'],
      ]
    : [
        [0, 'accent.nightSubtle'],
        [0.45, 'accent.nightSubtle'],
        [0.9, 'art.night'],
      ];
  const spark = p.c('ambient.spark');
  const heavens = day
    ? [dot(WINDOW.sun, `data-part="sun" fill="${spark}" stroke="${p.c('accent.candle')}"`)]
    : [
        shape(WINDOW.stars, { stroke: spark, 'stroke-width': n(2.4 / (outer * DESK.window.scale)) }),
        shape(WINDOW.moon, { fill: spark, stroke: p.c('accent.night') }),
      ];
  return [
    `<defs><linearGradient id="${id}" x2="0" y2="1">`,
    ...stops.map(([offset, token]) => `<stop offset="${offset}" stop-color="${p.c(token as string)}"/>`),
    '</linearGradient></defs>',
    shape(WINDOW.sky, { fill: `url(#${id})`, 'data-part': 'sky' }),
    ...heavens,
    shape(WINDOW.hills, { fill: p.c(day ? 'art.moss' : 'art.night') }),
    shape(WINDOW.bars, { 'data-part': 'window-bars' }),
    shape(WINDOW.vine, { stroke: moss, 'data-part': 'vine' }),
    ...WINDOW.leaves.map((d) => shape(d, { fill: p.c('art.moss'), stroke: moss, 'data-part': 'leaf' })),
    shape(WINDOW.sill, { 'data-part': 'sill' }),
  ];
}

function plantBody(p: Palette): string[] {
  const moss = p.c('accent.primary');
  const leafy = { fill: p.c('art.moss'), stroke: moss };
  return [
    shape(PLANT.pot, { fill: p.c('art.clay'), 'data-part': 'pot' }),
    shape(PLANT.rim),
    shape(PLANT.stem, { stroke: moss }),
    shape(PLANT.trailing, { stroke: moss }),
    ...[...PLANT.leaves, ...PLANT.trailingLeaves].map((d) => shape(d, leafy)),
  ];
}

function booksBody(p: Palette): string[] {
  const fills = ['art.dusk', 'art.moss', 'art.night', 'art.candle'];
  return [
    ...BOOKS.books.map((d, i) => shape(d, { fill: p.c(fills[i]) })),
    shape(BOOKS.spines),
    shape(BOOKS.bookmark, { stroke: p.c('accent.clay') }),
  ];
}

function notebookBody(p: Palette): string[] {
  const paper = p.c('accent.candleSubtle');
  return [
    shape(NOTEBOOK.cover, { fill: p.c('art.moss') }),
    shape(NOTEBOOK.left, { fill: paper }),
    shape(NOTEBOOK.right, { fill: paper }),
    shape(NOTEBOOK.lines),
    shape(NOTEBOOK.stroke, { stroke: p.c('accent.primary') }),
    dot(NOTEBOOK.dot, `fill="${p.c('accent.clay')}" stroke="none"`),
  ];
}

function candleBody(p: Palette, id: string): string[] {
  const glow = p.c('art.candle');
  return [
    `<defs><radialGradient id="${id}"><stop offset="0" stop-color="${glow}"/>`,
    `<stop offset="0.45" stop-color="${glow}" stop-opacity="0.6"/>`,
    `<stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>`,
    dot(CANDLE.halo, `fill="url(#${id})" stroke="none"`),
    shape(CANDLE.flame, { fill: p.c('ambient.spark'), stroke: p.c('accent.candle'), 'data-part': 'flame' }),
    shape(CANDLE.wick),
    shape(CANDLE.body, { 'data-part': 'candle-body' }),
    shape(CANDLE.shine),
    shape(CANDLE.dish, { fill: p.c('art.clay'), 'data-part': 'dish' }),
    shape(CANDLE.base, { 'data-part': 'candle-base' }),
  ];
}

/**
 * The desk by the window, as the welcome step draws it. The window has its vine and the day or evening sky, with
 * the plant on its sill. On the desk are four books, an open notebook, and two candles of different heights. It is
 * drawn in a 240 by 150 box and scaled, and `id` keeps its gradients apart from any other desk in the picture.
 */
export function deskScene(p: Palette, x: number, y: number, scale = 1, id = 'desk'): string {
  const edge = p.c('border.control');
  const root = `<g data-part="desk-scene" transform="translate(${x} ${y}) scale(${scale})" ${lines(edge)}>`;
  const slab = shape(DESK.slab, {
    fill: p.c('accent.candleSubtle'),
    'stroke-width': n(LINE / scale),
    'data-part': 'desk',
  });
  return [
    root,
    slab,
    part('window', DESK.window, scale, windowBody(p, `${id}-sky`, scale)),
    part('plant', DESK.plant, scale, plantBody(p)),
    part('books', DESK.books, scale, booksBody(p)),
    part('notebook', DESK.notebook, scale, notebookBody(p)),
    part('candle', DESK.candle, scale, candleBody(p, `${id}-glow-1`)),
    part('short-candle', DESK.shortCandle, scale, candleBody(p, `${id}-glow-2`)),
    '</g>',
  ].join('');
}

/**
 * The plant at the foot of the notebooks pane, as the app draws it at `width` px. Its pot's lowest point is on the
 * line at `ground`, so it stands on that line and never below it.
 */
export function plantPot(p: Palette, x: number, ground: number, width = 42): string {
  const scale = width / PLANT.box[0];
  const top = ground - PLANT.base * scale;
  const root = `<g data-part="plant-pot" ${lines(p.c('border.control'))}>`;
  return [root, part('plant', { at: [x, top], scale }, 1, plantBody(p)), '</g>'].join('');
}
