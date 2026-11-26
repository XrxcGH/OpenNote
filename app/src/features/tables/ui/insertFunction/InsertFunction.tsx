// The Insert function dialog: search by name or by what a function does, narrow to a family, read the function's
// signature, description, and example, and insert it at the entry's caret.
import { useId, useState } from 'react';
import { t } from '../../../../strings/t';
import { Dialog } from '../../../../ui';
import type { Family } from '../../engine/formula/fn';
import type { DialogProps } from '../formulaBar/FormulaBar';
import type { FnInfo } from '../formulaBar/functions';
import styles from '../formulaBar/formulaBar.module.css';
import { FAMILIES, insertCall, searchFunctions } from './search';

interface Lists {
  list: string;
  found: FnInfo[];
  chosen: FnInfo | undefined;
}

function SearchField(
  props: Lists & { query: string; search(query: string): void; move(by: 1 | -1): void; insert(): void },
) {
  const { list, chosen, query, search, move, insert } = props;
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{t('sheetFormula.insert.search')}</label>
      <input
        id={id}
        className={styles.field}
        type="search"
        value={query}
        role="combobox"
        aria-expanded="true"
        aria-controls={list}
        aria-activedescendant={chosen ? `${list}-${chosen.name}` : undefined}
        onChange={(event) => search(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            insert();
          }
        }}
      />
    </>
  );
}

function FamilyField({ family, choose }: { family: Family | null; choose(family: Family | null): void }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{t('sheetFormula.insert.family')}</label>
      <select
        id={id}
        className={styles.field}
        value={family ?? ''}
        onChange={(event) => choose((event.currentTarget.value || null) as Family | null)}
      >
        <option value="">{t('sheetFormula.insert.all')}</option>
        {FAMILIES.map((f) => (
          <option key={f} value={f}>
            {t(`sheetFormula.insert.families.${f}`)}
          </option>
        ))}
      </select>
    </>
  );
}

function Results({ list, found, chosen, pick, insert }: Lists & { pick(i: number): void; insert(name: string): void }) {
  if (found.length === 0) return <p role="status">{t('sheetFormula.insert.none')}</p>;
  return (
    <ul id={list} role="listbox" aria-label={t('sheetFormula.insert.list')} className={styles.list}>
      {found.map((info, i) => (
        <li
          key={info.name}
          id={`${list}-${info.name}`}
          role="option"
          aria-selected={info === chosen}
          className={styles.option}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(i)}
          onDoubleClick={() => insert(info.name)}
        >
          {info.name}
        </li>
      ))}
    </ul>
  );
}

function Details({ chosen }: { chosen: FnInfo }) {
  return (
    <div className={styles.explain} aria-live="polite">
      <p>
        <strong>{chosen.signature}</strong>
      </p>
      {chosen.summary ? <p>{chosen.summary}</p> : null}
      <p className={styles.detail}>{t('sheetFormula.insert.example', { example: chosen.example })}</p>
    </div>
  );
}

export default function InsertFunction({ text, caret, onInsert, onClose }: DialogProps) {
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [index, setIndex] = useState(0);
  const list = useId();
  const found = searchFunctions(query, family);
  const chosen = found[Math.min(index, found.length - 1)];
  const insert = (name = chosen?.name) => {
    if (name) onInsert(insertCall(text, caret, name));
  };
  const lists = { list, found, chosen };
  return (
    <Dialog
      title={t('sheetFormula.insert.title')}
      size="medium"
      onDismiss={onClose}
      actions={[
        { id: 'cancel', label: t('sheetFormula.insert.cancel'), variant: 'secondary', onPress: onClose },
        {
          id: 'insert',
          label: t('sheetFormula.insert.insert'),
          variant: 'primary',
          onPress: () => insert(),
          disabled: !chosen,
        },
      ]}
    >
      <SearchField
        {...lists}
        query={query}
        search={(next) => {
          setQuery(next);
          setIndex(0);
        }}
        move={(by) => setIndex((i) => (i + by + Math.max(1, found.length)) % Math.max(1, found.length))}
        insert={() => insert()}
      />
      <FamilyField
        family={family}
        choose={(next) => {
          setFamily(next);
          setIndex(0);
        }}
      />
      <Results {...lists} pick={setIndex} insert={insert} />
      {chosen ? <Details chosen={chosen} /> : null}
    </Dialog>
  );
}
