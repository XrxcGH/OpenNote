// The live calculation block's data in page.json: which kit and tool made it, the inputs to reopen it with, and the
// words and numbers shown on the page. The fallback text is the summary and the key results, so search, export, and
// older versions of OpenNote keep the numbers. Inputs larger than INPUT_LIMIT are not kept (the block still shows
// its results, but cannot reopen the tool with them).

export const INPUT_LIMIT = 64 * 1024;

export interface KitCalcRow {
  label: string;
  value: string;
  unit: string;
}

export interface KitCalcData {
  kit: string;
  tool: string;
  /** The tool's title in words when the block was made. */
  title: string;
  summary: string;
  inputs: unknown;
  rows?: readonly KitCalcRow[];
  latex?: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function sizeOf(inputs: unknown): number {
  try {
    return JSON.stringify(inputs ?? null).length;
  } catch {
    return Infinity;
  }
}

/** The block's data, with the inputs dropped when they are too large or cannot be saved. */
export function kitCalcData(block: KitCalcData): KitCalcData {
  const rows = (block.rows ?? []).slice(0, 12).map((row) => ({ label: row.label, value: row.value, unit: row.unit }));
  return {
    kit: block.kit,
    tool: block.tool,
    title: block.title,
    summary: block.summary,
    inputs: sizeOf(block.inputs) <= INPUT_LIMIT ? (block.inputs ?? null) : null,
    ...(rows.length ? { rows } : {}),
    ...(block.latex ? { latex: block.latex } : {}),
  };
}

/** The block's data read back from page.json, or null when it is not a kit calculation. */
export function readKitCalc(data: Record<string, unknown>): KitCalcData | null {
  const kit = text(data.kit);
  const tool = text(data.tool);
  if (!kit || !tool) return null;
  const rows = Array.isArray(data.rows)
    ? data.rows
        .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
        .map((row) => ({ label: text(row.label), value: text(row.value), unit: text(row.unit) }))
    : [];
  return {
    kit,
    tool,
    title: text(data.title),
    summary: text(data.summary),
    inputs: data.inputs ?? null,
    ...(rows.length ? { rows } : {}),
    ...(text(data.latex) ? { latex: text(data.latex) } : {}),
  };
}

/** The block's words for search and export: the title, the summary, and one line per key result. */
export function kitCalcFallback(data: KitCalcData): string {
  const lines = [
    data.title,
    data.summary,
    ...(data.rows ?? []).map((row) => `${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ''}`),
  ];
  return lines.filter(Boolean).join('\n');
}
