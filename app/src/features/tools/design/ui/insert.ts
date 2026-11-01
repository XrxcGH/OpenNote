// What the kit puts into the open page: an answer line, the answer as an equation, the results as a table, the
// worked steps as a numbered list with typeset math, and a picture as an SVG image. Each goes through the tools'
// insert event, which the page answers; the window says in words what happened.
import '../text';
import { INSERT_EVENT } from '../../flags';
import { escapeXml, numberLatex, numberText, unitLatex, withUnit } from '../kit/format';
import type { Outcome, Row } from '../kit/spec';
import { defaultUnit, fromEngine, type System } from '../kit/units';

export type Say = (key: string, params?: Readonly<Record<string, string | number>>) => string;

export interface InsertContext {
  readonly tool: string;
  readonly outcome: Outcome;
  readonly system: System;
  readonly say: Say;
}

/** A row's label. */
export const rowLabel = (c: InsertContext, row: Row): string => c.say(`kitDesign.${c.tool}.row.${row.id}`);

/** A row's number in the unit it is shown in, and that unit. */
export function rowNumber(row: Row, system: System): { value: number; unit: string } | null {
  if (row.value === undefined) return null;
  if (row.dim) {
    const unit = defaultUnit(row.dim, system);
    return { value: fromEngine(row.dim, unit, row.value), unit };
  }
  return { value: row.value, unit: row.unit ?? '' };
}

/** A row's value as text. */
export function rowText(c: InsertContext, row: Row): string {
  if (row.text !== undefined) return row.text;
  if (row.word !== undefined) return c.say(`kitDesign.${c.tool}.word.${row.word}`);
  const shown = rowNumber(row, c.system);
  return shown ? withUnit(numberText(shown.value, row.digits ?? 5), shown.unit) : '';
}

/** A row's value as LaTeX. */
export function rowLatex(c: InsertContext, row: Row): string {
  if (row.text !== undefined) return `\\texttt{${row.text.replace(/[\\{}$&#^_%~]/g, (ch) => `\\${ch}`)}}`;
  if (row.word !== undefined) return `\\text{${c.say(`kitDesign.${c.tool}.word.${row.word}`)}}`;
  const shown = rowNumber(row, c.system);
  return shown ? `${numberLatex(shown.value, row.digits ?? 5)}${unitLatex(shown.unit)}` : '';
}

const answers = (c: InsertContext): readonly Row[] => {
  const marked = c.outcome.rows.filter((row) => row.answer);
  return marked.length > 0 ? marked : c.outcome.rows.slice(0, 1);
};

export function answerText(c: InsertContext): string {
  const title = c.say(`kitDesign.${c.tool}.title`);
  return `${title}: ${answers(c)
    .map((row) => `${rowLabel(c, row)} = ${rowText(c, row)}`)
    .join('; ')}`;
}

export function answerLatex(c: InsertContext): string {
  return answers(c)
    .map((row) => `${row.sym ?? `\\text{${rowLabel(c, row)}}`} = ${rowLatex(c, row)}`)
    .join(',\\quad ');
}

export function resultTable(c: InsertContext): { header: string[]; rows: string[][] } {
  return {
    header: [c.say('kitDesign.ui.quantity'), c.say('kitDesign.ui.value')],
    rows: c.outcome.rows.map((row) => [rowLabel(c, row), rowText(c, row)]),
  };
}

/** One of the outcome's further tables, with its column names. */
export function extraTable(c: InsertContext, index: number): { header: string[]; rows: string[][] } | null {
  const table = c.outcome.tables?.[index];
  if (!table) return null;
  return {
    header: table.columns.map((id) => c.say(`kitDesign.${c.tool}.col.${id}`)),
    rows: table.rows.map((row) => row.map((cell) => (typeof cell === 'number' ? numberText(cell) : cell))),
  };
}

/** The steps as an ordered list, in the HTML the page reads: each step's words, then its equation as math. */
export function stepsHtml(c: InsertContext): string {
  const items = c.outcome.steps.map((one) => {
    const words = escapeXml(c.say(`kitDesign.step.${one.key}`));
    return `<li><p>${words} <span data-math="${escapeXml(one.latex)}"></span></p></li>`;
  });
  // The steps stay in the formulas' own units; beside a US answer they say so.
  const units = c.system === 'us' ? `<p>${escapeXml(c.say('kitDesign.ui.stepsUnits'))}</p>` : '';
  return `<p>${escapeXml(c.say(`kitDesign.${c.tool}.title`))}</p>${units}<ol>${items.join('')}</ol>`;
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

export function pictureRequest(svgText: string, name: string, alt: string): NonNullable<InsertRequest['picture']> {
  const bytes = new TextEncoder().encode(svgText);
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    name,
    alt,
    mime: 'image/svg+xml',
  };
}
