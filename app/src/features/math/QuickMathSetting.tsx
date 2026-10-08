// The Quick math switch in Settings, then Editing.
import { useState } from 'react';
import { t } from '../../strings/t';
import { Switch } from '../../ui';
import { quickMathEnabled, setQuickMathEnabled } from './quickMath';

export default function QuickMathSetting() {
  const [on, setOn] = useState(quickMathEnabled);
  return (
    <div>
      <Switch
        label={t('study.quickMath.label')}
        checked={on}
        onChange={(next) => {
          setQuickMathEnabled(next);
          setOn(next);
        }}
      />
      <p>{t('study.quickMath.help')}</p>
    </div>
  );
}
