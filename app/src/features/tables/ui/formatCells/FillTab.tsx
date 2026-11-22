// checks-disable-file brand-consistency: the starting colors of a new fill are document data, not interface styling
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import type { Fill } from '../../sheet/model';
import { PATTERNS } from '../../sheet/model/enums';
import { ColorField, NumberInput, Select } from './controls';
import type { TabProps } from './controls';
import { FILL_KINDS, fillKind, gradientOf, withFill } from './draft';
import type { FillKind } from './draft';
import styles from './formatCells.module.css';

type Pattern = Extract<Fill, { pattern: string }>;
type Look = Pick<TabProps, 'style' | 'set' | 'scheme' | 'notebookId'>;

const KIND_KEYS: Record<FillKind, MessageKey> = {
  none: 'sheetFormat.fill.none',
  solid: 'sheetFormat.fill.solid',
  pattern: 'sheetFormat.fill.pattern',
  gradient: 'sheetFormat.fill.gradient',
};

/** The pattern, its color, and its background color. */
function PatternFill({ pattern, style, set, scheme, notebookId }: Look & { pattern: Pattern }) {
  const write = (next: Pattern) => set(withFill(style, next));
  return (
    <>
      <Select
        label={t('sheetFormat.fill.patternStyle')}
        value={pattern.pattern as (typeof PATTERNS)[number]}
        values={PATTERNS}
        name={(v) => t(`sheetFormat.pattern.${v}`)}
        onChange={(v) => write({ ...pattern, pattern: v })}
      />
      <ColorField
        label={t('sheetFormat.fill.patternColor')}
        value={pattern.color}
        scheme={scheme}
        notebookId={notebookId}
        onPick={(color) => write({ ...pattern, color })}
      />
      <ColorField
        label={t('sheetFormat.fill.patternBack')}
        value={pattern.back}
        fill
        scheme={scheme}
        notebookId={notebookId}
        onPick={(back) => write({ ...pattern, back })}
      />
    </>
  );
}

interface GradientProps extends Look {
  stops: readonly string[];
  angle: number;
}

/** Two or three colors and the angle. */
function GradientFill({ stops, angle, style, set, scheme, notebookId }: GradientProps) {
  const write = (colors: readonly string[], to = angle) => set(withFill(style, gradientOf(colors, to)));
  return (
    <>
      <Select
        label={t('sheetFormat.fill.stops')}
        value={stops.length === 3 ? 'three' : 'two'}
        values={['two', 'three'] as const}
        name={(v) => t(v === 'two' ? 'sheetFormat.fill.twoStops' : 'sheetFormat.fill.threeStops')}
        onChange={(v) => write(v === 'three' ? [stops[0], stops[1] ?? '#cccccc', '#888888'] : stops.slice(0, 2))}
      />
      {stops.map((color, i) => (
        <ColorField
          key={i}
          label={t('sheetFormat.fill.stop', { number: i + 1 })}
          value={color}
          fill
          scheme={scheme}
          notebookId={notebookId}
          onPick={(value) => write(stops.map((c, j) => (j === i ? (value ?? c) : c)))}
        />
      ))}
      <NumberInput
        label={t('sheetFormat.fill.angle')}
        value={angle}
        min={0}
        max={359}
        onChange={(n) => write(stops, n ?? 0)}
      />
    </>
  );
}

export function FillTab({ style, set, scheme, notebookId }: TabProps) {
  const fill: Fill | undefined = style.fill;
  const kind = fillKind(fill);
  const solid = typeof fill === 'string' && fill !== 'none' ? fill : undefined;
  const pattern = typeof fill === 'object' && 'pattern' in fill ? fill : undefined;
  const gradient = typeof fill === 'object' && 'gradient' in fill ? fill.gradient : undefined;
  const stops = gradient?.stops.map((s) => s.color) ?? ['#ffffff', '#cccccc'];
  const angle = gradient?.angle ?? 0;
  const choose = (next: FillKind) => {
    if (next === 'none') return set(withFill(style, 'none'));
    if (next === 'solid') return set(withFill(style, solid ?? '#fde68a'));
    if (next === 'pattern') return set(withFill(style, pattern ?? { pattern: 'lightGray', color: '#000000' }));
    set(withFill(style, gradientOf(stops, angle)));
  };
  const look = { style, set, scheme, notebookId };
  return (
    <div className={styles.grid}>
      <Select
        label={t('sheetFormat.fill.kind')}
        value={kind}
        values={FILL_KINDS}
        name={(v) => t(KIND_KEYS[v])}
        onChange={choose}
      />
      {kind === 'solid' ? (
        <ColorField
          label={t('sheetFormat.fill.color')}
          value={solid}
          fill
          scheme={scheme}
          notebookId={notebookId}
          onPick={(value) => set(withFill(style, value ?? 'none'))}
        />
      ) : null}
      {kind === 'pattern' && pattern ? <PatternFill pattern={pattern} {...look} /> : null}
      {kind === 'gradient' ? <GradientFill stops={stops} angle={angle} {...look} /> : null}
    </div>
  );
}
