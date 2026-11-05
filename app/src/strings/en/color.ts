// The one color palette: theme colors, standard colors, recent colors, and More colors.
// Owner: shared:x-palette (B10). shared:x-shared registered it in the string index.

export const color = {
  palette: 'Colors',
  automatic: 'Automatic',
  none: 'No color',
  themeColors: 'Theme colors',
  standardColors: 'Standard colors',
  recentColors: 'Recent colors',
  moreColors: 'More colors',
  /** A tint or shade, such as "Indigo, lighter 40%". */
  swatchLighter: '{name}, lighter {percent}%',
  swatchDarker: '{name}, darker {percent}%',
  /** A recent color, named by its value. */
  recentSwatch: 'Recent color {hex}',
  hex: 'Hex',
  hexError: 'Enter a color as #RRGGBB.',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  hue: 'Hue',
  saturation: 'Saturation',
  lightness: 'Lightness',
  apply: 'Apply',
  eyedropper: 'Pick from screen',
  contrastGood: 'Contrast {ratio} to 1, passes for text',
  contrastLow: 'Contrast {ratio} to 1, low for text',
} as const;
