// The preview of what a vocabulary would change in a transcript: each change in words, and Apply or Cancel.
import type { VocabularyChange } from '../../../services/intel';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import styles from '../plus.module.css';
import { openModal } from '../modal';

/** Shows the changes. Resolves true when the person applies them. */
export function openPreview(changes: readonly VocabularyChange[]): Promise<boolean> {
  return new Promise((resolve) => {
    openModal((close) => {
      const finish = (answer: boolean) => {
        resolve(answer);
        close();
      };
      return (
        <Dialog
          title={t('intelPlus.vocabulary.previewTitle')}
          description={t('intelPlus.vocabulary.previewBody', { count: changes.length })}
          initialFocus="leastDestructive"
          onDismiss={() => finish(false)}
          actions={[
            {
              id: 'cancel',
              label: t('intelPlus.vocabulary.cancel'),
              variant: 'secondary',
              leastDestructive: true,
              onPress: () => finish(false),
            },
            { id: 'apply', label: t('intelPlus.vocabulary.apply'), variant: 'primary', onPress: () => finish(true) },
          ]}
        >
          <ul className={styles.changes}>
            {changes.map((change, index) => (
              <li key={`${change.span.start}-${index}`}>
                {t('intelPlus.vocabulary.previewChange', { from: change.from, to: change.to })}
              </li>
            ))}
          </ul>
        </Dialog>
      );
    });
  });
}
