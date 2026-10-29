// Body segment parameters from Dempster's cadaver study: each segment's mass as a fraction of the body's, and the
// place of its center of mass as a fraction of the segment's length from its proximal end (the joint nearer the
// trunk). Check a value against its source before relying on it.

export const SEGMENT_SOURCES = {
  dempster: {
    name:
      'W. T. Dempster, Space Requirements of the Seated Operator, WADC Technical Report 55-159, Wright-Patterson ' +
      'Air Force Base, 1955; as tabulated in D. A. Winter, Biomechanics and Motor Control of Human Movement, ' +
      '4th ed., 2009, Table 4.1',
    license: 'A US Air Force technical report, public domain. The tabulated numbers are facts.',
  },
} as const;

export interface Segment {
  /** Segment mass over body mass. */
  readonly mass: number;
  /** Center of mass from the proximal end, over the segment's length. */
  readonly com: number;
  /** The segment's ends, proximal first, for the words. */
  readonly ends: string;
}

export const SEGMENTS = {
  hand: { mass: 0.006, com: 0.506, ends: 'wrist axis to knuckle II of the third finger' },
  forearm: { mass: 0.016, com: 0.43, ends: 'elbow axis to ulnar styloid' },
  upperArm: { mass: 0.028, com: 0.436, ends: 'glenohumeral axis to elbow axis' },
  forearmHand: { mass: 0.022, com: 0.682, ends: 'elbow axis to ulnar styloid' },
  foot: { mass: 0.0145, com: 0.5, ends: 'lateral malleolus to head of metatarsal II' },
  shank: { mass: 0.0465, com: 0.433, ends: 'femoral condyles to medial malleolus' },
  thigh: { mass: 0.1, com: 0.433, ends: 'greater trochanter to femoral condyles' },
  footShank: { mass: 0.061, com: 0.606, ends: 'femoral condyles to medial malleolus' },
  trunk: { mass: 0.497, com: 0.5, ends: 'greater trochanter to glenohumeral joint' },
  headNeck: { mass: 0.081, com: 1, ends: 'C7–T1 and first rib to ear canal' },
} as const satisfies Record<string, Segment>;

export type SegmentId = keyof typeof SEGMENTS;

/** Standard gravity, m/s². */
export const G0 = 9.80665;
