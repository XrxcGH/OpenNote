// Draws a paper template: lines, boxes, patterned areas, and labels, positioned as fractions of an area so one
// template fits any paper size. Readers skip elements they don't know and keep at most 200 (format spec 4.5).

import { contentBox, type Rect, type SheetGeometry } from '../pagination/geometry';
import { dots, grid, ruled, staves } from './basic';
import { wholeCells, type Canvas } from './canvas';
import type { PaperTemplate, TemplateElement } from './types';

export const MAX_ELEMENTS = 200;
/** The longest label text a template may hold. */
export const MAX_LABEL = 60;
const SPACING = { min: 4, max: 200 } as const;

const fraction = (n: number) => Math.min(Math.max(n, 0), 1);
const finite = (...values: number[]) => values.every((n) => Number.isFinite(n));

function place(area: Rect, x: number, y: number): { x: number; y: number } {
  return { x: area.x + fraction(x) * area.w, y: area.y + fraction(y) * area.h };
}

function boxOf(area: Rect, el: { x: number; y: number; w: number; h: number }): Rect {
  const at = place(area, el.x, el.y);
  return { ...at, w: fraction(el.w) * area.w, h: fraction(el.h) * area.h };
}

function drawPatterned(c: Canvas, area: Rect, el: Extract<TemplateElement, { spacing: number }>): void {
  const step = Math.min(Math.max(el.spacing, SPACING.min), SPACING.max);
  const box = boxOf(area, el);
  if (el.kind === 'rules') ruled(c, { ...box, y: box.y + step, h: box.h - step }, box.y, step);
  else if (el.kind === 'staff') staves(c, box, step);
  else if (el.kind === 'grid') grid(c, wholeCells(box, step), box, step);
  else dots(c, wholeCells(box, step), box, step);
}

function drawElement(c: Canvas, area: Rect, el: TemplateElement): void {
  if (el.kind === 'line') {
    if (!finite(el.x1, el.y1, el.x2, el.y2)) return;
    const a = place(area, el.x1, el.y1);
    const b = place(area, el.x2, el.y2);
    c.line(a.x, a.y, b.x, b.y, el.weight === 'strong' ? 'strong' : 'rule');
  } else if (el.kind === 'rect') {
    if (!finite(el.x, el.y, el.w, el.h)) return;
    const box = boxOf(area, el);
    if (el.fill === 'tint') c.tint(box);
    c.outline(box, el.weight === 'strong' ? 'strong' : 'rule');
  } else if (el.kind === 'label') {
    if (!finite(el.x, el.y) || typeof el.text !== 'string') return;
    c.label({ ...place(area, el.x, el.y), text: el.text.slice(0, MAX_LABEL), size: el.size ?? 'small' });
  } else if (
    (el.kind === 'rules' || el.kind === 'grid' || el.kind === 'dots' || el.kind === 'staff') &&
    finite(el.x, el.y, el.w, el.h, el.spacing)
  ) {
    drawPatterned(c, area, el);
  }
}

/** Draws one sheet of the template. An unknown kind or a bad number skips that element and keeps the rest. */
export function drawTemplate(c: Canvas, template: PaperTemplate, g: SheetGeometry): void {
  const area = template.area === 'sheet' ? { x: 0, y: 0, w: g.width, h: g.height } : contentBox(g, 0);
  const elements = Array.isArray(template.elements) ? template.elements : [];
  for (const el of elements.slice(0, MAX_ELEMENTS)) drawElement(c, area, el);
}
