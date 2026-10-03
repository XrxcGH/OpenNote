// The keys cell while a shortcut is being changed (ARCHITECTURE.md sections 14.4 and 14.7). A field takes the next
// key press as the chord. Escape cancels, and Backspace removes the shortcut. Reserved chords say why they can't be
// used. A chord another command has asks first, with "Use it here" and "Cancel". The dispatcher leaves elements
// marked data-key-capture alone, so the field sees every key, even ones that run commands.

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatChord } from '../../commands/chords';
import type { AnyCommand } from '../../commands/keymap';
import type { Chord } from '../../commands/types';
import { interceptEscape } from '../../state/layers';
import { assignShortcut, setShortcut } from '../../state/keymap';
import { t } from '../../strings/t';
import { Button, announce, showToast } from '../../ui';
import { checkChord, hear } from './capture';
import type { ShortcutRow } from './rows';
import styles from './ShortcutList.module.css';

export type CaptureResult = 'changed' | 'removed' | 'canceled';

interface Conflict {
  readonly chord: Chord;
  readonly others: readonly AnyCommand[];
}

function conflictText(row: ShortcutRow, { chord, others }: Conflict): string {
  const [first, ...rest] = others;
  const params = { keys: formatChord(chord), other: t(first.title), command: row.title };
  return rest.length
    ? t('shortcuts.capture.conflictMore', { ...params, more: rest.length })
    : t('shortcuts.capture.conflict', params);
}

function useCapture(row: ShortcutRow, onDone: (result: CaptureResult) => void) {
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // Set while the field gives way to the prompt, so its removal isn't taken for the person tabbing away.
  const handingOver = useRef(false);
  const cancel = (say = true) => {
    if (say) announce(t('shortcuts.capture.canceled', { command: row.title }));
    onDone('canceled');
  };
  // Escape reaches the layer stack before the field. While capturing, it means "stop capturing", and nothing else.
  useEffect(() => interceptEscape(() => (cancel(), true)));

  const save = (run: Promise<void>, done: string, result: CaptureResult) => {
    run.then(
      () => {
        announce(done);
        onDone(result);
      },
      () => showToast({ message: t('errors.commandFailed'), tone: 'danger' }),
    );
  };
  const remove = () => save(setShortcut(row.id, []), t('shortcuts.capture.removed', { command: row.title }), 'removed');
  const assign = (chord: Chord) =>
    save(
      assignShortcut(row.id, chord),
      t('shortcuts.capture.changed', { command: row.title, keys: formatChord(chord) }),
      'changed',
    );
  const reject = (text: string) => {
    setProblem(text);
    announce(text);
  };

  const press = (event: KeyboardEvent<HTMLInputElement>) => {
    const heard = hear(event.nativeEvent);
    // Tab and Escape keep their own meaning. Every other key belongs to the field, even ones that run commands.
    if (event.key !== 'Tab' && event.key !== 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
    if (heard.kind === 'remove') return remove();
    if (heard.kind === 'unknown') return reject(t('shortcuts.capture.unknown'));
    if (heard.kind === 'chord') judge(heard.chord);
  };
  const judge = (chord: Chord) => {
    const verdict = checkChord(row.id, chord);
    if (verdict.kind === 'ok') return assign(chord);
    if (verdict.kind === 'problem') {
      return reject(t(`shortcuts.capture.${verdict.problem}`, { keys: formatChord(chord) }));
    }
    const found = { chord, others: verdict.others };
    setProblem(null);
    handingOver.current = true;
    setConflict(found);
    announce(conflictText(row, found));
  };
  // Tabbing away stops the change without a word. A window that loses focus keeps it, so coming back resumes.
  const leave = () => {
    if (!handingOver.current && document.hasFocus()) cancel(false);
  };
  return { problem, conflict, press, leave, cancel, assign };
}

export function KeyCapture({ row, onDone }: { row: ShortcutRow; onDone(result: CaptureResult): void }) {
  const { problem, conflict, press, leave, cancel, assign } = useCapture(row, onDone);
  const field = useRef<HTMLInputElement>(null);
  const prompt = useRef<HTMLDivElement>(null);
  const ids = { hint: useId(), problem: useId() };
  useEffect(() => {
    (conflict ? prompt.current?.querySelector('button') : field.current)?.focus();
  }, [conflict]);
  if (conflict) {
    return (
      <div
        ref={prompt}
        role="group"
        aria-label={t('shortcuts.capture.label', { command: row.title })}
        className={styles.prompt}
      >
        <p>{conflictText(row, conflict)}</p>
        <div className={styles.promptActions}>
          <Button variant="primary" onClick={() => assign(conflict.chord)}>
            {t('shortcuts.capture.useHere')}
          </Button>
          <Button onClick={() => cancel()}>{t('common.cancel')}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.capture}>
      <input
        ref={field}
        readOnly
        data-key-capture=""
        className={styles.captureField}
        aria-label={t('shortcuts.capture.label', { command: row.title })}
        aria-describedby={problem ? `${ids.hint} ${ids.problem}` : ids.hint}
        aria-invalid={problem ? true : undefined}
        placeholder={t('shortcuts.find.waiting')}
        onKeyDown={press}
        onBlur={leave}
      />
      <span id={ids.hint} className={styles.note}>
        {t('shortcuts.capture.hint')}
      </span>
      {problem && (
        <span id={ids.problem} className={styles.problem}>
          {problem}
        </span>
      )}
    </div>
  );
}
