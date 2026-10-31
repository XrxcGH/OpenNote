// The notice on a page that opened read-only because the last run of OpenNote was still closing and held its locks
// (docs/format 20.3). Its newest ink waits in the journal, and the next start recovers it.

import type { ReadOnlyInfo } from '../../services/pages/types';
import { t } from '../../strings/t';

export function StillClosingNotice({ readOnly }: { readOnly: ReadOnlyInfo | null }) {
  if (readOnly?.reason !== 'stillClosing') return null;
  return <p role="status">{t('page.stillClosing')}</p>;
}
