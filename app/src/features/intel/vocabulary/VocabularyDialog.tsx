// Edits a notebook's custom vocabulary as plain text. The list can be imported from a text file and exported to
// one, so it can be shared. It is saved on this device only.
import { useId, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { announce, Button, Dialog, showToast } from '../../../ui';
import { openModal } from '../modal';
import styles from '../plus.module.css';
import { addTerm, countTerms, parseVocabulary } from './list';
import { loadVocabulary, saveVocabulary } from './store';

function Editor(props: { title: string; initial: string; onSave(text: string): Promise<void>; onClose(): void }) {
  const { title, initial, onSave, onClose } = props;
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const helpId = useId();
  const file = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    try {
      await onSave(text);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    try {
      const incoming = parseVocabulary(await chosen.text());
      const merge = (all: string, one: (typeof incoming)[number]) =>
        one.heardAs.length === 0
          ? addTerm(all, one.term)
          : one.heardAs.reduce((acc, h) => addTerm(acc, one.term, h), all);
      setText((current) => incoming.reduce(merge, current));
      showToast({ message: t('intelPlus.vocabulary.imported') });
    } catch {
      showToast({ message: t('intelPlus.vocabulary.saveFailed'), tone: 'danger' });
    }
  };
  const exportFile = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = t('intelPlus.vocabulary.exportName');
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <Dialog
      title={title}
      description={t('intelPlus.vocabulary.description')}
      size="medium"
      initialFocus="first"
      onDismiss={onClose}
      actions={[
        { id: 'cancel', label: t('intelPlus.vocabulary.cancel'), variant: 'secondary', onPress: onClose },
        { id: 'save', label: t('intelPlus.vocabulary.save'), variant: 'primary', onPress: save },
      ]}
    >
      <div className={styles.stack} aria-busy={busy}>
        <label id={labelId} htmlFor={`${labelId}-area`} className={styles.label}>
          {t('intelPlus.vocabulary.label')}
        </label>
        <textarea
          id={`${labelId}-area`}
          className={styles.textarea}
          rows={10}
          value={text}
          spellCheck={false}
          aria-describedby={helpId}
          onChange={(event) => setText(event.target.value)}
        />
        <p id={helpId} className={styles.help}>
          {t('intelPlus.vocabulary.help')} {t('intelPlus.vocabulary.count', { count: countTerms(text) })}
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => file.current?.click()}>
            {t('intelPlus.vocabulary.import')}
          </Button>
          <Button variant="secondary" onClick={exportFile}>
            {t('intelPlus.vocabulary.export')}
          </Button>
          <input
            ref={file}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}

/** Opens the editor for a notebook's list. `name` is the notebook's name, or null for the list for all notebooks. */
export async function openVocabularyEditor(notebookId: string | null, name: string | null): Promise<void> {
  const initial = await loadVocabulary(notebookId);
  const title = name ? t('intelPlus.vocabulary.forNotebook', { notebook: name }) : t('intelPlus.vocabulary.forAll');
  openModal((close) => (
    <Editor
      title={title}
      initial={initial}
      onClose={close}
      onSave={async (text) => {
        try {
          await saveVocabulary(notebookId, text);
          announce(t('intelPlus.vocabulary.saved'));
          showToast({ message: t('intelPlus.vocabulary.saved') });
          close();
        } catch {
          showToast({ message: t('intelPlus.vocabulary.saveFailed'), tone: 'danger' });
        }
      }}
    />
  ));
}
