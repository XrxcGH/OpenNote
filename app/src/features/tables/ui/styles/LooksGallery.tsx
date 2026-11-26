// The Format as table gallery: the 21 looks as small samples (seven pens in a light, a medium, and a dark weight),
// "No look", and the Table Style Options checkboxes. The samples are drawn from the same look rules the table uses,
// so a sample is what the table will show. The choice applies on Apply, as one data patch.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { Dialog } from '../../../../ui/Dialog';
import type { Scheme } from '../../../../ui/color/parse';
import { layer } from '../../sheet/model';
import type { CellStyle, LookElement } from '../../sheet/model';
import { drawFill, colorOf } from '../../sheet/render/color';
import { LOOK_NAMES, lookStyle } from '../../sheet/render/looks';
import { cssLine } from '../../sheet/render/borders';
import formats from '../formatCells/formatCells.module.css';
import type { LookOptions } from './tableLook';
import styles from './styles.module.css';

export interface LooksGalleryProps {
  options: LookOptions;
  header: boolean;
  scheme: Scheme;
  onApply(options: LookOptions, header: boolean): void;
  onCancel(): void;
}

/** The name of a look in words: "Medium indigo". */
export function lookLabel(name: string): string {
  const [weight, pen] = name.split('-');
  return `${t(`sheetFormat.looks.weight.${weight}` as MessageKey)} ${t(`sheetFormat.looks.pen.${pen}` as MessageKey).toLowerCase()}`;
}

/** The style of one sample row: the whole-table element under the row's own (header, band, or plain). */
function sampleStyle(name: string, element: LookElement | null, scheme: Scheme): CellStyle {
  const whole = lookStyle(name, 'whole', scheme) ?? {};
  const own = element ? (lookStyle(name, element, scheme) ?? {}) : {};
  return layer(whole, own);
}

function MiniLook({ name, options, scheme }: { name: string; options: LookOptions; scheme: Scheme }) {
  const rows: (LookElement | null)[] = [
    'header',
    options.band.rows ? 'band1' : null,
    options.band.rows ? 'band2' : null,
    options.emphasis.totalRow ? 'total' : null,
  ];
  return (
    <span className={styles.mini} aria-hidden="true">
      {rows.flatMap((element, r) =>
        [0, 1, 2].map((c) => {
          const style = sampleStyle(name, element, scheme);
          const fill = drawFill(style.fill, scheme);
          const bottom = style.border?.b;
          const top = style.border?.t;
          const bold = style.font?.bold === true || (options.emphasis.firstCol && c === 0);
          return (
            <span
              key={`${r}-${c}`}
              className={styles.miniCell}
              style={{
                backgroundColor: fill.color,
                borderBottom: bottom ? cssLine(bottom, colorOf(bottom.color, scheme) ?? 'currentColor') : undefined,
                borderTop: top ? cssLine(top, colorOf(top.color, scheme) ?? 'currentColor') : undefined,
                fontWeight: bold ? 700 : undefined,
              }}
            />
          );
        }),
      )}
    </span>
  );
}

export function LooksGallery({
  options: initial,
  header: initialHeader,
  scheme,
  onApply,
  onCancel,
}: LooksGalleryProps) {
  const [options, setOptions] = useState<LookOptions>(initial);
  const [header, setHeader] = useState(initialHeader);
  const choices: (string | null)[] = [null, ...LOOK_NAMES];
  const flag = (label: MessageKey, on: boolean, change: (on: boolean) => void) => (
    <label className={formats.check}>
      <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} />
      {t(label)}
    </label>
  );
  return (
    <Dialog
      title={t('sheetFormat.looks.title')}
      size="large"
      onDismiss={onCancel}
      actions={[
        { id: 'cancel', label: t('sheetFormat.looks.cancel'), variant: 'secondary', onPress: onCancel },
        {
          id: 'apply',
          label: t('sheetFormat.looks.apply'),
          variant: 'primary',
          onPress: () => onApply(options, header),
        },
      ]}
    >
      <ul className={styles.gallery} aria-label={t('sheetFormat.looks.gallery')}>
        {choices.map((name) => (
          <li key={name ?? 'none'}>
            <button
              type="button"
              className={styles.look}
              aria-pressed={options.look === name}
              onClick={() => setOptions({ ...options, look: name })}
            >
              {name ? <MiniLook name={name} options={options} scheme={scheme} /> : null}
              <span>{name ? lookLabel(name) : t('sheetFormat.looks.none')}</span>
            </button>
          </li>
        ))}
      </ul>
      <fieldset className={formats.group}>
        <legend>{t('sheetFormat.looks.options')}</legend>
        <div className={styles.options}>
          {flag('sheetFormat.looks.header', header, setHeader)}
          {flag('sheetFormat.looks.total', options.emphasis.totalRow, (on) =>
            setOptions({ ...options, emphasis: { ...options.emphasis, totalRow: on } }),
          )}
          {flag('sheetFormat.looks.firstCol', options.emphasis.firstCol, (on) =>
            setOptions({ ...options, emphasis: { ...options.emphasis, firstCol: on } }),
          )}
          {flag('sheetFormat.looks.lastCol', options.emphasis.lastCol, (on) =>
            setOptions({ ...options, emphasis: { ...options.emphasis, lastCol: on } }),
          )}
          {flag('sheetFormat.looks.bandRows', options.band.rows, (on) =>
            setOptions({ ...options, band: { ...options.band, rows: on } }),
          )}
          {flag('sheetFormat.looks.bandCols', options.band.cols, (on) =>
            setOptions({ ...options, band: { ...options.band, cols: on } }),
          )}
        </div>
      </fieldset>
    </Dialog>
  );
}
