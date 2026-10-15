// The Translate dialog (A3-25): what to translate, which language to translate it to, and what that needs. A language
// pack is downloaded only after the person sees its size and presses Download. Nothing is translated until they press
// Translate, and the translation is added beside the original, never over it.
import { useEffect, useId, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../strings/t';
import { Button, Dialog, ProgressBar, showToast } from '../../ui';
import { packFor, sizeLabel, translateMarkdown, translationEngine } from './engine';
import type { LanguagePack, TranslationEngine } from './engine';
import { LANGUAGES, nameOf } from './languages';

export type Scope = 'selection' | 'page' | 'transcript';

/** Something the person can translate, with the Markdown to send. */
export interface Source {
  scope: Scope;
  markdown: string;
  /** The language it is written in, when known. */
  from: string | null;
}

export interface Translation {
  scope: Scope;
  language: string;
  markdown: string;
  kept: number;
}

interface Props {
  sources: readonly Source[];
  onDone(result: Translation | null): void;
}

function Body({ sources, onDone }: Props) {
  const engine = translationEngine();
  const [scope, setScope] = useState<Scope>(sources[0]?.scope ?? 'page');
  const [to, setTo] = useState('es');
  const [packs, setPacks] = useState<readonly LanguagePack[]>([]);
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set());
  const [downloading, setDownloading] = useState<number | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const ids = { scope: useId(), to: useId() };
  const source = sources.find((one) => one.scope === scope);
  const pack = useMemo(() => packFor(packs, source?.from ?? null, to), [packs, source, to]);
  useEffect(() => {
    if (!engine) return;
    void Promise.all([engine.packs(), engine.installed()]).then(([all, have]) => {
      setPacks(all);
      setInstalled(have);
    });
  }, [engine]);
  const ready = pack !== null && installed.has(pack.id);

  const download = async (using: TranslationEngine, wanted: LanguagePack) => {
    setDownloading(0);
    try {
      await using.install(wanted, (fraction) => setDownloading(fraction));
      setInstalled(await using.installed());
    } catch (error) {
      showToast({ message: t('intelMore.translate.failed', { message: String(error) }), tone: 'danger' });
    } finally {
      setDownloading(null);
    }
  };

  const run = async () => {
    if (!engine || !pack || !source) return;
    setWorking(0);
    try {
      const done = await translateMarkdown(source.markdown, engine, source.from, to, { onProgress: setWorking });
      onDone({ scope, language: to, markdown: done.text, kept: done.kept });
    } catch (error) {
      showToast({ message: t('intelMore.translate.failed', { message: String(error) }), tone: 'danger' });
      setWorking(null);
    }
  };

  if (!engine) return <p>{t('intelMore.translate.noEngine')}</p>;
  return (
    <div>
      <p>
        <label htmlFor={ids.scope}>{t('intelMore.translate.what')} </label>
        <select id={ids.scope} value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
          {sources.map((one) => (
            <option key={one.scope} value={one.scope}>
              {t(`intelMore.translate.${one.scope}`)}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor={ids.to}>{t('intelMore.translate.to')} </label>
        <select id={ids.to} value={to} onChange={(event) => setTo(event.target.value)}>
          {LANGUAGES.map((language) => (
            <option key={language.code} value={language.code} lang={language.code}>
              {language.name}
            </option>
          ))}
        </select>
      </p>
      {pack === null && <p role="status">{t('intelMore.translate.noPack')}</p>}
      {pack !== null && !ready && (
        <div>
          <p>{t('intelMore.translate.pack', { name: pack.name, size: sizeLabel(pack.size) })}</p>
          {downloading === null ? (
            <Button
              variant="secondary"
              onClick={() => void download(engine, pack)}
              aria-label={t('intelMore.translate.download', { name: pack.name, size: sizeLabel(pack.size) })}
            >
              {t('intelMore.translate.download', { name: pack.name, size: sizeLabel(pack.size) })}
            </Button>
          ) : (
            <ProgressBar
              label={t('intelMore.translate.downloading', { name: pack.name })}
              value={Math.round(downloading * 100)}
            />
          )}
        </div>
      )}
      {ready && pack && <p role="status">{t('intelMore.translate.ready', { name: pack.name })}</p>}
      {working !== null && <ProgressBar label={t('intelMore.translate.working')} value={Math.round(working * 100)} />}
      <p>
        <Button variant="primary" disabled={!ready || working !== null || !source} onClick={() => void run()}>
          {t('intelMore.translate.go')}
        </Button>
      </p>
    </div>
  );
}

/** Opens the dialog. It removes itself when closed, and gives the translation to `onDone`, or null if there was none. */
export function openTranslate(sources: readonly Source[], onDone: (result: Translation | null) => void): void {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let closed = false;
  const close = (result: Translation | null) => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      root.unmount();
      host.remove();
      onDone(result);
    });
  };
  root.render(
    <Dialog
      title={t('intelMore.translate.title')}
      actions={[
        { id: 'cancel', label: t('intelMore.translate.cancel'), variant: 'secondary', onPress: () => close(null) },
      ]}
      initialFocus="first"
      onDismiss={() => close(null)}
    >
      <Body sources={sources} onDone={close} />
    </Dialog>,
  );
}

export { nameOf };
