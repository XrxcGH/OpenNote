// Settings, then Tables: which keys a new table uses (ADR 0063, DESIGN.md section 11.1, PLAN.md decision 4).
// A table stores its choice when it is made, so this setting changes only tables made after it.
import type { TableKeys } from '../../../platform/bindings/TableKeys';
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { RadioCard, RadioGroup } from '../../../ui';
import styles from './keys.module.css';

export default function TablesSettings() {
  const keys = useSettings((settings) => settings.tables.newTableKeys);
  return (
    <section className={styles.settings} aria-labelledby="settings-tables">
      <h2 id="settings-tables">{t('sheetKeys.settings.title')}</h2>
      <RadioGroup<TableKeys>
        label={t('sheetKeys.settings.newTableKeys')}
        value={keys}
        onChange={(next) => void updateSettings({ tables: { newTableKeys: next } })}
      >
        <RadioCard
          value="spreadsheet"
          label={t('sheetKeys.settings.spreadsheet')}
          description={t('sheetKeys.settings.spreadsheetHelp')}
        />
        <RadioCard
          value="document"
          label={t('sheetKeys.settings.document')}
          description={t('sheetKeys.settings.documentHelp')}
        />
      </RadioGroup>
      <p className={styles.help}>{t('sheetKeys.settings.help')}</p>
    </section>
  );
}
