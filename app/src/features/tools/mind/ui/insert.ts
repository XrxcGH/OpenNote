// What the kit puts into the open page: an answer line, the answer as an equation, the results as a table, the
// worked steps as a numbered list with typeset math, further tables, and each picture as an SVG image. Each goes
// through the tools' insert event, which the page answers; the window says in words what happened.
import { t } from '../../../../strings/t';
import { INSERT_EVENT } from '../../flags';
import { fillMath, valueLatex, valueText, wordVars } from '../kit/format';
import { plotSvg } from '../kit/draw';
import { escapeXml, SCREEN, type Palette } from '../kit/plot';
import type { Cell, Column, Outcome, Picture, ResultRow } from '../kit/spec';
import type { Vars } from '../kit/types';

export type Say = (key: string, vars?: Vars) => string;

/** t for keys built at run time. Every key the kit builds exists in strings/en/kitMind (a test checks). */
export const say: Say = (key, vars) => {
  try {
    return (t as unknown as (k: string, v?: Record<string, string>) => string)(key, wordVars(vars));
  } catch {
    return key.slice(key.lastIndexOf('.') + 1);
  }
};

/** The words at a key, or null when the strings have none there, for optional words such as hints. */
export function maybeSay(key: string, vars?: Vars): string | null {
  try {
    return (t as unknown as (k: string, v?: Record<string, string>) => string)(key, wordVars(vars));
  } catch {
    return null;
  }
}

export interface InsertContext {
  readonly tool: string;
  readonly outcome: Outcome;
}

export const toolKey = (c: InsertContext, rest: string): string => `kitMind.${c.tool}.${rest}`;

export const rowLabel = (c: InsertContext, row: ResultRow): string => say(toolKey(c, `row.${row.id}`), row.vars);

/** A row's value as text; a value that is not defined reads as words. */
export function rowText(row: ResultRow): string {
  const text = valueText(row.value);
  return text === '' ? say('kitMind.ui.notDefined') : text;
}

/** A table cell as text. */
export const cellText = (c: InsertContext, cell: Cell): string =>
  typeof cell === 'object' ? say(toolKey(c, `word.${cell.word}`)) : valueText(cell);

export const columnLabel = (c: InsertContext, column: Column): string =>
  typeof column === 'string' ? say(toolKey(c, `col.${column}`)) : column.raw;

const answers = (c: InsertContext) => {
  const marked = c.outcome.rows.filter((row) => row.answer);
  return marked.length > 0 ? marked : c.outcome.rows.slice(0, 1);
};

export function answerText(c: InsertContext): string {
  const list = answers(c).map((row) => `${rowLabel(c, row)} = ${rowText(row)}`);
  return `${say(toolKey(c, 'title'))}: ${list.join('; ')}`;
}

export function answerLatex(c: InsertContext): string {
  return answers(c)
    .map((row) => `${row.sym ?? `\\text{${rowLabel(c, row)}}`} = ${valueLatex(row.value)}`)
    .join(',\\quad ');
}

export function resultTable(c: InsertContext): { header: string[]; rows: string[][] } {
  return {
    header: [say('kitMind.ui.quantity'), say('kitMind.ui.value')],
    rows: c.outcome.rows.map((row) => [rowLabel(c, row), rowText(row)]),
  };
}

export function extraTable(c: InsertContext, index: number): { header: string[]; rows: string[][] } | null {
  const table = c.outcome.tables?.[index];
  if (!table) return null;
  return {
    header: table.columns.map((column) => columnLabel(c, column)),
    rows: table.rows.map((row) => row.map((cell) => cellText(c, cell))),
  };
}

/** A step's sentence. Its key is <tool>.<name>, and the words live under kitMind.<tool>.step.<name>. */
export const stepWords = (key: string, vars?: Vars): string => {
  const at = key.indexOf('.');
  return say(`kitMind.${key.slice(0, at)}.step.${key.slice(at + 1)}`, vars);
};

/** The steps as an ordered list, in the HTML the page reads: each step's words, then its equation as math. */
export function stepsHtml(c: InsertContext): string {
  const items = c.outcome.steps.map((one) => {
    const words = escapeXml(stepWords(one.key, one.vars));
    const math = one.math ? ` <span data-math="${escapeXml(fillMath(one.math, one.vars))}"></span>` : '';
    return `<li><p>${words}${math}</p></li>`;
  });
  return `<p>${escapeXml(say(toolKey(c, 'title')))}</p><ol>${items.join('')}</ol>`;
}

/** A picture's SVG text in a palette. */
export function pictureSvg(c: InsertContext, picture: Picture, palette: Palette = SCREEN): string {
  const label = (id: string, vars?: Vars) => say(toolKey(c, `plot.${id}`), vars);
  const title = say(toolKey(c, `picture.${picture.id}`));
  if (picture.draw) return picture.draw(palette, label);
  return picture.plot ? plotSvg(picture.plot, palette, label, title) : '';
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
