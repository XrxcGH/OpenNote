// The switch for study tape as blanks, in the print and export dialog. It shows nothing when the feature is off.
import { useState } from 'react';
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { Switch } from '../../../ui';
import { setTapeBlanks, tapeBlanksOn } from '../host/tapePref';
import styles from './pagesUi.module.css';

export function TapeBlanksSwitch() {
  const [on, setOn] = useState(tapeBlanksOn);
  if (!isEnabled('study.tapeBlanks')) return null;
  return (
    <>
      <Switch
        label={t('pagesPlus.tape.blanks')}
        checked={on}
        onChange={(value) => {
          setTapeBlanks(value);
          setOn(value);
        }}
      />
      <p className={styles.hint}>{t('pagesPlus.tape.blanksHelp')}</p>
    </>
  );
}
