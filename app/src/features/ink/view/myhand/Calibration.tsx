// The calibration page (flag ink.myHandwriting): the only way a handwriting style begins. It asks for every character
// on its own, three times each, then sentences that use every letter and the punctuation, on calm ruled boxes, one
// step at a time. Every box saves as it is written, so the person can stop and come back; a preview shows the style
// before it is made.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { announce, Button, Dialog, ProgressBar } from '../../../../ui';
import {
  CHAR_GROUPS,
  SAMPLES_PER_CHAR,
  SENTENCES,
  charSampleId,
  requiredSamples,
  sentenceSampleId,
} from '../../myhand/charset';
import { buildStyle, completion, isComplete } from '../../myhand/metrics';
import type { HandStyle } from '../../myhand/style';
import { mathFigure } from '../../myhand/mathLayout';
import { writeRuns } from '../../myhand/write';
import { InkDrawing, PenBox } from './PenBox';
import { SampleGrid } from './SampleGrid';
import type { GridRow } from './SampleGrid';
import { finishCalibration, setSample, setStep, styleState } from './store';
import styles from './myhand.module.css';

const STEPS = ['intro', ...CHAR_GROUPS.map((g) => g.id), 'sentences', 'preview'] as const;
type StepId = (typeof STEPS)[number];

const SENTENCE_BOX = { width: 760, height: 112, baseline: 78, guide: 22 } as const;

const rowsOf = (chars: readonly string[]): GridRow[] =>
  chars.map((char) => ({ char, ids: Array.from({ length: SAMPLES_PER_CHAR }, (_, n) => charSampleId(char, n)) }));

/** The step a sample is written in. */
function stepOf(id: string): number {
  if (id.startsWith('sentence:')) return STEPS.indexOf('sentences');
  const char = String.fromCodePoint(Number(id.split(':')[1]));
  const group = CHAR_GROUPS.find((g) => (g.chars as readonly string[]).includes(char));
  return group ? STEPS.indexOf(group.id) : 1;
}

/** A sentence and a little math in the given style, as a preview. */
export function StylePreview(props: { style: HandStyle | null; label: string }) {
  const paths = useMemo(() => {
    const place = { left: 0, width: 420, baseline: 30, xHeight: 10, next: (y: number) => y + 34 };
    return writeRuns(
      [
        { kind: 'text', text: `${t('myHand.previewText')}\n` },
        {
          kind: 'figure',
          figure: mathFigure('x^2 + y^2 = r^2, \\quad \\frac{a}{b} \\leq \\sqrt{2}', props.style, 11),
          display: false,
        },
      ],
      props.style,
      place,
      7,
    ).paths;
  }, [props.style]);
  return (
    <div className={styles.preview}>
      <InkDrawing paths={paths} width={1.3} label={props.label} />
    </div>
  );
}

/** The measures of a style, in words. */
export function StyleFacts({ style }: { style: HandStyle }) {
  const m = style.metrics;
  const slant = Math.round(m.slant.mean);
  const pressure = m.pressure.mean < 0.4 ? 'pressureLight' : m.pressure.mean > 0.7 ? 'pressureFirm' : 'pressureMedium';
  const fraction = (v: number) => t('myHand.facts.gapValue', { value: `${Math.round(v * 100)}%` });
  return (
    <dl className={styles.facts}>
      <dt>{t('myHand.facts.size')}</dt>
      <dd>{t('myHand.facts.sizeValue', { size: Math.round(m.xHeight) })}</dd>
      <dt>{t('myHand.facts.slant')}</dt>
      <dd>
        {slant > 1
          ? t('myHand.facts.slantRight', { degrees: slant })
          : slant < -1
            ? t('myHand.facts.slantLeft', { degrees: -slant })
            : t('myHand.facts.slantUpright')}
      </dd>
      <dt>{t('myHand.facts.letterGap')}</dt>
      <dd>{fraction(m.letterGap.mean)}</dd>
      <dt>{t('myHand.facts.wordGap')}</dt>
      <dd>{fraction(m.wordGap.mean)}</dd>
      <dt>{t('myHand.facts.joins')}</dt>
      <dd>{t('myHand.facts.joinsValue', { percent: Math.round(m.joinRate * 100) })}</dd>
      <dt>{t('myHand.facts.pressure')}</dt>
      <dd>{t(`myHand.facts.${pressure}`)}</dd>
    </dl>
  );
}

function Sentences({ step, focusId }: { step: number; focusId: string | null }) {
  const samples = useStore(styleState, (s) => s.doc.progress.samples);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const n = focusId?.startsWith('sentence:') ? Number(focusId.split(':')[1]) : -1;
    if (n >= 0) holder.current?.querySelector<HTMLElement>(`[data-myhand-box="${n}"]`)?.focus();
  }, [focusId]);
  return (
    <div className={styles.rows} ref={holder}>
      <p className={styles.lead}>{t('myHand.calibration.sentenceHint')}</p>
      {SENTENCES.map((text, n) => {
        const id = sentenceSampleId(n);
        return (
          <div className={styles.sentence} key={id}>
            <p lang="en">{text}</p>
            <PenBox
              index={n}
              label={t('myHand.box.sentence', { n: n + 1, text })}
              sample={samples[id] ?? null}
              {...SENTENCE_BOX}
              tabIndex={0}
              onChange={(sample) => void setSample(id, sample, step)}
            />
          </div>
        );
      })}
    </div>
  );
}

function Preview(props: { onFirstEmpty: () => void }) {
  const progress = useStore(styleState, (s) => s.doc.progress);
  const style = useMemo(() => buildStyle(progress, styleState.get().doc.style, 0), [progress]);
  const empty = requiredSamples().filter((id) => !progress.samples[id]).length;
  if (!style) {
    return (
      <div className={styles.page}>
        <p>{t('myHand.calibration.notFinished', { count: empty })}</p>
        <div className={styles.actions}>
          <Button onClick={props.onFirstEmpty}>{t('myHand.calibration.firstEmpty')}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('myHand.calibration.previewHint')}</p>
      <StylePreview style={style} label={t('myHand.preview')} />
      <StyleFacts style={style} />
    </div>
  );
}

function Intro() {
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t('myHand.calibration.introBody')}</p>
      <p className={styles.lead}>{t('myHand.calibration.introCalm')}</p>
      <p className={styles.lead}>{t('myHand.calibration.introRedo')}</p>
      <p className={styles.lead}>{t('myHand.privacy')}</p>
    </div>
  );
}

export function CalibrationDialog({ done }: { done: () => void }) {
  const saved = useStore(styleState, (s) => s.doc.progress.step);
  const progress = useStore(styleState, (s) => s.doc.progress);
  const [step, setLocalStep] = useState(() => Math.min(STEPS.length - 1, Math.max(0, saved)));
  const [focusId, setFocusId] = useState<string | null>(null);
  const id: StepId = STEPS[step];
  const go = (next: number, focus: string | null = null) => {
    setLocalStep(next);
    setFocusId(focus);
    void setStep(next);
    announce(
      t('myHand.calibration.stepOf', {
        step: next + 1,
        count: STEPS.length,
        name: t(`myHand.calibration.steps.${STEPS[next]}`),
      }),
    );
  };
  const percent = Math.round(completion(progress) * 100);
  const complete = isComplete(progress);
  const group = CHAR_GROUPS.find((g) => g.id === id);
  const firstEmpty = () => {
    const missing = requiredSamples().find((sample) => !progress.samples[sample]);
    if (missing) go(stepOf(missing), missing);
  };
  return (
    <Dialog
      title={t('myHand.calibration.title')}
      description={t('myHand.calibration.stepOf', {
        step: step + 1,
        count: STEPS.length,
        name: t(`myHand.calibration.steps.${id}`),
      })}
      size="large"
      onDismiss={() => {
        announce(t('myHand.calibration.paused'));
        done();
      }}
      actions={[
        {
          id: 'pause',
          label: t('myHand.calibration.pause'),
          variant: 'quiet',
          onPress: () => {
            announce(t('myHand.calibration.paused'));
            done();
          },
        },
        {
          id: 'back',
          label: t('myHand.calibration.back'),
          variant: 'secondary',
          disabled: step === 0,
          onPress: () => {
            if (step > 0) go(step - 1);
          },
        },
        id === 'preview'
          ? {
              id: 'finish',
              label: t('myHand.calibration.finish'),
              variant: 'primary',
              disabled: !complete,
              onPress: async () => {
                if (await finishCalibration()) {
                  announce(t('myHand.calibration.finished'));
                  done();
                }
              },
            }
          : { id: 'next', label: t('myHand.calibration.next'), variant: 'primary', onPress: () => go(step + 1) },
      ]}
    >
      <div className={styles.page} data-myhand-calibration={id}>
        <ProgressBar label={t('myHand.calibration.progress', { percent })} value={percent} />
        <ol className={styles.steps} aria-label={t('myHand.calibration.title')}>
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined}>
              {t(`myHand.calibration.steps.${s}`)}
            </li>
          ))}
        </ol>
        {id === 'intro' && <Intro />}
        {group && (
          <>
            <p className={styles.lead}>{t('myHand.calibration.groupHint')}</p>
            <SampleGrid key={group.id} rows={rowsOf(group.chars)} step={step} focusId={focusId} />
          </>
        )}
        {id === 'sentences' && <Sentences step={step} focusId={focusId} />}
        {id === 'preview' && <Preview onFirstEmpty={firstEmpty} />}
      </div>
    </Dialog>
  );
}

let open = false;

/** Opens the calibration page. Resolves when it closes. */
export function showCalibration(): Promise<void> {
  if (open) return Promise.resolve();
  open = true;
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = () => {
      open = false;
      resolve();
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<CalibrationDialog done={done} />);
  });
}
