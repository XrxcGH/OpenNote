// A calculator session as plain data: the angle mode, the answer history, and nine memory slots. Every function
// returns a new session. Only answers go into the history, never errors.

import { calculate } from './evaluate';
import type { CalcResult } from './errors';
import { dropTrailingEquals, snap, type AngleMode } from '../../../core/expr';

export const MEMORY_SLOTS = 9;
export const MAX_HISTORY = 200;

export interface HistoryEntry {
  id: number;
  /** The expression as evaluated, with a leading "ans" filled in if the user started with an operator. */
  expression: string;
  value: number;
  /** The angle mode in force, because sin(30) means different things in degrees and radians. */
  angle: AngleMode;
}

export interface CalcSession {
  angle: AngleMode;
  history: HistoryEntry[];
  /** Slots m1 to m9. Null means empty, and an empty slot reads as 0. */
  memory: (number | null)[];
  nextId: number;
}

export function newSession(angle: AngleMode = 'deg'): CalcSession {
  return { angle, history: [], memory: Array.from({ length: MEMORY_SLOTS }, () => null), nextId: 1 };
}

/** The value "ans" has: the last answer, or 0 before the first. */
export function lastAnswer(session: CalcSession): number {
  return session.history.at(-1)?.value ?? 0;
}

/** Starting with *, /, ^, ×, or ÷ continues from the last answer, as on a handheld calculator. */
function continued(input: string): string {
  const text = dropTrailingEquals(input.trim());
  return /^[*/^×÷]/.test(text) ? `ans${text}` : text;
}

/** Evaluates the input. A good answer goes into the history and becomes "ans". An error changes nothing. */
export function submit(session: CalcSession, input: string): { session: CalcSession; result: CalcResult } {
  const expression = continued(input);
  const result = calculate(expression, { angle: session.angle, ans: lastAnswer(session), memory: session.memory });
  if (!result.ok) return { session, result };
  const entry: HistoryEntry = { id: session.nextId, expression, value: result.value, angle: session.angle };
  const history = [...session.history, entry].slice(-MAX_HISTORY);
  return { session: { ...session, history, nextId: session.nextId + 1 }, result };
}

export function setAngleMode(session: CalcSession, angle: AngleMode): CalcSession {
  return { ...session, angle };
}

export function clearHistory(session: CalcSession): CalcSession {
  return { ...session, history: [] };
}

function changeSlot(session: CalcSession, slot: number, change: (old: number) => number): CalcSession {
  if (!Number.isInteger(slot) || slot < 1 || slot > MEMORY_SLOTS) return session;
  const memory = session.memory.map((v, i) => (i === slot - 1 ? change(v ?? 0) : v));
  return { ...session, memory };
}

/** Stores a value in slot 1 to 9. */
export function memoryStore(session: CalcSession, slot: number, value: number): CalcSession {
  return changeSlot(session, slot, () => value);
}

/** Adds to a slot, like "M+". Use a negative amount for "M-". */
export function memoryAdd(session: CalcSession, slot: number, amount: number): CalcSession {
  return changeSlot(session, slot, (old) => snap(old + amount));
}

/** Empties one slot, or all of them if no slot is given. */
export function memoryClear(session: CalcSession, slot?: number): CalcSession {
  const index = slot === undefined ? null : slot - 1;
  if (index !== null && !(Number.isInteger(index) && index >= 0 && index < MEMORY_SLOTS)) return session;
  return { ...session, memory: session.memory.map((v, i) => (index === null || i === index ? null : v)) };
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function restoreEntry(raw: unknown): HistoryEntry | null {
  if (!isObject(raw) || typeof raw.expression !== 'string' || !isNumber(raw.value) || !isNumber(raw.id)) return null;
  return { id: raw.id, expression: raw.expression, value: raw.value, angle: raw.angle === 'rad' ? 'rad' : 'deg' };
}

/** Rebuilds a session from saved JSON, dropping anything it can't read. */
export function restoreSession(raw: unknown): CalcSession {
  const fresh = newSession();
  if (!isObject(raw)) return fresh;
  const history = (Array.isArray(raw.history) ? raw.history : []).flatMap((e) => restoreEntry(e) ?? []);
  const saved = Array.isArray(raw.memory) ? raw.memory : [];
  const memory = fresh.memory.map((_, i) => (isNumber(saved[i]) ? saved[i] : null));
  const nextId = Math.max(1, ...history.map((e) => e.id + 1));
  return { angle: raw.angle === 'rad' ? 'rad' : 'deg', history: history.slice(-MAX_HISTORY), memory, nextId };
}
