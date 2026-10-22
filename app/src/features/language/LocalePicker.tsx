// The language choice: the English dialects as cards, and the other languages this PC can spell-check or recognize in
// a list. Setup and Settings both show it. It holds no state; the caller keeps the chosen tag.

import { useId } from 'react';
import { ENGLISH_DIALECTS, isEnglish, localeName } from '../../state/language';
import { t } from '../../strings/t';
import { RadioCard, RadioGroup } from '../../ui';
import { useInstalledLanguages } from './installed';
import styles from './language.module.css';

export interface LocalePickerProps {
  value: string;
  onChange(tag: string): void;
}

export function LocalePicker({ value, onChange }: LocalePickerProps) {
  const id = useId();
  const installed = useInstalledLanguages();
  const others = installed ?? [];
  // A chosen language that isn't English gets a card of its own, so the group always has a selected card to reach.
  const extra = isEnglish(value) ? null : { tag: value, name: localeName(value) };
  return (
    <div className={styles.picker}>
      <RadioGroup label={t('language.pickerLabel')} value={value} onChange={onChange} columns={2}>
        {ENGLISH_DIALECTS.map((choice) => (
          <RadioCard key={choice.tag} value={choice.tag} label={choice.name} />
        ))}
        {extra && <RadioCard value={extra.tag} label={extra.name} />}
      </RadioGroup>
      <div className={styles.other}>
        <label htmlFor={`${id}-other`}>{t('language.other.label')}</label>
        <select
          id={`${id}-other`}
          value={extra?.tag ?? ''}
          disabled={others.length === 0}
          onChange={(event) => event.currentTarget.value && onChange(event.currentTarget.value)}
        >
          <option value="">{installed === null ? t('language.other.checking') : t('language.other.choose')}</option>
          {others.map((choice) => (
            <option key={choice.tag} value={choice.tag}>
              {choice.name}
            </option>
          ))}
        </select>
        <p className={styles.help}>
          {others.length === 0 && installed ? t('language.other.none') : t('language.other.hint')}
        </p>
      </div>
    </div>
  );
}

/** What the choice means for the dictionary, in plain words. Calm when no dictionary pack exists for the language. */
export function DictionaryNote({ locale }: { locale: string }) {
  return (
    <p className={styles.help}>
      {isEnglish(locale)
        ? t('language.dictionary.english', { name: localeName(locale) })
        : t('language.dictionary.noPack', { name: localeName(locale) })}
    </p>
  );
}
