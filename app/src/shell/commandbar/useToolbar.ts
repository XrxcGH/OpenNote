// The toolbar's roving focus and its overflow into "More" (ARCHITECTURE.md section 14.5).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, RefObject } from 'react';
import { useDensity } from '../../state/layout';
import type { BarEntry } from './useBarItems';

const STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

function toolsIn(root: HTMLElement | null): HTMLElement[] {
  const all = root?.querySelectorAll<HTMLElement>('[data-tool]') ?? [];
  return [...all].filter((tool) => !tool.closest('[data-measure]'));
}

/**
 * One tool is in the tab order at a time: the last one focused, else the first. Arrow keys, Home, and End move
 * focus. The tools render with tabIndex -1, and this sets 0 on one of them after every render.
 */
export function useRovingTools(ref: RefObject<HTMLElement | null>) {
  const current = useRef<HTMLElement | null>(null);
  const mark = useCallback(
    (target: HTMLElement) => {
      current.current = target;
      toolsIn(ref.current).forEach((tool) => (tool.tabIndex = tool === target ? 0 : -1));
    },
    [ref],
  );
  useLayoutEffect(() => {
    const tools = toolsIn(ref.current);
    const last = current.current;
    if (tools.length) mark(last && tools.includes(last) ? last : tools[0]);
  });
  const onFocus = (event: FocusEvent) => {
    const tool = (event.target as Element).closest<HTMLElement>('[data-tool]');
    if (tool && toolsIn(ref.current).includes(tool)) mark(tool);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = STEPS[event.key];
    const tools = toolsIn(ref.current);
    const index = tools.indexOf(document.activeElement as HTMLElement);
    if (!step || index === -1) return;
    event.preventDefault();
    const next = tools[step(index, tools.length)];
    mark(next);
    next.focus();
  };
  return { onFocus, onKeyDown };
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Which items to move into More: none when everything fits, else the lowest priorities until the rest fit. */
export function overflowing(
  entries: readonly BarEntry[],
  widthOf: (id: string) => number,
  room: { width: number; more: number },
): Set<string> {
  const total = entries.reduce((sum, entry) => sum + widthOf(entry.item.id), 0);
  if (total <= room.width) return new Set();
  let used = room.more;
  const kept = new Set<string>();
  for (const entry of [...entries].sort((a, b) => b.item.priority - a.item.priority)) {
    const width = widthOf(entry.item.id);
    if (used + width > room.width) break;
    used += width;
    kept.add(entry.item.id);
  }
  return new Set(entries.filter((entry) => !kept.has(entry.item.id)).map((entry) => entry.item.id));
}

/**
 * Fits the tools to the toolbar as it resizes. Each tool is measured while it shows: after the set of tools or
 * the density changes, every tool shows again for one render, so widths are always current.
 */
export function useOverflow(ref: RefObject<HTMLElement | null>, entries: readonly BarEntry[]): ReadonlySet<string> {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const widths = useRef(new Map<string, number>());
  const latest = useRef(entries);
  const density = useDensity();
  const key = `${density} ${entries.map((entry) => entry.item.id).join(' ')}`;
  const [measuredFor, setMeasuredFor] = useState(key);
  if (measuredFor !== key) {
    setMeasuredFor(key);
    setHidden(new Set());
  }
  const fit = useCallback(() => {
    const bar = ref.current;
    if (!bar) return;
    for (const slot of bar.querySelectorAll<HTMLElement>('[data-item-id], [data-more]')) {
      widths.current.set(slot.dataset.itemId ?? 'more', slot.getBoundingClientRect().width);
    }
    const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
    const widthOf = (id: string) => (widths.current.get(id) ?? 0) + gap;
    const next = overflowing(latest.current, widthOf, { width: bar.clientWidth, more: widthOf('more') });
    setHidden((previous) => (sameIds(previous, next) ? previous : next));
  }, [ref]);
  useLayoutEffect(() => {
    latest.current = entries;
    fit();
  });
  useEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(bar);
    return () => observer.disconnect();
  }, [ref, fit]);
  return hidden;
}
