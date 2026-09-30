// First-run setup: "Choose your look" (step 2) and "Where should OpenNote keep things?" (step 3).

import { type Box, type Palette, captionKeepOut, circle, palette, rect, region, tag, text, NOTE } from '../lib/svg.ts';
import { WIDE, miniApp, titleBar } from '../lib/chrome.ts';
import { type Screen, makeScreen } from './screen.ts';

const CARD: Box = { x: 360, y: 130, w: 720, h: 600 };

function setupCard(p: Palette, step: number, title: string, subtitle: string): string[] {
  const center = CARD.x + CARD.w / 2;
  const dots = [1, 2, 3, 4].map((n) =>
    circle(center - 36 + (n - 1) * 24, CARD.y + 40, 5, p.c(n <= step ? 'accent.primary' : 'border.subtle')),
  );
  return [
    titleBar(p, { minimal: true }),
    rect(CARD, { fill: p.c('surface.raised'), r: 16, shadow: true }),
    ...dots,
    text(center, CARD.y + 70, `Step ${step} of 4`, { size: 13, fill: p.c('text.muted'), anchor: 'middle' }),
    text(center, CARD.y + 116, title, { size: 30, weight: 600, fill: p.c('text.primary'), anchor: 'middle' }),
    text(center, CARD.y + 146, subtitle, { size: 15, fill: p.c('text.secondary'), anchor: 'middle' }),
  ];
}

function buttons(p: Palette, primary: string): string[] {
  const y = CARD.y + CARD.h - 72;
  const right = CARD.x + CARD.w - 36;
  return [
    text(CARD.x + 48, y + 26, 'Back', { size: 15, weight: 600, fill: p.c('text.link') }),
    rect({ x: right - 150, y, w: 150, h: 40 }, { fill: p.c('accent.primary'), r: 8 }),
    text(right - 75, y + 26, primary, { size: 15, weight: 600, fill: p.c('text.onAccent'), anchor: 'middle' }),
  ];
}

interface ThemeCard {
  label: string;
  caption: string;
  themes: ('light' | 'dark')[];
  selected?: boolean;
}

function themeCard(p: Palette, x: number, y: number, card: ThemeCard): string {
  const parts = [
    rect(
      { x, y, w: 200, h: 200 },
      {
        fill: p.c('surface.page'),
        stroke: p.c(card.selected ? 'accent.primary' : 'border.subtle'),
        r: 12,
        width: card.selected ? 3 : 1,
      },
    ),
  ];
  const previewWidth = 176 / card.themes.length;
  card.themes.forEach((theme, i) =>
    parts.push(miniApp({ x: x + 12 + i * previewWidth, y: y + 12, w: previewWidth, h: 116 }, theme)),
  );
  parts.push(text(x + 16, y + 156, card.label, { size: 16, weight: 600, fill: p.c('text.primary') }));
  parts.push(text(x + 16, y + 178, card.caption, { size: 13, fill: p.c('text.secondary') }));
  if (card.selected)
    parts.push(
      circle(x + 180, y + 152, 10, p.c('accent.primary')),
      text(x + 180, y + 157, '✓', { size: 13, weight: 700, fill: p.c('text.onAccent'), anchor: 'middle' }),
    );
  return parts.join('');
}

export function firstRunLook(): Screen {
  const p = palette('light');
  const cards: ThemeCard[] = [
    { label: 'Light', caption: 'Always light', themes: ['light'] },
    { label: 'Dark', caption: 'Always dark', themes: ['dark'] },
    { label: 'Match Windows', caption: 'Follows Windows', themes: ['light', 'dark'], selected: true },
  ];
  const cardsY = CARD.y + 190;
  const body = [
    ...setupCard(p, 2, 'Choose your look', 'Change it any time with the ☾ button or Ctrl+Shift+D.'),
    ...cards.map((card, i) => themeCard(p, CARD.x + 36 + i * 224, cardsY, card)),
    text(CARD.x + CARD.w / 2, cardsY + 240, 'Preselected because Windows is set to Light.', {
      size: 13,
      fill: p.c('text.muted'),
      anchor: 'middle',
    }),
    ...buttons(p, 'Continue'),
    region(CARD, 'Setup card 720×600, centered'),
    region({ x: CARD.x + 30, y: cardsY - 6, w: 660, h: 212 }, 'Theme cards 200×200, gap 24'),
    tag(CARD.x + CARD.w + 16, cardsY + 100, 'Clicking a card repaints the whole screen', NOTE.region),
    tag(CARD.x + CARD.w + 16, cardsY + 124, 'Focus starts on the preselected card', NOTE.region),
    captionKeepOut(WIDE.width),
  ];
  return makeScreen({
    file: '01-first-run-look.svg',
    title: 'First run, step 2: choose your look',
    background: p.c('surface.app'),
    body,
  });
}

function field(p: Palette, y: number, label: string, value: string, font: 'ui' | 'mono' = 'ui'): string[] {
  const x = CARD.x + 48;
  return [
    text(x, y, label, { size: 14, weight: 600, fill: p.c('text.primary') }),
    rect({ x, y: y + 10, w: 500, h: 38 }, { fill: p.c('surface.sunken'), stroke: p.c('border.control'), r: 8 }),
    text(x + 12, y + 34, value, { size: 14, fill: p.c('text.primary'), font }),
  ];
}

function radio(p: Palette, y: number, label: string, detail: string, on: boolean): string[] {
  const x = CARD.x + 48;
  const dot = on
    ? [circle(x + 9, y - 5, 9, 'none', p.c('accent.primary')), circle(x + 9, y - 5, 5, p.c('accent.primary'))]
    : [circle(x + 9, y - 5, 9, 'none', p.c('border.control'))];
  return [
    ...dot,
    text(x + 28, y, label, { size: 14, fill: p.c('text.primary') }),
    text(x + 28, y + 20, detail, { size: 12, fill: p.c('text.muted') }),
  ];
}

export function firstRunStorage(): Screen {
  const p = palette('light');
  const x = CARD.x + 48;
  const chips = ['Fern', 'Brick', 'Indigo', 'Plum', 'Amber'].map((pen, i) =>
    circle(x + 12 + i * 34, CARD.y + 500, 11, p.pen(pen), i === 0 ? p.c('text.primary') : undefined),
  );
  const body = [
    ...setupCard(
      p,
      3,
      'Where should OpenNote keep things?',
      'Your notes are plain files you own. Updates never touch them.',
    ),
    ...field(p, CARD.y + 196, 'Your notes', 'C:\\Users\\you\\Documents\\OpenNote', 'mono'),
    rect({ x: x + 512, y: CARD.y + 206, w: 112, h: 38 }, { stroke: p.c('border.control'), r: 8 }),
    text(x + 568, CARD.y + 230, 'Change…', { size: 14, fill: p.c('text.primary'), anchor: 'middle' }),
    text(x, CARD.y + 290, 'The app', { size: 14, weight: 600, fill: p.c('text.primary') }),
    ...radio(
      p,
      CARD.y + 322,
      'Add OpenNote to the Start menu (recommended)',
      'Moves OpenNote.exe to your user folder. No administrator rights needed.',
      true,
    ),
    ...radio(p, CARD.y + 368, 'Keep it where it is', 'Downloads\\OpenNote.exe', false),
    ...field(p, CARD.y + 410, 'Your first notebook', 'My notebook'),
    ...chips,
    ...buttons(p, 'Continue'),
    region({ x: x - 8, y: CARD.y + 180, w: 648, h: 76 }, 'Full path, wraps instead of cutting'),
    captionKeepOut(WIDE.width),
    tag(CARD.x + CARD.w + 16, CARD.y + 330, 'Step 4 (optional): import from OneNote or Evernote', NOTE.region),
  ];
  return makeScreen({
    file: '02-first-run-storage.svg',
    title: 'First run, step 3: where to keep things',
    background: p.c('surface.app'),
    body,
  });
}
