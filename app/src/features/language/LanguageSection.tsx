// Settings, then Language: the one language for spelling, recognition, OCR, the voice, hyphenation, and the dictionary.

import { useLocale, setLocale } from '../../state/language';
import { t } from '../../strings/t';
import { DictionaryNote, LocalePicker } from './LocalePicker';
import styles from './language.module.css';

export default function LanguageSection() {
  const locale = useLocale();
  return (
    <section className={styles.section} aria-labelledby="settings-language">
      <h2 id="settings-language">{t('language.settings.title')}</h2>
      <p className={styles.help}>{t('language.settings.intro')}</p>
      <LocalePicker value={locale} onChange={(tag) => void setLocale(tag).catch(() => undefined)} />
      <DictionaryNote locale={locale} />
      <p className={styles.help}>{t('language.setup.interface')}</p>
    </section>
  );
}
