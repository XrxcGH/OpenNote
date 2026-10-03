// Eraser and lasso filters in the Draw tab: which ink the eraser takes, whether it hands back the last tool, and what
// the lasso picks up and in what shape. Each is a menu, so a keyboard reaches every choice, and each choice is saved
// in Settings, where the Pen and touch section shows the same ones.
import { useFlag } from '../../../app/flags';
import type { LassoPick } from '../../../platform/bindings/LassoPick';
import type { CommandBarComponentProps } from '../../../registries/types';
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce, openMenu } from '../../../ui';
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

export function DrawOptions({ toolProps }: CommandBarComponentProps) {
  const erasers = useFlag('ink.erasers');
  const lasso = useFlag('ink.lasso');
  const ink = useSettings((settings) => settings.ink);

  const eraserMenu = async (anchor: HTMLElement) => {
    await openMenu({
      label: t('ink.options.eraserType'),
      anchor,
      returnFocus: anchor,
      items: [
        ...ERASER_CHOICES.map(([id, label]) => ({
          id,
          label: t(label),
          kind: 'radio' as const,
          checked: ink.eraser.erases === id,
          onSelect: () => {
            void updateSettings({ ink: { eraser: { erases: id } } });
            announce(t(label));
          },
        })),
        {
          id: 'returnToLastTool',
          label: t('ink.options.returnToLast'),
          kind: 'checkbox' as const,
          checked: ink.eraser.returnToLastTool,
          separatorBefore: true,
          onSelect: () => void updateSettings({ ink: { eraser: { returnToLastTool: !ink.eraser.returnToLastTool } } }),
        },
      ],
    });
  };

  const lassoMenu = async (anchor: HTMLElement) => {
    const picks = ink.lasso.picks.length === 0 ? EVERYTHING : ink.lasso.picks;
    await openMenu({
      label: t('ink.options.lasso'),
      anchor,
      returnFocus: anchor,
      items: [
        ...(['free', 'rectangle'] as const).map((shape) => ({
          id: shape,
          label: t(shape === 'free' ? 'ink.options.lassoFree' : 'ink.options.lassoRectangle'),
          kind: 'radio' as const,
          checked: ink.lasso.shape === shape,
          onSelect: () => void updateSettings({ ink: { lasso: { shape } } }),
        })),
        ...LASSO_PICKS.map(([pick, label], index) => ({
          id: pick,
          label: t(label),
          kind: 'checkbox' as const,
          checked: picks.includes(pick),
          separatorBefore: index === 0,
          onSelect: () => void updateSettings({ ink: { lasso: { picks: togglePick(ink.lasso.picks, pick) } } }),
        })),
      ],
    });
  };

  if (!erasers && !lasso) return null;
  return (
    <div className={styles.group} role="group" aria-label={t('ink.options.group')}>
      {erasers && (
        <button
          type="button"
          {...toolProps}
          className={styles.tool}
          aria-haspopup="menu"
          data-ink-eraser-options=""
          onClick={(event) => void eraserMenu(event.currentTarget)}
        >
          {t('ink.options.eraserType')}
        </button>
      )}
      {lasso && (
        <button
          type="button"
          {...toolProps}
          className={styles.tool}
          aria-haspopup="menu"
          data-ink-lasso-options=""
          onClick={(event) => void lassoMenu(event.currentTarget)}
        >
          {t('ink.options.lasso')}
        </button>
      )}
    </div>
  );
}
