// The Code group of the Models panel (Settings, then On-device intelligence): the runtime packs with their sizes, and
// the code models the panel passes in. It is the one place for the code studio's large downloads, and Settings, then
// Code, then Downloads opens it (openCodeDownloads). Nothing downloads until a person presses Download and confirms.
import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import type { PackInfo } from '../contracts';
import {
  anyPackDownloading,
  cancelPack,
  CODE_DOWNLOADS_ID,
  downloadPack,
  formatSize,
  packsState,
  packStateLine,
  POLL_MS,
  refreshPacks,
  removePack,
} from './store';

/** The class names of the panel the group sits in, so the rows look like the model rows. */
export interface CodeDownloadsStyles {
  label?: string;
  help?: string;
  list?: string;
  item?: string;
  itemHead?: string;
  meter?: string;
  actions?: string;
}

function PackRow(props: { pack: PackInfo; styles: CodeDownloadsStyles }) {
  const { pack, styles } = props;
  const nameId = useId();
  const size = formatSize(pack.bytes);
  const state = pack.state;
  const offline = state.kind === 'blocked';
  return (
    <li className={styles.item} aria-labelledby={nameId}>
      <div className={styles.itemHead}>
        <strong id={nameId} translate="no">
          {pack.name} {pack.version}
        </strong>
        <span>{t('codeStudio.packs.sizeOf', { size })}</span>
      </div>
      {pack.detail && <p className={styles.help}>{pack.detail}</p>}
      {pack.license && (
        <p className={styles.help} translate="no">
          {t('codeStudio.packs.license', { license: pack.license })}
        </p>
      )}
      {(state.kind === 'downloading' || state.kind === 'partial') && (
        <progress
          className={styles.meter}
          value={state.receivedBytes}
          max={state.totalBytes}
          aria-label={packStateLine(pack)}
        />
      )}
      <p className={styles.help} role="status">
        {packStateLine(pack)}
      </p>
      <div className={styles.actions}>
        {(state.kind === 'absent' || state.kind === 'failed' || offline) && (
          <Button
            variant="secondary"
            aria-label={t('codeStudio.packs.downloadNamed', { name: pack.name, size })}
            disabled={offline}
            onClick={() => void downloadPack(pack)}
          >
            {t('codeStudio.packs.download')}
          </Button>
        )}
        {state.kind === 'partial' && (
          <Button
            variant="secondary"
            aria-label={t('codeStudio.packs.resumeNamed', { name: pack.name })}
            onClick={() => void downloadPack(pack)}
          >
            {t('codeStudio.packs.resume')}
          </Button>
        )}
        {state.kind === 'downloading' && (
          <Button
            variant="secondary"
            aria-label={t('codeStudio.packs.cancelNamed', { name: pack.name })}
            onClick={() => void cancelPack(pack)}
          >
            {t('codeStudio.packs.cancel')}
          </Button>
        )}
        {(state.kind === 'ready' || state.kind === 'partial' || state.kind === 'failed') && (
          <Button
            variant="quiet"
            aria-label={t('codeStudio.packs.removeNamed', { name: pack.name })}
            onClick={() => void removePack(pack)}
          >
            {t('codeStudio.packs.remove')}
          </Button>
        )}
      </div>
    </li>
  );
}

export default function CodeDownloads(props: { styles: CodeDownloadsStyles; children?: ReactNode }) {
  const { styles, children } = props;
  const state = useStore(packsState, (one) => one);
  const headingId = useId();
  const downloading = anyPackDownloading(state.list);
  useEffect(() => {
    void refreshPacks();
  }, []);
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void refreshPacks(), POLL_MS);
    return () => clearInterval(timer);
  }, [downloading]);
  const packs = state.list?.packs ?? [];
  const core = packs.filter((pack) => !pack.id.startsWith('pyodide:'));
  const packages = packs.filter((pack) => pack.id.startsWith('pyodide:'));
  return (
    <div id={CODE_DOWNLOADS_ID} tabIndex={-1} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.label}>
        {t('codeStudio.packs.heading')}
      </h3>
      <p className={styles.help}>{t('codeStudio.packs.help')}</p>
      {state.failed && !state.list && <p className={styles.help}>{t('codeStudio.packs.desktopOnly')}</p>}
      <ul className={styles.list} aria-label={t('codeStudio.packs.heading')}>
        {core.map((pack) => (
          <PackRow key={pack.id} pack={pack} styles={styles} />
        ))}
        {children}
      </ul>
      {packages.length > 0 && (
        <>
          <p className={styles.help}>{t('codeStudio.packs.packagesHelp')}</p>
          <ul className={styles.list} aria-label={t('codeStudio.packs.packagesHelp')}>
            {packages.map((pack) => (
              <PackRow key={pack.id} pack={pack} styles={styles} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
