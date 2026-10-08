// A writing suggestion with every change marked: added words are underlined and removed words are struck through, so
// the change shows without color. Nothing replaces the person's text until they choose Accept.
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { VisuallyHidden } from '../../../ui/VisuallyHidden';
import { openModal } from '../modal';
import styles from '../plus.module.css';
import { changeCount, diffWords } from './diff';
import type { WritingResult, WritingTool } from './ops';

function Marked({ before, result }: { before: string; result: WritingResult }) {
  const runs = diffWords(before, result.text);
  return (
    <p className={styles.marked}>
      {runs.map((run, index) =>
        run.kind === 'same' ? (
          <span key={index}>{run.text}</span>
        ) : run.kind === 'add' ? (
          <ins key={index} className={styles.added}>
            <VisuallyHidden>{t('intelPlus.writing.addedStart')}</VisuallyHidden>
            {run.text}
            <VisuallyHidden>{t('intelPlus.writing.addedEnd')}</VisuallyHidden>
          </ins>
        ) : (
          <del key={index} className={styles.removed}>
            <VisuallyHidden>{t('intelPlus.writing.removedStart')}</VisuallyHidden>
            {run.text}
            <VisuallyHidden>{t('intelPlus.writing.removedEnd')}</VisuallyHidden>
          </del>
        ),
      )}
    </p>
  );
}

/** Shows the suggestion. Resolves true when the person accepts it. */
export function showSuggestion(tool: WritingTool, before: string, result: WritingResult): Promise<boolean> {
  const count = changeCount(diffWords(before, result.text));
  return new Promise((resolve) => {
    openModal((close) => {
      const finish = (answer: boolean) => {
        resolve(answer);
        close();
      };
      return (
        <Dialog
          title={t(`intelPlus.writing.tools.${tool}`)}
          description={t('intelPlus.writing.reviewBody', { count })}
          size="medium"
          initialFocus="first"
          onDismiss={() => finish(false)}
          actions={[
            { id: 'cancel', label: t('intelPlus.writing.cancel'), variant: 'secondary', onPress: () => finish(false) },
            ...(count > 0
              ? [
                  {
                    id: 'accept',
                    label: t('intelPlus.writing.accept'),
                    variant: 'primary' as const,
                    onPress: () => finish(true),
                  },
                ]
              : []),
          ]}
        >
          <div className={styles.stack}>
            <Marked before={before} result={result} />
            <p className={styles.help}>{t('intelPlus.writing.legend')}</p>
          </div>
        </Dialog>
      );
    });
  });
}
