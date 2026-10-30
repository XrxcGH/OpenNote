// A live calculation block: what the kit's Insert menu puts on the page so the work can be reopened. The block keeps
// the tool, the typed texts, the units, and the answer as text and LaTeX; its button hands the texts back to the
// tool. The data is read defensively, because the page keeps it and another version or a person may have changed it.
import { MECHDYN_TOOL_IDS } from '../meta';
import type { SavedInputs } from '../open';
import { answerLatex, answerText, type InsertContext } from './insert';

export const CALC_KIT = 'mechdyn';

export interface CalcData {
  kit: typeof CALC_KIT;
  tool: string;
  inputs: Record<string, string>;
  system: SavedInputs['system'];
  summary: string;
  latex: string;
}

/** The block's data for the tool's current work. */
export function calcData(c: InsertContext, texts: Readonly<Record<string, string>>): CalcData {
  return {
    kit: CALC_KIT,
    tool: c.tool,
    inputs: { ...texts },
    system: c.system,
    summary: answerText(c),
    latex: answerLatex(c),
  };
}

/** The block's data, or null when it isn't a calculation this kit can reopen. */
export function readCalc(data: unknown): CalcData | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = data as Record<string, unknown>;
  const { tool, inputs, system } = raw;
  if (raw.kit !== CALC_KIT || typeof tool !== 'string' || !MECHDYN_TOOL_IDS.includes(tool)) return null;
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) return null;
  const texts = Object.fromEntries(
    Object.entries(inputs as Record<string, unknown>).filter(
      (one): one is [string, string] => typeof one[1] === 'string',
    ),
  );
  return {
    kit: CALC_KIT,
    tool,
    inputs: texts,
    system: system === 'us' ? 'us' : 'si',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    latex: typeof raw.latex === 'string' ? raw.latex : '',
  };
}
