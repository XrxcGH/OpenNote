// Thicker caret. The caret's width and blinking follow the Windows text cursor
// settings, which the shell reads, with a 1 to 6 px choice in Settings and a steady caret that does not blink.
// A browser draws its own caret one pixel wide and always blinking, so when the wanted caret differs, the page
// hides that one and draws its own: one thin element that follows the selection. With Windows' own default
// (one pixel, blinking) nothing changes. The color is the text color, so it reads in every theme.
import type { CaretMetrics } from '../../../platform/types';
import { commandContext } from '../../../commands/registry';
import { osStore } from '../../../state/os';
import type { MountedPage } from '../mount';
import { pageExtrasPrefs } from './prefs';
import type { PageExtrasPrefs } from './prefs';
import styles from './qol.module.css';

export interface CaretLook {
  /** In CSS px. */
  width: number;
  /** Milliseconds shown before the caret hides, or null for a caret that stays. */
  blinkMs: number | null;
  /** Whether the page must draw its own caret. */
  custom: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The caret to draw, from the choices and what Windows reports (null when it can't be read). */
export function caretLook(prefs: PageExtrasPrefs, windows: CaretMetrics | null, dpr = 1): CaretLook {
  // Where Windows can't be read, the caret stays as the browser draws it.
  if (prefs.caretFollowsWindows && windows === null) {
    return { width: 1, blinkMs: prefs.caretSteady ? null : 530, custom: prefs.caretSteady };
  }
  const fromWindows = prefs.caretFollowsWindows && windows !== null;
  const device = fromWindows ? clamp(windows.widthPx, 1, 20) : prefs.caretWidth;
  // Windows counts device pixels; the page counts CSS pixels, so a caret at 150% scaling stays the width asked for.
  const width = fromWindows ? Math.max(1, Math.round(device / (dpr > 0 ? dpr : 1))) : device;
  const blinkMs = prefs.caretSteady ? null : fromWindows ? windows.blinkMs : 530;
  const custom = width > 1 || blinkMs === null;
  return { width, blinkMs, custom };
}

function windowsMetrics(): Promise<CaretMetrics | null> {
  try {
    return commandContext('test')
      .platform.pageExtras.caretMetrics()
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

export function attachCaret(mounted: MountedPage): () => void {
  if (!mounted.host.flag('page.thickCaret')) return () => undefined;
  const doc = mounted.viewport.viewport.ownerDocument;
  const scroller = mounted.viewport.viewport;
  const element = doc.createElement('div');
  element.className = styles.caret;
  element.setAttribute('aria-hidden', 'true');
  element.hidden = true;
  doc.body.append(element);
  let windows: CaretMetrics | null = null;
  let look: CaretLook = caretLook(pageExtrasPrefs.get(), null);
  let frame = 0;

  const place = () => {
    frame = 0;
    const active = mounted.pool.active();
    const editor = active?.editor;
    const selection = editor?.state.selection;
    const focused = !!editor && editor.view.hasFocus();
    if (!look.custom || !editor || !selection?.empty || !focused || !editor.isEditable) {
      element.hidden = true;
      scroller.removeAttribute('data-custom-caret');
      return;
    }
    let box: { left: number; top: number; bottom: number };
    try {
      box = editor.view.coordsAtPos(selection.head);
    } catch {
      element.hidden = true;
      return;
    }
    const inside = scroller.getBoundingClientRect();
    const visible = box.bottom > inside.top && box.top < inside.bottom;
    element.hidden = !visible;
    scroller.setAttribute('data-custom-caret', '');
    const color = getComputedStyle(editor.view.dom).color;
    element.style.setProperty('--caret-width', `${look.width}px`);
    element.style.setProperty('--caret-color', color);
    element.style.left = `${box.left}px`;
    element.style.top = `${box.top}px`;
    element.style.height = `${Math.max(1, box.bottom - box.top)}px`;
    // A steady caret does not blink. So does a caret when the person turned animation off in Windows.
    const blinks = look.blinkMs !== null && osStore.get().animations;
    element.toggleAttribute('data-steady', !blinks);
    if (blinks) element.style.setProperty('--caret-blink', `${(look.blinkMs ?? 530) * 2}ms`);
    // Restart the blink on each move, so the caret is solid while the person types.
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = '';
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(place);
  };
  const refresh = () => {
    look = caretLook(pageExtrasPrefs.get(), windows, window.devicePixelRatio || 1);
    schedule();
  };

  void windowsMetrics().then((found) => {
    windows = found;
    refresh();
  });
  const stopPrefs = pageExtrasPrefs.subscribe(refresh);
  doc.addEventListener('selectionchange', schedule);
  scroller.addEventListener('scroll', schedule, { passive: true });
  scroller.addEventListener('input', schedule, true);
  scroller.addEventListener('focusin', schedule, true);
  scroller.addEventListener('focusout', schedule, true);
  window.addEventListener('resize', schedule);
  return () => {
    stopPrefs();
    doc.removeEventListener('selectionchange', schedule);
    scroller.removeEventListener('scroll', schedule);
    scroller.removeEventListener('input', schedule, true);
    scroller.removeEventListener('focusin', schedule, true);
    scroller.removeEventListener('focusout', schedule, true);
    window.removeEventListener('resize', schedule);
    if (frame !== 0) cancelAnimationFrame(frame);
    scroller.removeAttribute('data-custom-caret');
    element.remove();
  };
}
