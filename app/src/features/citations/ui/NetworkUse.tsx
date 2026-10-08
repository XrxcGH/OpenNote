// The citation look-up's row in Settings, then Privacy: which two sites a look-up talks to, what it sends, and when it
// last ran. A look-up goes out only when the person asks for one source, and never while Work offline is on.
import { useFlag } from '../../../app/flags';
import { formatDate, formatTime } from '../../../strings/format';
import { t } from '../../../strings/t';
import { useOffline } from '../../diagnostics';
import { LOOKUP_HOSTS, lookupLastRan } from '../lookup';
import styles from './citations.module.css';

export function CitationNetworkUse() {
  const offline = useOffline();
  const on = useFlag('tools.citations');
  if (!on) return null;
  const ran = lookupLastRan();
  return (
    <li className={styles.useRow}>
      <span className={styles.useTitle}>{t('study.citations.privacy.title')}</span>
      <span>{t('study.citations.privacy.detail', { hosts: LOOKUP_HOSTS.join(', ') })}</span>
      <span className={styles.muted}>
        {offline
          ? t('study.citations.privacy.blocked')
          : ran
            ? t('study.citations.privacy.lastRan', { date: formatDate(ran), time: formatTime(ran) })
            : t('study.citations.privacy.never')}
      </span>
    </li>
  );
}
