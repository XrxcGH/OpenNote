// Settings: appearance (including the dark mode setting) and updates.

import { type Palette, captionKeepOut, circle, line, palette, rect, region, tag, text, NOTE } from '../lib/svg.ts';
import { WIDE, miniApp, titleBar } from '../lib/chrome.ts';
import { SETTINGS_SECTIONS, chip } from '../lib/parts.ts';
import { type Screen, makeScreen } from './screen.ts';

const NAV_W = 240;
const TOP = WIDE.title;

function nav(p: Palette): string {
  const parts = [
    rect({ x: 0, y: TOP, w: NAV_W, h: WIDE.height - TOP }, { fill: p.c('surface.app') }),
    line([NAV_W, TOP], [NAV_W, WIDE.height], p.c('border.subtle')),
    text(20, TOP + 30, '‹ Back to notes', { size: 13, weight: 600, fill: p.c('text.link') }),
  ];
  SETTINGS_SECTIONS.forEach((item, i) => {
    const y = TOP + 50 + i * 34;
    if (item === 'Appearance')
      parts.push(rect({ x: 8, y, w: NAV_W - 16, h: 30 }, { fill: p.c('surface.selected'), r: 6 }));
    parts.push(text(20, y + 20, item, { size: 14, fill: p.c('text.primary') }));
  });
  return parts.join('');
}

function radio(p: Palette, x: number, y: number, label: string, on: boolean): string {
  const ring = circle(x + 8, y - 5, 8, 'none', p.c(on ? 'accent.primary' : 'border.control'));
  return (
    ring +
    (on ? circle(x + 8, y - 5, 4, p.c('accent.primary')) : '') +
    text(x + 24, y, label, { size: 14, fill: p.c('text.primary') })
  );
}

function appearance(p: Palette, x: number): string {
  const themes: [string, ('light' | 'dark')[], boolean][] = [
    ['Light', ['light'], false],
    ['Dark', ['dark'], false],
    ['Match Windows', ['light', 'dark'], true],
  ];
  const parts = [
    text(x, TOP + 60, 'Appearance', { size: 24, weight: 600, fill: p.c('text.primary') }),
    text(x, TOP + 100, 'Theme', { size: 15, weight: 600, fill: p.c('text.primary') }),
  ];
  themes.forEach(([label, set, on], i) => {
    const cx = x + i * 172;
    parts.push(
      rect(
        { x: cx, y: TOP + 112, w: 160, h: 132 },
        { fill: p.c('surface.page'), stroke: p.c(on ? 'accent.primary' : 'border.subtle'), r: 10, width: on ? 3 : 1 },
      ),
    );
    set.forEach((theme, j) =>
      parts.push(miniApp({ x: cx + 10 + j * (140 / set.length), y: TOP + 122, w: 140 / set.length, h: 80 }, theme)),
    );
    parts.push(radio(p, cx + 10, TOP + 228, label, on));
  });
  parts.push(
    text(x, TOP + 272, 'Quick toggle: the sun and moon button in the title bar, or Ctrl+Shift+D', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
  );
  parts.push(text(x, TOP + 316, 'Page color in dark mode', { size: 15, weight: 600, fill: p.c('text.primary') }));
  parts.push(
    radio(p, x, TOP + 346, 'Match the theme (default)', true),
    radio(p, x, TOP + 376, 'Always paper white', false),
  );
  parts.push(text(x, TOP + 426, 'Text size', { size: 15, weight: 600, fill: p.c('text.primary') }));
  ['80%', '90%', '100%', '110%', '125%', '150%', '175%', '200%'].forEach((size, i) =>
    parts.push(chip(p, x + i * 62, TOP + 438, size, size === '100%', 54)),
  );
  parts.push(text(x, TOP + 500, 'Interface size', { size: 15, weight: 600, fill: p.c('text.primary') }));
  ['90%', '100%', '110%', '125%', '150%'].forEach((size, i) =>
    parts.push(chip(p, x + i * 62, TOP + 512, size, size === '100%', 54)),
  );
  return parts.join('');
}

function updates(p: Palette, x: number): string {
  const w = 480;
  return [
    rect({ x, y: TOP + 40, w, h: 470 }, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 12 }),
    text(x + 24, TOP + 80, 'Updates', { size: 20, weight: 600, fill: p.c('text.primary') }),
    text(x + 24, TOP + 104, 'OpenNote 0.4.0 · Stable channel', { size: 13, fill: p.c('text.secondary') }),
    rect({ x: x + 24, y: TOP + 124, w: w - 48, h: 92 }, { fill: p.c('accent.primarySubtle'), r: 10 }),
    text(x + 40, TOP + 152, 'Version 0.5.0 is ready', { size: 15, weight: 600, fill: p.c('text.primary') }),
    text(x + 40, TOP + 172, 'Downloaded and checked. Takes about 2 seconds.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
    rect({ x: x + 40, y: TOP + 182, w: 150, h: 26 }, { fill: p.c('accent.primary'), r: 6 }),
    text(x + 115, TOP + 200, 'Restart to update', {
      size: 13,
      weight: 600,
      fill: p.c('text.onAccent'),
      anchor: 'middle',
    }),
    text(x + 206, TOP + 200, "What's new", { size: 13, weight: 600, fill: p.c('text.link') }),
    radio(p, x + 24, TOP + 254, 'Install updates automatically (recommended)', true),
    radio(p, x + 24, TOP + 284, 'Ask before installing', false),
    radio(p, x + 24, TOP + 314, 'Only check when I ask', false),
    text(x + 24, TOP + 356, 'Channel', { size: 14, weight: 600, fill: p.c('text.primary') }),
    rect({ x: x + 100, y: TOP + 338, w: 120, h: 28 }, { stroke: p.c('border.control'), r: 6 }),
    text(x + 112, TOP + 357, 'Stable ▾', { size: 13, fill: p.c('text.primary') }),
    text(x + 24, TOP + 402, 'Go back to version 0.3.2', { size: 13, weight: 600, fill: p.c('text.link') }),
    text(x + 24, TOP + 444, 'Updates never change your notes or settings.', { size: 13, fill: p.c('text.muted') }),
    text(x + 24, TOP + 464, 'A backup is made before any file conversion.', { size: 13, fill: p.c('text.muted') }),
  ].join('');
}

export function settings(): Screen {
  const p = palette('light');
  const content = NAV_W + 48;
  const updatesX = content + 540;
  const body = [
    titleBar(p, { breadcrumb: 'Settings', update: true }),
    rect({ x: NAV_W, y: TOP, w: WIDE.width - NAV_W, h: WIDE.height - TOP }, { fill: p.c('surface.page') }),
    nav(p),
    appearance(p, content),
    updates(p, updatesX),
    captionKeepOut(WIDE.width),
    region({ x: 2, y: TOP + 44, w: NAV_W - 4, h: 460 }, ''),
    tag(8, TOP + 560, 'Settings sections 240', NOTE.region),
    region({ x: WIDE.width - 138 - 240, y: 6, w: 110, h: 28 }, ''),
    tag(WIDE.width - 138 - 460, 78, 'Update notice lives in the title bar, never a pop-up', NOTE.region),
    tag(
      content,
      TOP + 600,
      'The Appearance and Updates sections are shown side by side here; the app shows one at a time',
      NOTE.region,
    ),
  ];
  return makeScreen({
    file: '08-settings.svg',
    title: 'Settings: appearance and updates',
    background: p.c('surface.app'),
    body,
  });
}
