// What a plot or heat map in the signals tools shows. The tools build these from engine results, with labels in words.

/** A labeled series of points for a plot. */
export interface Series {
  readonly label: string;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  /** How the points are drawn: joined, as stems from zero, as dots, or as steps. */
  readonly kind?: 'line' | 'stem' | 'dots' | 'steps';
  /** Which of the plot's colors: 0 to 4. */
  readonly tone?: number;
  readonly dashed?: boolean;
}

export interface PlotSpec {
  readonly series: readonly Series[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly logX?: boolean;
  /** Fixed ranges; found from the data when left out. */
  readonly xRange?: readonly [number, number];
  readonly yRange?: readonly [number, number];
  /** Vertical marker lines with short labels, such as peaks or cutoffs. */
  readonly markers?: readonly { x: number; label: string }[];
  /** Drawn on a square plot with equal axes (pole-zero plots, constellations). */
  readonly square?: boolean;
  /** A circle of this radius about the origin (the unit circle of a pole-zero plot). */
  readonly circle?: number;
}

/** A grid of values for a heat map: rows from the bottom up, each a run of columns. */
export interface HeatSpec {
  readonly values: readonly Float64Array[];
  readonly xRange: readonly [number, number];
  readonly yRange: readonly [number, number];
  readonly xLabel: string;
  readonly yLabel: string;
  /** The value range the colors span; found from the data when left out. */
  readonly zRange?: readonly [number, number];
}
