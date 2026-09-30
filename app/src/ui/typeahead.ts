// Type-ahead for trees, menus, and lists (ARCHITECTURE.md section 13.4). Case and accents don't matter, the
// search starts after the current item and wraps, and typing the same letter again cycles through the items
// that start with it.

import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { tokens } from '../theme/tokens';

const collator = new Intl.Collator('en-US', { sensitivity: 'base', usage: 'search' });

/** NFD, then combining marks removed, so "É" compares as "E". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function startsWith(label: string, prefix: string): boolean {
  const folded = fold(label);
  const chars = [...prefix];
  return collator.compare([...folded].slice(0, chars.length).join(''), prefix) === 0;
}

/**
 * The index of the next label that starts with `buffer`, searching after `startIndex` and wrapping around, or
 * -1 when none does. A buffer of one repeated letter, such as "bbb", cycles through the labels starting with it.
 */
export function typeaheadMatch(labels: readonly string[], startIndex: number, buffer: string): number {
  if (labels.length === 0 || buffer.length === 0) return -1;
  const chars = [...fold(buffer)];
  const repeated = chars.every((char) => collator.compare(char, chars[0]) === 0);
  const prefix = repeated ? chars[0] : chars.join('');
  // A longer buffer keeps the current item when it still matches, so typing "mi" stays on "Mitosis".
  const first = repeated || chars.length === 1 ? 1 : 0;
  for (let step = first; step < labels.length + first; step += 1) {
    const index = (((startIndex + step) % labels.length) + labels.length) % labels.length;
    if (startsWith(labels[index], prefix)) return index;
  }
  return -1;
}

/**
 * Collects printable keys into a buffer that clears after a pause, and calls onType with it. The returned
 * handler says whether it used the key. Keys with Ctrl, Alt, or the Windows key, and input method composition,
 * are ignored.
 */
export function useTypeahead(
  onType: (buffer: string) => void,
  options: { timeoutMs?: number } = {},
): (event: KeyboardEvent) => boolean {
  const buffer = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutMs = options.timeoutMs ?? tokens.interaction.typeaheadMs;
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return useCallback(
    (event: KeyboardEvent) => {
      const { key, ctrlKey, altKey, metaKey, nativeEvent } = event;
      if (ctrlKey || altKey || metaKey || nativeEvent.isComposing || key === 'Process') return false;
      if ([...key].length !== 1 || (key === ' ' && buffer.current === '')) return false;
      buffer.current += key;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => (buffer.current = ''), timeoutMs);
      onType(buffer.current);
      return true;
    },
    [onType, timeoutMs],
  );
}
