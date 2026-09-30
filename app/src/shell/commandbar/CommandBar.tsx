// The command bar: a toolbar of the items features register for the Home tab. WP7 adds the tabs, roving focus,
// overflow into More, and the compact bottom bar.

import { withEnabledFlags } from '../../app/flags';
import { executeCommand } from '../../commands/registry';
import { commandBar, commands, useRegistry } from '../../registries';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { useRegion } from '../regions';
import styles from './CommandBar.module.css';

export function CommandBar() {
  const items = withEnabledFlags(useRegistry(commandBar)).filter((item) => item.tab === 'home');
  const region = useRegion('commandBar');
  if (items.length === 0) return null;
  return (
    <div role="toolbar" aria-label={t('layout.regions.commands')} className={styles.commandBar} {...region}>
      {items
        .sort((a, b) => b.priority - a.priority)
        .map((item) => {
          const def = commands.get(item.command);
          if (!def) return null;
          return (
            <Button
              key={item.id}
              variant="quiet"
              onClick={() => void executeCommand(item.command, undefined, 'commandBar')}
            >
              {t(def.title)}
            </Button>
          );
        })}
    </div>
  );
}

/** The compact layout's bottom bar. WP0 has no compact layout, so it renders nothing. */
export function BottomBar() {
  return null;
}
