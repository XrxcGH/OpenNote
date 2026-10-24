// The pens: brand colors, tools, and the width a pen draws at a point.

export {
  alphaOf,
  CUSTOM_SLOT,
  FIRST_HIGHLIGHTER_SLOT,
  FIRST_PEN_SLOT,
  HIGHLIGHTERS,
  PALETTE,
  paletteByName,
  paletteEntry,
  parseHex,
  PENS,
  resolveColor,
  slotsForTool,
  toCss,
} from './palette';
export type { ColorScheme, PaletteEntry, PaletteKind, Rgba } from './palette';
export {
  codeOfTool,
  DEFAULT_WIDTH_MM,
  isHighlighter,
  isKnownToolCode,
  MAX_WIDTH_MM,
  MIN_WIDTH_MM,
  mmToPage,
  pageToMm,
  TOOL_CODES,
  toolFromCode,
  WIDTH_PRESETS_MM,
} from './tools';
export {
  eraserHoverPreview,
  maxWidthFactor,
  minWidthFactor,
  NEUTRAL_PRESSURE,
  penHoverPreview,
  pressureForFactor,
  widthAt,
} from './width';
export type { HoverPreview, WidthOptions } from './width';
