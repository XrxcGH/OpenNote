// The weights a family really has, from the faces the shell lists (Docs' font weights menu), and the names that
// split "Segoe UI Semibold" into the family and a weight.
import type { FontFamily } from '../../platform/types';

export type WeightKey =
  | 'textFonts.weight100'
  | 'textFonts.weight200'
  | 'textFonts.weight300'
  | 'textFonts.weight400'
  | 'textFonts.weight500'
  | 'textFonts.weight600'
  | 'textFonts.weight700'
  | 'textFonts.weight800'
  | 'textFonts.weight900';

export interface WeightChoice {
  weight: number;
  key: WeightKey;
}

const NAMES: ReadonlyArray<readonly [number, readonly string[]]> = [
  [100, ['thin', 'hairline']],
  [200, ['extra light', 'extralight', 'ultra light', 'ultralight']],
  [300, ['light']],
  [400, ['regular', 'normal']],
  [500, ['medium']],
  [600, ['semi bold', 'semibold', 'demi bold', 'demibold', 'demi']],
  [700, ['bold']],
  [800, ['extra bold', 'extrabold', 'ultra bold', 'ultrabold']],
  [900, ['black', 'heavy']],
];

/** The weights of a family, lightest first, each with its message key ("Light", "Regular", "Semibold", "Bold"). */
export function weightsOf(family: FontFamily): WeightChoice[] {
  const seen = [...new Set(family.faces.map((face) => Math.round(face.weight / 100) * 100))].sort((a, b) => a - b);
  return seen
    .filter((weight) => weight >= 100 && weight <= 900)
    .map((weight) => ({ weight, key: `textFonts.weight${weight}` as WeightKey }));
}

/**
 * A name such as "Segoe UI Semibold", when "Segoe UI" is a family: the family and the weight. A name that is not
 * a family plus a weight word gives null. The document stores family plus weight (design section 2).
 */
export function splitWeightName(
  name: string,
  hasFamily: (name: string) => boolean,
): { family: string; weight: number } | null {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  for (const [weight, words] of NAMES) {
    for (const word of words) {
      if (!lower.endsWith(` ${word}`)) continue;
      const family = trimmed.slice(0, trimmed.length - word.length - 1).trim();
      if (family !== '' && hasFamily(family)) return { family, weight };
    }
  }
  return null;
}
