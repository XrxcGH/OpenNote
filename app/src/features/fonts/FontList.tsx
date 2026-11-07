// The open font list: a listbox that draws only the rows in view, each name in its own face. The active row
// scrolls into view when the highlight moves.
import { useEffect, useRef, useState } from 'react';
import { t } from '../../strings/t';
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

export function FontList({ id, rows, catalog, active, onActive, onChoose }: FontListProps) {
  const height = rowHeight();
  const [top, setTop] = useState(0);
  const list = useScrollIntoView(active, height);
  const shown = Math.min(rows.length, VISIBLE_ROWS);
  const first = Math.max(0, Math.floor(top / height) - OVERSCAN);
  const last = Math.min(rows.length - 1, Math.ceil((top + shown * height) / height) + OVERSCAN);
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
          {rows.slice(first, last + 1).map((row, offset) => {
            const index = first + offset;
            const place = { insetBlockStart: index * height, blockSize: height };
            if (row.kind === 'header') {
              return (
                <div key={row.id} className={styles.header} style={place} aria-hidden="true">
                  {row.text}
                </div>
              );
            }
            return (
              <div
                key={row.id}
                id={`${id}-${row.id}`}
                role="option"
                aria-selected={index === active}
                aria-posinset={index + 1}
                aria-setsize={rows.length}
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
      </div>
    </div>
  );
}
