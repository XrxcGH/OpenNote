import { useState } from 'react';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { NumberInput, Select } from './controls';
import type { TabProps } from './controls';
import { withProp } from './draft';
import styles from './formatCells.module.css';

const H_VALUES = ['general', 'left', 'center', 'right', 'fill', 'justify', 'centerAcross', 'distributed'] as const;
const V_VALUES = ['top', 'middle', 'bottom', 'justify', 'distributed'] as const;
const WRAPS = ['wrap', 'overflow', 'clip'] as const;
const DIRECTIONS = ['context', 'ltr', 'rtl'] as const;

type Side = 't' | 'r' | 'b' | 'l';

const PADS: readonly (readonly [Side, MessageKey])[] = [
  ['t', 'sheetFormat.align.padTop'],
  ['r', 'sheetFormat.align.padRight'],
  ['b', 'sheetFormat.align.padBottom'],
  ['l', 'sheetFormat.align.padLeft'],
];

/** The orientation dial, its degree field, and stacked text. */
function Rotation({ style, set }: Pick<TabProps, 'style' | 'set'>) {
  const rotate = style.align?.rotate;
  const degrees = typeof rotate === 'number' ? rotate : 0;
  const stacked = rotate === 'stacked';
  const write = (value: number | 'stacked' | undefined) => set(withProp(style, 'align', 'rotate', value));
  return (
    <>
      <fieldset className={styles.group} disabled={stacked}>
        <legend>{t('sheetFormat.align.rotation')}</legend>
        <input
          type="range"
          min={-90}
          max={90}
          value={degrees}
          aria-label={t('sheetFormat.align.dial')}
          onChange={(e) => write(Number(e.target.value) || undefined)}
        />
        <NumberInput
          label={t('sheetFormat.align.rotation')}
          value={degrees}
          min={-90}
          max={90}
          onChange={(n) => write(n ? n : undefined)}
        />
      </fieldset>
      <label className={styles.check}>
        <input type="checkbox" checked={stacked} onChange={(e) => write(e.target.checked ? 'stacked' : undefined)} />
        {t('sheetFormat.align.stacked')}
      </label>
    </>
  );
}

/** The four paddings, with a toggle that gives all sides the same value. */
function Padding({ style, set }: Pick<TabProps, 'style' | 'set'>) {
  const [linked, setLinked] = useState(false);
  const pad = style.pad ?? {};
  const write = (side: Side, value: number | undefined) => {
    let next = style;
    for (const key of linked ? (['t', 'r', 'b', 'l'] as const) : [side]) next = withProp(next, 'pad', key, value);
    set(next);
  };
  return (
    <fieldset className={styles.group}>
      <legend>{t('sheetFormat.align.padding')}</legend>
      {PADS.map(([side, key]) => (
        <NumberInput
          key={side}
          label={t(key)}
          value={pad[side]}
          min={0}
          max={100}
          step={0.5}
          onChange={(n) => write(side, n)}
        />
      ))}
      <label className={styles.check}>
        <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
        {t('sheetFormat.align.link')}
      </label>
    </fieldset>
  );
}

export function AlignmentTab({ style, set }: TabProps) {
  const align = style.align ?? {};
  const put = (key: string, value: unknown) => set(withProp(style, 'align', key, value));
  return (
    <div className={styles.grid}>
      <Select
        label={t('sheetFormat.align.horizontal')}
        value={align.h ?? 'general'}
        values={H_VALUES}
        name={(v) => t(`sheetFormat.align.h.${v}`)}
        onChange={(v) => put('h', v === 'general' ? undefined : v)}
      />
      <Select
        label={t('sheetFormat.align.vertical')}
        value={align.v ?? 'top'}
        values={V_VALUES}
        name={(v) => t(`sheetFormat.align.v.${v}`)}
        onChange={(v) => put('v', v)}
      />
      <NumberInput
        label={t('sheetFormat.align.indent')}
        value={align.indent ?? 0}
        min={0}
        max={15}
        onChange={(n) => put('indent', n ? n : undefined)}
      />
      <Select
        label={t('sheetFormat.align.wrap')}
        value={align.wrap ?? 'wrap'}
        values={WRAPS}
        name={(v) => t(`sheetFormat.align.w.${v}`)}
        onChange={(v) => put('wrap', v === 'wrap' ? undefined : v)}
      />
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={align.shrink === true}
          onChange={(e) => put('shrink', e.target.checked || undefined)}
        />
        {t('sheetFormat.align.shrink')}
      </label>
      <Select
        label={t('sheetFormat.align.direction')}
        value={align.dir ?? 'context'}
        values={DIRECTIONS}
        name={(v) => t(`sheetFormat.align.dir.${v}`)}
        onChange={(v) => put('dir', v === 'context' ? undefined : v)}
      />
      <Rotation style={style} set={set} />
      <Padding style={style} set={set} />
    </div>
  );
}
