// The Split cell dialog (ADR 0064): how many columns and rows to divide the cell into. Enter splits, Escape cancels.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../../strings/t';
import { Dialog, TextField } from '../../../../ui';
import { readSplit } from './split';

export function SplitForm(props: { onDone(answer: { columns: number; rows: number } | null): void }) {
  const [columns, setColumns] = useState('2');
  const [rows, setRows] = useState('1');
  const [shown, setShown] = useState(false);
  const read = readSplit(columns, rows);
  const submit = () => {
    if (read.ok) props.onDone({ columns: read.columns, rows: read.rows });
    else setShown(true);
  };
  const error = shown && !read.ok ? t(read.error) : undefined;
  const field = shown && !read.ok ? read.field : null;
  return (
    <Dialog
      title={t('sheetMerge.split.title')}
      size="small"
      onDismiss={() => props.onDone(null)}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => props.onDone(null) },
        { id: 'split', label: t('sheetMerge.split.confirm'), variant: 'primary', onPress: submit },
      ]}
    >
      <TextField
        label={t('sheetMerge.split.columns')}
        value={columns}
        onChange={setColumns}
        onCommit={submit}
        onCancel={() => props.onDone(null)}
        autoSelect
        error={field === 'columns' || field === 'both' ? error : undefined}
      />
      <TextField
        label={t('sheetMerge.split.rows')}
        value={rows}
        onChange={setRows}
        onCommit={submit}
        onCancel={() => props.onDone(null)}
        error={field === 'rows' ? error : undefined}
      />
    </Dialog>
  );
}

/** Asks for the split. Resolves the columns and rows, or null when the person cancels. */
export function askSplit(): Promise<{ columns: number; rows: number } | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer: { columns: number; rows: number } | null) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(answer);
    };
    root.render(<SplitForm onDone={finish} />);
  });
}
