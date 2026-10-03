// "Find by shortcut" (ARCHITECTURE.md section 14.7): a field that listens for a chord, so the list shows the commands
// that use it. Like the editor's field, it is marked data-key-capture, so every key reaches it, even ones that run
// commands elsewhere. Escape stops listening, and Tab leaves the field as it always does.

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { formatChord } from '../../commands/chords';
import type { Chord } from '../../commands/types';
import { interceptEscape } from '../../state/layers';
import { t } from '../../strings/t';
import { hear } from './capture';
import styles from './ShortcutList.module.css';

export function FindByShortcut(props: { chord: Chord | null; onChord(chord: Chord): void; onStop(): void }) {
  const { chord, onChord, onStop } = props;
  const field = useRef<HTMLInputElement>(null);
  const hint = useId();
  useEffect(() => field.current?.focus(), []);
  // Escape reaches the layer stack before the field, and here it means "stop listening", so it stops there.
  useEffect(() => interceptEscape(() => (onStop(), true)));
  const press = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Tab' && event.key !== 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
    const heard = hear(event.nativeEvent);
    if (heard.kind === 'chord') onChord(heard.chord);
  };
  return (
    <div className={styles.capture}>
      <label className={styles.findLabel} htmlFor={`${hint}-field`}>
        {t('shortcuts.find.field')}
      </label>
      <input
        id={`${hint}-field`}
        ref={field}
        readOnly
        data-key-capture=""
        className={styles.captureField}
        aria-describedby={hint}
        placeholder={t('shortcuts.find.waiting')}
        value={chord ? formatChord(chord) : ''}
        onKeyDown={press}
      />
      <span id={hint} className={styles.note}>
        {t('shortcuts.find.hint')}
      </span>
    </div>
  );
}
