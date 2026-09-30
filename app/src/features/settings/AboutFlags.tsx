// The experimental flags, for development and nightly builds (ARCHITECTURE.md section 2.2). Each one is a switch.
// Turning one on or off is saved in settings.experimental.flags and applies at once.

import { useState } from 'react';
import { FLAGS, initFlags, isEnabled } from '../../app/flags';
import type { FlagId } from '../../app/flags';
import { getSettings, updateSettings } from '../../state/settings';
import { t } from '../../strings/t';
import { Switch } from '../../ui';
import { host } from './host';
import styles from './SettingsView.module.css';

function apply(id: FlagId, on: boolean): Promise<void> {
  return updateSettings({ experimental: { flags: { [id]: on } } }).then(() => {
    const { boot } = host();
    initFlags(boot.channel, boot.flagOverrides, getSettings().experimental.flags);
  });
}

export function ExperimentalFlags() {
  // Flags aren't React state, so the list follows its own changes.
  const [, refresh] = useState(0);
  return (
    <section className={styles.block} aria-labelledby="settings-flags">
      <h2 id="settings-flags">{t('settings.about.experimental')}</h2>
      <p className={styles.help}>{t('settings.about.experimentalHelp')}</p>
      <ul className={styles.flags}>
        {FLAGS.map((flag) => (
          <li key={flag.id}>
            <Switch
              label={flag.id}
              checked={isEnabled(flag.id)}
              describedBy={`flag-${flag.id}`}
              onChange={(on) => void apply(flag.id, on).then(() => refresh((count) => count + 1))}
            />
            <p id={`flag-${flag.id}`} className={styles.help}>
              {flag.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
