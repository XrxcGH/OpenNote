// The devices that sync, with Remove for the others, and Add a device: a one-time pairing code as a QR code and
// as text, which works for 24 hours.

import { useEffect, useState } from 'react';
import { t } from '../../strings/t';
import { Button, Dialog, announce, confirm, showToast } from '../../ui';
import { codeOf, deviceLines, errorText, qrPath } from './model';
import { refreshSync, setView, syncClient } from './runtime';
import styles from './sync.module.css';
import type { DeviceRow, PairingCode } from './types';

function Pairing({ code, onClose }: { code: PairingCode; onClose(): void }) {
  const size = (code.rows.length || 21) + 8;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      announce(t('sync.devices.copied'));
    } catch {
      showToast({ message: t('sync.errors.unknown'), tone: 'danger' });
    }
  };
  return (
    <Dialog
      title={t('sync.devices.codeTitle')}
      description={t('sync.devices.codeHelp')}
      onDismiss={onClose}
      actions={[
        { id: 'copy', label: t('sync.devices.copy'), variant: 'secondary', onPress: copy },
        { id: 'done', label: t('sync.devices.close'), variant: 'primary', onPress: onClose },
      ]}
    >
      <div className={styles.block}>
        {code.rows.length > 0 && (
          <svg className={styles.qr} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t('sync.devices.qrLabel')}>
            <path className={styles.qrDark} d={qrPath(code.rows)} />
          </svg>
        )}
        <p className={styles.help}>{t('sync.devices.codeLabel')}</p>
        <p className={styles.key} data-testid="sync-pairing-code">
          {code.code}
        </p>
      </div>
    </Dialog>
  );
}

export function Devices() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState<PairingCode | null>(null);
  // The time the rows are read against, for "Last synced" and a device that has gone quiet.
  const [now] = useState(() => Date.now());
  const load = () =>
    syncClient()
      .devices()
      .then((rows) => {
        setDevices(rows);
        setProblem(null);
      })
      .catch((error: unknown) => setProblem(errorText(codeOf(error))));
  useEffect(() => {
    void load();
  }, []);

  const remove = async (device: DeviceRow) => {
    const yes = await confirm({
      title: t('sync.devices.removeTitle', { name: device.name }),
      body: t('sync.devices.removeBody'),
      confirmLabel: t('sync.devices.removeConfirm'),
      danger: true,
    });
    if (!yes) return;
    try {
      setView(await syncClient().removeDevice(device.tag));
      announce(t('sync.done.removed'));
      await load();
    } catch (error) {
      setProblem(errorText(codeOf(error)));
    }
  };

  const add = async () => {
    try {
      setCode(await syncClient().pairingCode());
    } catch (error) {
      setProblem(errorText(codeOf(error)));
    }
  };

  return (
    <section className={styles.block} aria-labelledby="sync-devices">
      <h2 id="sync-devices">{t('sync.devices.title')}</h2>
      <p className={styles.help}>{t('sync.devices.help')}</p>
      {problem && (
        <p className={styles.notice} role="alert">
          {problem}
        </p>
      )}
      {devices && (
        <ul className={styles.list} aria-labelledby="sync-devices">
          {devices.map((device) => (
            <li key={device.tag} className={styles.row}>
              <span className={styles.rowText}>
                <span>{device.thisDevice ? t('sync.devices.thisDevice', { name: device.name }) : device.name}</span>
                {deviceLines(device, now).map((line) => (
                  <span key={line} className={styles.help}>
                    {line}
                  </span>
                ))}
              </span>
              {!device.thisDevice && (
                <Button
                  variant="quiet"
                  aria-label={t('sync.devices.remove', { name: device.name })}
                  onClick={() => void remove(device)}
                >
                  {t('sync.devices.removeConfirm')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <Button onClick={() => void add()}>{t('sync.devices.add')}</Button>
      </div>
      {code && (
        <Pairing
          code={code}
          onClose={() => {
            setCode(null);
            void refreshSync();
          }}
        />
      )}
    </section>
  );
}
