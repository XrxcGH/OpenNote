// Study tools: a flashcard and a quiz embedded in a page, and the panel that generates them.

import { type Palette, line, palette, rect, region, tag, text, textLines, NOTE } from '../lib/svg.ts';
import { BODY_TOP, EDITOR_X, editorBackground, standardWindow, windowAnnotations } from '../lib/chrome.ts';
import { type Screen, makeScreen } from './screen.ts';

const X = EDITOR_X + 64;
const Y = BODY_TOP + 140;

function pill(p: Palette, x: number, y: number, label: string, on = false): string {
  const w = label.length * 7 + 24;
  const fill = on ? p.c('accent.primarySubtle') : 'none';
  const color = p.c(on ? 'text.link' : 'text.primary');
  return (
    '<g data-fit="6" data-center="both">' +
    rect({ x, y, w, h: 28 }, { fill, stroke: p.c('border.control'), r: 14 }) +
    text(x + w / 2, y + 19, label, { size: 13, fill: color, anchor: 'middle' }) +
    '</g>'
  );
}

function flashcard(p: Palette): string {
  const parts = [
    rect(
      { x: X, y: Y, w: 380, h: 250 },
      { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 12, shadow: true },
    ),
    text(X + 20, Y + 30, 'Flashcard · 3 of 12 due', { size: 12, fill: p.c('text.muted') }),
    text(X + 20, Y + 70, 'What does the nucleus do?', { size: 20, weight: 600, fill: p.c('text.primary') }),
    line([X + 20, Y + 96], [X + 360, Y + 96], p.c('border.subtle')),
    text(X + 20, Y + 130, 'Stores DNA and controls the cell.', { size: 16, fill: p.c('text.primary') }),
    text(X + 20, Y + 180, 'How well did you know it?', { size: 12, fill: p.c('text.muted') }),
  ];
  ['Again', 'Hard', 'Good', 'Easy'].forEach((label, i) =>
    parts.push(pill(p, X + 20 + i * 84, Y + 196, label, i === 2)),
  );
  return parts.join('');
}

function quiz(p: Palette): string {
  const x = X + 400;
  const options = ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi body'];
  const parts = [
    rect(
      { x, y: Y, w: 340, h: 250 },
      { fill: p.c('surface.raised'), stroke: p.c('border.subtle'), r: 12, shadow: true },
    ),
    text(x + 20, Y + 30, 'Quiz · question 2 of 5', { size: 12, fill: p.c('text.muted') }),
    text(x + 20, Y + 62, 'Which organelle makes ATP?', { size: 17, weight: 600, fill: p.c('text.primary') }),
  ];
  options.forEach((option, i) => {
    const oy = Y + 82 + i * 36;
    const correct = i === 1;
    parts.push(
      rect(
        { x: x + 20, y: oy, w: 300, h: 30 },
        {
          fill: correct ? p.c('accent.primarySubtle') : 'none',
          stroke: p.c(correct ? 'accent.primary' : 'border.subtle'),
          r: 8,
        },
      ),
    );
    parts.push(text(x + 34, oy + 20, `${'ABCD'[i]}   ${option}`, { size: 13, fill: p.c('text.primary') }));
    if (correct)
      parts.push(text(x + 306, oy + 20, '✓', { size: 14, weight: 700, fill: p.c('status.success'), anchor: 'end' }));
  });
  return parts.join('');
}

function generatePanel(p: Palette): string {
  const y = Y + 290;
  const parts = [
    rect({ x: X, y, w: 740, h: 170 }, { fill: p.c('surface.sunken'), r: 12 }),
    text(X + 20, y + 32, 'Generate study cards', { size: 16, weight: 600, fill: p.c('text.primary') }),
    text(X + 20, y + 62, 'From', { size: 13, fill: p.c('text.secondary') }),
    pill(p, X + 70, y + 44, 'This page', true),
    pill(p, X + 180, y + 44, 'Lecture 6 recording', true),
    pill(p, X + 350, y + 44, 'Whole section'),
    text(X + 20, y + 102, 'Make', { size: 13, fill: p.c('text.secondary') }),
    pill(p, X + 70, y + 84, 'Flashcards', true),
    pill(p, X + 182, y + 84, 'Quiz', true),
    pill(p, X + 248, y + 84, 'Fill in the blank'),
    pill(p, X + 400, y + 84, 'Image occlusion'),
    text(X + 20, y + 146, 'Cards stay editable. Runs on this device.', { size: 12, fill: p.c('text.muted') }),
    rect({ x: X + 600, y: y + 122, w: 120, h: 34 }, { fill: p.c('accent.primary'), r: 8 }),
    text(X + 660, y + 144, 'Generate', { size: 14, weight: 600, fill: p.c('text.onAccent'), anchor: 'middle' }),
  ];
  return parts.join('');
}

export function studyTools(): Screen {
  const p = palette('light');
  const tree = [
    { label: 'Biology 101', depth: 0, kind: 'notebook' as const, color: p.pen('Fern') },
    { label: 'Lectures', depth: 1, kind: 'section' as const, color: p.pen('Fern'), selected: true },
  ];
  const pages = [
    { title: 'Cell structure: review', meta: '12 cards · 3 due today', selected: true },
    { title: 'Lecture 6: Enzymes', meta: 'Recording · 20 cards' },
  ];
  const body = [
    ...standardWindow(p, {
      title: { breadcrumb: 'Biology 101  ›  Lectures  ›  Cell structure: review' },
      tab: 'Insert',
      tools: [{ label: '▢ Flashcard' }, { label: '? Quiz', active: true }, { label: '▦ Table' }, { label: '∑ Math' }],
      tree,
      pagesHeading: 'Lectures',
      pages,
    }),
    editorBackground(p),
    text(X, BODY_TOP + 70, 'Cell structure: review', { size: 30, weight: 600, fill: p.c('text.primary') }),
    textLines(X, BODY_TOP + 96, [420, 360], p.c('border.control')),
    flashcard(p),
    quiz(p),
    generatePanel(p),
    ...windowAnnotations(),
    region({ x: X - 4, y: Y - 4, w: 388, h: 258 }, ''),
    region({ x: X + 396, y: Y - 4, w: 348, h: 258 }, ''),
    tag(X, Y + 480, 'Flashcard 380×250 and quiz 340×250 are page blocks; they export to Anki or CSV', NOTE.region),
    tag(X, Y + 504, 'Due counts show in the page list, so review is one click away', NOTE.region),
  ];
  return makeScreen({
    file: '11-study-tools.svg',
    title: 'Flashcards, quizzes, and card generation',
    background: p.c('surface.app'),
    body,
  });
}
