// How to work the parts of an engineering diagram, with the pointer and from the keyboard.
import { t } from '../../../strings/t';
import styles from './canvas.module.css';

export function KeysHint({ lead }: { lead?: string }) {
  return (
    <p className={styles.hint}>
      {lead ? `${lead} ` : ''}
      {t('engineering.common.keysHint')} {t('engineering.common.keysKeys')}
    </p>
  );
}
