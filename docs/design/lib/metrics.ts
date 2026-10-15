// How wide a line of text is in the wireframes. Each number is the wider of two advance widths: the font the SVGs fall
// back to on Windows (Segoe UI for the interface, Cambria for the page's reading text) and the app's own Atkinson
// Hyperlegible Next and Literata, which the layout check measures in. A browser or a PNG shows one or the other, so a
// pill sized from these numbers fits its words in both. Labels, buttons, tools, and highlights are sized from them, so
// the gaps between tools are even. Widths are thousandths of the font size, for the characters from space to ~.

type Face = 'ui400' | 'ui600' | 'ui700' | 'reading400' | 'reading700' | 'reading400i';

/** Measured from the TrueType files with Pillow (ImageFont.getlength at 1000 px). */
const ADVANCE: Record<Face, number[]> = {
  ui400: [
    280, 286, 392, 651, 592, 919, 800, 230, 302, 302, 485, 684, 217, 400, 217, 390, 648, 539, 548, 576, 614, 588, 598,
    539, 615, 595, 217, 217, 684, 684, 684, 480, 955, 645, 613, 645, 701, 569, 552, 694, 710, 392, 512, 631, 541, 898,
    748, 754, 592, 754, 614, 592, 558, 690, 621, 934, 623, 575, 607, 317, 387, 344, 684, 415, 268, 525, 588, 485, 589,
    538, 314, 589, 566, 252, 245, 497, 262, 861, 566, 586, 588, 589, 349, 471, 339, 566, 479, 723, 481, 484, 460, 344,
    239, 344, 684,
  ],
  ui600: [
    303, 304, 438, 730, 604, 953, 727, 258, 332, 332, 485, 694, 252, 402, 253, 424, 656, 430, 569, 592, 621, 602, 617,
    536, 621, 578, 253, 252, 694, 694, 694, 526, 955, 671, 634, 654, 717, 589, 562, 711, 735, 415, 546, 654, 548, 924,
    767, 756, 617, 756, 639, 604, 592, 703, 642, 966, 666, 627, 615, 333, 424, 344, 694, 415, 289, 544, 603, 502, 603,
    555, 349, 603, 582, 285, 261, 536, 301, 886, 584, 597, 603, 603, 370, 497, 361, 584, 509, 756, 522, 508, 492, 370,
    278, 370, 694,
  ],
  ui700: [
    312, 327, 493, 765, 610, 969, 850, 293, 369, 369, 485, 707, 271, 404, 272, 443, 659, 575, 579, 600, 624, 607, 626,
    575, 624, 575, 272, 271, 707, 707, 707, 547, 954, 703, 643, 658, 737, 597, 566, 718, 766, 424, 561, 663, 552, 957,
    790, 758, 629, 758, 653, 610, 607, 723, 667, 1005, 685, 650, 618, 369, 440, 369, 707, 415, 314, 552, 620, 510, 619,
    563, 383, 619, 602, 300, 284, 559, 318, 916, 605, 611, 620, 619, 398, 508, 389, 605, 542, 797, 552, 538, 505, 381,
    326, 381, 707,
  ],
  reading400: [
    220, 321, 393, 672, 561, 890, 810, 237, 382, 382, 449, 582, 328, 354, 333, 490, 579, 554, 554, 554, 554, 554, 554,
    554, 554, 554, 333, 328, 582, 582, 582, 538, 885, 733, 659, 699, 765, 636, 614, 751, 839, 409, 557, 753, 636, 1002,
    833, 760, 602, 760, 724, 598, 736, 809, 737, 1089, 706, 714, 656, 350, 490, 350, 582, 470, 500, 539, 607, 499, 612,
    519, 386, 558, 661, 333, 309, 608, 335, 969, 661, 586, 617, 600, 473, 452, 403, 634, 590, 858, 567, 575, 486, 387,
    420, 387, 712,
  ],
  reading700: [
    220, 337, 438, 691, 595, 976, 837, 258, 408, 408, 453, 592, 325, 339, 329, 505, 617, 592, 592, 592, 603, 592, 592,
    592, 592, 592, 329, 326, 592, 592, 592, 559, 944, 755, 691, 710, 779, 663, 638, 768, 842, 418, 576, 784, 649, 986,
    837, 777, 654, 787, 745, 613, 746, 786, 757, 1108, 756, 745, 687, 368, 505, 368, 592, 470, 500, 578, 648, 544, 658,
    566, 427, 606, 689, 365, 337, 671, 362, 997, 694, 624, 660, 641, 541, 498, 438, 677, 622, 901, 603, 611, 534, 393,
    442, 393, 592,
  ],
  reading400i: [
    220, 337, 403, 679, 498, 858, 730, 251, 372, 372, 475, 582, 331, 353, 320, 466, 572, 528, 528, 528, 554, 528, 538,
    528, 533, 530, 320, 336, 582, 582, 582, 511, 885, 691, 616, 619, 735, 593, 561, 642, 760, 359, 367, 688, 584, 932,
    746, 715, 590, 703, 678, 498, 621, 748, 690, 1001, 687, 670, 613, 339, 466, 339, 582, 498, 498, 571, 566, 486, 573,
    477, 382, 551, 587, 298, 296, 548, 282, 876, 596, 539, 576, 541, 464, 441, 402, 593, 533, 786, 531, 538, 477, 375,
    406, 375, 583,
  ],
};

/** The punctuation and signs past ~ that the wireframes use, measured the same way, in the order of EXTRA_CHARS. */
const EXTRA_CHARS = '·›×—–…‹’≤−÷²¹';
const EXTRA: Record<Face, number[]> = {
  ui400: [240, 353, 684, 1000, 504, 733, 353, 236, 685, 684, 684, 382, 351],
  ui600: [277, 382, 694, 1000, 502, 813, 382, 259, 695, 694, 694, 396, 371],
  ui700: [294, 394, 707, 1000, 501, 912, 394, 290, 708, 707, 707, 404, 394],
  reading400: [333, 306, 582, 1000, 500, 883, 308, 328, 554, 582, 582, 407, 407],
  reading700: [329, 321, 592, 1000, 500, 923, 322, 307, 592, 592, 592, 437, 437],
  reading400i: [319, 312, 577, 1001, 501, 958, 306, 268, 549, 582, 582, 395, 395],
};

/** Any other character, such as an arrow or a check mark from a symbol font, is taken as this wide. */
const OTHER = 600;

/** One character's advance in thousandths of the font size. */
function advanceOf(face: Face, ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 32 && code <= 126) return ADVANCE[face][code - 32];
  const extra = EXTRA_CHARS.indexOf(ch);
  return extra >= 0 ? EXTRA[face][extra] : OTHER;
}

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
    // Cascadia Code and Consolas, the monospaced fallbacks, are 0.55 to 0.59 of the size wide.
    const advance = face ? advanceOf(face, ch) : 570;
    total += whole ? Math.round((advance * size) / 1000) : (advance * size) / 1000;
  }
  return total;
}

/** The largest size in pixels at which a browser uses Cambria's hinted, whole-pixel widths. */
const HINTED = 20;
