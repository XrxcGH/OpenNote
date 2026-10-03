// One entry in a menu (APG menu pattern): a menuitem, menuitemcheckbox, or menuitemradio, with an optional icon,
// shortcut, and submenu. Disabled items stay focusable, as the pattern asks, but do nothing.

import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import type { ComponentType, PointerEvent } from 'react';
import { ariaKeyShortcuts } from '../commands/keymap';
import type { Chord } from '../commands/types';
import type { IconProps } from './icons';
import styles from './Menu.module.css';

export interface MenuItemSpec {
  id: string;
  label: string;
  icon?: ComponentType<IconProps>;
  shortcut?: string;
  kind?: 'item' | 'checkbox' | 'radio';
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  submenu?: readonly MenuItemSpec[];
  onSelect?(): void;
}

const ROLES = { item: 'menuitem', checkbox: 'menuitemcheckbox', radio: 'menuitemradio' } as const;

/** Which optional columns a menu shows, so labels line up. */
export interface MenuColumns {
  check: boolean;
  icon: boolean;
}

export function menuColumns(items: readonly MenuItemSpec[]): MenuColumns {
  return {
    check: items.some((item) => item.kind === 'checkbox' || item.kind === 'radio'),
    icon: items.some((item) => item.icon),
  };
}

export function hasSubmenu(item: MenuItemSpec): boolean {
  return Boolean(item.submenu?.length);
}

interface MenuItemProps {
  item: MenuItemSpec;
  id: string;
  columns: MenuColumns;
  expanded: boolean;
  onActivate(item: MenuItemSpec, element: HTMLElement): void;
  onHover(item: MenuItemSpec, event: PointerEvent<HTMLElement>): void;
}

export function MenuItem({ item, id, columns, expanded, onActivate, onHover }: MenuItemProps) {
  const role = ROLES[item.kind ?? 'item'];
  const Icon = item.icon;
  const submenu = hasSubmenu(item);
  // The shortcut is shown in the user's words, such as "Ctrl+Shift+D", which is also the keymap's chord form.
  const keys = item.shortcut ? ariaKeyShortcuts([item.shortcut.replaceAll(' ', '') as Chord]) : undefined;
  return (
    <>
      {item.separatorBefore && <div role="separator" className={styles.separator} />}
      <div
        id={id}
        role={role}
        tabIndex={-1}
        className={styles.item}
        data-danger={item.danger || undefined}
        aria-disabled={item.disabled || undefined}
        aria-checked={role === 'menuitem' ? undefined : Boolean(item.checked)}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-expanded={submenu ? expanded : undefined}
        aria-keyshortcuts={keys}
        onClick={(event) => onActivate(item, event.currentTarget)}
        onPointerMove={(event) => onHover(item, event)}
      >
        {columns.check && (
          <span className={styles.check} aria-hidden="true">
            {item.checked && <CheckIcon />}
          </span>
        )}
        {columns.icon && (
          <span className={styles.icon} aria-hidden="true">
            {Icon && <Icon aria-hidden />}
          </span>
        )}
        <span className={styles.label}>{item.label}</span>
        {item.shortcut && (
          <span className={styles.shortcut} aria-hidden="true">
            {item.shortcut}
          </span>
        )}
        {submenu && <CaretRightIcon className={styles.caret} aria-hidden="true" />}
      </div>
    </>
  );
}
