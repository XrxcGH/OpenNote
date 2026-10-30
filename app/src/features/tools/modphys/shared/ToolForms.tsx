// One tool's calculations: a picker when there are several, then the chosen calculation's form. The choice is
// remembered for the next time the tool opens.
import './strings';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import extra from '../../ui/extra.module.css';
import { loadStored, saveStored } from '../../ui/storage';
import tools from '../../ui/tools.module.css';
import { useState } from 'react';
import { KitForm } from './KitForm';
import type { KitFormProps } from './KitForm';

export interface FormDef {
  id: string;
  label: MessageKey;
  fields: KitFormProps['fields'];
  solve: KitFormProps['solve'];
  intro?: MessageKey;
}

export function ToolForms({ tool, forms }: { tool: string; forms: readonly FormDef[] }) {
  const key = `modphys.${tool}.calc`;
  const [chosen, setChosen] = useState<string>(() => loadStored<string>(key, forms[0]!.id));
  const current = forms.find((form) => form.id === chosen) ?? forms[0]!;
  const id = `modphys-${tool}-calc`;
  return (
    <div className={tools.tool}>
      {forms.length > 1 ? (
        <div className={extra.field}>
          <label htmlFor={id}>{t('kitModPhys.window.calculation')}</label>
          <select
            id={id}
            className={extra.input}
            value={current.id}
            onChange={(event) => {
              setChosen(event.target.value);
              saveStored(key, event.target.value);
            }}
          >
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {t(form.label)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <KitForm
        key={current.id}
        name={`${tool}-${current.id}`}
        fields={current.fields}
        solve={current.solve}
        {...(current.intro ? { intro: t(current.intro) } : {})}
      />
    </div>
  );
}
