// Change passphrase in Settings > Sync (ADR 0049): the recovery key, then the new passphrase typed twice. The
// devices that already sync keep their own keys; a device that joins later uses the new passphrase. The palette
// command opens the same form.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button, TextField, announce } from '../../ui';
import { codeOf, errorText, passphraseProblem } from './model';
import { passphraseAsked, setView, syncClient } from './runtime';
import styles from './sync.module.css';

const same = <T,>(value: T) => value;

export function ChangePassphrase() {
  const asked = useStore(passphraseAsked, same);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (asked) heading.current?.focus();
  }, [asked]);

  const close = () => {
    passphraseAsked.set(false);
    setRecoveryKey('');
    setPassphrase('');
    setAgain('');
    setProblem(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const wrong = passphraseProblem(passphrase, again);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      setView(await syncClient().changePassphrase({ recoveryKey, passphrase }));
      close();
      announce(t('sync.done.passphrase'));
    } catch (error) {
      setProblem(errorText(codeOf(error)));
    } finally {
      setBusy(false);
    }
  };

  if (!asked) {
    return (
      <div className={styles.actions}>
        <Button onClick={() => passphraseAsked.set(true)}>{t('sync.passphrase.open')}</Button>
      </div>
    );
  }
  return (
    <form className={styles.block} aria-labelledby="sync-passphrase" onSubmit={(e) => void submit(e)} noValidate>
      <h2 id="sync-passphrase" ref={heading} tabIndex={-1}>
        {t('sync.passphrase.title')}
      </h2>
      <p className={styles.help}>{t('sync.passphrase.help')}</p>
      <TextField
        label={t('sync.passphrase.recovery')}
        value={recoveryKey}
        onChange={setRecoveryKey}
        help={t('sync.passphrase.recoveryHelp')}
        secret
      />
      <TextField
        label={t('sync.passphrase.new')}
        value={passphrase}
        onChange={setPassphrase}
        help={t('sync.wizard.passphraseHelp')}
        secret
      />
      <TextField label={t('sync.wizard.confirm')} value={again} onChange={setAgain} secret />
      {problem && (
        <p className={styles.notice} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={busy}>
          {t('sync.passphrase.save')}
        </Button>
        <Button onClick={close} disabled={busy}>
          {t('sync.passphrase.cancel')}
        </Button>
      </div>
    </form>
  );
}
