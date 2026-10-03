// A command's keys, each in a <kbd>, with "or" between them. No keys reads "None".

import { Fragment } from 'react';
import { formatChord } from '../../commands/keymap';
import type { Chord } from '../../commands/types';
import { t } from '../../strings/t';
import styles from './ShortcutList.module.css';

export function ChordList({ chords }: { chords: readonly string[] }) {
  if (chords.length === 0) return <span className={styles.none}>{t('shortcuts.none')}</span>;
  return (
    <span className={styles.chords}>
      {chords.map((chord, i) => (
        <Fragment key={chord}>
          {i > 0 && <span className={styles.or}>{t('shortcuts.or')}</span>}
          <kbd className={styles.kbd}>{formatChord(chord as Chord)}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
