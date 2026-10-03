// The crash report consent screen (docs/design/SCREENS.md, Crash reports). Two buttons of the same size and weight,
// neither chosen for the person. Escape means no when the screen opened by itself, and changes nothing when the
// person opened it from Settings. The example report is a real report in the real format, hidden until asked for.

import { useEffect, useReducer, useRef, useState } from 'react';
import { t } from '../../strings/t';
import { Button, Dialog, announce, showToast } from '../../ui';
import { openConsent, reduceConsent, savingAllowed } from './consent';
import type { ConsentFlow } from './consent';
import styles from './Diagnostics.module.css';
import { changeConsent, diagnostics } from './runtime';

export function ConsentDialog({ reason, onClose }: { reason: ConsentFlow['reason']; onClose(): void }) {
  const [flow, dispatch] = useReducer(reduceConsent, reason, openConsent);
  const [example, setExample] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const now = () => Math.floor(Date.now() / 1000);

  useEffect(() => {
    if (!flow.showingExample || example !== null) return;
    let current = true;
    void diagnostics()
      .exampleReport()
      .then((report) => current && setExample(JSON.stringify(report, null, 2)))
      .catch(() => current && setExample(''));
    return () => {
      current = false;
    };
  }, [flow.showingExample, example]);

  useEffect(() => {
    if (!flow.closed) return;
    const { result } = flow;
    if (!result) {
      onClose();
      return;
    }
    void diagnostics()
      .setConsent(result)
      .then(() => {
        changeConsent(result);
        announce(t(savingAllowed(result) ? 'diagnostics.consent.announceOn' : 'diagnostics.consent.announceOff'));
      })
      .catch(() => showToast({ message: t('diagnostics.privacy.offlineFailed'), tone: 'danger' }))
      .finally(onClose);
  }, [flow, onClose]);

  const reworded = flow.reason === 'reworded';
  return (
    <Dialog
      title={t(reworded ? 'diagnostics.consent.titleReworded' : 'diagnostics.consent.title')}
      size="medium"
      initialFocus={body}
      onDismiss={() => dispatch({ type: 'dismiss', now: now() })}
      actions={[
        {
          id: 'keepOff',
          label: t('diagnostics.consent.keepOff'),
          variant: 'secondary',
          onPress: () => dispatch({ type: 'keepOff', now: now() }),
        },
        {
          id: 'turnOn',
          label: t('diagnostics.consent.turnOn'),
          variant: 'secondary',
          onPress: () => dispatch({ type: 'turnOn', now: now() }),
        },
      ]}
    >
      <div ref={body} tabIndex={-1} className={styles.body}>
        <p>{t('diagnostics.consent.intro')}</p>
        {reworded && <p>{t('diagnostics.consent.reworded')}</p>}
        <h3>{t('diagnostics.consent.holdsHeading')}</h3>
        <ul>
          <li>{t('diagnostics.consent.holdsWhere')}</li>
          <li>{t('diagnostics.consent.holdsVersions')}</li>
          <li>{t('diagnostics.consent.holdsTime')}</li>
        </ul>
        <h3>{t('diagnostics.consent.neverHeading')}</h3>
        <ul>
          <li>{t('diagnostics.consent.neverNotes')}</li>
          <li>{t('diagnostics.consent.neverFiles')}</li>
          <li>{t('diagnostics.consent.neverNames')}</li>
        </ul>
        <p>{t('diagnostics.consent.control')}</p>
        <div>
          <Button
            variant="quiet"
            aria-expanded={flow.showingExample}
            onClick={() => dispatch({ type: 'toggleExample' })}
          >
            {t(flow.showingExample ? 'diagnostics.consent.hideExample' : 'diagnostics.consent.seeExample')}
          </Button>
        </div>
        {flow.showingExample && (
          <pre className={styles.text} role="region" tabIndex={0} aria-label={t('diagnostics.consent.exampleLabel')}>
            {example ?? ''}
          </pre>
        )}
        <p className={styles.help}>{t('diagnostics.consent.changeLater')}</p>
      </div>
    </Dialog>
  );
}
