// The caption layout report (ARCHITECTURE.md section 10.4). After every layout, zoom, text scale, density,
// maximize, and DPI change, the caption buttons measure the Maximize button and send its rectangle to Rust. Rust
// never computes it, so the Snap Layouts overlay always matches the HTML button.

import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import type { CaptionLayout, WindowClient } from '../../platform/types';

export interface CaptionLabels {
  maximize: string;
  restore: string;
}

/**
 * The layout for a Maximize button at `rect`, in CSS pixels relative to the viewport. WebView2 fills the client
 * area, and `devicePixelRatio` includes both the display scale and the zoom, so the product is in physical pixels
 * relative to the client area, as Rust expects.
 */
export function captionLayout(
  rect: Pick<DOMRectReadOnly, 'x' | 'y' | 'width' | 'height'>,
  devicePixelRatio: number,
  labels: CaptionLabels,
  snapLayouts: boolean,
): CaptionLayout {
  const scale = (value: number) => value * devicePixelRatio;
  return {
    maximize: { x: scale(rect.x), y: scale(rect.y), width: scale(rect.width), height: scale(rect.height) },
    labels: { maximize: labels.maximize, restore: labels.restore },
    snapLayouts,
  };
}

/** Calls `onChange` when `devicePixelRatio` changes: a zoom change or a move to a monitor with another scale. */
function watchPixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  const listen = () => {
    query?.removeEventListener('change', changed);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', changed);
  };
  function changed() {
    listen();
    onChange();
  }
  listen();
  return () => query?.removeEventListener('change', changed);
}

/**
 * Reports the caption layout to Rust while `enabled`, and `null` otherwise, which gives the window back its native
 * frame. A report only goes out when the layout changed.
 */
export function useCaptionLayoutReport(options: {
  client: WindowClient | null;
  enabled: boolean;
  maximize: RefObject<HTMLElement | null>;
  labels: CaptionLabels;
  snapLayouts: boolean;
}): void {
  const { client, enabled, maximize, snapLayouts } = options;
  const { maximize: maximizeLabel, restore: restoreLabel } = options.labels;
  useLayoutEffect(() => {
    if (!client) return undefined;
    if (!enabled) {
      client.setCaptionLayout(null);
      return undefined;
    }
    let last = '';
    const report = () => {
      const button = maximize.current;
      if (!button) return;
      const labels = { maximize: maximizeLabel, restore: restoreLabel };
      const layout = captionLayout(button.getBoundingClientRect(), window.devicePixelRatio, labels, snapLayouts);
      const key = JSON.stringify(layout);
      if (key === last) return;
      last = key;
      client.setCaptionLayout(layout);
    };
    report();
    const observer = new ResizeObserver(report);
    if (maximize.current) observer.observe(maximize.current);
    observer.observe(document.documentElement);
    window.addEventListener('resize', report);
    const stopRatio = watchPixelRatio(report);
    // Maximize and restore resize the window; measure after the page's layout catches up.
    const stopMaximized = client.onMaximizedChange(() => requestAnimationFrame(report));
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      stopRatio();
      stopMaximized();
    };
  }, [client, enabled, maximize, maximizeLabel, restoreLabel, snapLayouts]);
}
