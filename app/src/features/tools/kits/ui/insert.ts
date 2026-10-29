// The kits' Insert menu actions, on the page's insert event (as the calculator and solvers use): an answer line, a
// LaTeX equation, a results table, the worked steps, a picture, and a live calculation block. Each returns whether
// an open page took it.
import { INSERT_EVENT } from '../../flags';
import type { KitCalcData } from '../block/model';
import { kitCalcFallback, kitCalcData } from '../block/model';
import type { KitResultRow, KitStep } from '../types';
import { say, stepsHtml } from './words';

interface InsertRequest {
  text?: string;
  math?: { source: string; display: boolean };
  table?: { header: string[]; rows: string[][] };
  picture?: { bytes: ArrayBuffer; name: string; alt: string; mime: string };
  block?: { type: string; data: Record<string, unknown>; fallback: string };
  handled: boolean;
}

function send(detail: Omit<InsertRequest, 'handled'>): boolean {
  const request: InsertRequest = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertRequest>(INSERT_EVENT, { detail: request }));
  return request.handled;
}

export const insertAnswer = (text: string): boolean => send({ text });

export const insertEquation = (latex: string, display = true): boolean => send({ math: { source: latex, display } });

export function insertTable(rows: readonly KitResultRow[]): boolean {
  return send({
    table: {
      header: [say('kits.results.quantity'), say('kits.results.value')],
      rows: rows.map((row) => [row.label, row.unit ? `${row.value} ${row.unit}` : row.value]),
    },
  });
}

/** The worked steps as a numbered list with each step's math as a math block (the page parses the HTML). */
export const insertSteps = (steps: readonly KitStep[]): boolean => send({ text: stepsHtml(steps) });

/** An SVG picture as an image block. WebView2 shows SVG images, and the page takes image/svg+xml. */
export function insertPicture(svg: string, alt: string, name = 'kit-plot.svg'): boolean {
  const bytes = new TextEncoder().encode(svg);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return send({ picture: { bytes: buffer, name, alt, mime: 'image/svg+xml' } });
}

/** A live calculation block that keeps the inputs, so Open in tool reopens the calculation. */
export function insertLiveBlock(block: KitCalcData): boolean {
  const data = kitCalcData(block);
  return send({ block: { type: 'kitcalc', data: { ...data }, fallback: kitCalcFallback(data) } });
}
