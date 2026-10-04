// The other three setup steps: the welcome desk (step 1), keys and pen (step 4), and bring in your notes (step 6).

import { type Palette, NOTE, captionKeepOut, palette, rect, region, tag, text } from '../lib/svg.ts';
import { WIDE, deskScene } from '../lib/chrome.ts';
import { button } from '../lib/parts.ts';
import { CARD, buttons, setupCard } from './first-run.ts';
import { type Screen, makeScreen } from './screen.ts';

function choice(p: Palette, y: number, label: string, detail: string, on: boolean): string {
  const box = { x: CARD.x + 34, y, w: CARD.w - 68, h: 76 };
  return [
    rect(box, {
      fill: on ? p.c('surface.selected') : p.c('surface.page'),
      stroke: p.c(on ? 'accent.primary' : 'border.subtle'),
      r: 10,
      width: on ? 3 : 1,
    }),
    text(box.x + 20, y + 32, label, { size: 15, weight: 600, fill: p.c('text.primary') }),
    text(box.x + 20, y + 54, detail, { size: 12, fill: p.c('text.secondary') }),
  ].join('');
}

export function firstRunWelcome(): Screen {
  const p = palette('light');
  const center = CARD.x + CARD.w / 2;
  const body = [
    ...setupCard(
      p,
      1,
      'Welcome to OpenNote',
      'A notebook for typing, handwriting, and recording. Your notes stay in files you own.',
    ),
    deskScene(p, center - 180, CARD.y + 190, 1.5),
    text(center, CARD.y + 520, 'Setup takes about a minute. You can change every choice later in Settings.', {
      size: 13,
      fill: p.c('text.muted'),
      anchor: 'middle',
    }),
    ...buttons(p, 'Get started').filter((part) => !part.includes('>Back<')),
    region({ x: center - 190, y: CARD.y + 184, w: 380, h: 240 }, 'Welcome desk 360×225, drawn at 240×150'),
    tag(CARD.x + CARD.w + 16, CARD.y + 230, 'The desk by the window', NOTE.region),
    tag(CARD.x + CARD.w + 16, CARD.y + 256, 'Drawings never sit on text', NOTE.region),
    tag(CARD.x + CARD.w + 16, CARD.y + 282, 'Backdrop: only the window light', NOTE.region),
    captionKeepOut(WIDE.width),
  ];
  return makeScreen({
    file: '16-first-run-welcome.svg',
    title: 'First run, step 1: welcome',
    background: p.c('surface.app'),
    body,
  });
}

export function firstRunKeys(): Screen {
  const p = palette('light');
  const body = [
    ...setupCard(p, 4, 'Keys and pen', 'Choose the shortcuts you know. You can change this in Settings.'),
    choice(p, CARD.y + 180, 'OpenNote', 'The shortcuts OpenNote is designed around.', true),
    choice(p, CARD.y + 272, 'OneNote', 'Keys keep the meaning they have in OneNote, such as Ctrl+E for search.', false),
    text(CARD.x + 48, CARD.y + 400, 'Pen top button', { size: 15, weight: 600, fill: p.c('text.primary') }),
    text(CARD.x + 48, CARD.y + 426, 'To open a quick note with the top button of your pen, choose OpenNote for the', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
    text(CARD.x + 48, CARD.y + 446, 'pen shortcut in Windows pen settings.', { size: 13, fill: p.c('text.secondary') }),
    button(p, CARD.x + 48, CARD.y + 466, 170, 'Open pen settings'),
    ...buttons(p, 'Continue'),
    region(CARD, 'Setup card 720×672, centered'),
    tag(CARD.x + CARD.w + 16, CARD.y + 220, 'Two sets; the list is in Settings', NOTE.region),
    tag(CARD.x + CARD.w + 16, CARD.y + 480, 'Opens Windows pen settings', NOTE.region),
    captionKeepOut(WIDE.width),
  ];
  return makeScreen({
    file: '16b-first-run-keys.svg',
    title: 'First run, step 4: keys and pen',
    background: p.c('surface.app'),
    body,
  });
}

export function firstRunImport(): Screen {
  const p = palette('light');
  const body = [
    ...setupCard(
      p,
      6,
      'Bring in your notes',
      'If your notes live in another app, OpenNote can bring them over. Nothing changes there.',
    ),
    choice(
      p,
      CARD.y + 180,
      'Start with a new notebook',
      'You can import notes any time with Import notes in the Home tab.',
      true,
    ),
    choice(
      p,
      CARD.y + 272,
      'Bring in notes when setup is done',
      'OpenNote opens the Import window, and checks what will come over first.',
      false,
    ),
    text(
      CARD.x + 48,
      CARD.y + 400,
      'OpenNote reads Word, Excel, PowerPoint, and OpenDocument files, OneNote exports,',
      {
        size: 13,
        fill: p.c('text.secondary'),
      },
    ),
    text(CARD.x + 48, CARD.y + 420, 'It also reads Evernote, Notion, Joplin, Google Keep, and Windows Sticky Notes.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
    ...buttons(p, 'Start taking notes'),
    region(CARD, 'Setup card 720×672, centered'),
    tag(CARD.x + CARD.w + 16, CARD.y + 220, 'Nothing is added before a review', NOTE.region),
    captionKeepOut(WIDE.width),
  ];
  return makeScreen({
    file: '16c-first-run-import.svg',
    title: 'First run, step 6: bring in your notes',
    background: p.c('surface.app'),
    body,
  });
}
