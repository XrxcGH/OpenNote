// Edits the Markdown that new daily, weekly, monthly, and yearly notes start with.
import { useId, useState } from 'react';
import { t } from '../../strings/t';
import { Button, RadioCard, RadioGroup, showToast } from '../../ui';
import styles from './daily.module.css';
import type { DailyKind } from './dates';
import { DEFAULT_TEMPLATES, PLACEHOLDERS, loadTemplates, saveTemplates } from './template';
import type { Templates } from './template';

const KINDS: readonly DailyKind[] = ['day', 'week', 'month', 'year'];

export function TemplateEditor({ onSaved }: { onSaved(): void }) {
  const [kind, setKind] = useState<DailyKind>('day');
  const [templates, setTemplates] = useState<Templates>(loadTemplates);
  const id = useId();
  const save = () => {
    saveTemplates(templates);
    showToast({ message: t('qolSearch.daily.templateSaved') });
    onSaved();
  };
  return (
    <div className={styles.templates}>
      <RadioGroup<DailyKind> label={t('qolSearch.daily.templateFor')} value={kind} onChange={setKind}>
        {KINDS.map((value) => (
          <RadioCard key={value} value={value} label={t(`qolSearch.daily.kinds.${value}`)} />
        ))}
      </RadioGroup>
      <label htmlFor={id} className={styles.help}>
        {t('qolSearch.daily.templateHelp', { placeholders: PLACEHOLDERS.join(' ') })}
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        rows={5}
        value={templates[kind]}
        onChange={(event) => setTemplates({ ...templates, [kind]: event.target.value })}
      />
      <div className={styles.periods}>
        <Button variant="primary" onClick={save}>
          {t('qolSearch.daily.saveTemplate')}
        </Button>
        <Button variant="quiet" onClick={() => setTemplates({ ...templates, [kind]: DEFAULT_TEMPLATES[kind] })}>
          {t('qolSearch.daily.resetTemplate')}
        </Button>
      </div>
    </div>
  );
}
