// Small interface parts shared by the newer wireframes: buttons, fields, switches, chips, dialogs, and the
// Settings frame. Each takes a palette, so the same drawing works in the light and the dark theme.

import { type Box, type Palette, captionKeepOut, circle, line, rect, text } from './svg.ts';
import { WIDE, titleBar } from './chrome.ts';

export type ButtonKind = 'primary' | 'secondary' | 'quiet';

export function button(p: Palette, x: number, y: number, w: number, label: string, kind: ButtonKind = 'secondary') {
  const fill = kind === 'primary' ? p.c('accent.primary') : 'none';
  const stroke = kind === 'secondary' ? p.c('border.control') : undefined;
  const color = kind === 'primary' ? p.c('text.onAccent') : kind === 'quiet' ? p.c('text.link') : p.c('text.primary');
  return [
    '<g data-fit="6" data-center="both">',
    rect({ x, y, w, h: 34 }, { fill, stroke, r: 8 }),
    text(x + w / 2, y + 22, label, { size: 13, weight: kind === 'primary' ? 600 : 400, fill: color, anchor: 'middle' }),
    '</g>',
  ].join('');
}

/** A text box or a menu button with its current value. */
export function field(p: Palette, x: number, y: number, w: number, value: string, menu = false, mono = false) {
  return [
    rect({ x, y, w, h: 34 }, { fill: p.c('surface.sunken'), stroke: p.c('border.control'), r: 8 }),
    text(x + 12, y + 22, value, { size: 13, fill: p.c('text.primary'), font: mono ? 'mono' : 'ui' }),
    menu ? text(x + w - 14, y + 22, '⌄', { size: 13, fill: p.c('text.secondary'), anchor: 'middle' }) : '',
  ].join('');
}

export function toggle(p: Palette, x: number, y: number, on: boolean): string {
  return (
    rect({ x, y, w: 40, h: 22 }, { fill: p.c(on ? 'accent.primary' : 'border.control'), r: 11 }) +
    circle(on ? x + 29 : x + 11, y + 11, 8, p.c('surface.page'))
  );
}

/** A setting: a bold name, a hint under it, and a switch at the right edge of the box. */
export function switchRow(p: Palette, x: number, y: number, w: number, label: string, hint: string, on: boolean) {
  return [
    text(x, y + 16, label, { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(x, y + 36, hint, { size: 12, fill: p.c('text.secondary') }),
    toggle(p, x + w - 40, y + 4, on),
  ].join('');
}

export function chip(p: Palette, x: number, y: number, label: string, active = false, w = label.length * 7 + 28) {
  return [
    '<g data-fit="4" data-center="both">',
    rect(
      { x, y, w, h: 28 },
      {
        fill: active ? p.c('accent.primarySubtle') : 'none',
        stroke: p.c(active ? 'accent.primary' : 'border.subtle'),
        r: 14,
      },
    ),
    text(x + w / 2, y + 19, label, { size: 12, fill: p.c(active ? 'text.link' : 'text.secondary'), anchor: 'middle' }),
    '</g>',
  ].join('');
}

/** A raised card: a dialog, popover, or tool window, with a title and an optional close mark. */
export function card(p: Palette, b: Box, title: string, close = true): string {
  return [
    rect(b, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 14, shadow: true }),
    text(b.x + 24, b.y + 38, title, { size: 17, weight: 600, fill: p.c('text.primary') }),
    close ? text(b.x + b.w - 24, b.y + 36, '✕', { size: 14, fill: p.c('text.secondary'), anchor: 'end' }) : '',
  ].join('');
}

/** The dim layer behind a modal dialog. The title bar is never dimmed. */
export function scrim(p: Palette): string {
  return rect(
    { x: 0, y: WIDE.title, w: WIDE.width, h: WIDE.height - WIDE.title },
    { fill: p.c('text.primary'), opacity: 0.28 },
  );
}

/** A list row inside a card, with a one-line detail. */
export function row(p: Palette, x: number, y: number, w: number, title: string, detail: string, selected = false) {
  return [
    selected ? rect({ x, y, w, h: 54 }, { fill: p.c('surface.selected'), r: 8 }) : '',
    text(x + 12, y + 22, title, { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(x + 12, y + 42, detail, { size: 12, fill: p.c('text.secondary') }),
  ].join('');
}

export const SETTINGS_SECTIONS = [
  'General',
  'Appearance',
  'Editing',
  'Recording',
  'On-device intelligence',
  'Storage and backups',
  'Updates',
  'Privacy',
  'Windows and power',
  'Connectors',
  'Help',
  'Shortcuts',
  'About',
];

export const SETTINGS_NAV_W = 240;

/** The Settings window: title bar, the section list with one section chosen, and a page-colored content area. */
export function settingsFrame(p: Palette, active: string): string[] {
  const top = WIDE.title;
  const parts = [
    titleBar(p, { breadcrumb: 'Settings' }),
    rect(
      { x: SETTINGS_NAV_W, y: top, w: WIDE.width - SETTINGS_NAV_W, h: WIDE.height - top },
      { fill: p.c('surface.page') },
    ),
    rect({ x: 0, y: top, w: SETTINGS_NAV_W, h: WIDE.height - top }, { fill: p.c('surface.app') }),
    line([SETTINGS_NAV_W, top], [SETTINGS_NAV_W, WIDE.height], p.c('border.subtle')),
    text(20, top + 30, '‹ Back to notes', { size: 13, weight: 600, fill: p.c('text.link') }),
  ];
  SETTINGS_SECTIONS.forEach((item, i) => {
    const y = top + 50 + i * 34;
    if (item === active)
      parts.push(rect({ x: 8, y, w: SETTINGS_NAV_W - 16, h: 30 }, { fill: p.c('surface.selected'), r: 6 }));
    parts.push(text(20, y + 20, item, { size: 14, fill: p.c('text.primary') }));
  });
  parts.push(captionKeepOut(WIDE.width));
  return parts;
}
