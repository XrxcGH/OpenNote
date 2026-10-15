// The two questions the account commands ask: which one of these, and what to type. Each is a dialog that resolves
// with the answer, or null when the person cancels. They are keyboard-first: arrow keys move through a list, Enter
// chooses, and Escape cancels.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Dialog, RadioCard, RadioGroup, TextField } from '../../../ui';
import styles from './accounts.module.css';
import { openDialog } from './dialog';

export interface Choice<T> {
  id: string;
  label: string;
  detail?: string;
  value: T;
}

export interface PickOptions<T> {
  title: string;
  description?: string;
  choices: readonly Choice<T>[];
  /** What the primary button says. */
  confirmLabel: string;
  /** Shown instead of the list when there is nothing to choose. */
  empty?: string;
}

/** Asks the person to choose one of the items. Resolves with its value, or null. */
export function pickOne<T>(options: PickOptions<T>): Promise<T | null> {
  let answer: T | null = null;
  return openDialog((close) => {
    function Picker() {
      const [chosen, setChosen] = useState(options.choices[0]?.id ?? '');
      const finish = () => {
        answer = options.choices.find((choice) => choice.id === chosen)?.value ?? null;
        close();
      };
      return (
        <Dialog
          title={options.title}
          description={options.description}
          onDismiss={close}
          actions={[
            { id: 'cancel', label: t('accounts.common.cancel'), variant: 'secondary', onPress: close },
            ...(options.choices.length > 0
              ? [{ id: 'choose', label: options.confirmLabel, variant: 'primary' as const, onPress: finish }]
              : []),
          ]}
        >
          {options.choices.length === 0 ? (
            <p className={styles.empty}>{options.empty ?? ''}</p>
          ) : (
            <RadioGroup label={options.title} value={chosen} onChange={setChosen}>
              {options.choices.map((choice) => (
                <RadioCard key={choice.id} value={choice.id} label={choice.label} description={choice.detail} />
              ))}
            </RadioGroup>
          )}
        </Dialog>
      );
    }
    return <Picker />;
  }).then(() => answer);
}

export interface AskOptions {
  title: string;
  description?: string;
  label: string;
  help?: string;
  initial?: string;
  confirmLabel: string;
  /** Hides what is typed. */
  secret?: boolean;
}

/** Asks for one line of text. Resolves with the trimmed text, or null when canceled or left empty. */
export function askText(options: AskOptions): Promise<string | null> {
  let answer: string | null = null;
  return openDialog((close) => {
    function Asker() {
      const [value, setValue] = useState(options.initial ?? '');
      const finish = () => {
        answer = value.trim() === '' ? null : value.trim();
        close();
      };
      return (
        <Dialog
          title={options.title}
          description={options.description}
          onDismiss={close}
          actions={[
            { id: 'cancel', label: t('accounts.common.cancel'), variant: 'secondary', onPress: close },
            { id: 'ok', label: options.confirmLabel, variant: 'primary', onPress: finish },
          ]}
        >
          <TextField
            label={options.label}
            help={options.help}
            value={value}
            onChange={setValue}
            secret={options.secret}
            onCommit={finish}
            onCancel={close}
          />
        </Dialog>
      );
    }
    return <Asker />;
  }).then(() => answer);
}
