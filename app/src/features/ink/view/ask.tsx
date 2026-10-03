// A small question in a dialog: one text field and, when asked, one switch. Insert space asks how tall, and Describe a
// drawing asks for the text and whether the drawing only decorates. It resolves with the answers, or null when the
// person cancels, so a caller needs no dialog state of its own.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog, Switch, TextField } from '../../../ui';

export interface AskSpec {
  readonly title: string;
  readonly description?: string;
  readonly field: { readonly label: string; readonly value: string; readonly help?: string };
  readonly check?: { readonly label: string; readonly value: boolean };
  readonly confirm: string;
  /** An error for an answer that cannot be used, or null. */
  readonly validate?: (text: string) => string | null;
}

export interface Answer {
  readonly text: string;
  readonly checked: boolean;
}

function AskDialog({ spec, done }: { spec: AskSpec; done: (answer: Answer | null) => void }) {
  const [text, setText] = useState(spec.field.value);
  const [checked, setChecked] = useState(spec.check?.value ?? false);
  const [shown, setShown] = useState<string | null>(null);
  const submit = () => {
    const error = spec.validate?.(text) ?? null;
    if (error) return setShown(error);
    done({ text, checked });
  };
  return (
    <Dialog
      title={spec.title}
      description={spec.description}
      size="small"
      onDismiss={() => done(null)}
      actions={[
        { id: 'cancel', label: t('ink.ask.cancel'), variant: 'secondary', onPress: () => done(null) },
        { id: 'confirm', label: spec.confirm, variant: 'primary', onPress: submit },
      ]}
    >
      <TextField
        label={spec.field.label}
        help={spec.field.help}
        value={text}
        error={shown ?? undefined}
        autoSelect
        onChange={(value) => {
          setText(value);
          setShown(null);
        }}
        onCommit={submit}
        onCancel={() => done(null)}
      />
      {spec.check && <Switch label={spec.check.label} checked={checked} onChange={setChecked} />}
    </Dialog>
  );
}

/** Asks the question and resolves with the answer, or null if the person cancels. */
export function ask(spec: AskSpec): Promise<Answer | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = (answer: Answer | null) => {
      resolve(answer);
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<AskDialog spec={spec} done={done} />);
  });
}
