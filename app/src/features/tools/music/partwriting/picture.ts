// A small picture of the four voices on a grand staff, with a dashed box around each chord that has a problem.
import { diatonic, noteName, parseNote } from '../theory/notes';
import type { Note } from '../theory/notes';
import type { Chord } from './chorale';

const GAP = 6;
const COLUMN = 46;
const LEFT = 36;
const TREBLE_BOTTOM = 70;
const BASS_BOTTOM = 150;
const E4 = diatonic(parseNote('E4')!);
const G2 = diatonic(parseNote('G2')!);

const accidental = (alt: number): string => (alt === 0 ? '' : alt > 0 ? '♯'.repeat(alt) : '♭'.repeat(-alt));

function staff(bottom: number, width: number): string {
  let lines = '';
  for (let i = 0; i < 5; i++) {
    const y = bottom - i * GAP;
    lines += `<line x1="8" y1="${y}" x2="${width - 8}" y2="${y}"/>`;
  }
  return lines;
}

function noteHead(n: Note, x: number, bottom: number, base: number): string {
  const position = diatonic(n) - base;
  const y = bottom - (position * GAP) / 2;
  let ledger = '';
  for (let p = -2; p >= position; p -= 2) ledger += `<line x1="${x - 8}" y1="${bottom - (p * GAP) / 2}" x2="${x + 8}" y2="${bottom - (p * GAP) / 2}"/>`;
  for (let p = 10; p <= position; p += 2) ledger += `<line x1="${x - 8}" y1="${bottom - (p * GAP) / 2}" x2="${x + 8}" y2="${bottom - (p * GAP) / 2}"/>`;
  const acc = n.alt === 0 ? '' : `<text x="${x - 17}" y="${y + 4}" font-size="11" stroke="none" fill="currentColor">${accidental(n.alt)}</text>`;
  return `${ledger}<ellipse cx="${x}" cy="${y}" rx="5.2" ry="3.6" fill="currentColor" stroke="none" transform="rotate(-18 ${x} ${y})"/>${acc}`;
}

export function chordPicture(chords: readonly Chord[], bad: ReadonlySet<number>, label: string): string {
  const width = LEFT + chords.length * COLUMN + 16;
  const height = 196;
  let body = `<g fill="none" stroke="currentColor" stroke-width="1">${staff(TREBLE_BOTTOM, width)}${staff(BASS_BOTTOM, width)}</g>`;
  body += `<text x="10" y="${TREBLE_BOTTOM - 3}" font-size="30" fill="currentColor">𝄞</text><text x="10" y="${BASS_BOTTOM - 8}" font-size="26" fill="currentColor">𝄢</text>`;
  chords.forEach((chord, k) => {
    const x = LEFT + 14 + k * COLUMN;
    body += `<g stroke="currentColor" stroke-width="1">`;
    body += noteHead(chord[0], x + 8, TREBLE_BOTTOM, E4) + noteHead(chord[1], x - 6, TREBLE_BOTTOM, E4);
    body += noteHead(chord[2], x + 8, BASS_BOTTOM, G2) + noteHead(chord[3], x - 6, BASS_BOTTOM, G2);
    body += `</g>`;
    body += `<text x="${x + 1}" y="${height - 6}" font-size="10" text-anchor="middle" fill="currentColor">${k + 1}</text>`;
    if (bad.has(k + 1)) {
      body += `<rect x="${x - 26}" y="12" width="${COLUMN - 4}" height="${BASS_BOTTOM + 28 - 12}" rx="4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    }
  });
  const desc = chords.map((c, k) => `${k + 1}: ${c.map((n) => noteName(n)).join(' ')}`).join('; ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}" ` +
    `font-family="serif"><title>${label}</title><desc>${desc}</desc>${body}</svg>`
  );
}
