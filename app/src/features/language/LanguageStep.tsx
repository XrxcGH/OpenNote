// Setup's "Language and spelling" step: English (United States) is selected in advance, whatever language Windows
// uses. The choice sets spelling, handwriting and math recognition, OCR, the read-aloud voice, hyphenation, and the
// dictionary, and it saves at once so it is stored before any page opens.

import type { SetupStepProps } from '../../registries';
import { DEFAULT_LOCALE, normalizeLocale, setLocale } from '../../state/language';
import { t } from '../../strings/t';
import { StepHeader, setupStyles as styles } from '../setup';
import { DictionaryNote, LocalePicker } from './LocalePicker';

export default function LanguageStep(props: SetupStepProps) {
  const { draft, setDraft } = props;
  const locale = normalizeLocale((draft.language as { locale?: string } | undefined)?.locale ?? DEFAULT_LOCALE);
  const choose = (tag: string) => {
    setDraft({ language: { locale: tag } });
    void setLocale(tag).catch(() => undefined);
  };
  return (
    <div className={styles.step}>
      <StepHeader {...props} title={t('setup.steps.language')} subtitle={t('language.setup.subtitle')} />
      <LocalePicker value={locale} onChange={choose} />
      <DictionaryNote locale={locale} />
      <p className={styles.note}>{t('language.setup.interface')}</p>
    </div>
  );
}
