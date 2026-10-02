// TEMPORARY CI diagnostics helpers, removed with the diagnostics.
import { page } from 'vitest/browser';

export const report: Record<string, unknown> = {};

function chain(el: Element | null) {
  const out: string[] = [];
  for (let e = el; e && out.length < 14; e = e.parentElement) {
    const flags = [
      e.hasAttribute('inert') && 'inert',
      e.getAttribute('aria-hidden') && 'ah',
      e.hasAttribute('hidden') && 'hidden',
    ]
      .filter(Boolean)
      .join(',');
    out.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${flags ? '[' + flags + ']' : ''}`);
  }
  return out.join(' < ');
}

export function look(el: Element) {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  let selector: string;
  try {
    selector = String((page.elementLocator(el) as unknown as { selector: string }).selector);
  } catch (e) {
    selector = 'ERR ' + String(e);
  }
  return {
    html: el.outerHTML.slice(0, 160),
    chain: chain(el),
    rect: [r.x, r.y, r.width, r.height].map(Math.round).join(','),
    vis: `${s.display}/${s.visibility}/${s.opacity}/${s.pointerEvents}`,
    selector,
  };
}

export async function limited(label: string, run: () => Promise<unknown>) {
  const started = performance.now();
  const outcome = await Promise.race([
    run().then(
      () => 'ok',
      (e: unknown) => 'threw ' + String(e).slice(0, 1500),
    ),
    new Promise((done) => setTimeout(() => done('STUCK 5s'), 5000)),
  ]);
  report[label] = `${outcome} after ${Math.round(performance.now() - started)}ms`;
}

export const environment = () => {
  const media = (q: string) => matchMedia(q).matches;
  return {
    ua: navigator.userAgent,
    dpr: devicePixelRatio,
    size: `${innerWidth}x${innerHeight}`,
    coarse: media('(pointer: coarse)'),
    hover: media('(hover: hover)'),
    reduced: media('(prefers-reduced-motion: reduce)'),
    forced: media('(forced-colors: active)'),
    dark: media('(prefers-color-scheme: dark)'),
    focus: document.hasFocus(),
    visibility: document.visibilityState,
    iframes: window.parent.document.querySelectorAll('iframe').length,
    iframeAttrs: [...window.parent.document.querySelectorAll('iframe')]
      .map((f) => `${f.getAttribute('data-vitest')}:${f.clientWidth}x${f.clientHeight}`)
      .join(' '),
    fonts: [...document.fonts].map((f) => f.status).join(','),
  };
};

/** Used by the real specs while the hang is being diagnosed: acts, and if it hangs says what the page looks like. */
export async function diagAct(label: string, el: Element, act: () => Promise<unknown>): Promise<void> {
  const outcome = await Promise.race([
    act().then(
      () => 'ok',
      (e: unknown) => 'threw ' + String(e).slice(0, 1500),
    ),
    new Promise((done) => setTimeout(() => done('STUCK'), 4000)),
  ]);
  if (outcome === 'ok') return;
  const direct: Record<string, string> = {};
  const selector = String((page.elementLocator(el) as unknown as { selector: string }).selector);
  const parentFrames = [...window.parent.document.querySelectorAll('iframe')].map(
    (f) => `${f.getAttribute('data-vitest')}:${f.clientWidth}x${f.clientHeight}:${f.getAttribute('src')?.slice(-40)}`,
  );
  try {
    direct.elements = String(page.elementLocator(el).elements().length);
  } catch (e) {
    direct.elements = 'ERR ' + String(e).slice(0, 200);
  }
  await Promise.race([
    page
      .elementLocator(el)
      .click({ timeout: 2500 })
      .then(
        () => (direct.rawClick = 'ok'),
        (e: unknown) => (direct.rawClick = 'threw ' + String(e).slice(0, 1200)),
      ),
    new Promise((done) => setTimeout(done, 4000)),
  ]);
  throw new Error(
    'DIAG-ACT ' +
      JSON.stringify(
        {
          label,
          outcome,
          selector,
          direct,
          parentFrames,
          timeOrigin: performance.timeOrigin,
          up: Math.round(performance.now()),
          connected: el.isConnected,
          look: look(el),
          env: environment(),
        },
        null,
        1,
      ),
  );
}
