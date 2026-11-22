// The formula bar's switch in Settings, then Tables (the section the spreadsheet keys register).
import { useId } from 'react';
import { updateSettings, useSettings } from '../../../../state/settings';
import { t } from '../../../../strings/t';
import { Switch } from '../../../../ui';

export function FormulaBarSetting() {
  const on = useSettings((settings) => settings.tables.formulaBar);
  const help = useId();
  return (
    <>
      <Switch
        label={t('sheetFormula.settings.formulaBar')}
        checked={on}
        describedBy={help}
        onChange={(next) => void updateSettings({ tables: { formulaBar: next } })}
      />
      <p id={help}>{t('sheetFormula.settings.formulaBarHelp')}</p>
    </>
  );
}
