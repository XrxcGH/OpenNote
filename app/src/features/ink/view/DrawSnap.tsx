// The snap tools in the Draw tab: the ruler, the protractor, snap to grid, and the grid's spacing. On ruled, grid, or
// dot paper the grid switch is "Snap to paper lines": shapes snap to the lines the paper draws, and the Draw tab's own
// grid and its spacing are for plain paper.
import { useFlag } from '../../../app/flags';
import type { CommandBarComponentProps } from '../../../registries/types';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce, openMenu } from '../../../ui';
import { hasPaperLines, paperNow } from './paperSnap';
import { inkPrefs, setPrefs } from './prefs';
import styles from './view.module.css';

export const GRID_CHOICES_MM = [2, 5, 10, 20] as const;

export function DrawSnap({ toolProps }: CommandBarComponentProps) {
  const on = useFlag('ink.snapTools');
  const prefs = useStore(inkPrefs, (state) => state);
  const lattice = useStore(paperNow, (state) => state);
  const paperOn = useFlag('ink.paperSnap');
  if (!on) return null;
  const lined = paperOn && hasPaperLines(lattice);
  const toggles = [
    ['ruler', 'ink.snap.ruler'],
    ['protractor', 'ink.snap.protractor'],
    lined ? (['paperSnap', 'ink.snap.paper'] as const) : (['gridSnap', 'ink.snap.grid'] as const),
  ] as const;

  const sizeMenu = async (anchor: HTMLElement) => {
    await openMenu({
      label: t('ink.snap.gridSize'),
      anchor,
      returnFocus: anchor,
      items: GRID_CHOICES_MM.map((mm) => ({
        id: String(mm),
        label: t('ink.snap.gridValue', { mm }),
        kind: 'radio' as const,
        checked: prefs.gridMm === mm,
        onSelect: () => {
          setPrefs({ gridMm: mm });
          announce(t('ink.snap.gridValue', { mm }));
        },
      })),
    });
  };

  return (
    <div className={styles.group} role="group" aria-label={t('ink.snap.group')}>
      {toggles.map(([key, label]) => (
        <button
          key={key}
          type="button"
          {...toolProps}
          className={styles.tool}
          aria-pressed={prefs[key]}
          data-ink-snap={key}
          onClick={() => {
            setPrefs({ [key]: !prefs[key] });
            announce(t(prefs[key] ? 'ink.snap.off' : 'ink.snap.on', { tool: t(label) }));
          }}
        >
          {t(label)}
        </button>
      ))}
      {prefs.gridSnap && !lined && (
        <button
          type="button"
          {...toolProps}
          className={styles.tool}
          aria-haspopup="menu"
          onClick={(event) => void sizeMenu(event.currentTarget)}
        >
          {t('ink.snap.gridSize')}
        </button>
      )}
    </div>
  );
}
