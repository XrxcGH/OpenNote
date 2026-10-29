// The switch for Windows notifications. They are off until asked for.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Switch } from '../../../ui';
import { disableReminders, enableReminders, remindersOn } from './notify';
import styles from './tools.module.css';

export function RemindersSwitch() {
  const [on, setOn] = useState(remindersOn);
  const [blocked, setBlocked] = useState(false);
  return (
    <div className={styles.form}>
      <Switch
        label={t('study.reminders.label')}
        checked={on}
        onChange={async (next) => {
          if (!next) {
            disableReminders();
            setOn(false);
            return;
          }
          const granted = await enableReminders();
          setOn(granted);
          setBlocked(!granted);
        }}
      />
      {blocked ? <p className={styles.note}>{t('study.reminders.blocked')}</p> : null}
    </div>
  );
}
