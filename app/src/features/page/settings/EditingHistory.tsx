// Settings, then Editing, then Page history (ARCHITECTURE.md section 21): how long versions are kept. The shell passes
// the choice to the core's retention setting.
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import styles from '../spelling/parts.module.css';

const CHOICES = ['month', 'year', 'forever'] as const;

export default function EditingHistory() {
  const keep = useSettings((settings) => settings.editing.history.keep);
  return (
    <section className={styles.part} aria-labelledby="history-settings-title">
      <h2 id="history-settings-title">{t('history.settings.title')}</h2>
      <fieldset className={styles.options} aria-describedby="history-settings-help">
        <legend>{t('history.settings.keep')}</legend>
        {CHOICES.map((choice) => (
          <label key={choice} className={styles.check}>
            <input
              type="radio"
              name="history-keep"
              value={choice}
              checked={keep === choice}
              onChange={() => void updateSettings({ editing: { history: { keep: choice } } })}
            />
            {t(`history.settings.${choice}`)}
          </label>
        ))}
      </fieldset>
      <p id="history-settings-help" className={styles.help}>
        {t('history.settings.help')}
      </p>
    </section>
  );
}
