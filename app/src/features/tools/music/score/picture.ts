// A plain engraving of a tune as SVG: a staff for each voice with clef, key signature, meter, notes, rests, ties, and
// bar lines, wrapped into systems. It uses the current text color, so it follows the theme.
import { diatonic, noteName, parseNote } from '../theory/notes';
import type { Note } from '../theory/notes';
import { midiOf } from '../theory/notes';
import type { Item, Tune, Voice } from './abc';

const GAP = 6;
const WIDTH = 620;
const LEFT = 16;
const QUARTER = 26;
const STAFF_HEIGHT = 130;

const accidentalGlyph = (written: string): string =>
  ({ '^': '♯', '^^': '𝄪', _: '♭', __: '𝄫', '=': '♮' })[written] ?? '';

const SHARPS: Record<'treble' | 'bass', string[]> = {
  treble: ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'],
  bass: ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'],
};
const FLATS: Record<'treble' | 'bass', string[]> = {
  treble: ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'],
  bass: ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2'],
};

const base = (clef: 'treble' | 'bass'): number => diatonic(parseNote(clef === 'treble' ? 'E4' : 'G2')!);

function clefOf(voice: Voice): 'treble' | 'bass' {
  const midis = voice.items.flatMap((i) => (i.kind === 'note' ? i.pitches.map(midiOf) : []));
  if (midis.length === 0) return 'treble';
  return midis.reduce((a, b) => a + b, 0) / midis.length < 57 ? 'bass' : 'treble';
}

const itemWidth = (item: Item): number => (item.kind === 'bar' ? 10 : Math.max(20, Math.min(120, item.dur * 4 * QUARTER)));

function noteGlyph(item: Item, x: number, top: number, clef: 'treble' | 'bass'): string {
  const bottom = top + 4 * GAP;
  const y = (n: Note): number => bottom - ((diatonic(n) - base(clef)) * GAP) / 2;
  if (item.kind === 'bar') return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="currentColor"/>`;
  if (item.kind === 'rest') {
    const mid = top + 2 * GAP;
    if (item.dur >= 0.5) return `<rect x="${x - 5}" y="${item.dur >= 1 ? mid - GAP : mid}" width="10" height="3" fill="currentColor"/>`;
    return `<path d="M${x - 3} ${mid - 6} l6 5 l-5 5 l5 4" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
  }
  const sorted = [...item.pitches].sort((a, b) => midiOf(a) - midiOf(b));
  const mean = sorted.reduce((s, p) => s + y(p), 0) / sorted.length;
  const stemUp = mean >= top + 2 * GAP;
  let out = '';
  const filled = item.dur < 0.5;
  for (const p of sorted) {
    const py = y(p);
    for (let ledger = bottom + GAP; ledger <= py + 0.1; ledger += GAP) out += `<line x1="${x - 8}" y1="${ledger}" x2="${x + 8}" y2="${ledger}" stroke="currentColor"/>`;
    for (let ledger = top - GAP; ledger >= py - 0.1; ledger -= GAP) out += `<line x1="${x - 8}" y1="${ledger}" x2="${x + 8}" y2="${ledger}" stroke="currentColor"/>`;
    const glyph = accidentalGlyph(p.written);
    if (glyph) out += `<text x="${x - 18}" y="${py + 4}" font-size="12" fill="currentColor">${glyph}</text>`;
    out += `<ellipse cx="${x}" cy="${py}" rx="5.2" ry="3.7" transform="rotate(-18 ${x} ${py})" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor"/>`;
  }
  if (item.dur < 1) {
    const high = y(sorted[sorted.length - 1]!);
    const low = y(sorted[0]!);
    const sx = stemUp ? x + 5 : x - 5;
    const end = stemUp ? high - 22 : low + 22;
    out += `<line x1="${sx}" y1="${stemUp ? low : high}" x2="${sx}" y2="${end}" stroke="currentColor"/>`;
    const flags = item.dur <= 0.125 + 1e-9 ? (item.dur <= 0.0625 + 1e-9 ? 2 : 1) : 0;
    for (let f = 0; f < flags; f++) {
      const fy = end + (stemUp ? f * 5 : -f * 5);
      out += `<path d="M${sx} ${fy} q6 ${stemUp ? 4 : -4} 4 ${stemUp ? 10 : -10}" fill="none" stroke="currentColor"/>`;
    }
  }
  const dotted = [1.5, 0.75, 0.375, 0.1875].some((d) => Math.abs(item.dur - d) < 1e-9);
  if (dotted) out += `<circle cx="${x + 11}" cy="${y(sorted[sorted.length - 1]!) - 2}" r="1.5" fill="currentColor"/>`;
  if (item.tied) out += `<path d="M${x + 4} ${y(sorted[0]!) + 8} q${itemWidth(item) / 2} 9 ${itemWidth(item)} 0" fill="none" stroke="currentColor"/>`;
  return out;
}

export function scorePicture(tune: Tune, voices: readonly Voice[], label: string): string {
  let y = 14;
  let body = '';
  const header = tune.title ? `<text x="${WIDTH / 2}" y="12" text-anchor="middle" font-size="13" fill="currentColor">${escapeXml(tune.title)}</text>` : '';
  if (header) y += 14;
  for (const voice of voices) {
    const clef = clefOf(voice);
    const marks = tune.key.fifths > 0 ? SHARPS[clef].slice(0, tune.key.fifths) : FLATS[clef].slice(0, -tune.key.fifths);
    let system = 0;
    let x = LEFT + 44 + marks.length * 9 + 22;
    const top = (): number => y + system * STAFF_HEIGHT + 30;
    const startSystem = (): string => {
      const t = top();
      const lines = Array.from({ length: 5 }, (_, i) => `<line x1="${LEFT}" y1="${t + i * GAP}" x2="${WIDTH - LEFT}" y2="${t + i * GAP}" stroke="currentColor"/>`).join('');
      const sig = marks
        .map((m, i) => {
          const n = parseNote(m)!;
          const py = t + 4 * GAP - ((diatonic(n) - base(clef)) * GAP) / 2;
          return `<text x="${LEFT + 36 + i * 9}" y="${py + 4}" font-size="13" fill="currentColor">${tune.key.fifths > 0 ? '♯' : '♭'}</text>`;
        })
        .join('');
      const meter =
        system === 0
          ? `<text x="${LEFT + 40 + marks.length * 9}" y="${t + 2 * GAP - 1}" font-size="13" font-weight="bold" fill="currentColor">${tune.meter.num}</text><text x="${LEFT + 40 + marks.length * 9}" y="${t + 4 * GAP}" font-size="13" font-weight="bold" fill="currentColor">${tune.meter.den}</text>`
          : '';
      const glyph = clef === 'treble' ? '𝄞' : '𝄢';
      return `${lines}<text x="${LEFT + 2}" y="${t + 4 * GAP + (clef === 'treble' ? 2 : -2)}" font-size="${clef === 'treble' ? 34 : 28}" fill="currentColor">${glyph}</text>${sig}${meter}<line x1="${LEFT}" y1="${t}" x2="${LEFT}" y2="${t + 4 * GAP}" stroke="currentColor"/>`;
    };
    body += startSystem();
    for (const item of voice.items) {
      const w = itemWidth(item);
      if (x + w > WIDTH - LEFT) {
        system++;
        x = LEFT + 44 + marks.length * 9 + 10;
        body += startSystem();
      }
      body += noteGlyph(item, x + w / 2, top(), clef);
      x += w;
    }
    body += `<line x1="${WIDTH - LEFT}" y1="${top()}" x2="${WIDTH - LEFT}" y2="${top() + 4 * GAP}" stroke="currentColor" stroke-width="2"/>`;
    y += (system + 1) * STAFF_HEIGHT;
  }
  const desc = voices
    .map((v) => `${v.id}: ${v.items.filter((i) => i.kind === 'note').map((i) => (i.kind === 'note' ? noteName(i.pitches[0]!) : '')).join(' ')}`)
    .join('; ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${y}" role="img" aria-label="${escapeXml(label)}" font-family="serif">` +
    `<title>${escapeXml(label)}</title><desc>${escapeXml(desc)}</desc>${header}${body}</svg>`
  );
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
