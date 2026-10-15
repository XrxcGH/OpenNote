// Settings, then Windows and power: quick capture, the window modes, whether OpenNote opens on Home, and low-power
// mode.

import { useEffect, useState } from 'react';
import { isEnabled } from '../../app/flags';
import { executeCommand } from '../../commands/registry';
import { qolStore } from '../../state/qol';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button, Switch, TextField } from '../../ui';
import { settingsStyles as styles } from '../settings';
import { refreshLowPower } from './modes';
import { readPrefs, writePrefs } from './prefs';
import type { QolPrefs } from './prefs';
import { commands } from '../../registries';
import { DEFAULT_QUICK, quickKeyClashes, quickKeyProblem, quickStatus, setQuick } from './quickCaptureControls';
import type { QuickStatus } from './quickCaptureControls';

function QuickCaptureSettings() {
  const [status, setStatus] = useState<QuickStatus>(DEFAULT_QUICK);
  const [key, setKey] = useState(DEFAULT_QUICK.choice.key);
  const [error, setError] = useState<'invalid' | 'altgr' | null>(null);
  useEffect(() => {
    let current = true;
    void quickStatus().then((loaded) => {
      if (!current) return;
      setStatus(loaded);
      setKey(loaded.choice.key);
    });
    return () => {
      current = false;
    };
  }, []);
  if (!isEnabled('qol.quickCapture')) return null;
  const save = async (enabled: boolean, next: string) => {
    try {
      const saved = await setQuick(enabled, next);
      setStatus(saved);
      setKey(saved.choice.key);
      setError(null);
    } catch {
      setError('invalid');
    }
  };
  // Only a shortcut that is on needs usable keys. Turning it off always works, so a Ctrl+Alt+Q an earlier beta saved
  // can be switched off without typing new keys first; the shell puts the default in place of a refused key.
  const toggle = (enabled: boolean) => {
    const problem = enabled ? quickKeyProblem(key) : null;
    if (problem) setError(problem);
    else void save(enabled, key);
  };
  const commit = () => {
    const problem = quickKeyProblem(key);
    if (problem) setError(problem);
    else void save(status.choice.enabled, key);
  };
  // The keys in the field, so the warning comes while the person picks them rather than after they are saved.
  const clashes = quickKeyClashes(key).map((id) => {
    const def = commands.get(id);
    return def ? t(def.title) : id;
  });
  return (
    <section className={styles.block} aria-labelledby="qol-quick">
      <h2 id="qol-quick">{t('qol.capture.settingsTitle')}</h2>
      <p>{t('qol.capture.settingsBody')}</p>
      <Switch label={t('qol.capture.enable')} checked={status.choice.enabled} onChange={toggle} />
      <TextField
        label={t('qol.capture.keys')}
        value={key}
        onChange={setKey}
        error={error ? t(error === 'altgr' ? 'qol.capture.keysAltGr' : 'qol.capture.keysInvalid') : undefined}
        help={t('qol.capture.keysHelp')}
        onCommit={commit}
      />
      {status.choice.enabled && !status.registered && (
        <p className={styles.help}>
          {t(quickKeyProblem(status.choice.key) === 'altgr' ? 'qol.capture.keysAltGr' : 'qol.capture.taken')}
        </p>
      )}
      {clashes.length > 0 && (
        <p className={styles.help}>{t('qol.capture.keysClash', { commands: clashes.join(', ') })}</p>
      )}
    </section>
  );
}

function WindowModes() {
  const docked = useStore(qolStore, (state) => state.docked);
  const mini = useStore(qolStore, (state) => state.miniWindow);
  return (
    <section className={styles.block} aria-labelledby="qol-modes">
      <h2 id="qol-modes">{t('qol.modes.title')}</h2>
      {isEnabled('qol.miniWindow') && (
        <Switch
          label={t('qol.modes.mini')}
          checked={mini}
          onChange={() => void executeCommand('window.toggleMini', undefined, 'menu')}
        />
      )}
      {isEnabled('qol.dock') && (
        <div className={styles.actions}>
          <Button onClick={() => void executeCommand('window.dockLeft', undefined, 'menu')}>
            {t(docked === 'left' ? 'qol.modes.undock' : 'qol.modes.dockLeft')}
          </Button>
          <Button onClick={() => void executeCommand('window.dockRight', undefined, 'menu')}>
            {t(docked === 'right' ? 'qol.modes.undock' : 'qol.modes.dockRight')}
          </Button>
        </div>
      )}
    </section>
  );
}

function Startup() {
  const [prefs, setPrefs] = useState<QolPrefs>({});
  useEffect(() => {
    let current = true;
    void readPrefs().then((loaded) => current && setPrefs(loaded));
    return () => {
      current = false;
    };
  }, []);
  const lowPower = useStore(qolStore, (state) => state.lowPower);
  const change = async (patch: Record<string, unknown>) => {
    setPrefs(await writePrefs(patch));
    await refreshLowPower();
  };
  return (
    <>
      {isEnabled('qol.home') && (
        <section className={styles.block} aria-labelledby="qol-home">
          <h2 id="qol-home">{t('qol.home.settingsTitle')}</h2>
          <Switch
            label={t('qol.home.startOnHome')}
            checked={prefs.startOnHome === true}
            onChange={(checked) => void change({ startOnHome: checked })}
          />
          <p className={styles.help}>{t('qol.home.startHelp')}</p>
        </section>
      )}
      {isEnabled('qol.lowPower') && (
        <section className={styles.block} aria-labelledby="qol-power">
          <h2 id="qol-power">{t('qol.power.title')}</h2>
          <Switch
            label={t('qol.power.auto')}
            checked={prefs.lowPowerAuto !== false}
            onChange={(checked) => void change({ lowPowerAuto: checked })}
          />
          <p className={styles.help} role="status">
            {t(lowPower ? 'qol.power.nowOn' : 'qol.power.nowOff')}
          </p>
        </section>
      )}
    </>
  );
}

export default function WindowsSection() {
  return (
    <>
      <QuickCaptureSettings />
      <WindowModes />
      <Startup />
    </>
  );
}
