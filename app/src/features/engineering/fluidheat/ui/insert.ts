// What the kit puts into the open page: an answer line, the answer as an equation, the results as a table, the
// worked steps as a numbered list with typeset math, and the picture as an SVG image. Each goes through the tools'
// insert event, which the page answers; the window says in words what happened.
import { INSERT_EVENT } from '../../../tools/flags';
import { escapeXml } from '../kit/picture';
import { fillMath, valueLatex, valueText, wordValues } from '../kit/format';
import type { Outcome, ResultRow } from '../kit/spec';
import type { System } from '../kit/units';

export type Say = (key: string, params?: Readonly<Record<string, string | number>>) => string;

export interface InsertContext {
  readonly tool: string;
  readonly outcome: Outcome;
  readonly system: System;
  readonly say: Say;
}

/** A row's label. */
export const rowLabel = (c: InsertContext, row: ResultRow): string => c.say(`kitFluidHeat.${c.tool}.row.${row.id}`);

/** A row's value as text. */
export function rowText(c: InsertContext, row: ResultRow): string {
  if (row.word !== undefined) return c.say(`kitFluidHeat.${c.tool}.word.${row.word}`);
  return row.value === undefined ? '' : valueText(row.value, c.system);
}

const answers = (c: InsertContext) => {
  const marked = c.outcome.rows.filter((row) => row.answer);
  return marked.length > 0 ? marked : c.outcome.rows.slice(0, 1);
};

export function answerText(c: InsertContext): string {
  const title = c.say(`kitFluidHeat.${c.tool}.title`);
  return `${title}: ${answers(c)
    .map((row) => `${rowLabel(c, row)} = ${rowText(c, row)}`)
    .join('; ')}`;
}

export function answerLatex(c: InsertContext): string {
  return answers(c)
    .filter((row) => row.value !== undefined)
    .map((row) => `${row.sym ?? `\\text{${rowLabel(c, row)}}`} = ${valueLatex(row.value ?? '', c.system)}`)
    .join(',\\quad ');
}

export function resultTable(c: InsertContext): { header: string[]; rows: string[][] } {
  return {
    header: [c.say('kitFluidHeat.ui.quantity'), c.say('kitFluidHeat.ui.value')],
    rows: c.outcome.rows.map((row) => [rowLabel(c, row), rowText(c, row)]),
  };
}

/** A table of the outcome's, such as the parts of a section, with its column names. */
export function extraTable(c: InsertContext, index: number): { header: string[]; rows: string[][] } | null {
  const table = c.outcome.tables?.[index];
  if (!table) return null;
  return {
    header: table.columns.map((id) => c.say(`kitFluidHeat.${c.tool}.col.${id}`)),
    rows: table.rows.map((row) => row.map((cell) => valueText(cell, c.system))),
  };
}

/** The steps as an ordered list, in the HTML the page reads: each step's words, then its equation as math. */
export function stepsHtml(c: InsertContext): string {
  const items = c.outcome.steps.map((one) => {
    const words = escapeXml(c.say(`kitFluidHeat.step.${one.key}`, wordValues(one.vars, c.system)));
    const math = one.math ? ` <span data-math="${escapeXml(fillMath(one.math, one.vars, c.system))}"></span>` : '';
    return `<li><p>${words}${math}</p></li>`;
  });
  const title = escapeXml(c.say(`kitFluidHeat.${c.tool}.title`));
  return `<p>${title}</p><ol>${items.join('')}</ol>`;
}

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
