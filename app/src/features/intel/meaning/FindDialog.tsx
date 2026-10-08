// Find by meaning: type a few words or a question, and the pages about the same idea are listed with the paragraph
// that matched, even when the words differ. It reads only the index on this device.
import { useEffect, useId, useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Dialog, TextField } from '../../../ui';
import { openModal } from '../modal';
import { openPageById } from '../openPage';
import styles from '../plus.module.css';
import { findByMeaning, loadSavedIndex, meaningState, startIndexing } from './engine';

function Find({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const state = useStore(meaningState, (current) => current);
  const listId = useId();
  useEffect(() => {
    void loadSavedIndex().then(() => startIndexing());
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setText(query), 150);
    return () => clearTimeout(timer);
  }, [query]);
  // The index fills while the dialog is open, and this component follows its progress, so each render looks again.
  const hits = findByMeaning(text);
  const open = (pageId: string) => {
    onClose();
    void openPageById(pageId);
  };
  return (
    <Dialog
      title={t('intelPlus.meaning.findTitle')}
      description={t('intelPlus.meaning.findBody')}
      size="medium"
      initialFocus="first"
      onDismiss={onClose}
      actions={[{ id: 'close', label: t('intelPlus.meaning.close'), variant: 'primary', onPress: onClose }]}
    >
      <div className={styles.stack}>
        <TextField label={t('intelPlus.meaning.findLabel')} value={query} onChange={setQuery} />
        {state.running && (
          <p className={styles.help} role="status">
            {t('intelPlus.meaning.progress', { done: state.done, total: state.total })}
          </p>
        )}
        <ul id={listId} className={styles.list} aria-label={t('intelPlus.meaning.results')}>
          {hits.map((hit) => (
            <li key={hit.pageId}>
              <button type="button" className={styles.linkButton} onClick={() => open(hit.pageId)}>
                <strong>{hit.title || t('intelPlus.meaning.untitled')}</strong>
                {hit.chunk && <span className={styles.help}> {hit.chunk.text.slice(0, 140)}</span>}
              </button>
            </li>
          ))}
        </ul>
        {text.trim() !== '' && hits.length === 0 && (
          <p className={styles.help} role="status">
            {state.running ? t('intelPlus.meaning.stillReading') : t('intelPlus.meaning.none')}
          </p>
        )}
        <p className={styles.help}>{t('intelPlus.meaning.how')}</p>
      </div>
    </Dialog>
  );
}

export function openFindByMeaning(): void {
  openModal((close) => <Find onClose={close} />);
}
