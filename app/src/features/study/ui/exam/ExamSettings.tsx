// The Practice exams switches in Settings, then Editing: practice exams on or off, and whether the language model on
// this device may write the questions when one is downloaded.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { Switch } from '../../../../ui';
import { examModelOn, examsOn, setExamModelOn, setExamsOn } from '../../exam/request';

export default function ExamSettings() {
  const [on, setOn] = useState(examsOn);
  const [model, setModel] = useState(examModelOn);
  return (
    <div>
      <Switch
        label={t('exams.settings.label')}
        checked={on}
        onChange={(next) => {
          setExamsOn(next);
          setOn(next);
        }}
      />
      <p>{t('exams.settings.help')}</p>
      <Switch
        label={t('exams.settings.modelLabel')}
        checked={model}
        disabled={!on}
        onChange={(next) => {
          setExamModelOn(next);
          setModel(next);
        }}
      />
      <p>{t('exams.settings.modelHelp')}</p>
    </div>
  );
}
