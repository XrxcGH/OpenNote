// The colors kit plots and sketches draw with. On screen they are the theme's tokens, so light and dark both work.
// On paper (a picture inserted into the page) they are the light theme's values from brand/tokens.json on the page
// color, so the picture reads the same in any theme and when printed.
import { tokens } from '../../../../theme/tokens';

export interface Palette {
  text: string;
  muted: string;
  grid: string;
  page: string;
  /** Series pens in order: indigo, brick, fern, plum, amber, walnut. */
  pens: readonly string[];
}

const PEN_NAMES = ['Indigo', 'Brick', 'Fern', 'Plum', 'Amber', 'Walnut'] as const;
const light = tokens.color.light;
const penColor = (name: string): string =>
  tokens.ink.pens.find((pen) => pen.name === name)?.light ?? light.text.primary;

export const PAPER: Palette = {
  text: light.text.primary,
  muted: light.text.secondary,
  grid: light.border.subtle,
  page: light.surface.page,
  pens: PEN_NAMES.map(penColor),
};

export const SCREEN: Palette = {
  text: 'var(--color-text-primary)',
  muted: 'var(--color-text-secondary)',
  grid: 'var(--color-border-subtle)',
  page: 'var(--color-surface-page)',
  pens: PEN_NAMES.map((name) => `var(--ink-${name.toLowerCase()})`),
};

export const paletteOf = (name: 'screen' | 'paper' = 'paper'): Palette => (name === 'screen' ? SCREEN : PAPER);
