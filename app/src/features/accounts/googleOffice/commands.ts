// Import from Google Docs, Sheets, or Slides, and Export to Google Docs, Sheets, or Slides. Import asks which kind and
// which file, has Drive export it, and opens Import notes at the review. Export is Send to Google Drive with the type
// already chosen, so the file is converted to Google's own type as Drive takes it.
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { connectors } from '../../connectors';
import { importFile } from '../../interop';
import { accountsHost } from '../host';
import { attempt, isConnected, tellNotConnected } from '../run';
import { pickOne } from '../ui/prompts';
import type { Choice } from '../ui/prompts';
import { sendTo } from '../sendto/commands';
import type { SendFormat } from '../sendto/types';
import { fetchDoc, recentDocs } from './import';
import type { DriveDoc, OfficeKind } from './import';

export async function importFromGoogle(): Promise<void> {
  if (!(await isConnected('google'))) return tellNotConnected('Google');
  const kind = await pickOne<OfficeKind>({
    title: t('accounts.googleOffice.kind.title'),
    description: t('accounts.googleOffice.kind.description'),
    confirmLabel: t('accounts.googleOffice.kind.confirm'),
    choices: [
      { id: 'docs', label: t('accounts.googleOffice.kind.docs'), value: 'docs' },
      {
        id: 'sheets',
        label: t('accounts.googleOffice.kind.sheets'),
        detail: t('accounts.googleOffice.kind.sheetsDetail'),
        value: 'sheets',
      },
      {
        id: 'slides',
        label: t('accounts.googleOffice.kind.slides'),
        detail: t('accounts.googleOffice.kind.slidesDetail'),
        value: 'slides',
      },
    ],
  });
  if (!kind) return;
  await attempt('Google', async () => {
    const docs = await recentDocs(connectors(), kind);
    const choices: Choice<DriveDoc>[] = docs.map((doc) => ({
      id: doc.id,
      label: doc.name || t('accounts.googleOffice.untitled'),
      detail: doc.modified ? new Date(doc.modified).toLocaleDateString() : undefined,
      value: doc,
    }));
    const doc = await pickOne<DriveDoc>({
      title: t('accounts.googleOffice.file.title'),
      description: t('accounts.googleOffice.file.description'),
      confirmLabel: t('accounts.googleOffice.file.confirm'),
      choices,
      empty: t('accounts.googleOffice.file.none'),
    });
    if (!doc) return;
    announce(t('accounts.googleOffice.fetching', { name: doc.name }));
    const path = await fetchDoc(accountsHost(), kind, doc);
    importFile(path);
  });
}

/** Sends the open page, section, or notebook to Google Drive as a Google Doc, Sheet, or Slides file. */
export function exportToGoogle(format: Extract<SendFormat, 'gdoc' | 'gsheet' | 'gslides'>): Promise<void> {
  return sendTo('drive', { format });
}
