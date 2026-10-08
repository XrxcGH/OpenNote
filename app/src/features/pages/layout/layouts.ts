// Saved layouts (FEATURES.md "Page layouts"): the paper and background of a page, kept by name so another page can use
// them, and shared as a small file. This is the pure part. The list lives in this device's storage, and the file is
// what a person sends. A layout from a file is untrusted: every number is checked and the drawing is read with the
// template reader's limits.

import { contentBox } from '../pagination/geometry';
import type { Margins } from '../pagination/geometry';
import { DRAWING_KEY, readDrawing } from '../paper/drawing';
import { spacingOf } from '../paper/patterns';
import { labNotebook, planner, storyboard } from '../paper/templates';
import type { LabText, PlannerText, TEMPLATE_IDS } from '../paper/templates';
import type { PaperTemplate } from '../paper/types';
import { setBackground, setTemplate } from './edit';
import { geometry, isObject, round2, type Json } from './json';
import { pageLayout } from './page';
import type { PageViewSpec } from './view';

export const LAYOUT_FORMAT = 'opennote-layout';
export const LAYOUT_VERSION = 1;
export const LAYOUT_EXTENSION = '.opennote-layout';
/** The most layouts a device keeps, and the longest name and file. */
export const MAX_LAYOUTS = 100;
export const MAX_LAYOUT_NAME = 60;
export const MAX_LAYOUT_FILE = 1_000_000;

export interface LayoutTemplate {
  readonly id: string;
  readonly name: string;
  readonly pattern: string;
  readonly spacing: number;
  readonly color: string;
  readonly marginLine: boolean;
  /** The drawing of a `template` pattern. */
  readonly drawing?: PaperTemplate;
  /** The sheet, when the layout also fixes the paper. */
  readonly paper?: { readonly width: number; readonly height: number; readonly margins: Margins };
}

const PX_PER_MM = 96 / 25.4;

export const unitsToMm = (units: number): number => Math.round((units / PX_PER_MM) * 10) / 10;
export const mmToUnits = (mm: number): number => mm * PX_PER_MM;

/** The spacing range of a pattern in millimeters, or null for paper with nothing to space. */
export function spacingRangeMm(pattern: string): readonly [number, number] | null {
  if (!['ruled', 'grid', 'dots', 'isometric'].includes(pattern)) return null;
  return [unitsToMm(spacingOf({ pattern, spacing: -1e9 })), unitsToMm(spacingOf({ pattern, spacing: 1e9 }))];
}

export interface TemplateTexts {
  readonly lab: LabText;
  readonly planner: PlannerText;
  /** The storyboard's name. */
  readonly storyboard: string;
}

/** The built-in template for a key, sized for the page's paper: the storyboard's frames keep their 16:9 shape. */
export function builtinTemplate(
  key: keyof typeof TEMPLATE_IDS,
  view: PageViewSpec,
  texts: TemplateTexts,
): PaperTemplate {
  if (key === 'lab') return labNotebook(texts.lab);
  if (key === 'planner') return planner(texts.planner);
  const box = contentBox(pageLayout(view).sheet, 0);
  return storyboard(texts.storyboard, { width: box.w, height: box.h });
}

/** A name with control characters removed and spaces collapsed, or null when nothing is left. */
export function layoutName(text: string): string | null {
  const spaced = Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
  const clean = spaced.replace(/\s+/g, ' ').trim().slice(0, MAX_LAYOUT_NAME);
  return clean === '' ? null : clean;
}

/** The layout the page has now, under a name. `withPaper` also keeps the sheet's size and margins. */
export function layoutOf(view: PageViewSpec, id: string, name: string, withPaper: boolean): LayoutTemplate {
  const { background, paper } = view;
  const drawing = background.pattern === 'template' ? readDrawing(background.extra[DRAWING_KEY]) : undefined;
  return {
    id,
    name,
    pattern: background.pattern,
    spacing: background.spacing,
    color: background.color,
    marginLine: background.marginLine,
    ...(drawing ? { drawing } : {}),
    ...(withPaper ? { paper: { width: paper.width, height: paper.height, margins: paper.margins } } : {}),
  };
}

/** The page's view with the layout on it. Paper is changed only when the layout holds one. */
export function applyLayout(view: PageViewSpec, layout: LayoutTemplate): PageViewSpec {
  let next = view;
  if (layout.paper) {
    const { width, height, margins } = layout.paper;
    next = {
      ...next,
      paper: {
        ...next.paper,
        size: 'custom',
        orientation: width > height ? 'landscape' : 'portrait',
        width,
        height,
        margins,
      },
    };
  }
  const plain = setBackground(next, {
    pattern: layout.pattern === 'template' ? 'plain' : layout.pattern,
    spacing: layout.spacing,
    color: layout.color,
    marginLine: layout.marginLine,
  });
  return layout.pattern === 'template' && layout.drawing ? setTemplate(plain, layout.drawing) : plain;
}

/** Adds a layout under a name no other layout has ("Weekly", "Weekly 2"), or returns the list unchanged when full. */
export function addLayout(list: readonly LayoutTemplate[], layout: LayoutTemplate): readonly LayoutTemplate[] {
  if (list.length >= MAX_LAYOUTS) return list;
  const taken = new Set(list.map((item) => item.name.toLowerCase()));
  let name = layout.name;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${layout.name.slice(0, MAX_LAYOUT_NAME - 4)} ${n}`;
  return [...list, { ...layout, name }];
}

export const removeLayout = (list: readonly LayoutTemplate[], id: string): readonly LayoutTemplate[] =>
  list.filter((item) => item.id !== id);

export function writeLayoutFile(layout: LayoutTemplate): string {
  const { id: _id, ...rest } = layout;
  return JSON.stringify({ format: LAYOUT_FORMAT, version: LAYOUT_VERSION, ...rest }, null, 2);
}

export type LayoutFileRead =
  | { readonly ok: true; readonly layout: Omit<LayoutTemplate, 'id'> }
  | { readonly ok: false; readonly error: 'tooBig' | 'notJson' | 'notLayout' | 'newer' | 'invalid' };

const PATTERNS = new Set(['plain', 'ruled', 'grid', 'dots', 'isometric', 'cornell', 'staff', 'template']);

/** Reads a layout file. It never throws: a bad file answers with the reason. */
export function readLayoutFile(text: string): LayoutFileRead {
  if (text.length > MAX_LAYOUT_FILE) return { ok: false, error: 'tooBig' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'notJson' };
  }
  if (!isObject(raw as Json) || (raw as Record<string, unknown>).format !== LAYOUT_FORMAT) {
    return { ok: false, error: 'notLayout' };
  }
  const file = raw as Record<string, unknown>;
  if (typeof file.version !== 'number' || file.version > LAYOUT_VERSION) return { ok: false, error: 'newer' };
  const name = typeof file.name === 'string' ? layoutName(file.name) : null;
  const pattern = typeof file.pattern === 'string' && PATTERNS.has(file.pattern) ? file.pattern : null;
  const spacing = geometry(file.spacing);
  if (!name || !pattern || spacing === null || spacing <= 0) return { ok: false, error: 'invalid' };
  const drawing = readDrawing(file.drawing);
  const paper = isObject(file.paper as Json) ? (file.paper as Record<string, unknown>) : null;
  const sides = paper ? [geometry(paper.width), geometry(paper.height)] : [];
  const margins =
    paper && Array.isArray(paper.margins) && paper.margins.length === 4 ? paper.margins.map(geometry) : [];
  const keepsPaper = sides.length === 2 && sides.every((n) => n !== null && n > 0) && margins.every((n) => n !== null);
  return {
    ok: true,
    layout: {
      name,
      pattern,
      spacing: round2(spacing),
      color: typeof file.color === 'string' ? file.color.slice(0, 40) : 'rule',
      marginLine: file.marginLine === true,
      ...(pattern === 'template' && drawing ? { drawing } : {}),
      ...(keepsPaper && margins.length === 4
        ? { paper: { width: sides[0] as number, height: sides[1] as number, margins: margins as unknown as Margins } }
        : {}),
    },
  };
}
