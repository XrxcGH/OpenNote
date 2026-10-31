// Pitch arithmetic shared by the music tools: MIDI numbers, frequencies, cents, and the nearest equal-tempered note.

export const A4_HZ = 440;

/** Frequency of the note with an MIDI number: f = A4 × 2^((m − 69) / 12). */
export const midiToHz = (midi: number, a4 = A4_HZ): number => a4 * 2 ** ((midi - 69) / 12);

/** The (fractional) MIDI number of a frequency. */
export const hzToMidi = (hz: number, a4 = A4_HZ): number => 69 + 12 * Math.log2(hz / a4);

/** Size of a frequency ratio in cents: 1200 × log2(ratio). */
export const centsOf = (ratio: number): number => 1200 * Math.log2(ratio);

/** The frequency ratio of an interval in cents. */
export const ratioOf = (cents: number): number => 2 ** (cents / 1200);

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** The name and octave for an MIDI number, such as C4 for 60. */
export function midiName(midi: number, flats = false): string {
  const rounded = Math.round(midi);
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export interface NearestNote {
  name: string;
  midi: number;
  /** How far the pitch is above (+) or below (−) that note, in cents. */
  cents: number;
}

/** The equal-tempered note closest to a frequency, with the offset in cents. */
export function nearestNote(hz: number, a4 = A4_HZ): NearestNote {
  const exact = hzToMidi(hz, a4);
  const midi = Math.round(exact);
  return { name: midiName(midi), midi, cents: (exact - midi) * 100 };
}

/** Reads a frequency ratio written 3/2, 3:2, or 1.5; null when it is not a positive ratio. */
export function parseRatio(text: string): number | null {
  const t = text.trim();
  const pair = /^(\d*\.?\d+)\s*[/:]\s*(\d*\.?\d+)$/.exec(t);
  if (pair) {
    const [a, b] = [Number(pair[1]), Number(pair[2])];
    return a > 0 && b > 0 ? a / b : null;
  }
  return /^\d*\.?\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
}
