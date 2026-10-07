// Dialogs, Settings sections, and tool windows as built in beta 4: recording options, import, export, on-device
// intelligence, privacy, Connectors, and the timer, calculator, and Upcoming windows.

import { type Palette, NOTE, circle, palette, rect, region, tag, text, textLines } from '../lib/svg.ts';
import {
  BODY_TOP,
  EDITOR_X,
  HOME_TOOLS,
  WIDE,
  editorBackground,
  pageHeader,
  propertiesChip,
  standardWindow,
  windowAnnotations,
} from '../lib/chrome.ts';
import {
  SETTINGS_NAV_W,
  button,
  card,
  chip,
  field,
  row,
  scrim,
  settingsFrame,
  switchRow,
  toggle,
} from '../lib/parts.ts';
import { type Screen, makeScreen } from './screen.ts';
import { PAGES, tree } from './workspace.ts';

const CRUMB = 'Biology 101 › Lectures › Mitosis';

function backdrop(p: Palette, recording?: string): string[] {
  const x = EDITOR_X + 48;
  return [
    ...standardWindow(p, {
      title: { breadcrumb: CRUMB, recording },
      tab: 'Home',
      tools: HOME_TOOLS,
      tree: tree(p),
      pages: PAGES.map((item) => ({ ...item, selected: item.title === 'Mitosis' })),
    }),
    editorBackground(p),
    propertiesChip(p, WIDE.width - 52, BODY_TOP + 8),
    pageHeader(p, x, BODY_TOP + 64, 'Mitosis'),
    textLines(x, BODY_TOP + 130, [520, 470, 500, 420], p.c('border.control'), 24),
  ];
}

function finish(file: string, title: string, p: Palette, body: string[]): Screen {
  return makeScreen({ file, title, background: p.c('surface.app'), body });
}

export function recordingOptions(): Screen {
  const p = palette('light');
  const x = EDITOR_X + 48;
  const pop = { x: 290, y: BODY_TOP + 2, w: 320, h: 200 };
  const y = BODY_TOP + 250;
  const body = [
    ...backdrop(p),
    rect(pop, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 12, shadow: true }),
    text(pop.x + 20, pop.y + 32, 'Recording options', { size: 15, weight: 600, fill: p.c('text.primary') }),
    text(pop.x + 20, pop.y + 58, 'Microphone', { size: 12, fill: p.c('text.secondary') }),
    field(p, pop.x + 20, pop.y + 66, 280, 'Default microphone', true),
    text(pop.x + 160, pop.y + 124, 'Look again', { size: 12, weight: 600, fill: p.c('text.link'), anchor: 'middle' }),
    text(pop.x + 20, pop.y + 152, 'Also record sound from this PC', { size: 13, fill: p.c('text.primary') }),
    toggle(p, pop.x + 260, pop.y + 136, false),
    text(pop.x + 20, pop.y + 176, 'Tell everyone before you record a meeting.', { size: 11, fill: p.c('text.muted') }),
    rect({ x, y, w: 700, h: 120 }, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 12 }),
    circle(x + 28, y + 28, 7, p.c('status.recording')),
    text(x + 44, y + 33, 'Recording, 12:48', { size: 14, weight: 600, fill: p.c('text.primary') }),
    button(p, x + 480, y + 12, 96, 'Pause'),
    button(p, x + 584, y + 12, 96, 'Stop'),
    ...Array.from({ length: 48 }, (_, i) =>
      rect(
        { x: x + 24 + i * 7, y: y + 76 - ((i * 7) % 13), w: 3, h: ((i * 7) % 13) * 2 + 4 },
        { fill: p.c('text.muted'), r: 1.5 },
      ),
    ),
    ...windowAnnotations(),
    tag(pop.x + 560, pop.y + 34, 'Record and Options sit side by side', NOTE.region),
    tag(pop.x + 560, pop.y + 60, 'Nothing records until Record is pressed', NOTE.region),
    tag(x, y - 16, 'While recording, a recording block takes the audio\u2019s place in the page', NOTE.region),
    tag(x, y + 148, 'What you write while recording is time-stamped; Alt+click a word to hear it', NOTE.region),
    tag(x, y + 174, 'The title bar shows Recording and the time; select it for the controls', NOTE.region),
    region({ x: 1104, y: 6, w: 130, h: 28 }, ''),
  ];
  return finish('24-recording-options.svg', 'Recording options and the recording block', p, body);
}

export function importDialog(): Screen {
  const p = palette('light');
  const a = { x: 130, y: 120, w: 560, h: 600 };
  const b = { x: 750, y: 120, w: 560, h: 600 };
  const sources = [
    'Markdown folders from Obsidian, Joplin, and Logseq',
    'Evernote exports (.enex)',
    'Notion exports',
    'Word documents (.docx), including OneNote exports',
    'Web pages (.html, .htm), text, and CSV files',
    'Exports from Google Keep and Bear, and Windows sticky notes',
  ];
  const body = [
    ...backdrop(p),
    scrim(p),
    card(p, a, 'Import notes'),
    text(a.x + 24, a.y + 76, 'Choose what to import', { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(a.x + 24, a.y + 100, 'Choose a file or folder exported from another app.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
    text(a.x + 24, a.y + 120, 'OpenNote checks it first and adds nothing until you say so.', {
      size: 13,
      fill: p.c('text.secondary'),
    }),
    button(p, a.x + 24, a.y + 144, 140, 'Choose a file…', 'primary'),
    button(p, a.x + 174, a.y + 144, 150, 'Choose a folder…'),
    text(a.x + 24, a.y + 214, 'What you can import', { size: 14, weight: 600, fill: p.c('text.primary') }),
    ...sources
      .map((s, i) => [
        circle(a.x + 32, a.y + 244 + i * 28, 3, p.c('text.muted')),
        text(a.x + 44, a.y + 249 + i * 28, s, { size: 13, fill: p.c('text.secondary') }),
      ])
      .flat(),
    button(p, a.x + a.w - 104, a.y + a.h - 58, 80, 'Close', 'quiet'),
    card(p, b, 'Import notes'),
    text(b.x + 24, b.y + 76, '5 pages will come into a new notebook called "Recipes".', {
      size: 14,
      weight: 600,
      fill: p.c('text.primary'),
    }),
    text(b.x + 24, b.y + 100, 'Evernote export: Recipes.enex', { size: 12, fill: p.c('text.secondary') }),
    text(b.x + 24, b.y + 124, '4 pictures and files (12.2 MB)', { size: 12, fill: p.c('text.secondary') }),
    text(b.x + 24, b.y + 156, '2 sections', { size: 12, weight: 600, fill: p.c('text.secondary') }),
    row(p, b.x + 24, b.y + 164, b.w - 48, 'Recipes', '3 pages', true),
    row(p, b.x + 24, b.y + 222, b.w - 48, 'Travel', '2 pages'),
    text(b.x + 24, b.y + 304, 'What will change', { size: 14, weight: 600, fill: p.c('text.primary') }),
    row(p, b.x + 24, b.y + 316, b.w - 48, 'Not imported', 'Reminders have no place in OpenNote yet.'),
    row(p, b.x + 24, b.y + 376, b.w - 48, 'Simplified', 'Text colors outside the pens became the nearest pen.'),
    text(b.x + 24, b.y + 470, 'Add an "Import report" page to the notebook', { size: 13, fill: p.c('text.primary') }),
    toggle(p, b.x + b.w - 64, b.y + 453, false),
    button(p, b.x + 24, b.y + b.h - 58, 80, 'Cancel', 'quiet'),
    button(p, b.x + b.w - 296, b.y + b.h - 58, 150, 'Choose another'),
    button(p, b.x + b.w - 130, b.y + b.h - 58, 106, 'Import', 'primary'),
    ...windowAnnotations(),
    tag(a.x, a.y + a.h + 24, 'Step 1: pick a file or folder. Nothing is added yet', NOTE.region),
    tag(
      b.x,
      b.y + b.h + 24,
      'Step 2: the review says what comes over and what does not. Import adds it with progress and Cancel',
      NOTE.region,
    ),
  ];
  return finish('25-import.svg', 'Import notes: choose, then review', p, body);
}

export function exportDialog(): Screen {
  const p = palette('light');
  const d = { x: 410, y: 70, w: 620, h: 760 };
  const formats: [string, string, boolean][] = [
    ['Markdown files', 'A folder of .md files, with pictures in an assets folder.', false],
    ['Web pages', 'A folder of .html pages with an index.', false],
    ['One web page', 'A single .html file with the pictures inside it.', false],
    ['Word document', 'One .docx file with headings, lists, tables, and pictures.', true],
    ['PowerPoint slides', 'One .pptx file. Headings and divider lines start new slides.', false],
    ['Tables as an Excel workbook', 'One .xlsx file with a sheet for each table.', false],
  ];
  const body = [
    ...backdrop(p),
    // The window's own zones are drawn under the dialog, which covers the pages pane's resize handle.
    ...windowAnnotations(),
    scrim(p),
    card(p, d, 'Export "Lectures"'),
    text(d.x + 24, d.y + 70, 'Choose what to export', { size: 14, weight: 600, fill: p.c('text.primary') }),
    chip(p, d.x + 24, d.y + 84, 'This section: "Lectures"', true, 190),
    chip(p, d.x + 226, d.y + 84, 'The whole notebook: "Biology 101"', false, 250),
    text(d.x + 24, d.y + 148, 'Choose a format', { size: 14, weight: 600, fill: p.c('text.primary') }),
    ...formats.flatMap(([name, detail, on], i) => [
      rect(
        { x: d.x + 24, y: d.y + 160 + i * 66, w: d.w - 48, h: 58 },
        {
          fill: on ? p.c('surface.selected') : 'none',
          stroke: p.c(on ? 'accent.primary' : 'border.subtle'),
          r: 8,
          width: on ? 2 : 1,
        },
      ),
      text(d.x + 40, d.y + 184 + i * 66, name, { size: 14, weight: 600, fill: p.c('text.primary') }),
      text(d.x + 40, d.y + 204 + i * 66, detail, { size: 12, fill: p.c('text.secondary') }),
    ]),
    text(d.x + 24, d.y + 580, 'Where to save it', { size: 14, weight: 600, fill: p.c('text.primary') }),
    text(d.x + 24, d.y + 606, 'C:\\Users\\you\\Documents', { size: 13, fill: p.c('text.secondary'), font: 'mono' }),
    button(p, d.x + d.w - 184, d.y + 586, 160, 'Choose a folder…'),
    button(p, d.x + 24, d.y + d.h - 62, 80, 'Cancel', 'quiet'),
    button(p, d.x + d.w - 130, d.y + d.h - 62, 106, 'Export', 'primary'),
    tag(d.x + d.w + 20, d.y + 100, 'Opens from the tree\u2019s right-click menu: Export…', NOTE.region),
    tag(d.x + d.w + 20, d.y + 130, 'Page, section, or notebook; the formats follow', NOTE.region),
    tag(d.x + d.w + 20, d.y + 160, 'Export shows progress, then a summary', NOTE.region),
  ];
  return finish('26-export.svg', 'The Export dialog', p, body);
}

function page(p: Palette, active: string, build: (x: number, w: number) => string[]): string[] {
  const x = SETTINGS_NAV_W + 48;
  return [...settingsFrame(p, active), ...build(x, 760)];
}

function heading(p: Palette, x: number, title: string, intro: string): string[] {
  const top = WIDE.title;
  return [
    text(x, top + 62, title, { size: 26, weight: 700, fill: p.c('text.primary'), font: 'reading' }),
    rect({ x, y: top + 74, w: 48, h: 2 }, { fill: p.c('accent.clay') }),
    text(x, top + 104, intro, { size: 13, fill: p.c('text.secondary') }),
  ];
}

export function intelligenceSettings(): Screen {
  const p = palette('light');
  const top = WIDE.title;
  const features: [string, string][] = [
    ['Text in images', 'Finds words in pictures and screenshots, so you can copy and search them.'],
    ['Handwriting', 'Turns handwriting into text you can copy and search, using Windows recognition.'],
    ['Read aloud', 'Reads a page in a voice installed on Windows, highlighting each word.'],
    ['Summaries and keywords', 'Picks the sentences and keywords that best stand for a page. It writes nothing new.'],
  ];
  const body = [
    ...page(p, 'On-device intelligence', (x, w) => [
      ...heading(
        p,
        x,
        'On-device intelligence',
        'These features read your notes on this computer. Nothing is sent anywhere. Each one stays off until you turn it on.',
      ),
      ...features.flatMap(([name, hint], i) => [
        rect(
          { x, y: top + 130 + i * 92, w, h: 80 },
          { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 10 },
        ),
        switchRow(p, x + 20, top + 140 + i * 92, w - 40, name, hint, false),
        text(x + 20, top + 194 + i * 92, 'Off · Runs on this device. Nothing leaves it.', {
          size: 11,
          fill: p.c('text.muted'),
        }),
      ]),
      text(x, top + 530, 'Models', { size: 15, weight: 600, fill: p.c('text.primary') }),
      text(x, top + 554, 'Some features need a model, a file that is downloaded once and then used on this device.', {
        size: 13,
        fill: p.c('text.secondary'),
      }),
      text(x, top + 574, 'You choose which. The size is shown first, and nothing downloads until you choose it.', {
        size: 13,
        fill: p.c('text.secondary'),
      }),
      text(x, top + 614, 'Speech to text', { size: 15, weight: 600, fill: p.c('text.primary') }),
      text(x, top + 638, 'Turn a recording into a transcript. Choose one model.', {
        size: 13,
        fill: p.c('text.secondary'),
      }),
    ]),
    tag(1050, top + 140, 'Every feature starts off', NOTE.region),
    tag(1050, top + 166, 'Each runs on this device', NOTE.region),
    tag(1050, top + 192, 'A choice survives a restart', NOTE.region),
    tag(1050, top + 218, 'Status: on and ready, or why not', NOTE.region),
  ];
  return finish('27-settings-intelligence.svg', 'Settings: on-device intelligence', p, body);
}

export function privacySettings(): Screen {
  const p = palette('light');
  const top = WIDE.title;
  const uses: [string, string, string][] = [
    [
      'Update checks',
      'OpenNote asks the update server whether a newer version exists, and downloads it when you allow it.',
      'Has not run yet.',
    ],
    [
      'Sending a crash report',
      'Only when you press Send on a report you have read, and only if an address is set.',
      'No address is set, so a report can only stay on this computer.',
    ],
    ['Model downloads', 'Models for on-device features, only when you choose one.', 'Has not run yet.'],
    [
      'Saving a web image you paste',
      'OpenNote can download the picture to keep it in the page.',
      'Runs only when you paste, never in the background.',
    ],
  ];
  const body = [
    ...page(p, 'Privacy', (x, w) => [
      ...heading(
        p,
        x,
        'Privacy',
        'OpenNote works on your computer and sends nothing unless you ask it to. This page lists every kind of network use it has.',
      ),
      text(x, top + 150, 'Work offline', { size: 14, weight: 600, fill: p.c('text.primary') }),
      text(x, top + 170, 'Blocks everything listed below. Your notes are not affected.', {
        size: 12,
        fill: p.c('text.secondary'),
      }),
      toggle(p, x + w - 40, top + 142, false),
      text(x, top + 214, 'Network use', { size: 15, weight: 600, fill: p.c('text.primary') }),
      ...uses.flatMap(([name, hint, state], i) => [
        text(x, top + 248 + i * 76, name, { size: 14, weight: 600, fill: p.c('text.primary') }),
        text(x, top + 268 + i * 76, hint.length > 96 ? `${hint.slice(0, 93)}...` : hint, {
          size: 12,
          fill: p.c('text.secondary'),
        }),
        text(x, top + 286 + i * 76, state, { size: 11, fill: p.c('text.muted') }),
      ]),
      text(x, top + 570, 'Crash reports and checks', { size: 15, weight: 600, fill: p.c('text.primary') }),
      text(x, top + 594, 'Crash reports are off. Each saved report can be read before anything is sent.', {
        size: 13,
        fill: p.c('text.secondary'),
      }),
      button(p, x, top + 612, 150, 'Check OpenNote'),
      button(p, x + 162, top + 612, 180, 'Turn on crash reports'),
    ]),
    tag(1050, top + 150, 'Work offline blocks every use below at once', NOTE.region),
    tag(1050, top + 250, 'Each use says what it sends and when', NOTE.region),
    tag(1050, top + 612, 'Check OpenNote: the self-check, in words', NOTE.region),
  ];
  return finish('28-settings-privacy.svg', 'Settings: privacy', p, body);
}

export function connectorsSettings(): Screen {
  const p = palette('light');
  const top = WIDE.title;
  const groups: [string, string, string][] = [
    [
      'Microsoft',
      'Import notebooks from OneNote, open meeting notes from Outlook events, and sync Microsoft To Do.',
      'Needs setup',
    ],
    [
      'Google',
      'Meeting notes from Calendar events, Google Tasks, Classroom assignments, Drive, and YouTube captions.',
      'Needs setup',
    ],
    ['Dropbox', 'Send a page, a section, or a selection to a Dropbox folder.', 'Needs setup'],
  ];
  const body = [
    ...page(p, 'Connectors', (x, w) => [
      ...heading(
        p,
        x,
        'Connectors',
        'Connect an account so a feature can use that service. Everything here is off until you connect it.',
      ),
      field(p, x, top + 124, w, 'Search connectors'),
      ...groups.flatMap(([name, detail, state], i) => {
        const y = top + 182 + i * 150;
        return [
          text(x, y, name, { size: 15, weight: 600, fill: p.c('text.primary') }),
          rect({ x, y: y + 12, w, h: 112 }, { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 10 }),
          text(x + 20, y + 42, name, { size: 14, weight: 600, fill: p.c('text.primary') }),
          text(x + w - 20, y + 42, state, { size: 12, fill: p.c('text.muted'), anchor: 'end' }),
          text(x + 20, y + 64, detail.length > 100 ? `${detail.slice(0, 97)}...` : detail, {
            size: 12,
            fill: p.c('text.secondary'),
          }),
          button(p, x + 20, y + 78, 150, 'Show setup steps', 'primary'),
          button(p, x + 182, y + 78, 210, 'Open the connectors folder'),
        ];
      }),
    ]),
    tag(1050, top + 190, 'A connector with no client ID says Needs setup', NOTE.region),
    tag(1050, top + 216, 'Nothing signs in until you ask', NOTE.region),
    tag(1050, top + 242, 'Setup steps explain registering the app', NOTE.region),
  ];
  return finish('29-settings-connectors.svg', 'Settings: connectors', p, body);
}

function toolWindow(p: Palette, x: number, y: number, w: number, h: number, title: string): string {
  return [
    card(p, { x, y, w, h }, title, false),
    text(x + w - 64, y + 36, 'Keep on top', { size: 12, fill: p.c('text.link'), anchor: 'end' }),
    text(x + w - 24, y + 36, '✕', { size: 14, fill: p.c('text.secondary'), anchor: 'end' }),
  ].join('');
}

export function toolWindows(): Screen {
  const p = palette('light');
  // The timer card ends 22 px below its Add timer button, like the calculator, and the button 22 px below the field.
  const t = { x: 480, y: BODY_TOP + 20, w: 300, h: 404 };
  const c = { x: 800, y: BODY_TOP + 20, w: 300, h: 540 };
  const u = { x: 1120, y: BODY_TOP + 20, w: 300, h: 420 };
  const keys = ['sin', 'cos', 'tan', 'ln', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−'];
  const body = [
    ...backdrop(p),
    toolWindow(p, t.x, t.y, t.w, t.h, 'Timers'),
    text(t.x + 24, t.y + 76, 'Timer 1', { size: 12, fill: p.c('text.secondary') }),
    text(t.x + 24, t.y + 128, '5:00', { size: 40, weight: 600, fill: p.c('text.primary'), font: 'mono' }),
    text(t.x + t.w - 24, t.y + 76, 'Running', { size: 12, fill: p.c('text.muted'), anchor: 'end' }),
    button(p, t.x + 24, t.y + 148, 80, 'Pause'),
    button(p, t.x + 114, t.y + 148, 80, 'Reset'),
    text(t.x + 24, t.y + 216, 'Kind', { size: 12, fill: p.c('text.secondary') }),
    field(p, t.x + 24, t.y + 224, t.w - 48, 'Countdown', true),
    text(t.x + 24, t.y + 284, 'Minutes', { size: 12, fill: p.c('text.secondary') }),
    field(p, t.x + 24, t.y + 292, 110, '5'),
    button(p, t.x + 24, t.y + t.h - 56, t.w - 48, 'Add timer', 'primary'),
    toolWindow(p, c.x, c.y, c.w, c.h, 'Calculator'),
    text(c.x + 24, c.y + 70, 'Expression', { size: 12, fill: p.c('text.secondary') }),
    field(p, c.x + 24, c.y + 78, c.w - 48, '5 km to mi'),
    text(c.x + 24, c.y + 140, '= 3.10685596119', { size: 14, weight: 600, fill: p.c('text.primary'), font: 'mono' }),
    ...keys.map((k, i) => {
      const kx = c.x + 24 + (i % 4) * 66;
      const ky = c.y + 168 + Math.floor(i / 4) * 44;
      return [
        '<g data-fit="4" data-center="both">',
        rect({ x: kx, y: ky, w: 58, h: 36 }, { stroke: p.c('border.control'), r: 8 }),
        text(kx + 29, ky + 23, k, { size: 13, fill: p.c('text.primary'), anchor: 'middle' }),
        '</g>',
      ].join('');
    }),
    text(c.x + 24, c.y + 372, 'History', { size: 12, weight: 600, fill: p.c('text.secondary') }),
    text(c.x + 24, c.y + 396, '2pi * 3', { size: 12, fill: p.c('text.secondary'), font: 'mono' }),
    text(c.x + c.w - 24, c.y + 396, '= 18.8495559215', {
      size: 12,
      fill: p.c('text.secondary'),
      font: 'mono',
      anchor: 'end',
    }),
    button(p, c.x + 24, c.y + c.h - 56, c.w - 48, 'Calculate', 'primary'),
    toolWindow(p, u.x, u.y, u.w, u.h, 'Upcoming'),
    text(u.x + 24, u.y + 70, 'Task and when it is due', { size: 12, fill: p.c('text.secondary') }),
    field(p, u.x + 24, u.y + 78, u.w - 48, 'Read chapter 4 Fri 5 PM'),
    text(u.x + 24, u.y + 140, 'Repeat', { size: 12, fill: p.c('text.secondary') }),
    field(p, u.x + 24, u.y + 148, u.w - 48, 'Does not repeat', true),
    button(p, u.x + 24, u.y + 200, 110, 'Add a task', 'primary'),
    button(p, u.x + 144, u.y + 200, 130, 'Import a file'),
    // Two lines, so the words stay inside the 252 px between the card's margins.
    text(u.x + 24, u.y + 266, 'Nothing due yet. Add a task, or import', { size: 12, fill: p.c('text.muted') }),
    text(u.x + 24, u.y + 286, 'a calendar file.', { size: 12, fill: p.c('text.muted') }),
    text(u.x + 24, u.y + 336, 'Remind me with a Windows notification', { size: 12, fill: p.c('text.primary') }),
    text(u.x + 24, u.y + 356, 'when something is due', { size: 12, fill: p.c('text.primary') }),
    toggle(p, u.x + 236, u.y + 338, false),
    ...windowAnnotations(),
    tag(
      480,
      BODY_TOP + 590,
      'Open from the command palette (Ctrl+K): Open timers, Open calculator, Open upcoming',
      NOTE.region,
    ),
    tag(
      480,
      BODY_TOP + 616,
      'Each works with the keyboard alone, keeps its state on this device, and closes with Escape',
      NOTE.region,
    ),
    tag(480, BODY_TOP + 642, 'Keep on top stops the window going behind the page', NOTE.region),
  ];
  return finish('30-tool-windows.svg', 'The timer, calculator, and Upcoming windows', p, body);
}
