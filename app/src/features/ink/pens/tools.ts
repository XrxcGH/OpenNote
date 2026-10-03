// The tools a stroke can be drawn with, and their numbers in the stroke record (spec 9.3). Width presets are in
// millimeters, as the Draw tab shows them (architecture 6.3), and convert to page units at 3.7795 per millimeter.

import { PAGE_UNITS_PER_MM } from '../geometry/stabilizer';
import type { InkTool } from '../geometry/types';

/** The tool byte of a stroke record. */
export const TOOL_CODES: Readonly<Record<InkTool, number>> = {
  pen: 0,
  pencil: 1,
  highlighter: 2,
  marker: 3,
  brush: 4,
};

const TOOLS_BY_CODE: readonly InkTool[] = ['pen', 'pencil', 'highlighter', 'marker', 'brush'];

/** The tool for a record's byte. Readers draw unknown values as a pen (spec 9.3). */
export function toolFromCode(code: number): InkTool {
  return TOOLS_BY_CODE[code] ?? 'pen';
}

/** True for a tool byte this version knows. */
export function isKnownToolCode(code: number): boolean {
  return Number.isInteger(code) && code >= 0 && code < TOOLS_BY_CODE.length;
}

export function codeOfTool(tool: InkTool): number {
  return TOOL_CODES[tool];
}

/** Width presets in millimeters for each tool. The marker and the brush share the pen's until the pen library lands. */
export const WIDTH_PRESETS_MM: Readonly<Record<InkTool, readonly number[]>> = {
  pen: [0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0, 3.5],
  pencil: [0.5, 0.7, 1.0, 2.0],
  highlighter: [2, 4, 6, 8],
  marker: [0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0, 3.5],
  brush: [0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0, 3.5],
};

/** The width a new pen starts with: the third pen preset, 0.5 mm, and the middle of each other list. */
export const DEFAULT_WIDTH_MM: Readonly<Record<InkTool, number>> = {
  pen: 0.5,
  pencil: 0.7,
  highlighter: 6,
  marker: 0.5,
  brush: 0.5,
};

/** The widest and narrowest nominal width a person can set, in millimeters, so a scaled stroke stays drawable. */
export const MIN_WIDTH_MM = 0.1;
export const MAX_WIDTH_MM = 24;

export function mmToPage(mm: number): number {
  return mm * PAGE_UNITS_PER_MM;
}

export function pageToMm(units: number): number {
  return units / PAGE_UNITS_PER_MM;
}

/** True for tools whose color is a highlighter slot, which draws under the other strokes of its block. */
export function isHighlighter(tool: InkTool): boolean {
  return tool === 'highlighter';
}
