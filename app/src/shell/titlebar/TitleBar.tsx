// The title bar (ARCHITECTURE.md section 10): the logo, "OpenNote", and the items features register (the history
// arrows, the breadcrumb, save status, the update chip, and the theme toggle). The window keeps its native frame
// for now (ADR 0012), so Windows draws the caption, the caption buttons, and the drag area above this bar, and the
// window can always be moved, snapped, and closed, even with a dialog open. This bar is an ordinary toolbar row.
//
// The compact layout has no bar, only the app bar; setup shows the logo and name only. Items that don't fit move
// into More by priority (fit.ts). The bar is never dimmed or made inert under overlays.

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefCallback } from 'react';
import { useLocation } from '../../app/location';
import { titleBarItems, useRegistry } from '../../registries';
import type { TitleBarItemDef } from '../../registries/types';
import { useSizeClass } from '../../state/layout';
import { t } from '../../strings/t';
import { useRegion } from '../regions';
import { useFit } from './fit';
import { Logo } from './Logo';
import styles from './TitleBar.module.css';
import { TitleBarOverflow } from './TitleBarOverflow';

/** The breadcrumb shortens instead of moving into More. */
export const BREADCRUMB_ID = 'layout.breadcrumb';

/** Levels before items start moving into More: the app name hides, the breadcrumb shortens, items shrink. */
export const FIT_LEVEL = { hideName: 1, shortBreadcrumb: 2, icons: 3, firstMove: 4 } as const;

function Items(props: { items: readonly TitleBarItemDef[]; side: 'start' | 'end'; level: number; moved: Set<string> }) {
  const { items, side, level, moved } = props;
  return items
    .filter((item) => item.side === side && !moved.has(item.id))
    .sort((a, b) => a.order - b.order)
    .map(({ id, Component }) => {
      const short = id === BREADCRUMB_ID ? level >= FIT_LEVEL.shortBreadcrumb : level >= FIT_LEVEL.icons;
      return (
        <span key={id} className={id === BREADCRUMB_ID ? styles.breadcrumbItem : styles.item}>
          <Component presentation={short ? 'icon' : 'full'} />
        </span>
      );
    });
}

/** The header element, marked as the title bar region when `region` is set. */
function Bar({
  variant,
  region,
  barRef,
  children,
}: {
  variant: string;
  region: boolean;
  barRef?: RefCallback<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <header
      ref={barRef}
      className={styles.titleBar}
      data-title-bar=""
      data-variant={variant}
      data-region={region ? 'titleBar' : undefined}
    >
      {children}
    </header>
  );
}

function useTitleBarItems() {
  const items = useRegistry(titleBarItems);
  return useMemo(() => {
    const movable = items.filter((item) => item.id !== BREADCRUMB_ID).sort((a, b) => a.priority - b.priority);
    return { items, movable, key: items.map((item) => item.id).join(' ') };
  }, [items]);
}

function FullTitleBar({ medium }: { medium: boolean }) {
  const { items, movable, key } = useTitleBarItems();
  const region = useRegion('titleBar');
  const bar = useRef<HTMLElement | null>(null);
  const start = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [watched] = useState(() => ({
    get current() {
      return [start.current, end.current];
    },
  }));
  const { ref: regionRef } = region;
  const barRef = useCallback(
    (element: HTMLElement | null) => {
      bar.current = element;
      return regionRef(element);
    },
    [regionRef],
  );
  const max = FIT_LEVEL.firstMove - 1 + movable.length;
  const level = useFit(bar, watched, { min: medium ? FIT_LEVEL.hideName : 0, max, key });
  const movedItems = movable.slice(0, Math.max(0, level - FIT_LEVEL.firstMove + 1));
  const moved = new Set(movedItems.map((item) => item.id));
  return (
    <Bar variant={medium ? 'medium' : 'full'} region barRef={barRef}>
      <Logo />
      {level < FIT_LEVEL.hideName && <span className={styles.appName}>{t('common.appName')}</span>}
      <div ref={start} className={styles.group} data-fit-max={level === max ? '' : undefined}>
        <Items items={items} side="start" level={level} moved={moved} />
      </div>
      <div className={styles.spacer} />
      <div ref={end} className={styles.group}>
        <Items items={items} side="end" level={level} moved={moved} />
        {movedItems.length > 0 && <TitleBarOverflow items={movedItems} />}
      </div>
    </Bar>
  );
}

function SetupTitleBar() {
  const region = useRegion('titleBar');
  return (
    <Bar variant="setup" region barRef={region.ref}>
      <Logo />
      <span className={styles.appName}>{t('common.appName')}</span>
    </Bar>
  );
}

export function TitleBar() {
  const location = useLocation();
  const sizeClass = useSizeClass();
  if (location.view === 'setup') return <SetupTitleBar />;
  if (sizeClass === 'compact') return null;
  return <FullTitleBar medium={sizeClass === 'medium'} />;
}
