// The notice on a page that can't save until the person fixes its file (spec 17.6): a read-only page.json or a cloud
// file that isn't downloaded. The title bar's "Couldn't save" alone gave no reason and no fix.

import { useEffect, useState } from 'react';
import type { OpenPage, ReadOnlyInfo } from '../../services/pages/types';
import { t } from '../../strings/t';

/** What to say for a read-only reason, or null when it isn't one the person fixes on the file. */
export function saveBlockedText(info: ReadOnlyInfo | null): string | null {
  if (info?.reason === 'readOnlyFile') return t('page.saveBlocked.readOnlyFile');
  if (info?.reason === 'cloudPlaceholder') return t('page.saveBlocked.cloudPlaceholder');
  return null;
}

export function SaveBlockedNotice({ page }: { page: OpenPage }) {
  const [info, setInfo] = useState<ReadOnlyInfo | null>(page.readOnly);
  useEffect(() => page.onReadOnly(setInfo), [page]);
  const text = saveBlockedText(info);
  return text ? <p role="alert">{text}</p> : null;
}
