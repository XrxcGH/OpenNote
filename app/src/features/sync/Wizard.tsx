// The steps that set sync up or join it. Setting up: where sync keeps its data, a passphrase typed twice, then the
// recovery key, shown once, and two of its groups typed back to show it was saved. Joining: where, then a pairing
// code, the passphrase, or the recovery key. Each step's heading takes focus, so a screen reader hears where it is.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '../../strings/t';
import { Button, RadioCard, RadioGroup, TextField, announce, showToast } from '../../ui';
import { checkGroups, codeOf, errorText, groupMatches, keyStoreText, passphraseProblem, placeReady } from './model';
import { setView, syncClient } from './runtime';
import styles from './sync.module.css';
import type { BackendConfig, BeginInput, SyncView } from './types';

type Mode = 'create' | 'join';

interface Fields {
  kind: 'folder' | 'webdav';
  path: string;
  url: string;
  username: string;
  password: string;
  deviceName: string;
  passphrase: string;
  again: string;
  how: 'code' | 'passphrase' | 'recovery';
  secret: string;
  first: string;
  second: string;
}

type Change = (patch: Partial<Fields>) => void;

export interface WizardProps {
  mode: Mode;
  onDone(view: SyncView): void;
  onCancel(): void;
}

function backendOf(f: Fields): BackendConfig {
  return f.kind === 'folder'
    ? { kind: 'folder', path: f.path.trim() }
    : { kind: 'webdav', url: f.url.trim(), username: f.username };
}

function joinInput(f: Fields): BeginInput {
  return {
    backend: backendOf(f),
    deviceName: f.deviceName,
    password: f.kind === 'webdav' ? f.password : undefined,
    code: f.how === 'code' ? f.secret : undefined,
    passphrase: f.how === 'passphrase' ? f.secret : undefined,
    recoveryKey: f.how === 'recovery' ? f.secret : undefined,
  };
}

/** The first sync starts right after setup, in the background. */
function finish(view: SyncView, message: 'sync.wizard.ready' | 'sync.wizard.joined', onDone: (view: SyncView) => void) {
  showToast({ message: t(message) });
  onDone(view);
  void syncClient()
    .syncNow()
    .then((result) => setView(result.view))
    .catch(() => {});
}

function PlaceStep({ f, set }: { f: Fields; set: Change }) {
  return (
    <div className={styles.block}>
      <RadioGroup label={t('sync.wizard.whereLabel')} value={f.kind} onChange={(kind: Fields['kind']) => set({ kind })}>
        <RadioCard value="folder" label={t('sync.wizard.folder')} description={t('sync.wizard.folderHelp')} />
        <RadioCard value="webdav" label={t('sync.wizard.webdav')} description={t('sync.wizard.webdavHelp')} />
      </RadioGroup>
      {f.kind === 'folder' ? (
        <TextField
          label={t('sync.wizard.folderPath')}
          value={f.path}
          onChange={(path) => set({ path })}
          help={t('sync.wizard.folderPathHelp')}
        />
      ) : (
        <>
          <TextField
            label={t('sync.wizard.url')}
            value={f.url}
            onChange={(url) => set({ url })}
            help={t('sync.wizard.urlHelp')}
          />
          <TextField label={t('sync.wizard.username')} value={f.username} onChange={(username) => set({ username })} />
          <TextField
            label={t('sync.wizard.password')}
            value={f.password}
            onChange={(password) => set({ password })}
            help={keyStoreText('sync.wizard.passwordHelp')}
            secret
          />
        </>
      )}
    </div>
  );
}

function SecretStep({ mode, f, set }: { mode: Mode; f: Fields; set: Change }) {
  const name = (
    <TextField
      label={t('sync.wizard.deviceName')}
      value={f.deviceName}
      onChange={(deviceName) => set({ deviceName })}
    />
  );
  if (mode === 'create') {
    return (
      <div className={styles.block}>
        <TextField
          label={t('sync.wizard.passphrase')}
          value={f.passphrase}
          onChange={(passphrase) => set({ passphrase })}
          help={t('sync.wizard.passphraseHelp')}
          secret
        />
        <TextField label={t('sync.wizard.confirm')} value={f.again} onChange={(again) => set({ again })} secret />
        {name}
      </div>
    );
  }
  const label = {
    code: 'sync.wizard.code',
    passphrase: 'sync.wizard.passphrase',
    recovery: 'sync.wizard.recoveryKey',
  } as const;
  return (
    <div className={styles.block}>
      <RadioGroup
        label={t('sync.wizard.howLabel')}
        value={f.how}
        onChange={(how: Fields['how']) => set({ how, secret: '' })}
      >
        <RadioCard value="code" label={t('sync.wizard.byCode')} description={t('sync.wizard.byCodeHelp')} />
        <RadioCard value="passphrase" label={t('sync.wizard.byPassphrase')} />
        <RadioCard value="recovery" label={t('sync.wizard.byRecovery')} />
      </RadioGroup>
      <TextField
        label={t(label[f.how])}
        value={f.secret}
        onChange={(secret) => set({ secret })}
        secret={f.how === 'passphrase'}
      />
      {name}
    </div>
  );
}

function RecoveryStep({ recovery }: { recovery: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recovery);
      announce(t('sync.wizard.copiedKey'));
    } catch {
      showToast({ message: t('sync.errors.unknown'), tone: 'danger' });
    }
  };
  return (
    <div className={styles.block}>
      <p>{t('sync.wizard.recoveryHelp')}</p>
      <p className={styles.help}>{t('sync.wizard.recoveryLabel')}</p>
      <p className={styles.key} data-testid="sync-recovery-key">
        {recovery}
      </p>
      <div className={styles.actions}>
        <Button onClick={() => void copy()}>{t('sync.wizard.copyKey')}</Button>
      </div>
    </div>
  );
}

function CheckStep({ groups, f, set }: { groups: [number, number]; f: Fields; set: Change }) {
  const [first, second] = groups;
  return (
    <div className={styles.block}>
      <p>{t('sync.wizard.checkHelp', { first, second })}</p>
      <div className={styles.groups}>
        <TextField
          label={t('sync.wizard.groupLabel', { number: first })}
          value={f.first}
          onChange={(v) => set({ first: v })}
        />
        <TextField
          label={t('sync.wizard.groupLabel', { number: second })}
          value={f.second}
          onChange={(v) => set({ second: v })}
        />
      </div>
    </div>
  );
}

const START: Fields = {
  kind: 'folder',
  path: '',
  url: '',
  username: '',
  password: '',
  deviceName: '',
  passphrase: '',
  again: '',
  how: 'code',
  secret: '',
  first: '',
  second: '',
};

/** The state and the moves between steps. */
function useWizard(mode: Mode, onDone: (view: SyncView) => void) {
  const [step, setStep] = useState(1);
  const [f, setFields] = useState<Fields>(() => ({ ...START, deviceName: t('sync.wizard.deviceNameDefault') }));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ view: SyncView; recovery: string } | null>(null);
  const set: Change = (patch) => setFields((old) => ({ ...old, ...patch }));
  const go = (next: number) => {
    setProblem(null);
    setStep(next);
  };
  const groups = checkGroups(made?.recovery ?? '');

  const begin = async () => {
    const wrong = mode === 'create' ? passphraseProblem(f.passphrase, f.again) : null;
    if (wrong) return setProblem(wrong);
    setBusy(true);
    setProblem(null);
    announce(t('sync.wizard.working'));
    try {
      if (mode === 'join') {
        const view = await syncClient().join(joinInput(f));
        set({ secret: '' });
        setView(view);
        return finish(view, 'sync.wizard.joined', onDone);
      }
      const input = { ...joinInput(f), code: undefined, recoveryKey: undefined, passphrase: f.passphrase };
      const view = await syncClient().setUp(input);
      setView(view);
      setMade({ view, recovery: view.recoveryKey ?? '' });
      set({ passphrase: '', again: '' });
      go(3);
    } catch (error) {
      setProblem(errorText(codeOf(error)));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 1) return placeReady(backendOf(f)) ? go(2) : setProblem(t('sync.wizard.needPlace'));
    if (step === 2) return void begin();
    if (step === 3) return go(4);
    const key = made?.recovery ?? '';
    if (made && groupMatches(key, groups[0], f.first) && groupMatches(key, groups[1], f.second)) {
      return void confirmKey();
    }
    setProblem(t('sync.wizard.checkWrong'));
  };

  // Sync waits, paused, from setup until the key is checked; only then does it start.
  const confirmKey = async () => {
    setBusy(true);
    try {
      const view = await syncClient().finishSetUp();
      setView(view);
      setMade(null);
      finish(view, 'sync.wizard.ready', onDone);
    } catch (error) {
      setProblem(errorText(codeOf(error)));
    } finally {
      setBusy(false);
    }
  };

  // After setup made the vault, Cancel takes it away again, so no sync runs with a key nobody saved.
  const cancel = async (onCancel: () => void) => {
    if (!made) return onCancel();
    setBusy(true);
    try {
      setView(await syncClient().cancelSetUp());
      setMade(null);
      onCancel();
    } catch (error) {
      setProblem(errorText(codeOf(error)));
    } finally {
      setBusy(false);
    }
  };
  return { step, f, set, problem, busy, recovery: made?.recovery ?? '', groups, go, submit, cancel };
}

export function Wizard({ mode, onDone, onCancel }: WizardProps) {
  const w = useWizard(mode, onDone);
  const heading = useRef<HTMLHeadingElement>(null);
  const count = mode === 'create' ? 4 : 2;
  useEffect(() => {
    heading.current?.focus();
  }, [w.step]);
  const titles = [
    'sync.wizard.whereLabel',
    mode === 'create' ? 'sync.wizard.passphrase' : 'sync.wizard.howLabel',
  ] as const;
  const title =
    w.step <= 2 ? t(titles[w.step - 1]) : t(w.step === 3 ? 'sync.wizard.recoveryTitle' : 'sync.wizard.checkTitle');
  const last = w.step === count;
  return (
    <form className={styles.page} onSubmit={w.submit} aria-labelledby="sync-wizard-title" noValidate>
      <div className={styles.heading}>
        <h2 id="sync-wizard-title">{mode === 'create' ? t('sync.wizard.title') : t('sync.wizard.joinTitle')}</h2>
        <span className={styles.badge}>{t('sync.beta')}</span>
      </div>
      <p className={styles.help}>{t('sync.wizard.step', { step: w.step, count })}</p>
      <h3 ref={heading} tabIndex={-1} className={styles.stepTitle}>
        {title}
      </h3>
      {w.step === 1 && <PlaceStep f={w.f} set={w.set} />}
      {w.step === 2 && <SecretStep mode={mode} f={w.f} set={w.set} />}
      {w.step === 3 && <RecoveryStep recovery={w.recovery} />}
      {w.step === 4 && <CheckStep groups={w.groups} f={w.f} set={w.set} />}
      {w.problem && (
        <p className={styles.notice} role="alert">
          {w.problem}
        </p>
      )}
      <div className={styles.actions}>
        {w.step < 3 && (
          <Button onClick={w.step === 1 ? onCancel : () => w.go(1)} disabled={w.busy}>
            {w.step === 1 ? t('sync.wizard.cancel') : t('sync.wizard.back')}
          </Button>
        )}
        {w.step >= 3 && (
          <Button onClick={() => void w.cancel(onCancel)} disabled={w.busy}>
            {t('sync.wizard.cancel')}
          </Button>
        )}
        {w.step === 4 && <Button onClick={() => w.go(3)}>{t('sync.wizard.back')}</Button>}
        <Button variant="primary" type="submit" disabled={w.busy}>
          {w.busy ? t('sync.wizard.working') : last ? t('sync.wizard.finish') : t('sync.wizard.next')}
        </Button>
      </div>
    </form>
  );
}
