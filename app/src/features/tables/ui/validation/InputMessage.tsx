// The input message of a rule: shown beside the cell while it is selected. It is a polite status, so a screen
// reader hears it when the selection arrives, and it never takes focus.
import { t } from '../../../../strings/t';
import styles from './validation.module.css';

export function InputMessage(props: { address: string; title: string; text: string }) {
  const { address, title, text } = props;
  if (title === '' && text === '') return null;
  return (
    <div role="status" className={styles.message} aria-label={t('sheetValidation.inputMessageLabel', { address })}>
      {title !== '' && <strong>{title}</strong>}
      {text}
    </div>
  );
}
