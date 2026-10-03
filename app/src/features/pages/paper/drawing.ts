// The drawing of a template background, kept in the page. A page that uses a template names it in
// `background.template` and holds the drawing under `background.drawing`, an extra key that readers keep (format spec
// 2.5), so the page shows its paper on any device without the app's template list. This reads that drawing and drops
// anything it cannot trust: a bad element is skipped, and no more than 200 are kept.

import { MAX_ELEMENTS, MAX_LABEL } from './template';
import type { PaperTemplate, TemplateElement } from './types';

/** The key of the drawing inside a page's `background` object. */
export const DRAWING_KEY = 'drawing';

const KINDS = new Set(['line', 'rect', 'rules', 'grid', 'dots', 'staff', 'label']);
const MAX_TEXT = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function element(raw: unknown): TemplateElement | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !KINDS.has(raw.kind)) return null;
  const numbers = Object.entries(raw).filter(([key]) => !['kind', 'weight', 'fill', 'text', 'size'].includes(key));
  if (numbers.some(([, value]) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  if (raw.kind === 'label') {
    if (typeof raw.text !== 'string') return null;
    return { ...raw, text: raw.text.slice(0, MAX_LABEL) } as unknown as TemplateElement;
  }
  return raw as unknown as TemplateElement;
}

/** The template a page's drawing holds, or undefined when there is none or it is not a drawing. */
export function readDrawing(raw: unknown): PaperTemplate | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.elements)) return undefined;
  const elements = raw.elements
    .slice(0, MAX_ELEMENTS)
    .map(element)
    .filter((item): item is TemplateElement => item !== null);
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, MAX_TEXT) : 'custom',
    title: typeof raw.title === 'string' ? raw.title.slice(0, MAX_TEXT) : '',
    area: raw.area === 'sheet' ? 'sheet' : 'content',
    elements,
  };
}
