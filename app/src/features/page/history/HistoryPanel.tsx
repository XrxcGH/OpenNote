// The Page history panel (ARCHITECTURE.md section 21): versions newest first, with date and time, the reason in plain
// words, device, and name. The newest is the current page, saved when the panel opens. Choosing a version compares it
// with the current page, and "Compare with" picks another. Versions can be named, restored, or restored as a copy,
// and the page's history deleted.
import { useCallback, useEffect, useState } from 'react';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { diffPages } from '../../../editor/diff/pageDiff';
import type { PageDiff } from '../../../editor/diff/pageDiff';
import type { OpenPage, VersionInfo } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, Button, confirm, IconButton, Switch, TextField } from '../../../ui';
import { historyAdmin } from './admin';
import { CompareView } from './CompareView';
import type { CompareActions } from './CompareView';
import styles from './history.module.css';
import { restoreBlocks, restoreParagraph, restoreVersion } from './restore';

const REASONS = new Set([
  'beforeEdit',
  'closed',
  'interval',
  'exit',
  'named',
  'beforeRestore',
  'beforeUpgrade',
  'beforeLargeDelete',
  'beforeRepair',
  'conflict',
  'recovered',
]);

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function reasonText(reason: string): string {
  return REASONS.has(reason) ? t(`history.reasons.${reason as 'closed'}`) : t('history.reasons.unknown');
}

function versionLabel(version: VersionInfo): string {
  return t('history.version', { when: when.format(new Date(version.savedAt)), device: version.device });
}

export interface HistoryPanelProps {
  page: OpenPage;
  title: string;
  onClose(): void;
}

type Listing = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; versions: VersionInfo[] };

async function listVersions(page: OpenPage): Promise<Listing> {
  try {
    await page.saveNow().catch(() => undefined);
    const versions = [...(await page.history.list())].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return { state: 'ready', versions };
  } catch {
    return { state: 'failed' };
  }
}

/** The page's versions, newest first, saved first; reload lists them again after a change. */
function useVersions(page: OpenPage): [Listing, () => void] {
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let current = true;
    void listVersions(page).then((next) => current && setListing(next));
    return () => {
      current = false;
    };
  }, [page, round]);
  return [listing, useCallback(() => setRound((value) => value + 1), [])];
}

function NameForm({ page, version, onDone }: { page: OpenPage; version: VersionInfo; onDone(): void }) {
  const [name, setName] = useState(version.name ?? '');
  const [keep, setKeep] = useState(version.keep || version.name !== null);
  const save = async () => {
    await page.history.name(version.revision, name.trim() || null, keep).catch(() => undefined);
    announce(t('history.name.done'));
    onDone();
  };
  return (
    <form
      className={styles.form}
      aria-label={t('history.name.title')}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <TextField label={t('history.name.label')} value={name} onChange={setName} autoSelect onCancel={onDone} />
      <Switch label={t('history.name.keep')} checked={keep} onChange={setKeep} />
      <div className={styles.actions}>
        <Button variant="primary" type="submit">
          {t('history.name.save')}
        </Button>
        <Button onClick={onDone}>{t('history.name.cancel')}</Button>
      </div>
    </form>
  );
}

async function deleteHistory(page: OpenPage, title: string): Promise<boolean> {
  const admin = historyAdmin();
  const notebook = admin?.notebookOf(page.id);
  if (!admin || !notebook) return false;
  const yes = await confirm({
    title: t('history.delete.title', { name: title }),
    body: t('history.delete.page'),
    confirmLabel: t('history.delete.confirm'),
    cancelLabel: t('history.delete.cancel'),
    danger: true,
  });
  if (!yes) return false;
  try {
    await admin.deleteHistory(notebook, { kind: 'page', id: page.id }, true);
    announce(t('history.delete.done'));
    return true;
  } catch {
    announce(t('history.delete.failed'), 'assertive');
    return false;
  }
}

function Compare(props: { page: OpenPage; versions: VersionInfo[]; older: string; onBack(): void; onChanged(): void }) {
  const { page, versions, older, onBack, onChanged } = props;
  const [newer, setNewer] = useState(versions[0].revision);
  const [result, setResult] = useState<{ key: string; diff: PageDiff } | null>(null);
  const key = `${older} ${newer}`;
  const diff = result?.key === key ? result.diff : null;
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    let current = true;
    void Promise.all([page.history.open(older), page.history.open(newer)])
      .then(([before, after]) => current && setResult({ key, diff: diffPages(before, after) }))
      .catch(
        () =>
          current &&
          setResult({ key, diff: { blocks: [], counts: { added: 0, removed: 0, changed: 0, moved: 0 }, ink: null } }),
      );
    return () => {
      current = false;
    };
  }, [page, older, newer, key]);
  const version = versions.find((item) => item.revision === older)!;
  const isCurrent = newer === versions[0].revision;
  const actions: CompareActions = {
    restoreParagraph: (block, change, all) =>
      void restoreParagraph(block, change, all).then((ok) => (ok ? onChanged() : undefined)),
    restoreBlock: (block) => void restoreBlocks(page, older, [block]).then((ok) => (ok ? onChanged() : undefined)),
  };
  return (
    <div className={styles.body}>
      <Button variant="quiet" onClick={onBack}>
        {t('history.compare.back')}
      </Button>
      <h3 className={styles.subtitle}>
        {t('history.compare.title', {
          older: versionLabel(version),
          newer: isCurrent ? t('history.current') : versionLabel(versions.find((item) => item.revision === newer)!),
        })}
      </h3>
      <label className={styles.field}>
        {t('history.compare.with')}
        <select className={styles.select} value={newer} onChange={(event) => setNewer(event.currentTarget.value)}>
          {versions
            .filter((item) => item.revision !== older)
            .map((item, index) => (
              <option key={item.revision} value={item.revision}>
                {index === 0 && item.revision === versions[0].revision ? t('history.current') : versionLabel(item)}
              </option>
            ))}
        </select>
      </label>
      <div className={styles.actions}>
        <Button onClick={() => void restoreVersion(page, older, false).then((ok) => (ok ? onChanged() : undefined))}>
          {t('history.restore.version')}
        </Button>
        <Button onClick={() => void restoreVersion(page, older, true)}>{t('history.restore.copy')}</Button>
        <Button onClick={() => setNaming(true)}>{t('history.commands.nameVersion')}</Button>
      </div>
      {naming && <NameForm page={page} version={version} onDone={() => setNaming(false)} />}
      {diff ? (
        <CompareView
          diff={diff}
          actions={isCurrent ? actions : { restoreParagraph: () => undefined, restoreBlock: actions.restoreBlock }}
        />
      ) : (
        <p role="status">{t('history.loading')}</p>
      )}
    </div>
  );
}

function VersionList(props: { versions: VersionInfo[]; onChoose(revision: string): void }) {
  return (
    <ul className={styles.versions} aria-label={t('history.versions')}>
      {props.versions.map((version, index) => (
        <li key={version.revision}>
          <button
            type="button"
            className={styles.version}
            aria-current={index === 0 ? 'true' : undefined}
            disabled={index === 0}
            onClick={() => props.onChoose(version.revision)}
          >
            <span className={styles.when}>{index === 0 ? t('history.current') : versionLabel(version)}</span>
            <span className={styles.reason}>{reasonText(version.reason)}</span>
            {version.name && (
              <span className={styles.name}>
                {t('history.named')}: {version.name}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HistoryPanel({ page, title, onClose }: HistoryPanelProps) {
  const [listing, reload] = useVersions(page);
  const [older, setOlder] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const versions = listing.state === 'ready' ? listing.versions : [];
  return (
    <aside
      className={styles.panel}
      aria-label={t('history.panel')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{t('history.panel')}</h2>
        <IconButton label={t('history.close')} icon={XIcon} onPress={onClose} />
      </header>
      {listing.state === 'loading' && <p role="status">{t('history.loading')}</p>}
      {listing.state === 'failed' && <p role="alert">{t('history.failed')}</p>}
      {listing.state === 'ready' && versions.length < 2 && <p>{t('history.empty')}</p>}
      {older && versions.length > 1 ? (
        <Compare page={page} versions={versions} older={older} onBack={() => setOlder(null)} onChanged={reload} />
      ) : (
        <div className={styles.body}>
          {versions.length > 0 && <VersionList versions={versions} onChoose={setOlder} />}
          <div className={styles.actions}>
            {versions[0] && <Button onClick={() => setNaming(true)}>{t('history.commands.nameVersion')}</Button>}
            {historyAdmin() && (
              <Button
                variant="danger"
                onClick={() => void deleteHistory(page, title).then((ok) => (ok ? reload() : undefined))}
              >
                {t('history.delete.action')}
              </Button>
            )}
          </div>
          {naming && versions[0] && (
            <NameForm
              page={page}
              version={versions[0]}
              onDone={() => {
                setNaming(false);
                reload();
              }}
            />
          )}
        </div>
      )}
    </aside>
  );
}
