// The geologic time scale: eons, eras, periods, and Cenozoic epochs with their boundary ages in millions of years.
// Names and ranks follow the USGS Geologic Names Committee's divisions of geologic time (public domain); boundary
// ages are those of the International Chronostratigraphic Chart (2023), facts the USGS divisions adopt.

export type Rank = 'eon' | 'era' | 'period' | 'epoch';

export interface Division {
  id: string;
  rank: Rank;
  /** Older boundary, Ma. */
  start: number;
  /** Younger boundary, Ma. */
  end: number;
}

const d = (id: string, rank: Rank, start: number, end: number): Division => ({ id, rank, start, end });

export const DIVISIONS: readonly Division[] = [
  d('hadean', 'eon', 4567, 4031),
  d('archean', 'eon', 4031, 2500),
  d('proterozoic', 'eon', 2500, 538.8),
  d('phanerozoic', 'eon', 538.8, 0),
  d('eoarchean', 'era', 4031, 3600),
  d('paleoarchean', 'era', 3600, 3200),
  d('mesoarchean', 'era', 3200, 2800),
  d('neoarchean', 'era', 2800, 2500),
  d('paleoproterozoic', 'era', 2500, 1600),
  d('mesoproterozoic', 'era', 1600, 1000),
  d('neoproterozoic', 'era', 1000, 538.8),
  d('paleozoic', 'era', 538.8, 251.902),
  d('mesozoic', 'era', 251.902, 66),
  d('cenozoic', 'era', 66, 0),
  d('tonian', 'period', 1000, 720),
  d('cryogenian', 'period', 720, 635),
  d('ediacaran', 'period', 635, 538.8),
  d('cambrian', 'period', 538.8, 486.85),
  d('ordovician', 'period', 486.85, 443.1),
  d('silurian', 'period', 443.1, 419.62),
  d('devonian', 'period', 419.62, 358.86),
  d('carboniferous', 'period', 358.86, 298.9),
  d('permian', 'period', 298.9, 251.902),
  d('triassic', 'period', 251.902, 201.4),
  d('jurassic', 'period', 201.4, 143.1),
  d('cretaceous', 'period', 143.1, 66),
  d('paleogene', 'period', 66, 23.04),
  d('neogene', 'period', 23.04, 2.58),
  d('quaternary', 'period', 2.58, 0),
  d('paleocene', 'epoch', 66, 56),
  d('eocene', 'epoch', 56, 33.9),
  d('oligocene', 'epoch', 33.9, 23.04),
  d('miocene', 'epoch', 23.04, 5.333),
  d('pliocene', 'epoch', 5.333, 2.58),
  d('pleistocene', 'epoch', 2.58, 0.0117),
  d('holocene', 'epoch', 0.0117, 0),
];

/** The divisions that hold an age (Ma), one per rank, from eon down. An age on a boundary belongs to the younger. */
export function lookup(age: number): Division[] {
  return (['eon', 'era', 'period', 'epoch'] as const)
    .map(
      (rank) =>
        DIVISIONS.find((x) => x.rank === rank && age <= x.start && age > x.end) ??
        (age === 0 ? DIVISIONS.find((x) => x.rank === rank && x.end === 0) : undefined),
    )
    .filter((x): x is Division => x !== undefined);
}

/** The divisions of one rank that overlap a span (Ma), clipped to it. */
export function within(rank: Rank, older: number, younger: number): Division[] {
  return DIVISIONS.filter((x) => x.rank === rank && x.start > younger && x.end < older).map((x) => ({
    ...x,
    start: Math.min(x.start, older),
    end: Math.max(x.end, younger),
  }));
}
