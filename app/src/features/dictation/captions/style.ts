// The look of captions: Windows' own settings when the shell can read them, and calm defaults from the theme
// otherwise (A2-25). The person already chose size, font, and colors for captions everywhere; the strip follows.
import type { CSSProperties } from 'react';

/** What the shell reads from Windows. Colors are `#rrggbb`, opacities run from 0 to 1. */
export interface CaptionStyle {
  fontColor: string;
  fontOpacity: number;
  scale: number;
  family: 'serif' | 'sans' | 'mono' | 'casual' | 'cursive' | 'small-caps';
  backgroundColor: string;
  backgroundOpacity: number;
  regionColor: string;
  regionOpacity: number;
}

const FAMILIES: Record<CaptionStyle['family'], string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'inherit',
  mono: 'ui-monospace, Consolas, monospace',
  casual: '"Segoe Print", "Comic Sans MS", cursive',
  cursive: '"Segoe Script", cursive',
  'small-caps': 'inherit',
};

// checks-disable-next-line brand-consistency: this pattern accepts the colors Windows reports; it is not a design color.
const HEX = /^#[0-9a-f]{6}$/i;

/** A color with an opacity as CSS. A value that is not a color is dropped, never passed on. */
export function withAlpha(color: string, opacity: number): string | undefined {
  if (!HEX.test(color)) return undefined;
  const alpha = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));
  // checks-disable-next-line brand-consistency: this is a color Windows reports for captions, not a design color.
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** The inline style of the caption text and its box for a Windows style, or none to use the theme. */
export function captionCss(style: CaptionStyle | null | undefined): { text: CSSProperties; box: CSSProperties } {
  if (!style) return { text: {}, box: {} };
  const family = FAMILIES[style.family] ?? 'inherit';
  const scale = Math.min(2.5, Math.max(0.5, Number.isFinite(style.scale) ? style.scale : 1));
  const text: CSSProperties = {
    fontSize: `${scale}em`,
    fontFamily: family,
    ...(style.family === 'small-caps' ? { fontVariantCaps: 'small-caps' as const } : {}),
  };
  const color = withAlpha(style.fontColor, style.fontOpacity);
  if (color) text.color = color;
  const box: CSSProperties = {};
  // The window behind the words (region) wins over the highlight behind each line, which is shown as the box.
  const region = withAlpha(style.regionColor, style.regionOpacity);
  const background = withAlpha(style.backgroundColor, style.backgroundOpacity);
  const fill = style.regionOpacity > 0 ? region : background;
  if (fill) box.background = fill;
  return { text, box };
}
