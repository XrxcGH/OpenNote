// A small question that wants a line of text (Phase 7): a title, a field, and a check that keeps the dialog open
// with the problem in words until the text is acceptable. It resolves with the text, or null when canceled.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog, TextField } from '../../../ui';

export interface AskTextOptions {
  title: string;
  description?: string;
  label: string;
  help?: string;
  initial?: string;
  confirmLabel: string;
  /** The problem with the text in words, or null when it is fine. */
  check(text: string): string | null;
}

function Ask({ options, finish }: { options: AskTextOptions; finish(text: string | null): void }) {
  const [text, setText] = useState(options.initial ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    const found = options.check(text);
    if (found) setProblem(found);
    else finish(text);
  };
  return (
    <Dialog
      title={options.title}
      {...(options.description ? { description: options.description } : {})}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => finish(null) },
        { id: 'ok', label: options.confirmLabel, variant: 'primary', onPress: submit },
      ]}
      onDismiss={() => finish(null)}
    >
      <TextField
        label={options.label}
        value={text}
        onChange={(next) => {
          setText(next);
          setProblem(null);
        }}
        onCommit={submit}
        {...(problem ? { error: problem } : {})}
        {...(options.help ? { help: options.help } : {})}
      />
    </Dialog>
  );
}

export function askText(options: AskTextOptions): Promise<string | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const finish = (text: string | null) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(text);
    };
    root.render(<Ask options={options} finish={finish} />);
  });
}
