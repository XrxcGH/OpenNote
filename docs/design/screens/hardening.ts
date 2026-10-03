// Phase 13: the crash report consent screen, the self-check, and the feedback file review.

import { type Palette, circle, line, palette, rect, text } from '../lib/svg.ts';
import { WIDE, titleBar } from '../lib/chrome.ts';
import { type Screen, makeScreen } from './screen.ts';

const TOP = WIDE.title;

/** The workspace behind a dialog, dimmed. */
function backdrop(p: Palette): string[] {
  return [
    titleBar(p, { breadcrumb: 'Settings' }),
    rect({ x: 0, y: TOP, w: WIDE.width, h: WIDE.height - TOP }, { fill: p.c('surface.page') }),
    rect({ x: 0, y: TOP, w: WIDE.width, h: WIDE.height - TOP }, { fill: p.c('surface.scrim'), opacity: 0.55 }),
  ];
}

function card(p: Palette, x: number, y: number, w: number, h: number): string {
  return rect({ x, y, w, h }, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 14, shadow: true });
}

function button(p: Palette, at: { x: number; y: number; w: number }, label: string, primary: boolean): string {
  const { x, y, w } = at;
  const box = rect(
    { x, y, w, h: 40 },
    primary ? { fill: p.c('accent.primary'), r: 8 } : { stroke: p.c('border.control'), r: 8, width: 1.5 },
  );
  const fill = primary ? p.c('text.onAccent') : p.c('text.primary');
  return box + text(x + w / 2, y + 25, label, { size: 14, weight: 600, fill, anchor: 'middle' });
}

function bullet(p: Palette, x: number, y: number, mark: string, label: string): string {
  const color = mark === '✓' ? p.c('status.success') : p.c('status.danger');
  return (
    text(x, y, mark, { size: 14, weight: 600, fill: color }) +
    text(x + 22, y, label, { size: 13, fill: p.c('text.primary') })
  );
}

/** Crash reports: the consent screen, with the example report open. */
export function crashConsent(): Screen {
  const p = palette('light');
  const x = 340;
  const y = 70;
  const col2 = x + 380;
  const sample = [
    '"kind": "exception",',
    '"app_version": "1.0.0",',
    '"os": "Windows 10.0.26200 x86_64",',
    '"exception_code": "0xc0000005",',
    '"frames": [ { "module": "opennote.exe", "offset": "0x1a2b3c" } ]',
  ];
  const body = [
    ...backdrop(p),
    card(p, x, y, 760, 740),
    text(x + 32, y + 52, 'Save crash reports on this computer?', { size: 22, weight: 600, fill: p.c('text.primary') }),
    text(x + 32, y + 88, 'If OpenNote stops working, it can save a short report that helps fix the cause.', {
      size: 14,
      fill: p.c('text.primary'),
    }),
    text(x + 32, y + 110, 'Nothing is saved unless you turn this on.', { size: 14, fill: p.c('text.primary') }),
    text(x + 32, y + 156, 'What a report holds', { size: 15, weight: 600, fill: p.c('text.primary') }),
    bullet(p, x + 32, y + 184, '✓', 'Where in the program the crash happened'),
    bullet(p, x + 32, y + 208, '✓', 'The versions of OpenNote and Windows'),
    bullet(p, x + 32, y + 232, '✓', 'When it happened'),
    text(col2, y + 156, 'What a report never holds', { size: 15, weight: 600, fill: p.c('text.primary') }),
    bullet(p, col2, y + 184, '✕', 'Your notes, page titles, or anything you typed'),
    bullet(p, col2, y + 208, '✕', 'File, folder, or notebook names'),
    bullet(p, col2, y + 232, '✕', 'Your name or your computer name'),
    text(x + 32, y + 284, 'A report stays on this computer. You read each one first,', {
      size: 14,
      fill: p.c('text.primary'),
    }),
    text(x + 32, y + 306, 'and you choose each time whether to send it.', { size: 14, fill: p.c('text.primary') }),
    text(x + 32, y + 350, '▾ Hide the example report', { size: 14, weight: 600, fill: p.c('text.link') }),
    rect(
      { x: x + 32, y: y + 366, w: 696, h: 172 },
      { fill: p.c('surface.sunken'), stroke: p.c('border.subtle'), r: 8 },
    ),
    ...sample.map((line, i) =>
      text(x + 52, y + 396 + i * 26, line, { size: 13, font: 'mono', fill: p.c('text.primary') }),
    ),
    button(p, { x: x + 32, y: y + 572, w: 296 }, 'Turn on crash reports', true),
    button(p, { x: x + 344, y: y + 572, w: 296 }, 'Keep crash reports off', false),
    text(x + 32, y + 650, 'You can change this at any time in Settings, under Privacy.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
    text(x + 32, y + 690, 'Escape closes this screen and keeps crash reports off.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
  ];
  return makeScreen({
    file: '13-crash-report-consent.svg',
    title: 'Crash reports: the consent screen with an example report open',
    background: p.c('surface.app'),
    body,
  });
}

interface Row {
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  title: string;
  summary: string;
}

const STATUS_LABEL = { pass: 'OK', warn: 'Needs attention', fail: 'Problem', skipped: 'Not checked' };

function statusIcon(p: Palette, x: number, y: number, status: Row['status']): string {
  const colors = { pass: 'status.success', warn: 'status.warning', fail: 'status.danger', skipped: 'border.control' };
  const glyph = { pass: '✓', warn: '!', fail: '✕', skipped: '–' };
  return (
    circle(x, y, 13, p.c(colors[status])) +
    text(x, y + 5, glyph[status], { size: 14, weight: 700, fill: p.c('surface.page'), anchor: 'middle' })
  );
}

/** Check OpenNote: the self-check. */
export function selfCheck(): Screen {
  const p = palette('light');
  const x = 270;
  const y = 70;
  const rows: Row[] = [
    { status: 'pass', title: 'Space for your notes', summary: '184.2 GB free.' },
    {
      status: 'warn',
      title: 'Space for updates and backups',
      summary: '240 MB free. Free up some space soon, so saves and updates keep working.',
    },
    { status: 'pass', title: 'Saving in the notebook folder', summary: 'OpenNote can save in this folder.' },
    {
      status: 'warn',
      title: 'Where the notebook is stored',
      summary: 'The notebook is on a NTFS drive. OneDrive syncs this folder.',
    },
    { status: 'fail', title: 'The notebook', summary: '2 problems found in 412 files checked.' },
    { status: 'pass', title: 'Updates', summary: 'Last checked today.' },
    { status: 'pass', title: 'Crash reports', summary: 'No crash reports are saved.' },
  ];
  const body = [
    ...backdrop(p),
    card(p, x, y, 900, 760),
    text(x + 32, y + 52, 'Check OpenNote', { size: 22, weight: 600, fill: p.c('text.primary') }),
    text(x + 32, y + 86, '2 things need attention.', { size: 16, weight: 600, fill: p.c('text.primary') }),
    text(x + 32, y + 110, 'Checked Oct 2, 2026 at 2:05 PM.', { size: 13, fill: p.c('text.secondary') }),
    button(p, { x: x + 738, y: y + 70, w: 130 }, 'Check again', false),
  ];
  rows.forEach((row, i) => {
    const top = y + 140 + i * 70;
    body.push(
      line([x + 32, top], [x + 868, top], p.c('border.subtle')),
      statusIcon(p, x + 50, top + 34, row.status),
      text(x + 82, top + 28, row.title, { size: 15, weight: 600, fill: p.c('text.primary') }),
      text(x + 82, top + 50, row.summary, { size: 13, fill: p.c('text.secondary') }),
      text(x + 868, top + 28, STATUS_LABEL[row.status], {
        size: 13,
        weight: 600,
        fill: p.c('text.primary'),
        anchor: 'end',
      }),
    );
  });
  body.push(
    text(x + 32, y + 716, 'This check changes nothing. Nothing leaves this computer.', {
      size: 13,
      fill: p.c('text.muted'),
    }),
  );
  return makeScreen({
    file: '14-self-check.svg',
    title: 'Check OpenNote: seven checks, each with a status in words',
    background: p.c('surface.app'),
    body,
  });
}

/** Send feedback: reviewing the file before it is saved. */
export function feedbackReview(): Screen {
  const p = palette('light');
  const x = 220;
  const y = 70;
  const parts: [string, string][] = [
    ['What you wrote', '34 characters'],
    ['System', '14 lines'],
    ['Self-check', '7 checks'],
    ['Recent log lines', '312 lines'],
    ['Crash reports', 'Not included'],
  ];
  const sample = [
    'OpenNote feedback bundle',
    'Made: 2026-10-02T21:05:00Z',
    '',
    'Contents',
    '- What you wrote: 34 characters, as you wrote them',
    '- System: 14 lines',
    '- Recent log lines: 312 lines, 9 things removed',
    '',
    'Removed from this file: 6 paths, 3 pieces of quoted text',
    '',
    '=== System ===',
    'OpenNote: 1.0.0-beta.2',
    'Windows: Windows 10.0.26200 x86_64',
  ];
  const body = [
    ...backdrop(p),
    card(p, x, y, 1000, 760),
    text(x + 32, y + 52, 'Review before saving', { size: 22, weight: 600, fill: p.c('text.primary') }),
    text(x + 32, y + 84, 'This is exactly what the file will hold.', { size: 14, fill: p.c('text.primary') }),
    rect(
      { x: x + 32, y: y + 108, w: 600, h: 560 },
      { fill: p.c('surface.sunken'), stroke: p.c('border.subtle'), r: 8 },
    ),
    ...sample.map((row, i) =>
      text(x + 52, y + 140 + i * 28, row, { size: 13, font: 'mono', fill: p.c('text.primary') }),
    ),
    rect({ x: x + 616, y: y + 124, w: 6, h: 220 }, { fill: p.c('border.control'), r: 3 }),
    text(x + 664, y + 132, 'In this file', { size: 15, weight: 600, fill: p.c('text.primary') }),
  ];
  parts.forEach(([title, count], i) => {
    const row = y + 168 + i * 44;
    const included = count !== 'Not included';
    body.push(
      text(x + 664, row, title, { size: 14, fill: p.c(included ? 'text.primary' : 'text.muted') }),
      text(x + 664, row + 20, count, { size: 13, fill: p.c('text.secondary') }),
    );
  });
  body.push(
    rect({ x: x + 664, y: y + 408, w: 304, h: 76 }, { fill: p.c('accent.primarySubtle'), r: 8 }),
    text(x + 680, y + 436, '9 things were removed and replaced', { size: 13, fill: p.c('text.primary') }),
    text(x + 680, y + 458, 'by marks such as <path>.', { size: 13, fill: p.c('text.primary') }),
    button(p, { x: x + 664, y: y + 628, w: 150 }, 'Save the file', true),
    button(p, { x: x + 830, y: y + 628, w: 138 }, 'Back', false),
    text(x + 32, y + 716, 'OpenNote does not send this file. You attach it to your report yourself.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
  );
  return makeScreen({
    file: '15-feedback-review.svg',
    title: 'Send feedback: reviewing the whole file before it is saved',
    background: p.c('surface.app'),
    body,
  });
}
