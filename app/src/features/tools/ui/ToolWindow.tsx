// A tool window: a panel docked at the right edge of the page region, between the command bar's line and the status
// line. The page shrinks beside it (shell/layout/dock.ts), so it never covers page text. It has a pin that keeps it
// above the others, a pop-out button where the app can open a window of its own, and a close button, and it is
// resized by its left edge. When the window is too narrow to keep a usable page, it overlays from the right edge
// with a shadow instead. It never takes focus from the page by itself and never traps it.
import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import styles from './tools.module.css';
import type { ToolDef } from './tools';

export interface ToolWindowProps {
  tool: ToolDef;
  /** The width now, which the person set by dragging the edge. */
  width: number;
  /** The space between this panel's right edge and the window's: the width of the panels docked to its right. */
  right: number;
  /** True when the window is too narrow to keep a usable page beside the panels, so they overlay it. */
  overlay: boolean;
  /** The widest this panel may get. */
  maxWidth: number;
  onResize(width: number): void;
  pinned: boolean;
  onPin(): void;
  onClose(): void;
  onPopOut?(): void;
  children: ReactNode;
}

/** The narrowest a panel gets when it is resized. */
export const MIN_PANEL = 280;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function frameStyle(width: number, right: number, overlay: boolean): CSSProperties {
  const top = overlay ? 'var(--panel-top)' : 'var(--panel-inset-top)';
  const bottom = overlay ? 'var(--panel-bottom)' : 'var(--panel-inset-bottom)';
  return {
    // Over the page, the panel stops short of the page's scroll bar, which stays in reach (--scrollbar-size is set by the host).
    insetInlineEnd: overlay ? `calc(${right}px + var(--scrollbar-size, 0px))` : right,
    insetBlockStart: top,
    insetBlockEnd: bottom,
    // Over the page, it also stays inside what the right inset leaves, so a narrow window never pushes it off the left edge.
    inlineSize: overlay
      ? `min(${width}px, calc(100vw - ${right}px - var(--scrollbar-size, 0px)))`
      : `min(${width}px, 100vw)`,
  };
}

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function ToolWindow({
  tool,
  width,
  right,
  overlay,
  maxWidth,
  onResize,
  pinned,
  onPin,
  onClose,
  onPopOut,
  children,
}: ToolWindowProps) {
  const title = t(tool.title);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (next: number) => onResize(clamp(Math.round(next), MIN_PANEL, Math.max(MIN_PANEL, maxWidth)));
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    drag.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const from = drag.current;
    if (from) resize(from.width + from.x - event.clientX);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const delta = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    resize(width + delta);
  };

  return (
    <section
      className={styles.window}
      data-docked={overlay ? undefined : ''}
      data-tool={tool.id}
      data-pinned={pinned ? '' : undefined}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={frameStyle(width, right, overlay)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className={styles.edge}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label={t('smart.tools.window.resize', { title })}
        aria-valuemin={MIN_PANEL}
        aria-valuemax={Math.max(MIN_PANEL, maxWidth)}
        aria-valuenow={width}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.header} data-move="" tabIndex={-1}>
        <h2 className={styles.title}>{title}</h2>
        <Button variant="quiet" aria-pressed={pinned} onClick={onPin}>
          {t('smart.tools.window.keepOnTop')}
        </Button>
        {onPopOut ? (
          <Button variant="quiet" onClick={onPopOut}>
            {t('smart.tools.window.popOut')}
          </Button>
        ) : null}
        <Button variant="quiet" aria-label={t('smart.tools.window.close', { title })} onClick={onClose}>
          ×
        </Button>
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
