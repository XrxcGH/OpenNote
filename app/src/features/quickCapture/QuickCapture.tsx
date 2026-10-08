// The quick capture window: one text box, Ctrl+Enter to save, Escape to close. It is a window of its own that the
// shell opens from the global shortcut, so it shows nothing else.

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { shellCall } from '../../platform/shellqol';
import { useNotes } from '../../services/notes';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { saveCapture } from './capture';
import styles from './QuickCapture.module.css';

export default function QuickCapture() {
  const notes = useNotes();
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const close = () => void shellCall('window.closeCapture').catch(() => window.close());
  const save = async () => {
    if (saving || text.trim() === '') return;
    setSaving(true);
    try {
      if (await saveCapture(notes, text)) return close();
      setFailed(true);
    } catch {
      setFailed(true);
    }
    setSaving(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  };
  return (
    <main className={styles.capture} onKeyDown={onKeyDown}>
      <label htmlFor="capture-text" className={styles.label}>
        {t('qol.capture.label')}
      </label>
      <textarea
        id="capture-text"
        ref={field}
        className={styles.text}
        value={text}
        autoFocus
        placeholder={t('qol.capture.placeholder')}
        onChange={(event) => setText(event.target.value)}
        aria-describedby="capture-help"
      />
      <p id="capture-help" className={failed ? styles.error : styles.help} role={failed ? 'alert' : undefined}>
        {failed ? t('qol.capture.failed') : t('qol.capture.help')}
      </p>
      <div className={styles.actions}>
        <Button variant="quiet" onClick={close}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={saving || text.trim() === ''} onClick={() => void save()}>
          {t('qol.capture.save')}
        </Button>
      </div>
    </main>
  );
}
