// What the kit puts into the open page: an answer line, the answer as an equation, the results as a table, the
// worked steps as a numbered list with typeset math, and each plot as an SVG picture. Each goes through the tools'
// insert event, which the page answers; the window says in words what happened.
import { INSERT_EVENT, type InsertDetail } from '../../../tools';
import { cellLatex, cellText } from '../kit/format';
import { escapeXml, plotSvg, type Palette, type PlotWords } from '../kit/picture';
import type { Outcome, ResultRow } from '../kit/spec';
import type { System } from '../kit/units';
import type { Plot } from '../types';

export type Say = (key: string, params?: Readonly<Record<string, string | number>>) => string;

export interface InsertContext {
  readonly tool: string;
  readonly outcome: Outcome;
  readonly system: System;
  readonly say: Say;
}

export const rowLabel = (c: InsertContext, row: ResultRow): string =>
  c.say(`kitMechDyn.${c.tool}.row.${row.id}`, row.vars);

export function rowText(c: InsertContext, row: ResultRow): string {
  if (row.word !== undefined) return c.say(`kitMechDyn.${c.tool}.word.${row.word}`);
  return row.value === undefined ? '' : cellText(row.value, c.system);
}

const answers = (c: InsertContext) => {
  const marked = c.outcome.rows.filter((row) => row.answer);
  return marked.length > 0 ? marked : c.outcome.rows.slice(0, 1);
};

export function answerText(c: InsertContext): string {
  const title = c.say(`kitMechDyn.${c.tool}.title`);
  return `${title}: ${answers(c)
    .map((row) => `${rowLabel(c, row)} = ${rowText(c, row)}`)
    .join('; ')}`;
}

export function answerLatex(c: InsertContext): string {
  return answers(c)
    .filter((row) => row.value !== undefined)
    .map((row) => `${row.sym ?? `\\text{${rowLabel(c, row)}}`} = ${cellLatex(row.value ?? '', c.system)}`)
    .join(',\\quad ');
}

export function resultTable(c: InsertContext): { header: string[]; rows: string[][] } {
  return {
    header: [c.say('kitMechDyn.ui.quantity'), c.say('kitMechDyn.ui.value')],
    rows: c.outcome.rows.map((row) => [rowLabel(c, row), rowText(c, row)]),
  };
}

export function extraTable(c: InsertContext, index: number): { header: string[]; rows: string[][] } | null {
  const table = c.outcome.tables?.[index];
  if (!table) return null;
  return {
    header: table.columns.map((id) => c.say(`kitMechDyn.${c.tool}.col.${id}`)),
    rows: table.rows.map((row) => row.map((cell) => cellText(cell, c.system))),
  };
}

export const stepWords = (c: Pick<InsertContext, 'say'>, step: Outcome['steps'][number]): string =>
  c.say(`kitMechDyn.steps.${step.key}`, step.vars);

/** The steps as an ordered list, in the HTML the page reads: each step's words, then its equation as math. */
export function stepsHtml(c: InsertContext): string {
  const items = c.outcome.steps.map((one) => {
    const math = one.math ? ` <span data-math="${escapeXml(one.math)}"></span>` : '';
    return `<li><p>${escapeXml(stepWords(c, one))}${math}</p></li>`;
  });
  const title = escapeXml(c.say(`kitMechDyn.${c.tool}.title`));
  return `<p>${title}</p><ol>${items.join('')}</ol>`;
}

export function plotWords(say: Say, plot: Plot): PlotWords {
  return {
    x: say(`kitMechDyn.axes.${plot.x}`),
    y: say(`kitMechDyn.axes.${plot.y}`),
    series: plot.series.map((one) => say(`kitMechDyn.series.${one.name}`, one.vars)),
  };
}

export const plotTitle = (say: Say, plot: Plot): string =>
  say('kitMechDyn.ui.plotTitle', { y: say(`kitMechDyn.axes.${plot.y}`), x: say(`kitMechDyn.axes.${plot.x}`) });

export const plotPicture = (say: Say, plot: Plot, palette: Palette): string =>
  plotSvg(plot, plotWords(say, plot), palette);

/** Asks the open page to take this; true when a page took it. */
export function sendToPage(detail: Omit<InsertDetail, 'handled'>): boolean {
  const request: InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail: request }));
  return request.handled;
}

export function pictureRequest(svgText: string, name: string, alt: string) {
  const bytes = new TextEncoder().encode(svgText);
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    name,
    alt,
    mime: 'image/svg+xml',
  };
}
