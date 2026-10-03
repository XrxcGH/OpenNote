// Settings, then Editing, then Spelling (ARCHITECTURE.md section 16.5): check spelling, the languages, the words to
// skip, the personal dictionary, and a way to Windows' language settings.
import { useEffect, useState } from 'react';
import { commandContext } from '../../../commands/registry';
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { Button, Switch } from '../../../ui';
import { spellingEngine } from '../spelling/current';
import type { LanguageInfo } from '../spelling/engine';
import styles from '../spelling/parts.module.css';

const names = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' });
  } catch {
    return null;
  }
})();
const nameOf = (language: LanguageInfo) => names?.of(language.tag) ?? language.name;

function openWindowsSettings(): void {
  void commandContext('menu')
    .platform.shell.openExternal({ kind: 'windowsSettings', page: 'language' })
    .catch(() => undefined);
}

function useInstalled(): LanguageInfo[] | null {
  const [installed, setInstalled] = useState<LanguageInfo[] | null>(null);
  useEffect(() => {
    let current = true;
    void (spellingEngine()?.languages() ?? Promise.resolve([])).then((list) => current && setInstalled(list));
    return () => {
      current = false;
    };
  }, []);
  return installed;
}

function Languages({ installed }: { installed: LanguageInfo[] }) {
  const chosen = useSettings((settings) => settings.editing.spelling.languages);
  const defaults = installed.filter((language) => language.isDefault).map((language) => language.tag);
  const active = chosen.length ? chosen : defaults;
  const toggle = (tag: string, on: boolean) => {
    const next = on ? [...active, tag] : active.filter((known) => known !== tag);
    void updateSettings({ editing: { spelling: { languages: next } } });
  };
  return (
    <fieldset className={styles.options} aria-describedby="spelling-languages-help">
      <legend>{t('spelling.settings.languages')}</legend>
      {installed.map((language) => (
        <label key={language.tag} className={styles.check}>
          <input
            type="checkbox"
            checked={active.includes(language.tag)}
            onChange={(event) => toggle(language.tag, event.currentTarget.checked)}
          />
          {language.isDefault ? t('spelling.settings.defaultLanguage', { name: nameOf(language) }) : nameOf(language)}
        </label>
      ))}
      <p id="spelling-languages-help" className={styles.help}>
        {t('spelling.settings.languagesHint')}
      </p>
    </fieldset>
  );
}

function PersonalWords() {
  const words = useSettings((settings) => settings.editing.spelling.personalWords);
  const remove = (word: string) => {
    const engine = spellingEngine();
    if (engine) void engine.removeWord(word);
    else void updateSettings({ editing: { spelling: { personalWords: words.filter((known) => known !== word) } } });
  };
  return (
    <section className={styles.part} aria-labelledby="spelling-personal">
      <h2 id="spelling-personal">{t('spelling.settings.personal')}</h2>
      {words.length === 0 ? (
        <p className={styles.help}>{t('spelling.settings.personalEmpty')}</p>
      ) : (
        <ul className={styles.words}>
          {words.map((word) => (
            <li key={word} className={styles.word}>
              <span>{word}</span>
              <Button aria-label={t('spelling.settings.removeWord', { word })} onClick={() => remove(word)}>
                {t('spelling.settings.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function EditingSpelling() {
  const spelling = useSettings((settings) => settings.editing.spelling);
  const installed = useInstalled();
  const usable = installed === null || installed.length > 0;
  const update = (patch: Partial<typeof spelling>) => void updateSettings({ editing: { spelling: patch } });
  return (
    <section className={styles.part} aria-labelledby="spelling-title">
      <h2 id="spelling-title">{t('spelling.settings.title')}</h2>
      <Switch
        label={t('spelling.settings.check')}
        checked={spelling.enabled && usable}
        disabled={usable ? undefined : 'aria'}
        describedBy={usable ? undefined : 'spelling-unavailable'}
        onChange={(enabled) => update({ enabled })}
      />
      {!usable && (
        <p id="spelling-unavailable" role="status">
          {t('spelling.settings.unavailable')}
        </p>
      )}
      {installed && installed.length > 0 && <Languages installed={installed} />}
      <Switch
        label={t('spelling.settings.ignoreUppercase')}
        checked={spelling.ignoreUppercase}
        onChange={(ignoreUppercase) => update({ ignoreUppercase })}
      />
      <Switch
        label={t('spelling.settings.ignoreWithDigits')}
        checked={spelling.ignoreWithDigits}
        onChange={(ignoreWithDigits) => update({ ignoreWithDigits })}
      />
      <PersonalWords />
      <div className={styles.actions}>
        <Button onClick={openWindowsSettings}>{t('spelling.settings.openWindows')}</Button>
      </div>
    </section>
  );
}
