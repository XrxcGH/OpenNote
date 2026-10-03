// Eraser and lasso filters in the Draw tab: which ink the eraser takes, whether it hands back the last tool, and what
// the lasso picks up and in what shape. Each is a menu, so a keyboard reaches every choice, and each choice is saved
// in Settings, where the Pen and touch section shows the same ones.
import { useFlag } from '../../../app/flags';
import type { LassoPick } from '../../../platform/bindings/LassoPick';
import type { CommandBarComponentProps } from '../../../registries/types';
import { updateSettings, useSettings } from '../../../state/settings';
import type { Settings } from '../../../platform/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce, openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import styles from './view.module.css';

type Erases = 'all' | 'highlighter' | 'pens' | 'pen' | 'pencil';

export const ERASER_CHOICES: readonly [Erases, MessageKey][] = [
  ['all', 'ink.options.eraserAll'],
  ['highlighter', 'ink.options.eraserHighlighter'],
  ['pens', 'ink.options.eraserPens'],
  ['pen', 'ink.options.eraserPen'],
  ['pencil', 'ink.options.eraserPencil'],
];

export const LASSO_PICKS: readonly [LassoPick, MessageKey][] = [
  ['ink', 'ink.options.pickInk'],
  ['highlighter', 'ink.options.pickHighlighter'],
  ['text', 'ink.options.pickText'],
  ['images', 'ink.options.pickImages'],
  ['shapes', 'ink.options.pickShapes'],
];

/** What a lasso with no picks chosen takes: everything. */
const EVERYTHING: readonly LassoPick[] = ['ink', 'highlighter', 'text', 'images', 'shapes'];

export function togglePick(picks: readonly LassoPick[], pick: LassoPick): LassoPick[] {
  const current = picks.length === 0 ? EVERYTHING : picks;
  const next = current.includes(pick) ? current.filter((p) => p !== pick) : [...current, pick];
  // Taking every pick away would leave a lasso that selects nothing, so it goes back to everything.
  return next.length === 0 || next.length === EVERYTHING.length ? [] : EVERYTHING.filter((p) => next.includes(p));
}

type InkSettings = Settings['ink'];

/** The eraser menu: which ink it takes, and whether it hands the pen back. */
function eraserItems(ink: InkSettings): MenuItemSpec[] {
  const choices = ERASER_CHOICES.map(([id, label]): MenuItemSpec => {
    const choose = () => {
      void updateSettings({ ink: { eraser: { erases: id } } });
      announce(t(label));
    };
    return { id, label: t(label), kind: 'radio', checked: ink.eraser.erases === id, onSelect: choose };
  });
  const toggle = () => void updateSettings({ ink: { eraser: { returnToLastTool: !ink.eraser.returnToLastTool } } });
  return [
    ...choices,
    {
      id: 'returnToLastTool',
      label: t('ink.options.returnToLast'),
      kind: 'checkbox',
      checked: ink.eraser.returnToLastTool,
      separatorBefore: true,
      onSelect: toggle,
    },
  ];
}

/** The lasso menu: its shape, then what it picks up. */
function lassoItems(ink: InkSettings): MenuItemSpec[] {
  const picks = ink.lasso.picks.length === 0 ? EVERYTHING : ink.lasso.picks;
  const shapes = (['free', 'rectangle'] as const).map((shape): MenuItemSpec => ({
    id: shape,
    label: t(shape === 'free' ? 'ink.options.lassoFree' : 'ink.options.lassoRectangle'),
    kind: 'radio',
    checked: ink.lasso.shape === shape,
    onSelect: () => void updateSettings({ ink: { lasso: { shape } } }),
  }));
  const kinds = LASSO_PICKS.map(([pick, label], index): MenuItemSpec => ({
    id: pick,
    label: t(label),
    kind: 'checkbox',
    checked: picks.includes(pick),
    separatorBefore: index === 0,
    onSelect: () => void updateSettings({ ink: { lasso: { picks: togglePick(ink.lasso.picks, pick) } } }),
  }));
  return [...shapes, ...kinds];
}

function MenuButton(props: CommandBarComponentProps & { label: string; data: string; items: () => MenuItemSpec[] }) {
  const { toolProps, label, data, items } = props;
  const open = (anchor: HTMLElement) => void openMenu({ label, anchor, returnFocus: anchor, items: items() });
  return (
    <button
      type="button"
      {...toolProps}
      className={styles.tool}
      aria-haspopup="menu"
      data-ink-options={data}
      onClick={(event) => open(event.currentTarget)}
    >
      {label}
    </button>
  );
}

export function DrawOptions({ toolProps }: CommandBarComponentProps) {
  const erasers = useFlag('ink.erasers');
  const lasso = useFlag('ink.lasso');
  const ink = useSettings((settings) => settings.ink);
  if (!erasers && !lasso) return null;
  return (
    <div className={styles.group} role="group" aria-label={t('ink.options.group')}>
      {erasers && (
        <MenuButton
          toolProps={toolProps}
          label={t('ink.options.eraserType')}
          data="eraser"
          items={() => eraserItems(ink)}
        />
      )}
      {lasso && (
        <MenuButton toolProps={toolProps} label={t('ink.options.lasso')} data="lasso" items={() => lassoItems(ink)} />
      )}
    </div>
  );
}
