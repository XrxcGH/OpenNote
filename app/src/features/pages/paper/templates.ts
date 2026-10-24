// The built-in templates: lab notebook, planner, and storyboard. Each is data, not code, and applying one copies it
// into the page, so the page stays complete on its own. The label text comes from the caller's strings.

import type { PaperTemplate, TemplateElement, Weight } from './types';

/** Fixed IDs for the built-in templates. */
export const TEMPLATE_IDS = {
  lab: 'builtin-lab-notebook',
  planner: 'builtin-planner',
  storyboard: 'builtin-storyboard',
} as const;

export interface LabText {
  readonly name: string;
  readonly title: string;
  readonly date: string;
  readonly project: string;
  readonly signed: string;
  readonly witnessed: string;
}

export interface PlannerText {
  readonly name: string;
  readonly date: string;
  readonly todo: string;
  readonly notes: string;
}

/** The content box's size in page units, for templates that need exact proportions. */
export interface AreaSize {
  readonly width: number;
  readonly height: number;
}

const line = (x1: number, y1: number, x2: number, y2: number, weight: Weight = 'rule'): TemplateElement => ({
  kind: 'line',
  x1,
  y1,
  x2,
  y2,
  weight,
});

const label = (x: number, y: number, text: string, size: 'caption' | 'small' = 'small'): TemplateElement => ({
  kind: 'label',
  x,
  y,
  text,
  size,
});

/** A writing line with its caption underneath, as on a form. */
function captioned(x1: number, x2: number, y: number, text: string): TemplateElement[] {
  return [line(x1, y, x2, y), label(x1, y + 0.016, text, 'caption')];
}

/** A header of Title, Date, and Project lines, a 5 mm grid, and Signed and Witnessed lines at the bottom. */
export function labNotebook(text: LabText): PaperTemplate {
  return {
    id: TEMPLATE_IDS.lab,
    title: text.name,
    area: 'content',
    elements: [
      ...captioned(0, 0.62, 0.03, text.title),
      ...captioned(0.68, 1, 0.03, text.date),
      ...captioned(0, 1, 0.07, text.project),
      line(0, 0.1, 1, 0.1, 'strong'),
      { kind: 'grid', x: 0, y: 0.11, w: 1, h: 0.8, spacing: 18.9 },
      ...captioned(0, 0.46, 0.96, text.signed),
      ...captioned(0.54, 1, 0.96, text.witnessed),
    ],
  };
}

const HOURS = { first: 7, last: 21 } as const;
const SCHEDULE = { top: 0.07, bottom: 0.8, width: 0.64 } as const;

/** A Date header, hourly rows from 7 AM to 9 PM on the left, To do lines on the right, and a Notes box below. */
export function planner(text: PlannerText): PaperTemplate {
  const rows = HOURS.last - HOURS.first + 1;
  const rowHeight = (SCHEDULE.bottom - SCHEDULE.top) / rows;
  const hours: TemplateElement[] = [];
  for (let i = 0; i < rows; i += 1) {
    const top = SCHEDULE.top + i * rowHeight;
    hours.push(label(0.006, top + 0.022, String((HOURS.first + i) % 12 || 12), 'caption'));
    hours.push(line(0, top + rowHeight, SCHEDULE.width, top + rowHeight));
  }
  return {
    id: TEMPLATE_IDS.planner,
    title: text.name,
    area: 'content',
    elements: [
      label(0, 0.03, text.date),
      line(0, 0.04, 1, 0.04, 'strong'),
      line(0, SCHEDULE.top, SCHEDULE.width, SCHEDULE.top),
      ...hours,
      line(0.66, 0.05, 0.66, SCHEDULE.bottom, 'strong'),
      label(0.68, 0.063, text.todo),
      { kind: 'rules', x: 0.68, y: SCHEDULE.top, w: 0.32, h: SCHEDULE.bottom - SCHEDULE.top, spacing: 32.88 },
      { kind: 'rect', x: 0, y: 0.84, w: 1, h: 0.16, weight: 'rule', fill: 'none' },
      label(0.01, 0.865, text.notes),
    ],
  };
}

const STORYBOARD = { columns: 2, rows: 3, gutter: 24, ruling: 26.46, ratio: 16 / 9 } as const;

/**
 * Six 16:9 frames in two columns, each with two ruled lines below it. The frames are sized from the content box so
 * they keep their proportions, and shrink to fit when the paper is wide and short.
 */
export function storyboard(name: string, area: AreaSize): PaperTemplate {
  const { columns, rows, gutter, ruling, ratio } = STORYBOARD;
  const rowHeight = (area.height - (rows - 1) * gutter) / rows;
  const frameHeight = Math.max(1, Math.min(rowHeight - 2.5 * ruling, (area.width - gutter) / columns / ratio));
  const frameWidth = frameHeight * ratio;
  const elements: TemplateElement[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = col === 0 ? 0 : area.width - frameWidth;
      const y = row * (rowHeight + gutter);
      const at = (v: number, total: number) => v / total;
      elements.push({
        kind: 'rect',
        x: at(x, area.width),
        y: at(y, area.height),
        w: at(frameWidth, area.width),
        h: at(frameHeight, area.height),
        weight: 'rule',
        fill: 'none',
      });
      for (const n of [1, 2]) {
        const lineY = at(y + frameHeight + n * ruling, area.height);
        elements.push(line(at(x, area.width), lineY, at(x + frameWidth, area.width), lineY));
      }
    }
  }
  return { id: TEMPLATE_IDS.storyboard, title: name, area: 'content', elements };
}
