// The open font list: a listbox that draws only the rows in view, each name in its own face. The active row
// scrolls into view when the highlight moves.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../strings/t';
import { rowPlaces } from './rows';
import type { Row } from './rows';
import { resolveFont } from './service';
import type { FontCatalog } from './service';
import styles from './fonts.module.css';

export const VISIBLE_ROWS = 10;
const OVERSCAN = 3;

/** The height of one row in pixels: a touch target on touch screens. */
export function rowHeight(): number {
  return document.documentElement.dataset.density === 'touch' ? 44 : 32;
}

export interface FontListProps {
  id: string;
  rows: readonly Row[];
  catalog: FontCatalog;
  active: number;
  onActive(index: number): void;
  onChoose(name: string): void;
}

function useScrollIntoView(active: number, height: number) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = list.current;
    if (box === null || active < 0) return;
    const at = active * height;
    if (at < box.scrollTop) box.scrollTop = at;
    else if (at + height > box.scrollTop + box.clientHeight) box.scrollTop = at + height - box.clientHeight;
  }, [active, height]);
  return list;
}

/** The id of an option row: built from its index, so it never holds a space and never repeats. */
export function optionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

/** The rows in view, grouped by section, each group named by its header. */
function visibleSections(rows: readonly Row[], section: readonly number[], first: number, last: number) {
  const groups: { start: number; label: string; indexes: number[] }[] = [];
  for (let index = first; index <= last; index++) {
    const start = section[index];
    const head = rows[start];
    const open = groups.at(-1);
    if (open !== undefined && open.start === start) open.indexes.push(index);
    else groups.push({ start, label: head.kind === 'header' ? head.text : '', indexes: [index] });
  }
  return groups;
}

export function FontList({ id, rows, catalog, active, onActive, onChoose }: FontListProps) {
  const height = rowHeight();
  const [top, setTop] = useState(0);
  const list = useScrollIntoView(active, height);
  const places = useMemo(() => rowPlaces(rows), [rows]);
  const shown = Math.min(rows.length, VISIBLE_ROWS);
  const first = Math.max(0, Math.floor(top / height) - OVERSCAN);
  const last = Math.min(rows.length - 1, Math.ceil((top + shown * height) / height) + OVERSCAN);
  const sections = visibleSections(rows, places.section, first, last);
  return (
    <div className={styles.popup}>
      <div
        ref={list}
        id={id}
        role="listbox"
        aria-label={t('textFonts.listLabel')}
        className={styles.list}
        style={{ blockSize: shown * height }}
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      >
        <div className={styles.spacer} style={{ blockSize: rows.length * height }}>
          {sections.map((group) => (
            <div key={group.start} role="group" aria-label={group.label}>
              {group.indexes.map((index) => {
                const row = rows[index];
                const place = { insetBlockStart: index * height, blockSize: height };
                if (row.kind === 'header') {
                  return (
                    <div key={index} className={styles.header} style={place} aria-hidden="true">
                      {row.text}
                    </div>
                  );
                }
                return (
                  <div
                    key={index}
                    id={optionId(id, index)}
                    role="option"
                    aria-selected={index === active}
                    aria-posinset={places.number[index]}
                    aria-setsize={places.options}
                    className={styles.option}
                    style={{ ...place, fontFamily: resolveFont(row.name, catalog).css }}
                    onPointerMove={() => index !== active && onActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onChoose(row.name)}
                  >
                    <span>{row.label}</span>
                    {row.hint === null ? null : <span className={styles.hint}>{row.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
