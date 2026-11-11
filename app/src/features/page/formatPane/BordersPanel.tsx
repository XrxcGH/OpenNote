// The Borders and shading tab of the Format pane (text DESIGN.md 5.3): the paragraph's border sides, presets, and shading.
import { useState } from 'react';
import type { Border, BorderSide, BorderSideName } from '../../../editor/paragraph/attributes';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import {
  BORDER_SIDES,
  BORDER_STYLES,
  DEFAULT_SIDE,
  applyBorderPreset,
  borderAt,
  setBorderSide,
  setShade,
  shadeAt,
} from './blocks';
import type { BorderPreset } from './blocks';
import { Box, Choice, Group } from './controls';
import { ColorField } from './ColorPicker';
import { lengthParse } from './fields';
import type { Parsed } from './fields';
import { optionLabel } from './labels';
import { run } from './TabsPanel';
import type { PanelProps } from './TabsPanel';
import { formatPoints } from './units';
import styles from './FormatPane.module.css';

const SHADE_PATTERNS = [
  'clear',
  'solid',
  'horzStripe',
  'vertStripe',
  'diagStripe',
  'horzCross',
  'diagCross',
  'pct10',
  'pct25',
  'pct50',
  'pct75',
];

/** The number a box parsed to, or the message that says why it is not one. */
function numberOf(result: Parsed, example: string): number | string {
  if (!result.ok) return result.message;
  return typeof result.value === 'number' ? result.value : t('textPane.invalid', { example });
}

/** The width and distance typed, as a side of the border, or the message for each box that is wrong. */
function sideFrom(
  style: string,
  width: string,
  space: string,
  color: string,
): { side: BorderSide } | { errors: Record<string, string> } {
  const w = numberOf(lengthParse(0.25, 6, 0.125)(width), '0.5');
  const s = numberOf(lengthParse(0, 31, 1)(space), '1');
  const errors: Record<string, string> = {};
  if (typeof w === 'string') errors['width'] = w;
  if (typeof s === 'string') errors['space'] = s;
  if (typeof w === 'string' || typeof s === 'string') return { errors };
  return { side: { style, width: w, space: s, color: color || null } };
}

function SideSummary({ border }: { border: Border }) {
  return (
    <ul className={styles.list}>
      {BORDER_SIDES.map((name) => {
        const have = border[name];
        const side = optionLabel('borderSide', name);
        const style = have ? optionLabel('borderStyle', have.style) : '';
        return (
          <li key={name} className={styles.detail}>
            {have
              ? t('textPane.borders.sideState', { side, style, width: formatPoints(have.width) })
              : t('textPane.borders.sideNone', { side })}
          </li>
        );
      })}
    </ul>
  );
}

function BorderGroup({ editor, refresh, notebook }: PanelProps) {
  const [side, setSide] = useState<BorderSideName>('top');
  const [style, setStyle] = useState<string>(DEFAULT_SIDE.style);
  const [width, setWidth] = useState(formatPoints(DEFAULT_SIDE.width));
  const [space, setSpace] = useState(formatPoints(DEFAULT_SIDE.space));
  const [color, setColor] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Applies a command built from the typed side; the boxes show their messages when a value is wrong. */
  const withSide = (build: (made: BorderSide) => ReturnType<typeof setBorderSide>) => {
    const made = sideFrom(style, width, space, color);
    setErrors('errors' in made ? made.errors : {});
    if ('errors' in made) return;
    run(editor, build(made.side));
    refresh();
  };
  const without = () => {
    run(editor, setBorderSide(side, null));
    refresh();
  };
  const preset = (kind: BorderPreset) => withSide((made) => applyBorderPreset(kind, made));
  return (
    <Group title={t('textPane.group.border')}>
      <Choice
        label={t('textPane.borders.side')}
        field="borderSide"
        options={BORDER_SIDES}
        value={side}
        onCommit={(value) => setSide(value as BorderSideName)}
      />
      <Choice
        label={t('textPane.borders.style')}
        field="borderStyle"
        options={BORDER_STYLES}
        value={style}
        onCommit={setStyle}
      />
      <Box
        label={t('textPane.borders.width')}
        value={width}
        unit={t('textPane.unitPoints')}
        step={0.25}
        error={errors['width']}
        onCommit={setWidth}
      />
      <Box
        label={t('textPane.borders.space')}
        value={space}
        unit={t('textPane.unitPoints')}
        step={1}
        error={errors['space']}
        onCommit={setSpace}
      />
      <ColorField label={t('textPane.borders.color')} value={color} notebookId={notebook} onCommit={setColor} />
      <div className={styles.row}>
        <Button onClick={() => withSide((made) => setBorderSide(side, made))}>{t('textPane.borders.apply')}</Button>
        <Button variant="secondary" onClick={without}>
          {t('textPane.borders.remove')}
        </Button>
      </div>
      <div className={styles.row} role="group" aria-label={t('textPane.borders.presets')}>
        <Button variant="secondary" onClick={() => preset('none')}>
          {t('textPane.borders.presetNone')}
        </Button>
        <Button variant="secondary" onClick={() => preset('box')}>
          {t('textPane.borders.presetBox')}
        </Button>
        <Button variant="secondary" onClick={() => preset('lines')}>
          {t('textPane.borders.presetLines')}
        </Button>
      </div>
      <SideSummary border={borderAt(editor.state)} />
    </Group>
  );
}

function ShadeGroup({ editor, refresh, notebook }: PanelProps) {
  const shade = shadeAt(editor.state);
  const [fill, setFill] = useState(shade?.fill ?? '');
  const [pattern, setPattern] = useState(shade?.pattern ?? 'clear');
  const [patternColor, setPatternColor] = useState(shade?.color ?? '');
  const apply = () => {
    run(editor, setShade({ fill: fill || null, pattern, color: patternColor || null }));
    refresh();
  };
  const remove = () => {
    run(editor, setShade(null));
    setFill('');
    setPattern('clear');
    setPatternColor('');
    refresh();
  };
  return (
    <Group title={t('textPane.group.shading')}>
      <ColorField label={t('textPane.borders.fill')} value={fill} notebookId={notebook} onCommit={setFill} />
      <Choice
        label={t('textPane.borders.pattern')}
        field="pattern"
        options={SHADE_PATTERNS}
        value={pattern}
        onCommit={setPattern}
      />
      <ColorField
        label={t('textPane.borders.patternColor')}
        value={patternColor}
        notebookId={notebook}
        onCommit={setPatternColor}
      />
      <div className={styles.row}>
        <Button onClick={apply}>{t('textPane.borders.applyShade')}</Button>
        <Button variant="secondary" onClick={remove}>
          {t('textPane.borders.removeShade')}
        </Button>
      </div>
    </Group>
  );
}

export function BordersPanel(props: PanelProps) {
  return (
    <div className={styles.panel}>
      <BorderGroup {...props} />
      <ShadeGroup {...props} />
    </div>
  );
}
