// Settings, then Shortcuts: the choice of shortcut set, then the shortcut list inline.

import { useFlag } from '../../app/flags';
import { useSettings } from '../../state/settings';
import { setShortcutSet } from '../../state/keymap';
import type { KeymapPresetId } from '../../platform/types';
import { t } from '../../strings/t';
import { RadioCard, RadioGroup, announce } from '../../ui';
import { ShortcutList } from './ShortcutList';
import styles from './ShortcutList.module.css';

export default function ShortcutsSection() {
  const preset = useSettings((settings) => settings.keymap.preset);
  // The OneNote set is offered while its flag is on, and always shown to someone already using it.
  const offered = useFlag('qol.onenoteKeys') || preset === 'onenote';
  const choose = (next: KeymapPresetId) => {
    void setShortcutSet(next).then(() => announce(t('shortcuts.set.changed', { set: t(`shortcuts.set.${next}`) })));
  };
  return (
    <div className={styles.section}>
      <RadioGroup label={t('shortcuts.set.label')} value={preset} onChange={choose}>
        <RadioCard value="default" label={t('shortcuts.set.default')} description={t('shortcuts.set.defaultHelp')} />
        {offered && (
          <RadioCard value="onenote" label={t('shortcuts.set.onenote')} description={t('shortcuts.set.onenoteHelp')} />
        )}
      </RadioGroup>
      <ShortcutList level={2} />
    </div>
  );
}
