// WP0's placeholder Trash view: only the heading. WP6 lists the trashed items with Restore, behind the
// trash.view flag.

import { t } from '../../strings/t';

export function TrashView() {
  return <h1>{t('tree.trash.title')}</h1>;
}
