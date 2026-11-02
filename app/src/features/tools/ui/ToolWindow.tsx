// A tool window: a panel docked at the right edge of the page region, between the command bar's line and the status
// line. The page shrinks beside it (shell/layout/dock.ts), so it never covers page text. It has a pin that keeps it
// above the others, a pop-out button where the app can open a window of its own, and a close button, and it is
// resized by its left edge. When the window is too narrow to keep a usable page, it floats over the page from the
// right edge with a shadow instead, clear of the page's scroll bar and as tall as its content (windowPlacement.ts).
// It never takes focus from the page by itself and never traps it.
import { Component, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { t } from '../../../strings/t';
import { Button, IconButton } from '../../../ui';
import styles from './tools.module.css';
import type { ToolDef } from './tools';

export interface ToolWindowProps {
  tool: ToolDef;
  /** The width now, which the person set by dragging the edge. */
  width: number;
  /** The space between this panel's right edge and the window's: the panels docked to its right, or for a floating one, its place. */
  right: number;
  /** For a floating window that had to overlap others: how far it starts below the top, so its title stays clear. */
  down?: number;
  /** True when the window is too narrow to keep a usable page beside the panels, so they overlay it. */
  overlay: boolean;
  /** Its place among the tool windows that overlap: higher is in front. */
  stack: number;
  /** Puts this window in front of the others, when the person presses or focuses it. */
  onRaise(): void;
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

function frameStyle(width: number, right: number, overlay: boolean, stack: number, down: number): CSSProperties {
  // Docked, the panel is a column from the command bar's line to the status line. Floating, it is as tall as its
  // content and no taller than the room between them, so a short tool leaves no empty box and a long one scrolls.
  return overlay
    ? {
        insetInlineEnd: right,
        insetBlockStart: down ? `calc(var(--panel-top) + ${down}px)` : 'var(--panel-top)',
        maxBlockSize: `calc(100dvh - var(--panel-top) - var(--panel-bottom) - ${down}px)`,
        inlineSize: width,
        zIndex: stack,
      }
    : {
        insetInlineEnd: right,
        insetBlockStart: 'var(--panel-inset-top)',
        insetBlockEnd: 'var(--panel-inset-bottom)',
        inlineSize: width,
        zIndex: stack,
      };
}

/** Says so in the window when a tool's code fails to load or throws, instead of leaving an empty box. */
class ToolBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  override state: { failed: boolean } = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p className={styles.problem} role="alert">
        {t('smart.tools.window.failed', { title: this.props.title })}
      </p>
    );
  }
}

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function ToolWindow({
  tool,
  width,
  right,
  down = 0,
  overlay,
  stack,
  onRaise,
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
      data-toast-avoid=""
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={frameStyle(width, right, overlay, stack, down)}
      onPointerDownCapture={onRaise}
      onFocusCapture={onRaise}
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
        <IconButton label={t('smart.tools.window.close', { title })} icon={XIcon} onPress={onClose} />
      </div>
      {/* While a tool's code loads, the empty body says so (data-loading, tools.module.css). */}
      <div className={styles.body} data-loading={t('smart.tools.window.loading', { title })}>
        <ToolBoundary title={title}>{children}</ToolBoundary>
      </div>
    </section>
  );
}
