// The shape libraries in the Draw tab: basic shapes, then flowchart, network, and entity diagram pieces. Choosing one
// adds it in the middle of the view, selected, with its handles. A second button puts a text box inside a shape.
import { isEnabled, useFlag } from '../../../app/flags';
import type { CommandBarComponentProps } from '../../../registries/types';
import { t } from '../../../strings/t';
import { openMenu } from '../../../ui';
import type { MenuAnchor } from '../../../ui';
import { LIBRARY } from '../geometry/shapes';
import type { LibraryGroup } from '../geometry/shapes';
import { viewContext } from './context';
import { groupLabel, itemLabel } from './libraryLabels';
import { addTextToShape, insertLibraryShape } from './shapeLibrary';
import styles from './view.module.css';

const GROUPS: readonly LibraryGroup[] = ['basic', 'flowchart', 'network', 'entity'];

/** Pieces a second group also lists: a flowchart's data store is the network's database cylinder. */
const ALSO_IN: Partial<Record<LibraryGroup, readonly string[]>> = { flowchart: ['database'] };

/** The items a group's submenu lists, in order. */
export function groupItems(group: LibraryGroup): string[] {
  return [...LIBRARY.filter((item) => item.group === group).map((item) => item.id), ...(ALSO_IN[group] ?? [])];
}

/** The shape library's groups: the basic ones, then the engineering ones their flags turn on. */
function shownGroups(): LibraryGroup[] {
  return [
    ...GROUPS,
    ...(isEnabled('engineering.fbd') ? (['mechanics'] as const) : []),
    ...(isEnabled('engineering.circuit') ? (['circuit'] as const) : []),
  ];
}

/**
 * Opens the shape library. The Draw tab's Shapes button opens it under itself; More and the command palette open it
 * at the control that has focus, so a narrow window still reaches every shape (full walk 2, A1-A10-2).
 */
export async function openShapeLibrary(anchor?: MenuAnchor): Promise<void> {
  const focused = document.activeElement;
  const at: MenuAnchor =
    anchor ??
    (focused instanceof HTMLElement && focused !== document.body
      ? focused
      : { x: Math.round(window.innerWidth / 2), y: 96 });
  await openMenu({
    label: t('ink.library.menu'),
    anchor: at,
    returnFocus: at instanceof HTMLElement ? at : null,
    items: shownGroups().map((group) => ({
      id: group,
      label: groupLabel(group),
      submenu: groupItems(group).map((id) => ({
        id: `${group}:${id}`,
        label: itemLabel(id),
        onSelect: () => {
          const context = viewContext();
          const surface = context?.surface();
          if (context && surface) void insertLibraryShape(context.host, surface, id);
        },
      })),
    })),
  });
}

export function DrawShapes({ toolProps }: CommandBarComponentProps) {
  const on = useFlag('ink.shapeTools');
  // Read so the menu offers the engineering groups as soon as their flags turn on.
  useFlag('engineering.fbd');
  useFlag('engineering.circuit');
  if (!on) return null;

  const text = () => {
    const context = viewContext();
    const surface = context?.surface();
    if (context && surface) void addTextToShape(context.host, surface);
  };

  return (
    <div className={styles.group} role="group" aria-label={t('ink.library.group')}>
      <button
        type="button"
        {...toolProps}
        className={styles.tool}
        aria-haspopup="menu"
        data-ink-library=""
        onClick={(event) => void openShapeLibrary(event.currentTarget)}
      >
        {t('ink.library.menu')}
      </button>
      <button type="button" {...toolProps} className={styles.tool} data-ink-shape-text="" onClick={text}>
        {t('ink.library.addText')}
      </button>
    </div>
  );
}
