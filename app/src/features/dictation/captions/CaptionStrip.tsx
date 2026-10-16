// The live caption strip (A2-25, A4-48): the last few phrases and the one being said, over the page, in the size,
// font, and colors the person set for captions in Windows. It is a quiet region for assistive technology, because the
// recording's own words are the thing being heard, and it says so when this computer cannot keep up.
import { useEffect, useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import styles from './captions.module.css';
import { isLate, shown } from './model';
import { invokeCaptionStyle } from './platform';
import { captionChoices, captionWords, captionsOpen } from './store';
import { captionCss } from './style';
import type { CaptionStyle } from './style';

export function CaptionStrip() {
  const open = useStore(captionsOpen, (value) => value);
  const words = useStore(captionWords, (value) => value);
  const position = useStore(captionChoices, (value) => value.position);
  const [style, setStyle] = useState<CaptionStyle | null>(null);
  useEffect(() => {
    let alive = true;
    void invokeCaptionStyle().then((found) => alive && setStyle(found));
    return () => {
      alive = false;
    };
  }, [open]);
  if (!open) return null;
  const { text, box } = captionCss(style);
  const lines = shown(words);
  return (
    <div className={`${styles.strip} ${position === 'top' ? styles.top : styles.bottom}`}>
      <div className={styles.box} style={box} role="region" aria-label={t('intelMore.captions.region')} aria-live="off">
        {lines.length === 0 ? (
          <p className={styles.line} style={text}>
            {t('intelMore.captions.waiting')}
          </p>
        ) : (
          lines.map((line, index) => (
            <p
              key={`${index}-${line.slice(0, 12)}`}
              className={`${styles.line} ${index === lines.length - 1 && words.partial ? styles.partial : ''}`}
              style={text}
            >
              {line}
            </p>
          ))
        )}
        {isLate(words) && (
          <p className={styles.late} role="status">
            {t('intelMore.captions.behind')}
          </p>
        )}
      </div>
    </div>
  );
}
