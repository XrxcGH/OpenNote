// The unit converter (Productivity and study tools): two boxes over the calculator's unit system. Typing in either
// box fills the other. "Insert into page" writes the conversion at the caret. There is no currency, because rates
// need the network.
import { useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { UNIT_CATEGORIES, convert, formatNumber, unitsIn } from '../calculator';
import type { UnitCategory } from '../calculator';
import { insertIntoPage } from './CalculatorTool';
import extra from './extra.module.css';
import { loadStored, saveStored } from './storage';
import styles from './tools.module.css';

const STORE = 'converter';

interface State {
  category: UnitCategory;
  from: string;
  to: string;
  text: string;
  /** Which box the person typed in last. */
  side: 'from' | 'to';
}

const FIRST: State = { category: 'length', from: 'mi', to: 'km', text: '1', side: 'from' };

/** The text the other box shows, or null when the typed text is not a number. */
export function otherSide(state: State): string | null {
  const value = Number(state.text.trim().replace(/,/g, ''));
  if (state.text.trim() === '' || !Number.isFinite(value)) return null;
  const result = state.side === 'from' ? convert(value, state.from, state.to) : convert(value, state.to, state.from);
  return result.ok ? formatNumber(result.value) : null;
}

export function ConverterTool() {
  const [state, setState] = useState<State>(() => {
    const saved = loadStored<Partial<State>>(STORE, {});
    return UNIT_CATEGORIES.includes(saved.category as UnitCategory) &&
      unitsIn(saved.category as UnitCategory).includes(saved.from ?? '') &&
      unitsIn(saved.category as UnitCategory).includes(saved.to ?? '')
      ? { ...FIRST, ...saved }
      : FIRST;
  });
  const units = useMemo(() => unitsIn(state.category), [state.category]);
  const update = (next: State) => {
    setState(next);
    saveStored(STORE, next);
  };
  const other = otherSide(state);
  const fromText = state.side === 'from' ? state.text : (other ?? '');
  const toText = state.side === 'to' ? state.text : (other ?? '');
  const invalid = other === null;

  const changeCategory = (category: UnitCategory) => {
    const list = unitsIn(category);
    update({ ...state, category, from: list[0], to: list[1] ?? list[0] });
  };

  const insert = () => {
    if (invalid) return;
    const text = `${fromText} ${state.from} = ${toText} ${state.to}`;
    announce(t(insertIntoPage({ text }) ? 'study.converter.inserted' : 'study.converter.noPage'));
  };

  const side = (which: 'from' | 'to', text: string, unit: string) => (
    <div className={extra.pair}>
      <label className={extra.field}>
        {t(which === 'from' ? 'study.converter.from' : 'study.converter.to')}
        <input
          type="text"
          inputMode="decimal"
          className={extra.input}
          value={text}
          aria-invalid={state.side === which && invalid ? true : undefined}
          onChange={(event) => update({ ...state, side: which, text: event.target.value })}
        />
      </label>
      <label className={extra.field}>
        {t('study.converter.unit')}
        <select
          className={extra.input}
          value={unit}
          onChange={(event) => update({ ...state, [which]: event.target.value })}
        >
          {units.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className={styles.tool}>
      <label className={extra.field}>
        {t('study.converter.kind')}
        <select
          className={extra.input}
          value={state.category}
          onChange={(event) => changeCategory(event.target.value as UnitCategory)}
        >
          {UNIT_CATEGORIES.map((one) => (
            <option key={one} value={one}>
              {t(`study.converter.categories.${one}`)}
            </option>
          ))}
        </select>
      </label>
      {side('from', fromText, state.from)}
      {side('to', toText, state.to)}
      <p className={styles.problem} role="status">
        {invalid ? t('study.converter.notNumber') : ''}
      </p>
      <div className={styles.buttons}>
        <Button variant="primary" disabled={invalid} onClick={insert}>
          {t('study.converter.insert')}
        </Button>
      </div>
      <p className={styles.note}>{t('study.converter.note')}</p>
    </div>
  );
}
