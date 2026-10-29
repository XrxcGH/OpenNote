// The summary of a page in a dialog: the key sentences, each a button that goes to it on the page, and the keywords.
// "Copy summary" puts the sentences on the clipboard. Focus returns to where it was when the dialog closes.
import { useId } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../strings/t';
import { Dialog, showToast } from '../../ui';
import type { DialogAction } from '../../ui';
import styles from './intel.module.css';
import type { PageSummary } from './summary';

function SummaryBody({ summary, onGo }: { summary: PageSummary; onGo(go: (() => void) | null): void }) {
  const hint = useId();
  return (
    <div className={styles.summary}>
      <p>{t('intel.summary.description')}</p>
      <h3>{t('intel.summary.sentences')}</h3>
      <p id={hint}>{t('intel.summary.jumpHint')}</p>
      <ul className={styles.sentences} aria-describedby={hint}>
        {summary.sentences.map((sentence, index) => (
          <li key={index}>
            <button type="button" className={styles.sentence} onClick={() => onGo(sentence.reveal)}>
              {sentence.text}
            </button>
          </li>
        ))}
      </ul>
      <p>{t('intel.summary.shown', { count: summary.sentences.length, total: summary.total })}</p>
      {summary.keywords.length > 0 && (
        <>
          <h3>{t('intel.summary.keywords')}</h3>
          <ul className={styles.keywords}>
            {summary.keywords.map((keyword) => (
              <li key={keyword} className={styles.keyword}>
                {keyword}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Opens the dialog. It removes itself when closed. */
export function openSummary(summary: PageSummary): void {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let closed = false;
  const close = (then?: () => void) => {
    if (closed) return;
    closed = true;
    // Unmounting first returns focus to the opener, so the page moves its caret after that.
    queueMicrotask(() => {
      root.unmount();
      host.remove();
      then?.();
    });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary.sentences.map((sentence) => sentence.text).join('\n'));
      showToast({ message: t('intel.summary.copied') });
    } catch {
      showToast({ message: t('intel.problems.failed'), tone: 'danger' });
    }
  };
  const actions: DialogAction[] = [
    { id: 'copy', label: t('intel.summary.copy'), variant: 'secondary', onPress: copy },
    { id: 'close', label: t('intel.summary.close'), variant: 'primary', onPress: () => close() },
  ];
  root.render(
    <Dialog title={t('intel.summary.title')} actions={actions} initialFocus="first" onDismiss={() => close()}>
      <SummaryBody summary={summary} onGo={(go) => close(go ?? undefined)} />
    </Dialog>,
  );
}
