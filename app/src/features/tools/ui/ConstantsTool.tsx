// Scientific constants (science helpers): a searchable picker over the 2022 CODATA values. Choosing a button puts the
// symbol, the value, or both at the caret, as text or as an equation. Each row says what name to type in Math with
// variables and units, where the same constant is already known.
import { useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import {
  CODATA,
  codataInsertLatex,
  codataInsertText,
  codataText,
  codataUncertainty,
  searchCodata,
} from '../science/codata';
import type { Codata, ConstantGroup, InsertPart } from '../science/codata';
import { insertIntoPage } from './CalculatorTool';
import { loadStored, saveStored } from './storage';
import cs from './constants.module.css';
import extra from './extra.module.css';
import science from './science.module.css';
import styles from './tools.module.css';

const STORE = 'constants';
const GROUPS: readonly (ConstantGroup | 'all')[] = ['all', 'universal', 'electromagnetic', 'atomic', 'thermodynamic'];
const PARTS: readonly InsertPart[] = ['symbol', 'value', 'both'];

interface Saved {
  as: 'text' | 'equation';
  group: ConstantGroup | 'all';
}

/** Writes a constant to the page. True when a page took it. */
export function insertConstant(one: Codata, part: InsertPart, as: 'text' | 'equation'): boolean {
  return as === 'equation'
    ? insertIntoPage({ math: { source: codataInsertLatex(one, part), display: false } })
    : insertIntoPage({ text: codataInsertText(one, part) });
}

const PART_LABEL = {
  symbol: 'science.constants.symbolOnly',
  value: 'science.constants.valueOnly',
  both: 'science.constants.both',
} as const;
const PART_ARIA = {
  symbol: 'science.constants.insertSymbol',
  value: 'science.constants.insertValue',
  both: 'science.constants.insertBoth',
} as const;

function loadSaved(): Saved {
  const stored = loadStored<Partial<Saved>>(STORE, {});
  return {
    as: stored.as === 'equation' ? 'equation' : 'text',
    group: GROUPS.includes(stored.group as ConstantGroup) ? (stored.group as Saved['group']) : 'all',
  };
}

function useConstants() {
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [query, setQuery] = useState('');
  const update = (next: Saved) => {
    setSaved(next);
    saveStored(STORE, next);
  };
  const shown = useMemo(
    () => searchCodata(query, saved.group === 'all' ? CODATA : CODATA.filter((one) => one.group === saved.group)),
    [query, saved.group],
  );
  const insert = (one: Codata, part: InsertPart) => {
    const ok = insertConstant(one, part, saved.as);
    announce(ok ? t('science.constants.inserted', { name: one.name }) : t('science.constants.noPage'));
  };
  const copy = async (one: Codata) => {
    try {
      await navigator.clipboard.writeText(codataText(one, false));
      announce(t('science.constants.copied', { name: one.name }));
    } catch {
      announce(t('science.constants.noPage'));
    }
  };
  return { saved, query, setQuery, update, shown, insert, copy };
}

function Controls({ saved, update }: { saved: Saved; update: (next: Saved) => void }) {
  return (
    <div className={science.row}>
      <label className={extra.field}>
        {t('science.constants.groupLabel')}
        <select
          className={extra.input}
          value={saved.group}
          onChange={(event) => update({ ...saved, group: event.target.value as Saved['group'] })}
        >
          {GROUPS.map((one) => (
            <option key={one} value={one}>
              {t(`science.constants.groups.${one}`)}
            </option>
          ))}
        </select>
      </label>
      <div role="group" aria-label={t('science.constants.as')} className={science.choice}>
        <span className={science.choiceLabel} aria-hidden="true">
          {t('science.constants.as')}
        </span>
        {(['text', 'equation'] as const).map((one) => (
          <button
            key={one}
            type="button"
            className={science.toggle}
            aria-pressed={saved.as === one}
            onClick={() => update({ ...saved, as: one })}
          >
            {t(one === 'text' ? 'science.constants.asText' : 'science.constants.asEquation')}
          </button>
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  one: Codata;
  insert: (one: Codata, part: InsertPart) => void;
  copy: (one: Codata) => Promise<void>;
}

function ConstantRow({ one, insert, copy }: RowProps) {
  return (
    <tr>
      <th scope="row" className={`${cs.name}`}>
        {one.name}
        <span className={science.sub}>
          {one.unc === ''
            ? t('science.constants.exact')
            : t('science.constants.uncertainty', { value: codataUncertainty(one).toExponential(1) })}
          {one.calc === '' ? '' : ` · ${t('science.constants.liveName', { name: one.calc })}`}
        </span>
      </th>
      <td className={cs.symbol}>{one.symbol}</td>
      <td className={cs.value}>
        <span className={cs.number}>{codataText(one)}</span>
        {one.unit === '' ? null : <span className={cs.unit}>{one.unit}</span>}
        <span className={cs.buttons} role="group" aria-label={one.name}>
          {PARTS.map((part) => (
            <Button
              key={part}
              variant="quiet"
              aria-label={t(PART_ARIA[part], { name: one.name })}
              onClick={() => insert(one, part)}
            >
              {t(PART_LABEL[part])}
            </Button>
          ))}
          <Button
            variant="quiet"
            aria-label={t('science.constants.copyOne', { name: one.name })}
            onClick={() => void copy(one)}
          >
            {t('science.constants.copy')}
          </Button>
        </span>
      </td>
    </tr>
  );
}

function ConstantsTable({ shown, insert, copy }: { shown: readonly Codata[] } & Omit<RowProps, 'one'>) {
  return (
    <div className={cs.scroll}>
      <table className={cs.table} aria-label={t('science.constants.list')}>
        <thead>
          <tr>
            <th scope="col">{t('science.constants.name')}</th>
            <th scope="col">{t('science.constants.symbol')}</th>
            <th scope="col">{t('science.constants.value')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((one) => (
            <ConstantRow key={one.id} one={one} insert={insert} copy={copy} />
          ))}
        </tbody>
      </table>
      <p className={`${styles.note} ${cs.footnote}`}>{t('science.constants.source')}</p>
    </div>
  );
}

export function ConstantsTool() {
  const { saved, query, setQuery, update, shown, insert, copy } = useConstants();
  return (
    <div className={styles.toolFill}>
      <TextField label={t('science.constants.search')} value={query} onChange={setQuery} />
      <Controls saved={saved} update={update} />
      <p className={styles.note} role="status">
        {t('science.constants.count', { count: shown.length })}
      </p>
      {query.trim() !== '' && shown.length === 0 ? (
        <p className={styles.empty} role="status">
          {t('science.constants.noMatch', { query: query.trim() })}
        </p>
      ) : null}
      <ConstantsTable shown={shown} insert={insert} copy={copy} />
    </div>
  );
}
