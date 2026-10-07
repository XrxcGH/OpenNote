// How wide a line of text is in the wireframes, from the advance widths of the fonts it falls back to on Windows:
// Segoe UI for the interface and Cambria for the page's reading text (the app's own Atkinson Hyperlegible Next and
// Literata ship inside the app, not with Windows, so a browser showing these SVGs and the PNGs rendered from them
// use the fallbacks). Labels, buttons, tools and highlights are sized from these numbers, so a pill fits its words
// and the gaps between tools are even. Widths are thousandths of the font size, for the characters from space to ~.

type Face = 'ui400' | 'ui600' | 'ui700' | 'reading400' | 'reading700' | 'reading400i';

/** Measured from the TrueType files with Pillow (ImageFont.getlength at 1000 px). */
const ADVANCE: Record<Face, number[]> = {
  ui400: [
    274, 284, 392, 591, 539, 818, 800, 230, 302, 302, 417, 684, 217, 400, 217, 390, 539, 539, 539, 539, 539, 539, 539,
    539, 539, 539, 217, 217, 684, 684, 684, 448, 955, 645, 573, 619, 701, 506, 488, 686, 710, 266, 357, 580, 471, 898,
    748, 754, 560, 754, 598, 531, 524, 687, 621, 934, 590, 553, 570, 302, 379, 302, 684, 415, 268, 509, 588, 462, 589,
    523, 313, 589, 566, 242, 242, 497, 242, 861, 566, 586, 588, 589, 348, 424, 339, 566, 479, 723, 459, 484, 452, 302,
    239, 302, 684,
  ],
  ui600: [
    275, 304, 438, 591, 555, 840, 715, 258, 332, 332, 434, 694, 241, 402, 241, 414, 555, 402, 555, 555, 576, 555, 558,
    536, 555, 558, 241, 241, 694, 694, 694, 444, 955, 671, 604, 621, 717, 518, 502, 697, 735, 292, 396, 611, 489, 924,
    767, 756, 584, 756, 623, 544, 552, 703, 642, 966, 619, 577, 587, 332, 405, 332, 694, 415, 289, 522, 603, 470, 603,
    531, 345, 603, 582, 261, 261, 525, 261, 886, 584, 597, 603, 603, 370, 431, 361, 584, 507, 756, 501, 508, 464, 332,
    278, 332, 694,
  ],
  ui700: [
    276, 327, 493, 592, 575, 867, 850, 293, 369, 369, 455, 707, 271, 404, 271, 443, 575, 575, 575, 575, 575, 575, 575,
    575, 575, 575, 271, 271, 707, 707, 707, 438, 954, 703, 641, 624, 737, 532, 520, 711, 766, 317, 445, 649, 511, 957,
    790, 758, 614, 758, 653, 561, 586, 723, 667, 1005, 655, 607, 607, 369, 436, 369, 707, 415, 314, 538, 620, 480, 619,
    541, 383, 619, 602, 284, 284, 559, 284, 916, 605, 611, 620, 619, 398, 440, 389, 605, 542, 797, 552, 538, 479, 369,
    326, 369, 707,
  ],
  reading400: [
    220, 286, 393, 619, 506, 890, 688, 237, 382, 382, 427, 554, 205, 332, 205, 490, 554, 554, 554, 554, 554, 554, 554,
    554, 554, 554, 264, 264, 554, 554, 554, 422, 885, 623, 611, 563, 662, 575, 537, 611, 687, 324, 307, 629, 537, 815,
    681, 653, 568, 653, 621, 496, 593, 648, 604, 921, 571, 570, 538, 350, 490, 350, 554, 371, 285, 488, 547, 441, 555,
    488, 303, 494, 552, 278, 266, 524, 271, 832, 558, 531, 556, 547, 414, 430, 338, 552, 504, 774, 483, 504, 455, 387,
    316, 387, 712,
  ],
  reading700: [
    220, 335, 422, 618, 543, 976, 740, 251, 408, 408, 453, 592, 232, 337, 232, 505, 592, 592, 592, 592, 592, 592, 592,
    592, 592, 592, 280, 280, 592, 592, 592, 452, 921, 652, 651, 573, 705, 578, 551, 646, 722, 350, 341, 682, 551, 846,
    679, 695, 614, 695, 662, 513, 639, 676, 634, 961, 619, 605, 566, 368, 505, 368, 592, 371, 285, 535, 591, 469, 597,
    531, 326, 520, 597, 314, 302, 592, 308, 890, 604, 569, 597, 591, 461, 459, 365, 597, 531, 798, 525, 531, 479, 393,
    320, 393, 592,
  ],
  reading400i: [
    220, 280, 389, 619, 488, 858, 659, 234, 372, 372, 415, 528, 199, 319, 199, 466, 528, 528, 528, 528, 528, 528, 528,
    528, 528, 528, 259, 259, 528, 528, 528, 407, 885, 588, 596, 540, 646, 568, 527, 585, 669, 320, 299, 603, 523, 792,
    671, 622, 555, 622, 590, 481, 574, 632, 575, 896, 545, 548, 512, 339, 466, 339, 528, 371, 271, 526, 521, 433, 524,
    457, 292, 522, 530, 271, 266, 497, 267, 799, 535, 507, 527, 521, 407, 382, 345, 535, 460, 728, 449, 460, 450, 375,
    315, 375, 528,
  ],
};

/** A character outside the table, such as an arrow or a check mark, is taken as this wide. */
const OTHER = 600;

export type FontKind = 'ui' | 'reading' | 'mono';

/** The face a browser picks for a weight: Segoe UI has 400, 600 and 700, and Cambria 400 and 700. */
function faceOf(font: FontKind, weight: number, italic: boolean): Face | null {
  if (font === 'mono') return null;
  if (font === 'reading') return weight >= 600 ? 'reading700' : italic ? 'reading400i' : 'reading400';
  return weight >= 700 ? 'ui700' : weight >= 600 ? 'ui600' : 'ui400';
}

/** The width of a run of text in pixels, at a font size in pixels. */
export function textWidth(content: string, size: number, weight = 400, font: FontKind = 'ui', italic = false): number {
  const face = faceOf(font, weight, italic);
  // Cambria's regular and italic carry hinted widths for small sizes, which round each character to a whole pixel.
  const whole = (face === 'reading400' || face === 'reading400i') && size <= HINTED;
  let total = 0;
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 0;
    // Cascadia Code and Consolas, the monospaced fallbacks, are 0.55 to 0.59 of the size wide.
    const advance = !face ? 570 : code >= 32 && code <= 126 ? ADVANCE[face][code - 32] : OTHER;
    total += whole ? Math.round((advance * size) / 1000) : (advance * size) / 1000;
  }
  return total;
}

/** The largest size in pixels at which a browser uses Cambria's hinted, whole-pixel widths. */
const HINTED = 20;
