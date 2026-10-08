// One tree row (ARCHITECTURE.md section 13.2): a flat treeitem with its level, position, and set size. Its name
// comes from the title element, so the "More actions" button doesn't join it, and its kind and color are the
// description. Anatomy: indent, disclosure triangle, color chip, title (a second line with the date for pages),
// and the "More actions" button, which shows on hover, on focus, and always with touch density.

import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { PushPinIcon } from '@phosphor-icons/react/dist/csr/PushPin';
import { memo, useId, useRef } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import type { NodeSummary } from '../../services/notes';
import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import { IconButton } from '../../ui';
import { titleOf } from './actions';
import { RenameField } from './RenameField';
import type { Row } from './rows';
import type { Renaming, TreeId } from './store';
import styles from './Tree.module.css';

export interface TreeRowProps {
  readonly tree: TreeId;
  readonly row: Row;
  readonly selected: boolean;
  /** Part of a selection of several rows. */
  readonly multi?: boolean;
  /** The roving row, with tabindex 0. */
  readonly focused: boolean;
  readonly renaming: Renaming | null;
  /** The row's top when the tree windows its rows. */
  readonly top?: number;
  onPress(row: Row, event: MouseEvent): void;
  onToggle(row: Row): void;
  onRename(row: Row): void;
  onMore(row: Row, anchor: HTMLElement): void;
}

/** "Section, color Fern", or "Subpage, Sep 28, 2026". */
export function describeNode(node: NodeSummary): string {
  if (node.kind === 'page') {
    const level = String(node.pageLevel);
    const date = formatDate(node.modified);
    const page = node.color
      ? t('tree.describe.pageColored', { level, date, color: t(`tree.colors.${node.color}`) })
      : t('tree.describe.page', { level, date });
    return node.pinned ? `${page} ${t('qol.pin.describe')}` : page;
  }
  const kind = node.color
    ? t('tree.describe.colored', { kind: node.kind, color: t(`tree.colors.${node.color}`) })
    : t('tree.describe.kind', { kind: node.kind });
  return node.kind === 'section' && node.pinned ? `${kind}. ${t('qol.pin.describe')}` : kind;
}

function Chip({ node }: { node: NodeSummary }) {
  if (node.kind === 'page' && !node.color) return null;
  const shape = node.kind === 'section' || node.kind === 'page' ? styles.dot : styles.square;
  const name = node.color ? t(`tree.colors.${node.color}`) : undefined;
  return (
    <span aria-hidden="true" className={`${styles.chip} ${shape}`} data-color={node.color ?? 'none'} title={name} />
  );
}

function Twisty({ row, onToggle }: { row: Row; onToggle(row: Row): void }) {
  if (row.expanded === undefined) return <span className={styles.twisty} aria-hidden="true" />;
  const Icon = row.expanded ? CaretDownIcon : CaretRightIcon;
  return (
    <span
      className={styles.twisty}
      aria-hidden="true"
      data-twisty=""
      onClick={(event) => {
        event.stopPropagation();
        onToggle(row);
      }}
    >
      <Icon aria-hidden />
    </span>
  );
}

function TreeRowView(props: TreeRowProps) {
  const { tree, row, selected, multi, focused, renaming, top } = props;
  const { node } = row;
  const id = useId();
  const element = useRef<HTMLDivElement>(null);
  const title = titleOf(node);
  const style = { '--level': row.level - 1, ...(top === undefined ? {} : { top }) } as CSSProperties;
  return (
    <div
      ref={element}
      role="treeitem"
      className={styles.row}
      data-kind={node.kind}
      data-node-id={node.id}
      data-windowed={top === undefined ? undefined : ''}
      data-multi={multi ? '' : undefined}
      data-archived={node.archived ? '' : undefined}
      style={style}
      aria-level={row.level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-expanded={row.expanded}
      aria-selected={selected}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      tabIndex={focused ? 0 : -1}
      onClick={(event) => props.onPress(row, event)}
    >
      <Twisty row={row} onToggle={props.onToggle} />
      <Chip node={node} />
      <span className={styles.text}>
        {renaming ? (
          <RenameField tree={tree} renaming={renaming} title={title} />
        ) : (
          <span id={`${id}-title`} className={styles.title} onDoubleClick={() => props.onRename(row)}>
            {title}
          </span>
        )}
        {renaming && (
          <span id={`${id}-title`} hidden>
            {title}
          </span>
        )}
        {node.kind === 'page' && !renaming && (
          <span className={styles.meta} aria-hidden="true">
            {formatDate(node.modified)}
          </span>
        )}
      </span>
      <span id={`${id}-description`} hidden>
        {describeNode(node)}
      </span>
      {node.pinned && !renaming && <PushPinIcon aria-hidden className={styles.pin} weight="fill" />}
      <span className={styles.more}>
        <IconButton
          label={t('tree.menu.more', { title })}
          icon={DotsThreeIcon}
          tabIndex={-1}
          hasPopup="menu"
          onPress={() => element.current && props.onMore(row, element.current)}
        />
      </span>
    </div>
  );
}

export const TreeRow = memo(TreeRowView);
