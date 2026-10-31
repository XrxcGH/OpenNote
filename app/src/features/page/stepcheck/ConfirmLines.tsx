// Before judging handwriting that was hard to read: the lines as read, each in a field the person can fix, then
// Check. Cancel checks nothing. The ink is never changed.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog, TextField } from '../../../ui';

function Confirm({ lines, done }: { lines: readonly string[]; done: (lines: string[] | null) => void }) {
  const [values, setValues] = useState([...lines]);
  return (
    <Dialog
      title={t('stepCheck.confirm.title')}
      description={t('stepCheck.confirm.description')}
      onDismiss={() => done(null)}
      actions={[
        {
          id: 'cancel',
          label: t('stepCheck.confirm.cancel'),
          variant: 'secondary',
          leastDestructive: true,
          onPress: () => done(null),
        },
        { id: 'check', label: t('stepCheck.confirm.check'), variant: 'primary', onPress: () => done(values) },
      ]}
    >
      {values.map((value, i) => (
        <TextField
          key={i}
          label={t('stepCheck.confirm.lineLabel', { number: i + 1 })}
          value={value}
          onChange={(next) => setValues((all) => all.map((old, j) => (j === i ? next : old)))}
        />
      ))}
    </Dialog>
  );
}

/** Shows the lines as read. Resolves with the lines as fixed, or null when the person cancels. */
export function confirmLines(lines: readonly string[]): Promise<string[] | null> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = (result: string[] | null) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(<Confirm lines={lines} done={done} />);
  });
}
