// The template picker: a dialog with one choice per template. "New page from template", "Insert template", and
// "Set default template" all use it. It resolves the chosen page, an empty string for "No template" when that is
// offered, or null when the person cancels.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog, RadioCard, RadioGroup } from '../../../ui';
import type { DialogAction } from '../../../ui';
import type { TemplateInfo } from './apply';

export interface PickerOptions {
  title: string;
  description: string;
  action: string;
  /** Offers "No template" as the first choice. */
  none?: boolean;
  initial?: string | null;
}

const NONE = '';

function Picker(props: PickerOptions & { templates: readonly TemplateInfo[]; done(choice: string | null): void }) {
  const { templates, done } = props;
  const [choice, setChoice] = useState<string>(props.initial ?? (props.none ? NONE : (templates[0]?.id ?? NONE)));
  const actions: DialogAction[] = [
    {
      id: 'cancel',
      label: t('common.cancel'),
      variant: 'secondary',
      leastDestructive: true,
      onPress: () => done(null),
    },
    { id: 'ok', label: props.action, variant: 'primary', onPress: () => done(choice) },
  ];
  return (
    <Dialog title={props.title} description={props.description} actions={actions} onDismiss={() => done(null)}>
      <RadioGroup<string> label={props.title} value={choice} onChange={setChoice}>
        {props.none && <RadioCard<string> value={NONE} label={t('pageExtras.templates.noTemplate')} />}
        {templates.map((template) => (
          <RadioCard<string> key={template.id} value={template.id} label={template.title} />
        ))}
      </RadioGroup>
    </Dialog>
  );
}

export function pickTemplate(options: PickerOptions, templates: readonly TemplateInfo[]): Promise<string | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = (choice: string | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(choice);
    };
    root.render(<Picker {...options} templates={templates} done={done} />);
  });
}
