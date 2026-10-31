// The Check my work switch in Settings, then Editing.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Switch } from '../../../ui';
import { checkWorkChosen, chooseCheckWork } from './choice';

export default function CheckWorkSetting() {
  const [on, setOn] = useState(checkWorkChosen);
  return (
    <div>
      <Switch
        label={t('stepCheck.setting.label')}
        checked={on}
        onChange={(next) => {
          chooseCheckWork(next);
          setOn(next);
        }}
      />
      <p>{t('stepCheck.setting.help')}</p>
    </div>
  );
}
