// Hands results to the open page: an answer line, a block of text, a table, an equation, or a picture. The page
// listens for the insert event (features/page/registrations/smart.ts) and says whether it took the content.
import { INSERT_EVENT } from '../../flags';

interface Detail {
  text?: string;
  table?: { header: string[]; rows: string[][] };
  math?: { source: string; display: boolean };
  picture?: { bytes: ArrayBuffer; name: string; alt: string; mime: string };
  handled: boolean;
}

function send(detail: Omit<Detail, 'handled'>): boolean {
  const request: Detail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<Detail>(INSERT_EVENT, { detail: request }));
  return request.handled;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Text at the caret. The page reads the text as HTML, so it is escaped; each line becomes a paragraph. */
export function insertText(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length === 1) return send({ text: escapeHtml(text) });
  return send({ text: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') });
}

/** Headings, paragraphs, and lists the kit built itself, with every piece of text already escaped. */
export const insertHtml = (html: string): boolean => send({ text: html });

/** Numbered steps as a list. */
export const insertSteps = (steps: readonly string[]): boolean =>
  insertHtml(`<ol>${steps.map((step) => `<li><p>${escapeHtml(step)}</p></li>`).join('')}</ol>`);

export const insertTable = (header: string[], rows: string[][]): boolean => send({ table: { header, rows } });

export const insertMath = (source: string): boolean => send({ math: { source, display: true } });

export function insertPicture(svg: string, name: string, alt: string): boolean {
  const bytes = new TextEncoder().encode(svg);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return send({ picture: { bytes: buffer, name: `${name}.svg`, alt, mime: 'image/svg+xml' } });
}
