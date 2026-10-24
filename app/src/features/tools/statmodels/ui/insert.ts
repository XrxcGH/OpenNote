// What the kit puts into the open page: an answer line, the fitted equation, the results, and the other tables, the
// worked steps as a numbered list with typeset math, the result in words, and each picture as an SVG image. Each
// goes through the tools' insert event, which the page answers; the window says in words what happened.
import { INSERT_EVENT } from '../../flags';
import { fillMath, valueLatex, valueText, wordValues } from '../kit/format';
import { escapeXml, PAGE, plotSvg, SCREEN, type Palette } from '../kit/picture';
import type { Outcome, Picture, ResultRow } from '../kit/spec';
import type { KitStep } from '../kit/types';

export type Say = (key: string, params?: Readonly<Record<string, string | number>>) => string;

export interface InsertContext {
  readonly tool: string;
  readonly outcome: Outcome;
  readonly say: Say;
}

const PREFIX = 'kitStatModels';

/** A row's label. */
export const rowLabel = (c: InsertContext, row: ResultRow): string => c.say(`${PREFIX}.${c.tool}.row.${row.id}`);

/** A row's value as text. */
export function rowText(c: InsertContext, row: ResultRow): string {
  if (row.word !== undefined) return c.say(`${PREFIX}.${c.tool}.word.${row.word}`);
  return row.value === undefined ? '' : valueText(row.value);
}

/** A step's words, with its values written in. */
export const stepWords = (c: InsertContext, one: KitStep): string =>
  c.say(`${PREFIX}.step.${one.key}`, wordValues(one.vars));

const answers = (c: InsertContext) => {
  const marked = c.outcome.rows.filter((row) => row.answer);
  return marked.length > 0 ? marked : c.outcome.rows.slice(0, 1);
};

export function answerText(c: InsertContext): string {
  const title = c.say(`${PREFIX}.${c.tool}.title`);
  return `${title}: ${answers(c)
    .map((row) => `${rowLabel(c, row)} = ${rowText(c, row)}`)
    .join('; ')}`;
}

/** The fitted equation, or else the answers as an equation. */
export function answerLatex(c: InsertContext): string {
  if (c.outcome.equation) return c.outcome.equation;
  return answers(c)
    .filter((row) => row.value !== undefined)
    .map((row) => `${row.sym ?? `\\text{${rowLabel(c, row)}}`} = ${valueLatex(row.value ?? '')}`)
    .join(',\\quad ');
}

export function resultTable(c: InsertContext): { header: string[]; rows: string[][] } {
  return {
    header: [c.say(`${PREFIX}.ui.quantity`), c.say(`${PREFIX}.ui.value`)],
    rows: c.outcome.rows.map((row) => [rowLabel(c, row), rowText(c, row)]),
  };
}

/** A column's name: its words under col.<id>, or the text after = for a name from the data, such as a group. */
export const columnName = (c: InsertContext, id: string): string =>
  id.startsWith('=') ? id.slice(1) : c.say(`${PREFIX}.${c.tool}.col.${id}`);

/** One of the outcome's further tables, such as the coefficients, with its column names. */
export function extraTable(c: InsertContext, index: number): { header: string[]; rows: string[][] } | null {
  const table = c.outcome.tables?.[index];
  if (!table) return null;
  return {
    header: table.columns.map((id) => columnName(c, id)),
    rows: table.rows.map((row) => row.map((cell) => valueText(cell))),
  };
}

/** The steps as an ordered list, in the HTML the page reads: each step's words, then its equation as math. */
export function stepsHtml(c: InsertContext): string {
  const items = c.outcome.steps.map((one) => {
    const words = escapeXml(stepWords(c, one));
    const math = one.math ? ` <span data-math="${escapeXml(fillMath(one.math, one.vars))}"></span>` : '';
    return `<li><p>${words}${math}</p></li>`;
  });
  const title = escapeXml(c.say(`${PREFIX}.${c.tool}.title`));
  return `<p>${title}</p><ol>${items.join('')}</ol>`;
}

/** The SVG text of a picture in the given palette. */
export function pictureSvg(c: InsertContext, picture: Picture, palette: Palette = SCREEN): string {
  const ctx = { palette, say: (key: string) => c.say(key), prefix: `${PREFIX}.${c.tool}` };
  return picture.type === 'plot' ? plotSvg(picture.plot, ctx) : picture.draw(ctx);
}

export const pictureName = (c: InsertContext, picture: Picture): string =>
  c.say(`${PREFIX}.${c.tool}.picture.${picture.id}`);

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

/** A picture for the page, in the light palette, as an SVG file. */
export function pictureRequest(c: InsertContext, picture: Picture): InsertRequest['picture'] {
  const bytes = new TextEncoder().encode(pictureSvg(c, picture, PAGE));
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    name: `${c.tool}-${picture.id}.svg`,
    alt: pictureName(c, picture),
    mime: 'image/svg+xml',
  };
}
