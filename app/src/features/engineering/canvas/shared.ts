// What every engineering block shares: the model kept in the block's data, sent as one undo step per finished
// change, and picked up again when undo, redo, or another window changes the block; and how numbers read.
import { useCallback, useState } from 'react';
import { formatNumber } from '../../../core/expr';

export interface BlockProps {
  data: Record<string, unknown>;
  readOnly: boolean;
  patch(data: Record<string, unknown>, fallback?: string): void;
  announce(text: string): void;
}

/**
 * The block's model: `draft` changes freely while a part is dragged, and `commit` saves it. A change from outside
 * (undo, another window) replaces the draft.
 */
export function useBlockModel<M>(
  raw: unknown,
  read: (raw: unknown) => M,
  save: (model: M) => void,
): { model: M; draft(next: M): void; commit(next?: M): void } {
  const [state, setState] = useState<{ model: M; seen: unknown; sent: unknown }>(() => ({
    model: read(raw),
    seen: raw,
    sent: undefined,
  }));
  // The page hands back what was saved as the same object; any other new value came from outside.
  let current = state;
  if (raw !== state.seen) {
    current = { ...state, seen: raw, model: raw === state.sent ? state.model : read(raw) };
    setState(current);
  }
  const { model } = current;
  const draft = useCallback((next: M) => setState((old) => ({ ...old, model: next })), []);
  const commit = useCallback(
    (next?: M) => {
      const value = next ?? model;
      setState((old) => ({ ...old, model: value, sent: value }));
      save(value);
    },
    [save, model],
  );
  return { model, draft, commit };
}

/** A number for people: four significant digits, a true minus sign, and ×10ⁿ in place of "e". */
export function fmt(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—';
  const text = formatNumber(Math.abs(value) < 1e-9 ? 0 : value, { digits });
  return superscriptPower(text).replace(/^-/, '−');
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
  '+': '',
};

/** "1.5e-7" becomes "1.5×10⁻⁷"; text without a power stays as it is. */
export function superscriptPower(text: string): string {
  const match = /^(-?[\d.]+)e([+-]?\d+)$/.exec(text);
  if (!match) return text;
  if (Number(match[2]) === 0) return match[1];
  return `${match[1]}×10${[...match[2]].map((c) => SUPERSCRIPT[c] ?? c).join('')}`;
}

/** A quantity for people: "6.25 kN". */
export const q = (value: number, unit: string): string => `${fmt(value)} ${unit}`.trim();

/** Reads a number field; empty or unreadable text keeps the old value. */
export function readNumber(text: string, fallback: number): number {
  const value = Number(text.replace('−', '-').replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) ? value : fallback;
}
