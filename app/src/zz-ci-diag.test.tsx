// TEMPORARY CI diagnostics, removed in the next commit. Reproduces the two Ubuntu-only hangs and reports the page.
import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { commandBar, titleBarItems } from './registries';
import { pressChord, renderApp } from './test';

const report: Record<string, unknown> = {};

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

function look(el: Element) {
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

async function limited(label: string, run: () => Promise<unknown>) {
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

const environment = () => {
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

it('diag palette', async () => {
  report.env = environment();
  await renderApp();
  await pressChord('Ctrl+K');
  const box = await screen.findByRole('combobox');
  report.paletteBox = look(box);
  report.paletteComboboxCount = page.getByRole('combobox').elements().length;
  await limited('clickByRole', () => page.getByRole('combobox').click({ timeout: 3000 }));
  await limited('typeInPalette', () => userEvent.type(box, 'dark'));
  report.paletteAfter = { value: (box as HTMLInputElement).value, active: document.activeElement?.tagName };
  expect.fail('DIAG-PALETTE ' + JSON.stringify(report, null, 1));
});

it('diag more button', async () => {
  const stopBar = commandBar.replaceAll([]);
  const chip = titleBarItems.register({
    id: 'test.chip',
    side: 'end',
    order: 1,
    priority: 1,
    compact: 'bottomMore',
    Component: () => <button type="button">{'Update ready'}</button>,
  });
  await renderApp({ sizeClass: 'compact' });
  const bar = screen.getByRole('navigation', { name: 'Quick actions' });
  const more = within(bar).getByRole('button', { name: 'More commands' });
  report.more = look(more);
  report.moreCount = page.getByRole('button', { name: 'More commands' }).elements().length;
  await limited('clickByRole', () => page.getByRole('button', { name: 'More commands' }).click({ timeout: 3000 }));
  await limited('clickByLabel', () => page.getByLabelText('More commands').click({ timeout: 3000 }));
  await limited('clickMore', () => userEvent.click(more));
  report.moreAfter = { expanded: more.getAttribute('aria-expanded'), dialogs: screen.queryAllByRole('dialog').length };
  chip();
  stopBar();
  expect.fail('DIAG-MORE ' + JSON.stringify(report, null, 1));
});
