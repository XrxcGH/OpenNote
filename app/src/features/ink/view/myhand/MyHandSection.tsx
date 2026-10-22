// Settings, My handwriting (flag ink.myHandwriting): where a style begins (only with the calibration page), its
// preview and measures, Recalibrate and Delete, the Math and science pen section, and uploads, which stay locked
// with a calm explanation until the calibration page is done.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { announce, Button, confirm, Switch } from '../../../../ui';
import { MATH_SYMBOLS } from '../../myhand/charset';
import { completion, isComplete } from '../../myhand/metrics';
import { showCalibration, StyleFacts, StylePreview } from './Calibration';
import { showMathPen } from './MathPen';
import { deleteStyle, loadStyle, recalibrate, removeKept, styleState } from './store';
import { showUploads } from './Uploads';
import styles from './myhand.module.css';

function Uploads() {
  const ready = useStore(styleState, (s) => s.doc.style !== null);
  const kept = useStore(styleState, (s) => s.doc.kept);
  const [keep, setKeep] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-labelledby="myhand-uploads">
      <h3 id="myhand-uploads">{t('myHand.uploads.title')}</h3>
      <p className={styles.lead}>{t('myHand.uploads.intro')}</p>
      {!ready ? (
        <p className={styles.locked} data-myhand-locked="">
          {t('myHand.uploads.locked')}
        </p>
      ) : (
        <>
          <Switch label={t('myHand.uploads.keep')} checked={keep} onChange={setKeep} />
          <p className={styles.missing}>{t('myHand.uploads.keepHint')}</p>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/bmp,image/gif"
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = '';
              void showUploads(files, keep);
            }}
          />
          <div className={styles.actions}>
            <Button onClick={() => input.current?.click()}>{t('myHand.uploads.choose')}</Button>
          </div>
          {kept.length > 0 && (
            <>
              <h4>{t('myHand.uploads.kept')}</h4>
              <ul>
                {kept.map((file, i) => (
                  <li key={`${file.name}:${file.at}`}>
                    {file.name}{' '}
                    <Button variant="quiet" onClick={() => void removeKept(i)}>
                      {t('myHand.uploads.removeKept', { name: file.name })}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default function MyHandSection() {
  const state = useStore(styleState, (s) => s);
  useEffect(() => void loadStyle(), []);
  const style = state.doc.style;
  const percent = Math.round(completion(state.doc.progress) * 100);
  const complete = isComplete(state.doc.progress);
  const started = Object.keys(state.doc.progress.samples).some((id) => !id.startsWith('math:'));
  const missingMath = style ? MATH_SYMBOLS.filter((c) => !style.glyphs[c]) : [];
  const status =
    state.status === 'loading' || state.status === 'idle'
      ? t('myHand.status.loading')
      : state.status === 'unreadable'
        ? t('myHand.status.unreadable')
        : state.status === 'unavailable'
          ? t('myHand.status.unavailable')
          : style
            ? t('myHand.status.ready')
            : started && !complete
              ? t('myHand.status.partial', { percent })
              : t('myHand.status.none');
  const remove = async () => {
    const yes = await confirm({
      title: t('myHand.removeTitle'),
      body: t('myHand.removeBody'),
      confirmLabel: t('myHand.remove'),
      danger: true,
    });
    if (!yes) return;
    announce((await deleteStyle()) ? t('myHand.removed') : t('myHand.removeFailed'));
  };
  return (
    <section aria-labelledby="myhand-settings" className={styles.page} data-myhand-section="">
      <h2 id="myhand-settings">{t('myHand.section')}</h2>
      <p className={styles.lead}>{t('myHand.intro')}</p>
      <p className={styles.lead}>{t('myHand.privacy')}</p>
      <p className={styles.lead}>{t('myHand.noSignature')}</p>
      <p role="status">{status}</p>
      {state.saveFailed && <p className={styles.locked}>{t('myHand.status.saveFailed')}</p>}
      {style && (
        <>
          <StylePreview style={style} label={t('myHand.preview')} />
          <StyleFacts style={style} />
        </>
      )}
      <div className={styles.actions}>
        {(!style || (started && !complete)) && (
          <Button variant={style ? 'secondary' : 'primary'} onClick={() => void showCalibration()}>
            {started ? t('myHand.resume') : t('myHand.start')}
          </Button>
        )}
        {style && (
          <Button
            onClick={async () => {
              await recalibrate();
              void showCalibration();
            }}
          >
            {t('myHand.recalibrate')}
          </Button>
        )}
        {style && <Button onClick={() => void showMathPen()}>{t('myHand.math.open')}</Button>}
        {(style || started || state.doc.kept.length > 0) && (
          <Button variant="danger" onClick={() => void remove()}>
            {t('myHand.remove')}
          </Button>
        )}
      </div>
      {style && missingMath.length > 0 && (
        <section aria-labelledby="myhand-missing">
          <h3 id="myhand-missing">{t('myHand.missingTitle')}</h3>
          <p className={styles.missing}>{t('myHand.missing', { chars: missingMath.join(' ') })}</p>
          <Button variant="quiet" onClick={() => void showMathPen(missingMath)}>
            {t('myHand.addMissing')}
          </Button>
        </section>
      )}
      <Uploads />
    </section>
  );
}
