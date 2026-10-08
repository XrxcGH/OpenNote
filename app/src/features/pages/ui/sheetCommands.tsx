// What the sheet commands do once they load: the Go to sheet dialog, and a step to the next or previous sheet.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Dialog, TextField } from '../../../ui';
import { flipTarget } from '../zoom';
import { shownPagesView } from '../live/shown';
import { openDialog } from './openDialog';

interface GoToProps {
  readonly sheets: number;
  readonly current: number;
  go(sheet: number): void;
  close(): void;
}

/** A sheet number as a whole number from 1 to `max`, or null. */
export function parseSheet(text: string, max: number): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

function GoToSheet({ sheets, current, go, close }: GoToProps) {
  const [text, setText] = useState(String(current + 1));
  const sheet = parseSheet(text, sheets);
  const commit = () => {
    if (sheet === null) return;
    go(sheet - 1);
    close();
  };
  return (
    <Dialog
      title={t('pagesPlus.sheets.dialog.title')}
      description={t('pagesPlus.sheets.dialog.description')}
      size="small"
      onDismiss={close}
      actions={[
        { id: 'cancel', label: t('pagesPlus.sheets.dialog.cancel'), variant: 'secondary', onPress: close },
        { id: 'go', label: t('pagesPlus.sheets.dialog.go'), variant: 'primary', onPress: commit },
      ]}
    >
      <TextField
        label={t('pagesPlus.sheets.dialog.field', { max: sheets })}
        value={text}
        onChange={setText}
        error={text !== '' && sheet === null ? t('pagesPlus.sheets.dialog.invalid', { max: sheets }) : undefined}
        onCommit={commit}
        autoSelect
      />
    </Dialog>
  );
}

/** Asks which sheet to go to, and goes there. */
export async function openGoToSheet(): Promise<void> {
  const api = shownPagesView.get();
  if (!api) return;
  const { count, current } = api.sheets();
  await openDialog((close) => <GoToSheet sheets={count} current={current} go={api.goToSheet} close={close} />);
}

/** Goes one sheet on, or back. */
export function stepSheet(direction: 1 | -1): void {
  const api = shownPagesView.get();
  if (!api) return;
  const { count, current } = api.sheets();
  api.goToSheet(flipTarget(current, direction, count));
}
