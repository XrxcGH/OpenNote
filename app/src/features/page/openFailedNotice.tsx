// The notice of a page that couldn't open. A damaged page.json offers to put back the newest saved version.

import { t } from '../../strings/t';
import { Button } from '../../ui';
import styles from './notice.module.css';
import { openFailureText } from './openFailure';
import type { OpenFailure } from './openFailure';

export function OpenFailedNotice(props: { failure: OpenFailure; onRecover?: () => void; note: string | null }) {
  const { failure, onRecover, note } = props;
  return (
    <div className={styles.notice} role="alert">
      <p>{openFailureText(failure)}</p>
      {failure === 'damaged' && onRecover && <Button onClick={onRecover}>{t('page.recoverDamaged')}</Button>}
      {note && <p role="status">{note}</p>}
    </div>
  );
}
