// The outlines of the drawings as plain data: path strings and numbers, with no styles and no React. The components
// in this folder draw them with the app's tokens. The wireframe generator (docs/design) draws the same strings for
// the social preview and the welcome step's picture, so the app and its pictures cannot drift apart. Edit a shape
// here and both follow. Each drawing is in its own box, and DESK says where the parts stand in the desk scene.

/** The arched window, drawn in a 100 x 103 box. */
export const WINDOW = {
  box: [100, 103],
  sky: 'M6.2 96 5.8 47C6 22.5 27 4.3 50.2 4 73.2 4.4 93.6 22 94.2 47.2L93.8 96Z',
  sun: { cx: 72, cy: 72, r: 9.5 },
  /** Six stars, each a zero-length stroke that the round cap turns into a dot. */
  stars: 'M20 36h.1M37 21h.1M63 17h.1M88 47h.1M40 70h.1M66 66h.1',
  moon: 'M77 24.5A11 11 0 1 0 82 42 9 9 0 1 1 77 24.5Z',
  hills: 'M7 78C20 73.5 30 80 46 76.5S72 72 93 77.5L93 95.3H7Z',
  bars: 'M50 4.2V96M6 56.4C30 55.6 70 57.2 94 56.2',
  /** The vine twines in and out of the frame down the left of the arch. */
  vine: [
    'M37.5 3.8C35.9 5.2 31.7 10.2 28 12.3 24.3 14.4 18 13.6 15.4 16.4 12.9 19.2 14.6 25.5 12.7 29.3',
    '10.8 33.1 5 35.9 4.2 39.4 3.4 42.9 7.9 47.5 8.1 50.4 8.3 53.4 5.9 55.9 5.5 57',
  ].join(' '),
  /** Each leaf is two curves from a point on the vine to its tip. */
  leaves: [
    'M37.5 3.8Q40.5 6.7 42.4 2.9Q39.3 0 37.5 3.8Z',
    'M28 12.3Q26.7 16.7 31.2 17.4Q32.5 13 28 12.3Z',
    'M15.4 16.4Q15.5 11.9 11 12.4Q10.9 16.9 15.4 16.4Z',
    'M12.7 29.3Q16.7 31.5 18.3 27.3Q14.4 25.1 12.7 29.3Z',
    'M4.2 39.4Q8.5 38.7 7 34.7Q2.6 35.3 4.2 39.4Z',
    'M8.1 50.4Q9.5 54.6 13.3 52.3Q11.8 48.2 8.1 50.4Z',
    'M5.5 57Q2.6 60.3 6.4 62.4Q9.3 59.1 5.5 57Z',
  ],
  sill: 'M1.5 96.5H98.5V101.5H1.5Z',
} as const;

/** The potted plant with a trailing vine, drawn in a 56 x 66 box. Nothing hangs below the pot's base. */
export const PLANT = {
  box: [56, 66],
  pot: 'M20 45H44L41.5 62.5C36 63.6 28 63.6 22.5 62.5Z',
  /** The lowest point of the pot, the middle of its curved base. A plant stands with this on its surface. */
  base: 63.325,
  rim: 'M17.5 44.6C28 43.6 37 43.6 46.5 44.6',
  stem: 'M32 44C31.4 34 32.4 23 32 12',
  trailing: 'M21.5 46C15.5 49.5 18 55.6 12.4 59 9 61 6 62.4 2.6 62.6',
  leaves: [
    'M32 35C24 35.6 19 30.6 18 23.4 26 22.6 31 27.6 32 35Z',
    'M32 25C40 25.6 45 20.6 46 13.4 38 12.6 33 17.6 32 25Z',
    'M32 12.6C28 8.6 28.6 3.6 32 1.4 35.4 3.6 36 8.6 32 12.6Z',
  ],
  trailingLeaves: [
    'M16.6 51.6Q14.9 47.6 11 49.5Q12.7 53.6 16.6 51.6Z',
    'M10.4 60.4Q14 58.2 11.4 55Q7.7 57.1 10.4 60.4Z',
    'M4.6 62.4Q5.8 58.5 1.7 58.3Q0.5 62.2 4.6 62.4Z',
  ],
} as const;

/** The stack of four books, drawn in a 64 x 40 box, bottom book first. */
export const BOOKS = {
  box: [64, 40],
  books: [
    'M2.5 37.6C20 38.3 44 38.2 61.5 37.5L62 29.8C44 29.2 20 29.3 2 30Z',
    'M9 29.6C24 29.9 42 29.8 58 29.4L57.6 22C42 22.4 24 22.3 8.6 22Z',
    'M5.5 21.8C20 22.2 36 22.1 49.6 21.7L49.2 15C36 15.4 20 15.3 5.2 15Z',
    'M12.4 15.1C24 15.4 36 15.4 46.2 15.1L45.8 8.8C36 9.2 24 9.1 12 8.8Z',
  ],
  spines: 'M7 30.2v7.4m3.4-7.5v7.6m43.2-15.5v7.3m-3.2-7.2v7.2M10 15.2v6.6m3.4-6.6v6.7M42.8 9v6.1m-3-6v6',
  bookmark: 'M44 29.8V35.6L45.8 34.4 47.6 35.6V29.8',
} as const;

/** The lit candle in a clay dish, drawn in a 28 x 58 box. */
export const CANDLE = {
  box: [28, 58],
  halo: { cx: 14, cy: 12, r: 16 },
  flame: 'M14 4.6C17.8 9.6 18.2 14.6 14.2 17.8 10.2 14.8 10.4 9.8 14 4.6Z',
  wick: 'M14 18.4V22',
  body: 'M9 22.6C12 21.8 16 22 19 22.5L19.2 54.2C16 54.9 12 54.8 8.8 54.1Z',
  shine: 'M16.2 22.8C16.4 26.4 16 28.2 14.8 28.6',
  dish: 'M3 51C8 56.2 20 56.4 25 51.2',
  base: 'M8 56H20',
} as const;

/** The open notebook, drawn in a 64 x 40 box. It rests on its spine, the lowest point of its cover. */
export const NOTEBOOK = {
  box: [64, 40],
  cover: 'M1.6 13V36.8C14 34 24 34.6 32 39.4 40 34.6 50 34 62.4 36.8V13Z',
  left: 'M3 9C14 6 24 7 32 12V37C24 32 14 31.4 3 34.4Z',
  right: 'M61 9C50 6 40 7 32 12V37C40 32 50 31.4 61 34.4Z',
  lines: 'M9 15.6C14 15 18.6 16 24 18.6M9 21.4C14 20.8 18.6 21.8 24 24.4M9 27.2C12 26.8 14 27.2 16 28',
  stroke: 'M39.6 20.6C44 15.6 47 24.4 50.4 19.6S55 19 56 17.6',
  dot: { cx: 57, cy: 17, r: 1.8 },
} as const;

/**
 * The desk scene, drawn in a 240 x 150 box. The desk slab's top edge is the line everything on the desk stands on,
 * and the window sill is the line the plant stands on. Each part is placed by a translation and a scale.
 */
export const DESK = {
  box: [240, 150],
  /** The y of the desk's top edge. */
  top: 128.4,
  slab: 'M10 128.4H230V135.4H10ZM22 136V148m196-12v12',
  window: { at: [75, 2], scale: 0.9 },
  plant: { at: [76, 38], scale: 0.8 },
  books: { at: [20, 90.3], scale: 1 },
  notebook: { at: [98, 96.88], scale: 0.8 },
  candle: { at: [176, 72.4], scale: 1 },
  shortCandle: { at: [203, 88.08], scale: 0.72 },
} as const;
