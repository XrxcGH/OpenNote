// The history of the calculator's other modes (programmer, statistics, matrix) as plain data: what was asked and the
// answer, newest last. Every function returns a new list, and a saved list is read back defensively.

export interface ModeEntry {
  id: number;
  input: string;
  output: string;
}

export const MAX_MODE_HISTORY = 100;
const MAX_TEXT = 4000;

export function addEntry(entries: readonly ModeEntry[], input: string, output: string): ModeEntry[] {
  const id = Math.max(0, ...entries.map((entry) => entry.id)) + 1;
  return [...entries, { id, input: input.slice(0, MAX_TEXT), output: output.slice(0, MAX_TEXT) }].slice(
    -MAX_MODE_HISTORY,
  );
}

/** A saved history, dropping anything it can't read. */
export function restoreEntries(raw: unknown): ModeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { id, input, output } = entry as Record<string, unknown>;
      if (typeof id !== 'number' || !Number.isFinite(id) || typeof input !== 'string' || typeof output !== 'string')
        return [];
      return [{ id, input: input.slice(0, MAX_TEXT), output: output.slice(0, MAX_TEXT) }];
    })
    .slice(-MAX_MODE_HISTORY);
}
