// The sync notice's button: the state in a word or two, such as "Synced" or "Sync stopped". It opens Settings > Sync.

import { navigate } from '../../app/location';
import { t } from '../../strings/t';
import { chipText, stateText } from './model';
import styles from './sync.module.css';
import type { SyncView } from './types';

export default function ChipBody({ view, iconOnly }: { view: SyncView; iconOnly: boolean }) {
  const label = chipText(view);
  if (!label) return null;
  const state = view.status.state;
  return (
    <button
      type="button"
      className={styles.chip}
      aria-label={t('sync.chip.label', { state: stateText(state) })}
      onClick={() => navigate({ view: 'settings', section: 'sync' })}
    >
      <span className={styles.dot} data-state={state} aria-hidden="true" />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}
