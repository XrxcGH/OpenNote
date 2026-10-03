// The title bar's More button: the items that no longer fit, each in its menu-item presentation, in a popover.
// Items can be any control, such as the dark mode switch, so the popover is a labeled group rather than a menu,
// which would allow menu items only. Escape, a press outside, or using an item closes it; focus returns to More.

import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { TitleBarItemDef } from '../../registries/types';
import { t } from '../../strings/t';
import { IconButton, Popover } from '../../ui';
import styles from './TitleBar.module.css';

function useOutsidePress(open: boolean, inside: readonly { current: HTMLElement | null }[], close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !inside.some((ref) => ref.current?.contains(target))) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, inside, close]);
}

export function TitleBarOverflow({ items }: { items: readonly TitleBarItemDef[] }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [refs] = useState(() => [anchor, body] as const);
  const [close] = useState(() => () => setOpen(false));
  useOutsidePress(open, refs, close);
  useEffect(() => {
    if (open) body.current?.querySelector<HTMLElement>('button, [href], input, [tabindex="0"]')?.focus();
  }, [open]);
  const closeAndReturn = () => {
    close();
    anchor.current?.querySelector('button')?.focus();
  };
  const onUse = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button, [href]')) closeAndReturn();
  };
  return (
    <span ref={anchor} className={styles.item}>
      <IconButton
        label={t('titleBar.more')}
        icon={DotsThreeIcon}
        hasPopup="dialog"
        expanded={open}
        onPress={() => setOpen(!open)}
      />
      <Popover anchor={anchor} label={t('titleBar.more')} open={open} onClose={closeAndReturn}>
        <div ref={body} className={styles.overflowList} onClick={onUse}>
          {items.map(({ id, Component }) => (
            <Component key={id} presentation="menuItem" />
          ))}
        </div>
      </Popover>
    </span>
  );
}
