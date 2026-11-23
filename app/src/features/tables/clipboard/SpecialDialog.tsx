// The Paste special dialog (DESIGN 13.7), opened with Ctrl+Alt+V: what to paste, an operation, skip blanks,
// transpose, and paste link. Enter pastes, Escape cancels.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog, RadioCard, RadioGroup, Switch } from '../../../ui';
import { PASTE_ALL, PASTE_OPERATIONS, PASTE_WHATS } from './special';
import type { PasteOperation, PasteSpecial, PasteWhat } from './special';

export function SpecialForm(props: { canLink: boolean; onDone(answer: PasteSpecial | null): void }) {
  const [choice, setChoice] = useState<PasteSpecial>({ ...PASTE_ALL });
  const set = (change: Partial<PasteSpecial>) => setChoice((before) => ({ ...before, ...change }));
  return (
    <Dialog
      title={t('sheetClipboard.special.title')}
      size="medium"
      onDismiss={() => props.onDone(null)}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => props.onDone(null) },
        {
          id: 'paste',
          label: t('sheetClipboard.special.confirm'),
          variant: 'primary',
          onPress: () => props.onDone(choice),
        },
      ]}
    >
      <RadioGroup<PasteWhat>
        label={t('sheetClipboard.special.what')}
        value={choice.what}
        onChange={(what) => set({ what })}
        columns={2}
      >
        {PASTE_WHATS.map((what) => (
          <RadioCard<PasteWhat> key={what} value={what} label={t(`sheetClipboard.what.${what}`)} />
        ))}
      </RadioGroup>
      <RadioGroup<PasteOperation>
        label={t('sheetClipboard.special.operation')}
        value={choice.operation}
        onChange={(operation) => set({ operation })}
        columns={5}
      >
        {PASTE_OPERATIONS.map((operation) => (
          <RadioCard<PasteOperation>
            key={operation}
            value={operation}
            label={t(`sheetClipboard.operation.${operation}`)}
          />
        ))}
      </RadioGroup>
      <Switch
        label={t('sheetClipboard.special.skipBlanks')}
        checked={choice.skipBlanks}
        onChange={(skipBlanks) => set({ skipBlanks })}
      />
      <Switch
        label={t('sheetClipboard.special.transpose')}
        checked={choice.transpose}
        onChange={(transpose) => set({ transpose })}
      />
      <Switch
        label={t('sheetClipboard.special.link')}
        checked={choice.link}
        onChange={(link) => set({ link })}
        disabled={props.canLink ? undefined : 'aria'}
      />
    </Dialog>
  );
}

/** Asks how to paste. Resolves the choice, or null when the person cancels. */
export function askSpecial(canLink: boolean): Promise<PasteSpecial | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer: PasteSpecial | null) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(answer);
    };
    root.render(<SpecialForm canLink={canLink} onDone={finish} />);
  });
}
