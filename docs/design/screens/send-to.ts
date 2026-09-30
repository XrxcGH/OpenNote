// "Send to": convert a page, section, or selection and upload it to a linked account.

import { type Palette, captionKeepOut, circle, line, palette, rect, region, tag, text, NOTE } from '../lib/svg.ts';
import { BODY_TOP, EDITOR_X, WIDE, editorBackground, standardWindow } from '../lib/chrome.ts';
import { samplePage } from './workspace.ts';
import { type Screen, makeScreen } from './screen.ts';

const D = { x: 400, y: 110, w: 640, h: 500 };

function pill(p: Palette, x: number, y: number, label: string, on = false): string {
  const w = Math.ceil(label.length * 7.4 + 28);
  const fill = on ? p.c('accent.primarySubtle') : 'none';
  return [
    '<g data-fit="6" data-center="both">',
    rect({ x, y, w, h: 30 }, { fill, stroke: p.c(on ? 'accent.primary' : 'border.control'), r: 15 }),
    text(x + w / 2, y + 20, label, { size: 13, fill: p.c(on ? 'text.link' : 'text.primary'), anchor: 'middle' }),
    '</g>',
  ].join('');
}

function pillRow(p: Palette, y: number, heading: string, labels: string[]): string {
  const parts = [text(D.x + 28, y + 20, heading, { size: 14, weight: 600, fill: p.c('text.primary') })];
  let x = D.x + 120;
  labels.forEach((label, i) => {
    parts.push(pill(p, x, y, label, i === 0));
    x += Math.ceil(label.length * 7.4 + 28) + 8;
  });
  return parts.join('');
}

interface Destination {
  service: string;
  path: string;
  color: string;
  favorite?: boolean;
}

function destinations(p: Palette, y: number): string {
  const list: Destination[] = [
    { service: 'Google Drive', path: 'Biology / Lab reports', color: p.pen('Fern'), favorite: true },
    { service: 'OneDrive', path: 'Documents / School', color: p.pen('Indigo') },
    { service: 'This PC', path: 'Downloads', color: p.pen('Walnut') },
  ];
  const parts = [text(D.x + 28, y + 20, 'Where', { size: 14, weight: 600, fill: p.c('text.primary') })];
  list.forEach((d, i) => {
    const ry = y + 36 + i * 52;
    if (i === 0) parts.push(rect({ x: D.x + 20, y: ry, w: D.w - 40, h: 46 }, { fill: p.c('surface.selected'), r: 8 }));
    parts.push(circle(D.x + 46, ry + 23, 12, d.color));
    parts.push(text(D.x + 70, ry + 20, d.service, { size: 14, weight: 600, fill: p.c('text.primary') }));
    parts.push(text(D.x + 70, ry + 38, d.path, { size: 12, fill: p.c('text.secondary') }));
    if (d.favorite)
      parts.push(text(D.x + D.w - 40, ry + 28, '★ Favorite', { size: 12, fill: p.c('text.link'), anchor: 'end' }));
  });
  parts.push(text(D.x + 28, y + 212, '+ Link another account', { size: 13, weight: 600, fill: p.c('text.link') }));
  return parts.join('');
}

function footer(p: Palette): string {
  const y = D.y + D.h - 64;
  return [
    line([D.x, y - 16], [D.x + D.w, y - 16], p.c('border.subtle')),
    rect({ x: D.x + 28, y: y - 1, w: 18, h: 18 }, { fill: p.c('accent.primary'), r: 4 }),
    text(D.x + 37, y + 13, '✓', { size: 12, weight: 700, fill: p.c('text.onAccent'), anchor: 'middle' }),
    text(D.x + 56, y + 13, 'Keep linked: offer to update the Drive copy after edits', {
      size: 13,
      fill: p.c('text.primary'),
    }),
    text(D.x + D.w - 170, y + 45, 'Cancel', { size: 14, weight: 600, fill: p.c('text.link'), anchor: 'end' }),
    '<g data-fit="8" data-center="both">',
    rect({ x: D.x + D.w - 148, y: y + 22, w: 120, h: 36 }, { fill: p.c('accent.primary'), r: 8 }),
    text(D.x + D.w - 88, y + 45, 'Send', { size: 14, weight: 600, fill: p.c('text.onAccent'), anchor: 'middle' }),
    '</g>',
  ].join('');
}

function dialog(p: Palette): string {
  return [
    rect(D, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 14, shadow: true }),
    text(D.x + 28, D.y + 44, 'Send to', { size: 22, weight: 600, fill: p.c('text.primary') }),
    text(D.x + D.w - 28, D.y + 42, '✕', { size: 16, fill: p.c('text.secondary'), anchor: 'end' }),
    pillRow(p, D.y + 70, 'What', ['This page', 'Whole section', 'Lassoed selection']),
    pillRow(p, D.y + 116, 'Format', ['PDF', 'Word', 'Google Docs', 'PNG image']),
    destinations(p, D.y + 162),
    footer(p),
  ].join('');
}

export function sendTo(): Screen {
  const p = palette('light');
  const pages = [{ title: 'Cell structure', meta: 'Sep 28 · 3 recordings', selected: true }];
  const tree = [
    { label: 'Biology 101', depth: 0, kind: 'notebook' as const, color: p.pen('Fern') },
    { label: 'Lectures', depth: 1, kind: 'section' as const, color: p.pen('Fern'), selected: true },
  ];
  const body = [
    ...standardWindow(p, {
      title: { breadcrumb: 'Biology 101  ›  Lectures  ›  Cell structure' },
      tab: 'Home',
      tools: [{ label: 'B' }, { label: 'I' }, { label: '↗ Send to', active: true }],
      tree,
      pagesHeading: 'Lectures',
      pages,
    }),
    editorBackground(p),
    samplePage(p, EDITOR_X + 64, BODY_TOP + 88),
    rect(
      { x: 0, y: WIDE.title, w: WIDE.width, h: WIDE.height - WIDE.title },
      { fill: p.c('text.primary'), opacity: 0.28 },
    ),
    dialog(p),
    captionKeepOut(WIDE.width),
    region({ x: D.x - 6, y: D.y - 6, w: D.w + 12, h: D.h + 12 }, ''),
    tag(D.x + D.w + 20, D.y + 20, 'Dialog 640 wide, opened with Ctrl+Shift+S', NOTE.region),
    tag(D.x + D.w + 20, D.y + 360, 'Favorites come first: one click sends', NOTE.region),
    tag(D.x + D.w + 20, D.y + 384, 'Sign-in uses the provider page (OAuth)', NOTE.region),
    tag(D.x, D.y + D.h + 30, 'Uploads run in the background; a toast shows the link when done', NOTE.region),
  ];
  return makeScreen({
    file: '12-send-to.svg',
    title: 'Send to Google Drive, OneDrive, or this PC',
    background: p.c('surface.app'),
    body,
  });
}
