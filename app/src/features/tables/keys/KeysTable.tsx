// The Table keys section of the shortcut list (ADR 0063): the fixed keys of Grid mode and Edit mode. The keys a
// person may change are commands, so they are in the list's Table group with the others.
import { formatChord } from '../../../commands/keymap';
import type { Chord } from '../../../commands/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { SHEET_FIXED_KEYS } from './bindings';
import styles from './keys.module.css';

function Keys({ keys }: { keys: readonly string[] | MessageKey }) {
  if (typeof keys === 'string') return <span>{t(keys)}</span>;
  return (
    <span>
      {keys.map((key, i) => (
        <span key={key}>
          {i > 0 && <span className={styles.or}>{t('shortcuts.or')}</span>}
          <kbd className={styles.kbd}>{formatChord(key as Chord)}</kbd>
        </span>
      ))}
    </span>
  );
}

export function SheetKeysTable() {
  return (
    <>
      <p className={styles.note}>{t('sheetKeys.fixed.description')}</p>
      <table className={styles.table} aria-label={t('sheetKeys.fixed.title')}>
        <thead hidden>
          <tr>
            <th scope="col">{t('shortcuts.fixed.actionColumn')}</th>
            <th scope="col">{t('shortcuts.fixed.keysColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {SHEET_FIXED_KEYS.map((row) => (
            <tr key={row.id}>
              <th scope="row" className={styles.name}>
                {t(row.action)}
              </th>
              <td>
                <Keys keys={row.keys} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
