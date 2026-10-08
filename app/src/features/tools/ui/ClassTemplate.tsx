// The words a new class page starts with. They are kept on this device and filled in with the class and the day.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { CLASS_PLACEHOLDERS, DEFAULT_CLASS_TEMPLATE, loadClassTemplate, saveClassTemplate } from './classActions';
import styles from './tools.module.css';
import extra from './extra.module.css';

export function ClassTemplate() {
  const [text, setText] = useState(loadClassTemplate);
  const change = (next: string) => {
    setText(next);
    saveClassTemplate(next);
  };
  return (
    <div className={styles.form}>
      <label className={extra.field}>
        {t('study.timetable.template')}
        <textarea
          className={extra.input}
          rows={4}
          value={text}
          aria-describedby="class-template-help"
          onChange={(event) => change(event.target.value)}
        />
      </label>
      <p id="class-template-help" className={styles.note}>
        {t('study.timetable.templateHelp', { placeholders: CLASS_PLACEHOLDERS.join(' ') })}
      </p>
      <div className={styles.buttons}>
        <Button variant="quiet" onClick={() => change(DEFAULT_CLASS_TEMPLATE)}>
          {t('study.timetable.templateReset')}
        </Button>
      </div>
    </div>
  );
}
