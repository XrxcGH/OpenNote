// Ask your notes: a question box, the answer, and the pages and paragraphs it used as links. The answer can be wrong,
// and the links are the check, so the screen says so and puts them beside the answer.
import { useEffect, useId, useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, Dialog, TextField } from '../../../ui';
import { loadSavedIndex, meaningState, startIndexing } from '../meaning/engine';
import { openModal } from '../modal';
import { openPageById } from '../openPage';
import styles from '../plus.module.css';
import { askNotes } from './answer';
import type { Answer } from './answer';

type Result = { kind: 'idle' } | { kind: 'asking' } | { kind: 'none' } | { kind: 'answer'; answer: Answer };

function Ask({ onClose }: { onClose(): void }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const state = useStore(meaningState, (current) => current);
  const listId = useId();
  useEffect(() => {
    void loadSavedIndex().then(() => startIndexing());
  }, []);
  const ask = async () => {
    if (!question.trim()) return;
    setResult({ kind: 'asking' });
    const answer = await askNotes(question).catch(() => null);
    setResult(answer ? { kind: 'answer', answer } : { kind: 'none' });
  };
  return (
    <Dialog
      title={t('intelPlus.ask.title')}
      description={t('intelPlus.ask.body')}
      size="medium"
      initialFocus="first"
      onDismiss={onClose}
      actions={[
        { id: 'close', label: t('intelPlus.ask.close'), variant: 'secondary', onPress: onClose },
        { id: 'ask', label: t('intelPlus.ask.ask'), variant: 'primary', onPress: ask },
      ]}
    >
      <div className={styles.stack}>
        <TextField
          label={t('intelPlus.ask.label')}
          value={question}
          onChange={setQuestion}
          onCommit={() => void ask()}
        />
        {state.running && (
          <p className={styles.help} role="status">
            {t('intelPlus.meaning.progress', { done: state.done, total: state.total })}
          </p>
        )}
        <div aria-live="polite">
          {result.kind === 'asking' && <p>{t('intelPlus.ask.working')}</p>}
          {result.kind === 'none' && <p>{t('intelPlus.ask.none')}</p>}
          {result.kind === 'answer' && (
            <>
              <p>{result.answer.text}</p>
              <p className={styles.help}>
                {result.answer.quoted ? t('intelPlus.ask.quoted') : t('intelPlus.ask.composed')}{' '}
                {t('intelPlus.ask.check')}
              </p>
              <h3 className={styles.heading}>{t('intelPlus.ask.sources')}</h3>
              <ol id={listId} className={styles.list}>
                {result.answer.sources.map((source, index) => (
                  <li key={`${source.pageId}-${source.block ?? index}`}>
                    <Button
                      variant="quiet"
                      aria-label={t('intelPlus.ask.openSource', { number: index + 1, title: source.title })}
                      onClick={() => {
                        onClose();
                        void openPageById(source.pageId);
                      }}
                    >
                      {`[${index + 1}] ${source.title || t('intelPlus.meaning.untitled')}`}
                    </Button>
                    <blockquote className={styles.quote}>{source.text.slice(0, 220)}</blockquote>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function openAskDialog(): void {
  openModal((close) => <Ask onClose={close} />);
}
