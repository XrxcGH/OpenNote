// The video on the page: a native video element playing the file from the page's own asset address. Nothing is
// loaded from the network, so it works offline. The player keys work while the video has focus, and captions from a
// .vtt file show as a text track the viewer can turn on and off.
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { BlockJson, OpenPage } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, Button } from '../../../ui';
import styles from '../media/embed.module.css';
import { applyKey, keyAction } from './keys';
import { videoDataOf } from './model';

export function VideoBlockView(props: {
  block: BlockJson;
  page: OpenPage;
  onCaptions?(block: string, remove: boolean): void;
}) {
  const { block, page } = props;
  const data = useMemo(() => videoDataOf(block), [block]);
  const [broken, setBroken] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  if (!data) {
    return (
      <div className={styles.card}>
        <p className={styles.note}>{t('video.block.unavailable')}</p>
      </div>
    );
  }
  const onKeyDown = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !video.current) return;
    const action = keyAction(event.key, event.shiftKey);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const said = applyKey(video.current, action);
    if (action.do === 'captions' && said) {
      announce(t(said === 'showing' ? 'video.block.captionsOn' : 'video.block.captionsOff'));
    } else if (action.do === 'volume') {
      announce(t('video.block.volume', { percent: said }));
    }
  };
  // Chromium's own controls toggle play on the key's release, which would undo the toggle done on its press.
  const onKeyUp = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault();
  };
  return (
    <div className={styles.card} role="group" aria-label={t('video.block.label', { name: data.name })}>
      <div className={styles.head}>
        <h3 className={styles.title}>{data.name}</h3>
      </div>
      <div className={styles.stage}>
        {broken ? (
          <p className={styles.note}>{t('video.block.unreadable', { name: data.name })}</p>
        ) : (
          <video
            ref={video}
            className={styles.frame}
            src={page.assetUrl(data.asset)}
            controls
            preload="metadata"
            playsInline
            crossOrigin="anonymous"
            aria-label={`${t('video.block.player', { name: data.name })} ${t('video.block.playerKeys')}`}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onError={() => setBroken(true)}
          >
            {data.captions && (
              <track
                kind="captions"
                label={t('video.block.captionsLabel')}
                src={page.assetUrl(data.captions)}
                default
              />
            )}
          </video>
        )}
      </div>
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => props.onCaptions?.(block.id, false)}>
          {t(data.captions ? 'video.block.replaceCaptions' : 'video.block.addCaptions')}
        </Button>
        {data.captions && (
          <Button variant="quiet" onClick={() => props.onCaptions?.(block.id, true)}>
            {t('video.block.removeCaptions')}
          </Button>
        )}
      </div>
      <p className={styles.note}>{t('video.block.hint')}</p>
    </div>
  );
}
