// The palette's popup: a listbox of options in labeled groups, never a menu (ARCHITECTURE.md section 14.6).
// Focus stays in the input, which points at the highlighted option with aria-activedescendant. An option's name is
// its title, then its shortcut in a <kbd>; a path is its description, and a command's state is aria-checked.

import { useLayoutEffect } from 'react';
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
      <span className={styles.optionTitle}>{result.title}</span>
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
  return (
    <div role="listbox" id={id} aria-label={t('palette.results')} className={styles.list}>
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
  );
}
