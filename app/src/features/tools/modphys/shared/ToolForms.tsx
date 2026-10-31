// One tool's calculations: a picker when there are several, then the chosen calculation's form. The choice is
// remembered for the next time the tool opens. A live calculation block keeps the form and its typed values, and its
// Open in tool puts them back here (the kit registers as 'modphys' in features/page/registrations/kitModPhys.ts).
import './strings';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import extra from '../../ui/extra.module.css';
import { loadStored, saveStored } from '../../ui/storage';
import tools from '../../ui/tools.module.css';
import { useCallback, useEffect, useState } from 'react';
import { insertLiveBlock } from '../../kits/ui/insert';
import { onKitInputs, takeKitInputs } from '../../kits/registry';
import { KitForm } from './KitForm';
import type { KitFormProps } from './KitForm';
import type { Values } from './form';

export interface FormDef {
  id: string;
  label: MessageKey;
  fields: KitFormProps['fields'];
  solve: KitFormProps['solve'];
  intro?: MessageKey;
}

/** The kit id of live calculation blocks from these tools. */
export const MODPHYS_KIT = 'modphys';

/** A live block's inputs: the form and the typed values. */
export interface ModPhysInputs {
  form: string;
  values: Values;
}

const strings = (value: unknown): Record<string, string> =>
  value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

/** A live block's inputs read back, or null when they are not a form of these tools. */
export function readModPhysInputs(inputs: unknown): ModPhysInputs | null {
  if (!inputs || typeof inputs !== 'object') return null;
  const { form, values } = inputs as { form?: unknown; values?: { text?: unknown; unit?: unknown } };
  if (typeof form !== 'string' || !values || typeof values !== 'object') return null;
  return { form, values: { text: strings(values.text), unit: strings(values.unit) } };
}

export function ToolForms({ tool, forms }: { tool: string; forms: readonly FormDef[] }) {
  const key = `modphys.${tool}.calc`;
  const [chosen, setChosen] = useState<string>(() => loadStored<string>(key, forms[0]!.id));
  // Values a live block brought back, and a count that remounts the form on them.
  const [restored, setRestored] = useState<{ form: string; values: Values; count: number } | null>(null);
  const take = useCallback(() => {
    const inputs = readModPhysInputs(takeKitInputs(MODPHYS_KIT, tool));
    if (!inputs || !forms.some((form) => form.id === inputs.form)) return;
    setChosen(inputs.form);
    saveStored(key, inputs.form);
    setRestored((last) => ({ form: inputs.form, values: inputs.values, count: (last?.count ?? 0) + 1 }));
  }, [forms, key, tool]);
  useEffect(() => {
    take();
    return onKitInputs(MODPHYS_KIT, (arrived) => {
      if (arrived === tool) take();
    });
  }, [take, tool]);
  const current = forms.find((form) => form.id === chosen) ?? forms[0]!;
  const live = (
    values: Values,
    outcome: { answer: string; latex?: string; rows?: readonly { label: string; value: string }[] },
  ) =>
    insertLiveBlock({
      kit: MODPHYS_KIT,
      tool,
      title: t(current.label),
      summary: outcome.answer,
      inputs: { form: current.id, values } satisfies ModPhysInputs,
      rows: (outcome.rows ?? []).map((row) => ({ label: row.label, value: row.value, unit: '' })),
      ...(outcome.latex ? { latex: outcome.latex } : {}),
    });
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
        key={`${current.id}-${restored?.count ?? 0}`}
        name={`${tool}-${current.id}`}
        fields={current.fields}
        solve={current.solve}
        live={live}
        {...(restored?.form === current.id ? { initial: restored.values } : {})}
        {...(current.intro ? { intro: t(current.intro) } : {})}
      />
    </div>
  );
}
