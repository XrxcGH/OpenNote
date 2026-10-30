// What the kit puts into the open page: an answer line, the answer as an equation, the results as a table, any
// further table, the worked steps as a numbered list with typeset math, and each plot as an SVG picture. Each goes
// through the tools' insert event, which the page answers; the window says in words what happened.
import { INSERT_EVENT } from '../../../tools/flags';
import type { Step } from '../lib/steps';
import { escapeXml, pictureSvg, type Palette, type Picture } from './plot';
import type { Column, Outcome, Row } from './spec';
import { quantityText, type System } from './units';

export type Say = (key: string, params?: Readonly<Record<string, string | number>>) => string;

export interface InsertContext {
  readonly tool: string;
  readonly outcome: Outcome;
  readonly system: System;
  readonly say: Say;
}

export const rowLabel = (c: InsertContext, row: Row): string => c.say(`kitControl.${c.tool}.row.${row.id}`, row.vars);

export const rowText = (c: InsertContext, row: Row): string =>
  typeof row.value === 'string' ? row.value : quantityText(row.value.si, row.value.kind, c.system);

export const stepText = (c: InsertContext, one: Step): string => c.say(`kitControl.steps.${one.key}`, one.vars);

const answers = (c: InsertContext) => {
  const marked = c.outcome.rows.filter((row) => row.answer);
  return marked.length > 0 ? marked : c.outcome.rows.slice(0, 1);
};

export function answerText(c: InsertContext): string {
  const title = c.say(`kitControl.${c.tool}.title`);
  return `${title}: ${answers(c)
    .map((row) => `${rowLabel(c, row)} = ${rowText(c, row)}`)
    .join('; ')}`;
}

export function answerLatex(c: InsertContext): string {
  if (c.outcome.latex) return c.outcome.latex;
  return answers(c)
    .map((row) => row.tex ?? `\\text{${rowLabel(c, row).replace(/[\\{}$&#%_^~]/g, '')}} = \\text{${rowText(c, row)}}`)
    .join(',\\quad ');
}

export function resultTable(c: InsertContext): { header: string[]; rows: string[][] } {
  return {
    header: [c.say('kitControl.ui.quantity'), c.say('kitControl.ui.value')],
    rows: c.outcome.rows.map((row) => [rowLabel(c, row), rowText(c, row)]),
  };
}

export const columnText = (c: InsertContext, col: Column): string =>
  typeof col === 'string' ? c.say(`kitControl.${c.tool}.col.${col}`) : col.text;

export function extraTable(c: InsertContext, index: number): { header: string[]; rows: string[][] } | null {
  const table = c.outcome.tables?.[index];
  if (!table) return null;
  return {
    header: table.columns.map((col) => columnText(c, col)),
    rows: table.rows.map((row) => [...row]),
  };
}

/** The steps as an ordered list in the HTML the page reads: each step's words, then its equation as math. */
export function stepsHtml(c: InsertContext): string {
  const items = c.outcome.steps.map((one) => {
    const math = one.math ? ` <span data-math="${escapeXml(one.math)}"></span>` : '';
    return `<li><p>${escapeXml(stepText(c, one))}${math}</p></li>`;
  });
  return `<p>${escapeXml(c.say(`kitControl.${c.tool}.title`))}</p><ol>${items.join('')}</ol>`;
}

export const plotWords = (c: InsertContext) => ({ plot: (id: string) => c.say(`kitControl.${c.tool}.plot.${id}`) });

export const plotText = (c: InsertContext, plot: Picture, palette: Palette): string =>
  pictureSvg(plot, palette, plotWords(c));

export interface InsertRequest {
  text?: string;
  math?: { source: string; display: boolean };
  table?: { header: string[]; rows: string[][] };
  picture?: { bytes: ArrayBuffer; name: string; alt: string; mime: string };
  handled: boolean;
}

/** Asks the open page to take this; true when a page took it. */
export function sendToPage(detail: Omit<InsertRequest, 'handled'>): boolean {
  const request: InsertRequest = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertRequest>(INSERT_EVENT, { detail: request }));
  return request.handled;
}

export function pictureRequest(svgText: string, name: string, alt: string): InsertRequest['picture'] {
  const bytes = new TextEncoder().encode(svgText);
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    name,
    alt,
    mime: 'image/svg+xml',
  };
}
