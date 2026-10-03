// The shortcut list's tables. Each is a real <table> with row headers, so screen readers' table navigation works.
// Nothing is virtualized: the whole list is in the page.

import { useEffect, useId, useRef, useState } from 'react';
import { resetShortcut } from '../../state/keymap';
import { t } from '../../strings/t';
import { Button, announce } from '../../ui';
import { ChordList } from './ChordList';
import { KeyCapture } from './KeyCapture';
import { FIXED_KEYS } from './fixed';
import type { ShortcutGroup, ShortcutRow } from './rows';
import styles from './ShortcutList.module.css';

/** Under the dialog's h2 the headings are h3; under Settings' h1 they are h2. */
export type HeadingLevel = 2 | 3;

function CommandRow({ row }: { row: ShortcutRow }) {
  const [changing, setChanging] = useState(false);
  const actions = useRef<HTMLTableCellElement>(null);
  const afterChange = useRef(false);
  const reset = () => {
    void resetShortcut(row.id).then(() => announce(t('shortcuts.resetDone', { command: row.title })));
  };
  // When the change ends, focus goes back to the row's Change button, which the field had replaced.
  useEffect(() => {
    if (!changing && afterChange.current) {
      afterChange.current = false;
      actions.current?.querySelector('button')?.focus();
    }
  }, [changing]);
  return (
    <tr>
      <th scope="row" className={styles.name}>
        {row.title}
        {row.moved && <span className={styles.note}>{row.moved}</span>}
      </th>
      {changing ? (
        // While it listens, the field takes the empty actions cell too, so its prompt and hint have room.
        <td colSpan={2}>
          <KeyCapture
            row={row}
            onDone={() => {
              afterChange.current = true;
              setChanging(false);
            }}
          />
        </td>
      ) : (
        <>
          <td>
            <ChordList chords={row.keys} />
          </td>
          <td ref={actions} className={styles.actions}>
            {row.customizable && (
              <Button
                variant="quiet"
                aria-label={t('shortcuts.changeLabel', { command: row.title })}
                onClick={() => setChanging(true)}
              >
                {t('shortcuts.change')}
              </Button>
            )}
            {row.changed && (
              <Button variant="quiet" aria-label={t('shortcuts.resetLabel', { command: row.title })} onClick={reset}>
                {t('shortcuts.reset')}
              </Button>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

export function CommandTable({ group, level }: { group: ShortcutGroup; level: HeadingLevel }) {
  const id = useId();
  const Heading = `h${level}` as const;
  return (
    <section className={styles.group}>
      <Heading id={id}>{t(group.title)}</Heading>
      <table aria-labelledby={id} className={styles.table}>
        <colgroup>
          <col className={styles.nameColumn} />
          <col />
          <col className={styles.actionsColumn} />
        </colgroup>
        <thead className={styles.visuallyHidden}>
          <tr>
            <th scope="col">{t('shortcuts.commandColumn')}</th>
            <th scope="col">{t('shortcuts.keysColumn')}</th>
            <th scope="col">{t('shortcuts.actionsColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <CommandRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function FixedKeysTable({ level }: { level: HeadingLevel }) {
  const id = useId();
  const Heading = `h${level}` as const;
  return (
    <section className={styles.group}>
      <Heading id={id}>{t('shortcuts.fixed.title')}</Heading>
      <p className={styles.note}>{t('shortcuts.fixed.description')}</p>
      <table aria-labelledby={id} className={styles.table}>
        <thead className={styles.visuallyHidden}>
          <tr>
            <th scope="col">{t('shortcuts.fixed.actionColumn')}</th>
            <th scope="col">{t('shortcuts.fixed.keysColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {FIXED_KEYS.map((row) => (
            <tr key={row.id}>
              <th scope="row" className={styles.name}>
                {t(row.action)}
              </th>
              <td>{typeof row.keys === 'string' ? <span>{t(row.keys)}</span> : <ChordList chords={row.keys} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
