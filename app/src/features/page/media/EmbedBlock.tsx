// The embed on the page: a card with the title and the saved picture. Nothing from the site loads until the person
// presses Play (or Show the live view), so a page full of videos opens fast, offline, and without telling any site that
// the page was read. A player that can report its playhead (YouTube, Vimeo) lets notes typed while it plays be
// time-stamped, and the transcript, when there is one, seeks it.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFlag } from '../../../app/flags';
import { commandContext } from '../../../commands/registry';
import type { BlockJson, OpenPage } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { useOffline } from '../../diagnostics';
import { clockText } from './captions';
import styles from './embed.module.css';
import { embedDataOf } from './model';
import { controlPlayer } from './player';
import type { PlayerControl } from './player';
import { playhead, registerSeeker } from './playhead';
import { PROVIDER_NAME } from './recognize';

/** The origin a provider's frame talks from. */
const ORIGIN: Record<string, string> = {
  youtube: 'https://www.youtube-nocookie.com',
  vimeo: 'https://player.vimeo.com',
};

/** The frame's address, with the page's own origin added for the player APIs that ask for it. */
function frameSource(embedUrl: string, provider: string, startSec: number | undefined): string {
  const url = new URL(embedUrl);
  if (provider === 'youtube' && typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
    url.searchParams.set('origin', window.location.origin);
  }
  if (provider === 'vimeo' && startSec) url.hash = `t=${startSec}s`;
  return url.toString();
}

function openLink(url: string): void {
  void commandContext('palette').platform.shell.openExternal({ kind: 'link', url });
}

export function EmbedBlockView(props: { block: BlockJson; page: OpenPage; open?(url: string): void }) {
  const { block, page } = props;
  const data = useMemo(() => embedDataOf(block), [block]);
  const offline = useOffline();
  const liveOn = useFlag('page.liveEmbeds');
  const [wantLoaded, setLoaded] = useState(false);
  // Going offline puts the picture back; the frame would only show an error.
  const loaded = wantLoaded && !offline;
  const [showTranscript, setShowTranscript] = useState(false);
  const [now, setNow] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const control = useRef<PlayerControl | null>(null);
  const titleId = useId();
  const playheadOn = data?.playhead === true;
  const provider = data?.provider;

  // The frame is followed while it is loaded; the page's notes then take their stamps from it.
  useEffect(() => {
    const element = frame.current;
    if (!loaded || !element || !playheadOn || (provider !== 'youtube' && provider !== 'vimeo')) return;
    void import('../audio/watch').then((module) => module.activate());
    const follower = controlPlayer(element, provider, ORIGIN[provider] ?? '', (state) => {
      setNow(state.ms);
      playhead.set({ block: block.id, page: page.id, ms: state.ms, playing: state.playing });
    });
    control.current = follower;
    const forget = registerSeeker(block.id, follower.seek);
    return () => {
      forget();
      follower.dispose();
      control.current = null;
      if (playhead.get()?.block === block.id) playhead.set(null);
    };
  }, [loaded, playheadOn, provider, block.id, page.id]);

  if (!data || (data.kind === 'live' && !liveOn)) {
    return (
      <div className={styles.card}>
        <p className={styles.note}>{t('accounts.media.block.unavailable')}</p>
      </div>
    );
  }
  const providerName = PROVIDER_NAME[data.provider];
  const live = data.kind === 'live';
  const podcast = data.provider === 'applePodcasts' || data.provider === 'spotify';
  const picture = data.thumb ? page.assetUrl(data.thumb) : null;
  const stageClass = [styles.stage, live ? styles.stageTall : '', podcast ? styles.stagePodcast : ''].join(' ');
  const sandbox = live
    ? 'allow-scripts allow-same-origin allow-presentation allow-forms allow-popups'
    : 'allow-scripts allow-same-origin allow-presentation';

  return (
    <div className={styles.card} role="group" aria-labelledby={titleId}>
      <div className={styles.head}>
        <span className={styles.provider}>{providerName}</span>
        <h3 id={titleId} className={styles.title}>
          {data.title}
        </h3>
      </div>
      <div className={stageClass}>
        {loaded && !offline ? (
          <iframe
            ref={frame}
            className={styles.frame}
            src={frameSource(data.embedUrl, data.provider, data.startSec)}
            title={t('accounts.media.block.frameTitle', { title: data.title, provider: providerName })}
            sandbox={sandbox}
            allow="fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        ) : (
          <>
            {picture ? (
              <img
                className={styles.picture}
                src={picture}
                alt={t('accounts.media.block.savedPicture', { title: data.title })}
              />
            ) : (
              <div className={styles.placeholder} aria-hidden="true">
                {providerName}
              </div>
            )}
            {!offline && (
              <div className={styles.overlay}>
                <Button
                  variant="primary"
                  aria-label={t(live ? 'accounts.media.block.loadLiveNamed' : 'accounts.media.block.playNamed', {
                    title: data.title,
                  })}
                  onClick={() => setLoaded(true)}
                >
                  {t(live ? 'accounts.media.block.loadLive' : 'accounts.media.block.play')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          aria-label={t('accounts.media.block.openNamed', { title: data.title })}
          disabled={offline}
          onClick={() => (props.open ?? openLink)(data.url)}
        >
          {t('accounts.media.block.open')}
        </Button>
        {data.transcript && (
          <Button variant="quiet" onClick={() => setShowTranscript((on) => !on)} aria-expanded={showTranscript}>
            {t(showTranscript ? 'accounts.media.transcript.hide' : 'accounts.media.transcript.show')}
          </Button>
        )}
      </div>
      {offline && <p className={styles.note}>{t('accounts.media.block.offlineNote')}</p>}
      {!live && !offline && loaded && (
        <p className={styles.note}>
          {t(data.playhead ? 'accounts.media.block.stampNote' : 'accounts.media.block.noStampNote')}
        </p>
      )}
      {data.transcript && showTranscript && (
        <>
          <p className={styles.note}>
            {t('accounts.media.transcript.summary', { count: data.transcript.lines.length })}
            {data.transcript.language
              ? `. ${t('accounts.media.transcript.language', { language: data.transcript.language })}`
              : ''}
          </p>
          <ul className={styles.transcript}>
            {data.transcript.lines.map((line, at) => {
              const next = data.transcript?.lines[at + 1]?.startMs ?? Number.POSITIVE_INFINITY;
              const current = loaded && now >= line.startMs && now < next;
              return (
                <li key={`${line.startMs}-${at}`}>
                  <button
                    type="button"
                    className={styles.line}
                    aria-current={current}
                    aria-label={t('accounts.media.transcript.lineAt', {
                      time: clockText(line.startMs),
                      text: line.text,
                    })}
                    onClick={() => {
                      if (!loaded) setLoaded(true);
                      control.current?.seek(line.startMs);
                    }}
                  >
                    <span className={styles.time}>{clockText(line.startMs)}</span>
                    <span>{line.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
