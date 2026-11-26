// The palette's popup: a listbox of options in labeled groups, never a menu (ARCHITECTURE.md section 14.6).
// Focus stays in the input, which points at the highlighted option with aria-activedescendant. An option's name is
// its title, then its shortcut in a <kbd>; a path is its description, and a command's state is aria-checked.

import { useLayoutEffect, useRef } from 'react';
import { formatChord } from '../../commands/keymap';
import type { PaletteResult } from '../../registries/types';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import styles from './CommandPalette.module.css';
import type { Ranked } from './search';

const GROUP_LABELS: Record<string, MessageKey> = {
  commands: 'palette.groups.commands',
  notebooks: 'palette.groups.notebooks',
  sections: 'palette.groups.sections',
  pages: 'palette.groups.pages',
  closed: 'qol.tabs.group',
  matches: 'search.groups.matches',
};

export const optionId = (listId: string, index: number) => `${listId}-option-${index}`;

interface OptionProps {
  result: PaletteResult;
  id: string;
  active: boolean;
  onHover(): void;
  onChoose(): void;
}

function Option({ result, id, active, onHover, onChoose }: OptionProps) {
  const [first] = result.keys ?? [];
  return (
    <div
      role="option"
      id={id}
      className={styles.option}
      aria-selected={active}
      aria-checked={result.checked}
      aria-disabled={result.disabled || undefined}
      aria-describedby={result.detail ? `${id}-detail` : undefined}
      onPointerMove={onHover}
      onClick={onChoose}
    >
      <span className={styles.optionTitle}>
        {result.ink && (
          <span aria-hidden="true" className={styles.ink} style={{ background: `var(--ink-${result.ink})` }} />
        )}
        {result.title}
      </span>
      {first && <kbd className={styles.keys}>{formatChord(first)}</kbd>}
      {result.detail && (
        <span id={`${id}-detail`} className={styles.detail} aria-hidden="true">
          {result.detail}
        </span>
      )}
    </div>
  );
}

export interface ResultListProps {
  id: string;
  ranked: Ranked;
  activeIndex: number;
  onHover(index: number): void;
  onChoose(result: PaletteResult): void;
}

export function ResultList({ id, ranked, activeIndex, onHover, onChoose }: ResultListProps) {
  useLayoutEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(id, activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [id, activeIndex]);
  const starts = ranked.groups.map((_, g) =>
    ranked.groups.slice(0, g).reduce((count, group) => count + group.results.length, 0),
  );
  // Once every provider has answered, an empty list says so where the results would be. The announcer has told
  // screen readers already, so the line isn't a live region.
  const empty = ranked.settled && ranked.flat.length === 0;
  const fitBelow = useFitBelow();
  return (
    <>
      <div ref={fitBelow} role="listbox" id={id} aria-label={t('palette.results')} className={styles.list}>
        {ranked.groups.map((group, g) => (
          <div key={group.id} role="group" aria-labelledby={`${id}-group-${group.id}`} className={styles.group}>
            <div role="presentation" id={`${id}-group-${group.id}`} className={styles.groupLabel}>
              {t(GROUP_LABELS[group.id] ?? 'palette.groups.other')}
            </div>
            {group.results.map((result, i) => {
              const at = starts[g] + i;
              return (
                <Option
                  key={result.id}
                  result={result}
                  id={optionId(id, at)}
                  active={at === activeIndex}
                  onHover={() => onHover(at)}
                  onChoose={() => onChoose(result)}
                />
              );
            })}
          </div>
        ))}
      </div>
      {empty && <p className={styles.empty}>{t('palette.none')}</p>}
    </>
  );
}

/** The room the list has under its top edge, down to 16 px above the window's bottom (the dialog layer's own padding). */
export const LIST_BOTTOM_MARGIN = 16;

/**
 * Keeps the list inside the window whatever sits above it: a title bar and an app bar, bigger text, or the compact
 * layout. A fixed sum for what is above the list (the old CSS) is wrong as soon as one of those changes
 * (Beta 8 walk VA-14: 19 px outside a 300 x 450 window).
 */
function useFitBelow() {
  const element = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const list = element.current;
    if (!list) return;
    const fit = () => {
      const room = window.innerHeight - list.getBoundingClientRect().top - LIST_BOTTOM_MARGIN;
      list.style.setProperty('--palette-list-room', `${Math.max(0, Math.floor(room))}px`);
    };
    fit();
    // The observer reports the resize that fitting itself causes, so it fits on the next frame, not inside its callback.
    let frame = 0;
    const fitLater = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };
    window.addEventListener('resize', fitLater);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitLater);
    if (list.parentElement) observer?.observe(list.parentElement);
    return () => {
      window.removeEventListener('resize', fitLater);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);
  return (node: HTMLElement | null) => {
    element.current = node;
  };
}
