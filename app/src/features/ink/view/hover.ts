// The pen hover preview: a circle that follows a pen above the screen, at the tip's width and color, or the
// eraser's size. A pen that reports no hover never makes the events, so it never shows. Settings can turn it off.
import { isEnabled } from '../../../app/flags';
import { getSettings } from '../../../state/settings';
import { mmToPage } from '../pens/tools';
import { toCss } from '../pens/palette';
import { hoverCircle } from './hoverShape';
import { inkPrefs } from './prefs';
import { activeSlot, drawState, styleOf } from './state';
import type { InkSurface } from './surface';

const STROKE_ERASER_PX = 6;

export function installHover(surfaceOf: () => InkSurface | null): () => void {
  let circle: HTMLDivElement | null = null;

  const hide = () => {
    if (circle) circle.style.display = 'none';
  };

  const show = (event: PointerEvent) => {
    const surface = surfaceOf();
    const shown = surface
      ? hoverCircle(event, {
          enabled: isEnabled('ink.hover') && inkPrefs.get().hover && !surface.readOnly,
          tool: drawState.get().tool,
          penWidth: styleOf(activeSlot()).width,
          eraserRadius: mmToPage(getSettings().ink.eraser.size) / 2,
          strokeEraserPx: STROKE_ERASER_PX,
          zoom: surface.cameraNow().zoom,
        })
      : null;
    if (!surface || !shown) return hide();
    const doc = surface.chrome.ownerDocument;
    if (!circle || circle.parentElement !== surface.chrome) {
      circle = doc.createElement('div');
      circle.dataset.inkHover = '';
      circle.setAttribute('aria-hidden', 'true');
      Object.assign(circle.style, {
        position: 'absolute',
        pointerEvents: 'none',
        borderRadius: '50%',
        zIndex: 'var(--layer-page-chrome)',
      });
      surface.chrome.append(circle);
    }
    const rect = surface.chrome.getBoundingClientRect();
    const d = shown.diameter;
    const color = shown.kind === 'pen' ? toCss(styleOf(activeSlot()).color) : 'currentColor';
    Object.assign(circle.style, {
      display: '',
      width: `${d}px`,
      height: `${d}px`,
      left: `${event.clientX - rect.left - d / 2}px`,
      top: `${event.clientY - rect.top - d / 2}px`,
      border: `1px solid ${color}`,
      background: shown.kind === 'pen' ? `color-mix(in srgb, ${color} 30%, transparent)` : 'transparent',
      color: 'var(--color-text-primary)',
    });
    circle.dataset.kind = shown.kind;
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'pen') show(event);
  };
  const onDown = (event: PointerEvent) => {
    if (event.pointerType === 'pen') hide();
  };
  const onLeave = () => hide();
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove, { capture: true });
    window.removeEventListener('pointerdown', onDown, { capture: true });
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    circle?.remove();
    circle = null;
  };
}
