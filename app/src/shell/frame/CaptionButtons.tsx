// The caption buttons of the custom frame (ARCHITECTURE.md sections 10.3 to 10.5) at the end of the title bar:
// Minimize, Maximize (Restore while maximized), and Close. They have Windows' metrics, 46 DIPs wide each at every
// text size, and sit in the 138-DIP keep-out zone. Like native caption buttons they're outside the tab order;
// screen readers and Voice Access still invoke them, and keyboard users have Alt+Space, Win+Up, Win+Down, and
// Alt+F4. They're exempt from a modal dialog's inertness (ui/inert.ts), so the window can always be minimized,
// maximized, and closed.
//
// With the `shell.customFrame` flag off they render nothing and give the window back its native frame. With
// `window.snapLayouts` on too, a native overlay covers Maximize so hovering it opens Snap Layouts. The overlay is
// then the Maximize button for assistive technology, so this one is hidden from it and draws the overlay's state.

import { useRef } from 'react';
import type { Ref } from 'react';
import type { WindowClient } from '../../platform/types';
import { t } from '../../strings/t';
import { Tooltip } from '../../ui';
import { useCaptionLayoutReport } from './captionLayout';
import styles from './CaptionButtons.module.css';
import {
  frameWindow,
  useCaptionState,
  useCustomFrame,
  useMaximized,
  useSnapLayoutsOverlay,
  useWindowActive,
} from './windowState';

type Glyph = 'minimize' | 'maximize' | 'restore' | 'close';

interface CaptionButtonProps {
  glyph: Glyph;
  label: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  /** Hidden from assistive technology because the native overlay stands in for it. */
  covered?: boolean;
  hovered?: boolean;
  pressed?: boolean;
}

function CaptionButton({ glyph, label, onClick, buttonRef, covered, hovered, pressed }: CaptionButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        ref={buttonRef}
        type="button"
        tabIndex={-1}
        className={styles.button}
        aria-label={label}
        aria-hidden={covered || undefined}
        data-caption={glyph === 'restore' ? 'maximize' : glyph}
        data-hovered={hovered || undefined}
        data-pressed={pressed || undefined}
        onClick={onClick}
      >
        <span className={styles.glyph} data-glyph={glyph} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export interface CaptionButtonsProps {
  /** The window to act on; by default the platform's. */
  client?: WindowClient | null;
}

export function CaptionButtons({ client = frameWindow() }: CaptionButtonsProps) {
  const customFrame = useCustomFrame();
  const overlay = useSnapLayoutsOverlay();
  const maximized = useMaximized(client);
  const active = useWindowActive();
  const state = useCaptionState(client, overlay);
  const maximizeButton = useRef<HTMLButtonElement>(null);
  const labels = { maximize: t('frame.maximize'), restore: t('frame.restore') };
  useCaptionLayoutReport({ client, enabled: customFrame, maximize: maximizeButton, labels, snapLayouts: overlay });
  if (!customFrame) return null;
  return (
    <div
      className={styles.captionButtons}
      role="group"
      aria-label={t('frame.captionButtons')}
      data-modal-exempt=""
      data-caption-buttons=""
      data-inactive={active ? undefined : ''}
    >
      <CaptionButton glyph="minimize" label={t('frame.minimize')} onClick={() => client?.minimize()} />
      <CaptionButton
        glyph={maximized ? 'restore' : 'maximize'}
        label={maximized ? labels.restore : labels.maximize}
        onClick={() => client?.toggleMaximize()}
        buttonRef={maximizeButton}
        covered={overlay}
        hovered={state.hovered}
        pressed={state.pressed}
      />
      <CaptionButton glyph="close" label={t('frame.close')} onClick={() => client?.close()} />
    </div>
  );
}
