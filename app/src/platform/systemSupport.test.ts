import { describe, expect, it } from 'vitest';

import { t } from '../strings/t';
import { systemLimits } from './systemSupport';

describe('systemLimits', () => {
  it('lists nothing on Windows', () => {
    expect(systemLimits('windows')).toEqual([]);
  });

  it('lets a Mac set up sync, because its keys live in the Keychain', () => {
    const mac: readonly string[] = systemLimits('macos');
    expect(mac).not.toContain('sync');
    expect(mac).not.toContain('syncKeyring');
  });

  it('says on Linux that sync needs a running keyring', () => {
    expect(systemLimits('linux')).toContain('syncKeyring');
    expect(t('settings.about.limits.syncKeyring')).toMatch(/GNOME Keyring or KWallet/);
  });

  it('has a sentence for every limit it lists', () => {
    for (const system of ['macos', 'linux'] as const) {
      for (const limit of systemLimits(system)) {
        expect(t(`settings.about.limits.${limit}`)).not.toMatch(/^settings\./);
      }
    }
  });
});
