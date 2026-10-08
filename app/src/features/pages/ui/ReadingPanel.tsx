// The Reading aids panel: a line focus band, a page tint, spacing, and a shorter line. Each change shows on the page at
// once and is kept on this device. None of it reaches the note or the print.
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { isEnabled } from '../../../app/flags';
import { Dialog, RadioCard, RadioGroup, Switch } from '../../../ui';
import { readingAids, setReadingAids } from '../live/reading';
import { DEFAULT_READING, FOCUS_SIZES, TINTS } from '../reading';
import type { FocusLines, ReadingAids, Step, Tint } from '../reading';
import styles from './pagesUi.module.css';

const STEPS: readonly Step[] = [0, 1, 2, 3];
const STEP_KEYS = ['normal', 'little', 'medium', 'large'] as const;
const FOCUS_KEYS = { 0: 'off', 1: 'one', 3: 'three', 5: 'five' } as const;
const WIDTHS = ['none', 'short', 'medium', 'long'] as const;
const WIDTH_CHARS = { none: null, short: 50, medium: 70, long: 90 } as const;
type Width = (typeof WIDTHS)[number];

const widthOf = (aids: ReadingAids): Width =>
  WIDTHS.find((width) => WIDTH_CHARS[width] === aids.maxLine) ??
  WIDTHS.find((width) => (WIDTH_CHARS[width] ?? 0) >= (aids.maxLine ?? 0)) ??
  'none';

export function ReadingPanel({ close }: { close(): void }) {
  const aids = useStore(readingAids, (value) => value);
  const change = (patch: Partial<ReadingAids>) => setReadingAids({ ...aids, ...patch });
  return (
    <Dialog
      title={t('pageViews.reading.title')}
      description={t('pageViews.reading.description')}
      size="medium"
      onDismiss={close}
      actions={[
        {
          id: 'reset',
          label: t('pageViews.reading.reset'),
          variant: 'secondary',
          onPress: () => setReadingAids(DEFAULT_READING),
        },
        { id: 'done', label: t('pageViews.reading.done'), variant: 'primary', onPress: close },
      ]}
    >
      <div className={styles.form}>
        <RadioGroup<`${FocusLines}`>
          label={t('pageViews.reading.focus')}
          value={`${aids.focus}`}
          onChange={(value) => change({ focus: Number(value) as FocusLines })}
        >
          {FOCUS_SIZES.map((size) => (
            <RadioCard key={size} value={`${size}`} label={t(`pageViews.reading.focusSizes.${FOCUS_KEYS[size]}`)} />
          ))}
        </RadioGroup>
        <RadioGroup<Tint>
          label={t('pageViews.reading.tint')}
          value={aids.tint}
          onChange={(value) => change({ tint: value })}
        >
          {TINTS.map((tint) => (
            <RadioCard key={tint} value={tint} label={t(`pageViews.reading.tints.${tint}`)} />
          ))}
        </RadioGroup>
        <RadioGroup<`${Step}`>
          label={t('pageViews.reading.wordSpace')}
          value={`${aids.wordSpace}`}
          onChange={(value) => change({ wordSpace: Number(value) as Step })}
        >
          {STEPS.map((step) => (
            <RadioCard key={step} value={`${step}`} label={t(`pageViews.reading.steps.${STEP_KEYS[step]}`)} />
          ))}
        </RadioGroup>
        <RadioGroup<`${Step}`>
          label={t('pageViews.reading.paragraphSpace')}
          value={`${aids.paragraphSpace}`}
          onChange={(value) => change({ paragraphSpace: Number(value) as Step })}
        >
          {STEPS.map((step) => (
            <RadioCard key={step} value={`${step}`} label={t(`pageViews.reading.steps.${STEP_KEYS[step]}`)} />
          ))}
        </RadioGroup>
        <RadioGroup<Width>
          label={t('pageViews.reading.lineWidth')}
          value={widthOf(aids)}
          onChange={(value) => change({ maxLine: WIDTH_CHARS[value] })}
        >
          {WIDTHS.map((width) => (
            <RadioCard key={width} value={width} label={t(`pageViews.reading.lineWidths.${width}`)} />
          ))}
        </RadioGroup>
        {isEnabled('pages.syllables') ? (
          <>
            <Switch
              label={t('pagesPlus.reading.syllables')}
              checked={aids.syllables}
              onChange={(checked) => change({ syllables: checked })}
            />
            <p className={styles.hint}>{t('pagesPlus.reading.syllablesHelp')}</p>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
