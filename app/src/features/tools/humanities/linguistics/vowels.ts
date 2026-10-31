// Vowel spaces from typed first and second formants, raw in hertz, as Lobanov z-scores, or on the Bark scale. A
// Lobanov score is z = (F − mean) / sd for each speaker and formant, with the sample standard deviation. Bark is
// Traunmüller's (1990) formula z = 26.81 f / (1960 + f) − 0.53.

export interface Token {
  vowel: string;
  f1: number;
  f2: number;
  speaker: string;
}

export type Scale = 'hz' | 'lobanov' | 'bark';

/** One token a line: the vowel, F1, F2, and an optional speaker, separated by spaces, commas, or tabs. */
export function parseFormants(text: string): Token[] {
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^vowel\b/i.test(l));
  if (rows.length === 0) throw new Error('empty');
  if (rows.length > 2000) throw new Error('tooMany');
  return rows.map((line) => {
    const parts = line.split(/[\s,;\t]+/);
    if (parts.length < 3) throw new Error('formantLine');
    const f1 = Number(parts[1]);
    const f2 = Number(parts[2]);
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) throw new Error('number');
    if (f1 <= 0 || f2 <= 0) throw new Error('positive');
    return { vowel: parts[0], f1, f2, speaker: parts[3] ?? '' };
  });
}

export const bark = (hz: number): number => (26.81 * hz) / (1960 + hz) - 0.53;

function meanSd(values: readonly number[]): [number, number] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return [mean, Math.sqrt(variance)];
}

/** Lobanov z-scores of one formant's values for one speaker. */
export function lobanov(values: readonly number[]): number[] {
  if (values.length < 2) throw new Error('fewTokens');
  const [mean, sd] = meanSd(values);
  if (sd === 0) throw new Error('noSpread');
  return values.map((v) => (v - mean) / sd);
}

export interface Normalized extends Token {
  x: number;
  y: number;
}

/** Each token's F1 and F2 on the chosen scale; Lobanov is worked out for each speaker on their own. */
export function normalize(tokens: readonly Token[], scale: Scale): Normalized[] {
  if (scale === 'hz') return tokens.map((t) => ({ ...t, x: t.f2, y: t.f1 }));
  if (scale === 'bark') return tokens.map((t) => ({ ...t, x: bark(t.f2), y: bark(t.f1) }));
  const out = tokens.map((t) => ({ ...t, x: 0, y: 0 }));
  for (const speaker of new Set(tokens.map((t) => t.speaker))) {
    const index = tokens.map((t, i) => (t.speaker === speaker ? i : -1)).filter((i) => i >= 0);
    const z1 = lobanov(index.map((i) => tokens[i].f1));
    const z2 = lobanov(index.map((i) => tokens[i].f2));
    index.forEach((i, k) => {
      out[i].y = z1[k];
      out[i].x = z2[k];
    });
  }
  return out;
}

/** The mean position of each vowel, for the labels of the chart. */
export function vowelMeans(points: readonly Normalized[]): { vowel: string; x: number; y: number; n: number }[] {
  const groups = new Map<string, Normalized[]>();
  for (const p of points) groups.set(p.vowel, [...(groups.get(p.vowel) ?? []), p]);
  return [...groups].map(([vowel, list]) => ({
    vowel,
    x: list.reduce((a, p) => a + p.x, 0) / list.length,
    y: list.reduce((a, p) => a + p.y, 0) / list.length,
    n: list.length,
  }));
}
