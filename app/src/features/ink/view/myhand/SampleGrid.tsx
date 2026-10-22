// Rows of writing boxes: a character, then a box for each time it is written. The calibration page and the Math and
// science section both use it. One box at a time is in the tab order, and the arrow keys move between them.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import type { RawSample } from '../../myhand/style';
import { charName } from './names';
import { PenBox, moveFocus } from './PenBox';
import { setSample, styleState } from './store';
import styles from './myhand.module.css';

export interface GridRow {
  readonly char: string;
  /** The sample IDs of the row's boxes, in order. */
  readonly ids: readonly string[];
  readonly tall?: boolean;
}

export const BOX = { width: 72, height: 88, baseline: 62, guide: 20 } as const;
export const TALL_BOX = { width: 72, height: 150, baseline: 112, guide: 20 } as const;

/** Rows of boxes. `focusId` puts focus on that box when it changes, as Go to the first empty box does. */
export function SampleGrid(props: { rows: readonly GridRow[]; step?: number; focusId?: string | null }) {
  const samples = useStore(styleState, (s) => s.doc.progress.samples);
  const ids = props.rows.flatMap((row) => row.ids);
  const [focus, setFocus] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  const columns = Math.max(1, ...props.rows.map((row) => row.ids.length));

  const focusBox = (index: number) => {
    setFocus(index);
    holder.current?.querySelector<HTMLElement>(`[data-myhand-box="${index}"]`)?.focus();
  };

  // A new target takes focus; the box's own focus handler then makes it the one in the tab order.
  useEffect(() => {
    if (!props.focusId) return;
    const index = ids.indexOf(props.focusId);
    if (index >= 0) holder.current?.querySelector<HTMLElement>(`[data-myhand-box="${index}"]`)?.focus();
    // Only a new target moves focus; re-renders while writing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusId]);

  const starts = props.rows.map((_, r) => props.rows.slice(0, r).reduce((sum, row) => sum + row.ids.length, 0));
  return (
    <div className={styles.rows} ref={holder}>
      {props.rows.map((row, r) => {
        const name = row.tall ? t('myHand.names.tall', { name: charName(row.char) }) : charName(row.char);
        const size = row.tall ? TALL_BOX : BOX;
        return (
          <div className={styles.row} key={`${row.char}${row.tall ? ':tall' : ''}`}>
            <span className={styles.char} aria-hidden="true">
              {row.char}
            </span>
            {row.ids.map((id, n) => {
              const at = starts[r] + n;
              return (
                <PenBox
                  key={id}
                  index={at}
                  label={t('myHand.box.label', { name, n: n + 1, of: row.ids.length })}
                  sample={samples[id] ?? null}
                  {...size}
                  tabIndex={at === focus ? 0 : -1}
                  onFocus={() => setFocus(at)}
                  onChange={(sample: RawSample | null) => void setSample(id, sample, props.step)}
                  onKeyDown={(event) => {
                    const next = moveFocus(event, at, ids.length, columns);
                    if (next !== null) focusBox(next);
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
