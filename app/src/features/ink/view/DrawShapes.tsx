// The shape libraries in the Draw tab: basic shapes, then flowchart, network, and entity diagram pieces. Choosing one
// adds it in the middle of the view, selected, with its handles. A second button puts a text box inside a shape.
import { useFlag } from '../../../app/flags';
import type { CommandBarComponentProps } from '../../../registries/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { openMenu } from '../../../ui';
import { LIBRARY } from '../geometry/shapes';
import type { LibraryGroup } from '../geometry/shapes';
import { viewContext } from './context';
import { addTextToShape, insertLibraryShape } from './shapeLibrary';
import styles from './view.module.css';

const GROUPS: readonly LibraryGroup[] = ['basic', 'flowchart', 'network', 'entity'];

export function DrawShapes({ toolProps }: CommandBarComponentProps) {
  const on = useFlag('ink.shapeTools');
  if (!on) return null;

  const open = async (anchor: HTMLElement) => {
    await openMenu({
      label: t('ink.library.menu'),
      anchor,
      returnFocus: anchor,
      items: GROUPS.map((group) => ({
        id: group,
        label: t(`ink.library.groups.${group}` as MessageKey),
        submenu: LIBRARY.filter((item) => item.group === group).map((item) => ({
          id: item.id,
          label: t(`ink.library.${item.id}` as MessageKey),
          onSelect: () => {
            const context = viewContext();
            const surface = context?.surface();
            if (context && surface) void insertLibraryShape(context.host, surface, item.id);
          },
        })),
      })),
    });
  };

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
        onClick={(event) => void open(event.currentTarget)}
      >
        {t('ink.library.menu')}
      </button>
      <button type="button" {...toolProps} className={styles.tool} data-ink-shape-text="" onClick={text}>
        {t('ink.library.addText')}
      </button>
    </div>
  );
}
