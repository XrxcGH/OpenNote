// ITS-90 thermocouple reference functions: voltage in millivolts from temperature in degrees Celsius, with the
// cold junction at 0 °C. The coefficients are the published ones of NIST Monograph 175 (public domain). The inverse
// (temperature from voltage) is found by bisection on these same functions, which are monotonic over each range,
// so the two directions always agree.

export const THERMOCOUPLE_SOURCE =
  'NIST Monograph 175, ITS-90 thermocouple reference functions (public domain). RTD: IEC 60751 coefficients.';

export type ThermocoupleType = 'K' | 'J' | 'T' | 'E';

interface Segment {
  /** Applies from `from` up to and including `to`, in °C. */
  from: number;
  to: number;
  /** c0, c1, c2 ... of E = Σ cᵢ tⁱ (mV). */
  c: readonly number[];
  /** The type K exponential term: E += a0 exp(a1 (t − a2)²). */
  extra?: readonly [number, number, number];
}

const TABLE: Record<ThermocoupleType, readonly Segment[]> = {
  K: [
    {
      from: -270,
      to: 0,
      c: [
        0, 3.9450128025e-2, 2.3622373598e-5, -3.2858906784e-7, -4.9904828777e-9, -6.7509059173e-11, -5.7410327428e-13,
        -3.1088872894e-15, -1.0451609365e-17, -1.9889266878e-20, -1.6322697486e-23,
      ],
    },
    {
      from: 0,
      to: 1372,
      c: [
        -1.7600413686e-2, 3.8921204975e-2, 1.8558770032e-5, -9.9457592874e-8, 3.1840945719e-10, -5.6072844889e-13,
        5.6075059059e-16, -3.2020720003e-19, 9.7151147152e-23, -1.2104721275e-26,
      ],
      extra: [1.185976e-1, -1.183432e-4, 1.269686e2],
    },
  ],
  J: [
    {
      from: -210,
      to: 760,
      c: [
        0, 5.0381187815e-2, 3.047583693e-5, -8.568106572e-8, 1.3228195295e-10, -1.7052958337e-13, 2.0948090697e-16,
        -1.2538395336e-19, 1.5631725697e-23,
      ],
    },
    {
      from: 760,
      to: 1200,
      c: [2.9645625681e2, -1.4976127786, 3.1787103924e-3, -3.1847686701e-6, 1.5720819004e-9, -3.0691369056e-13],
    },
  ],
  T: [
    {
      from: -270,
      to: 0,
      c: [
        0, 3.8748106364e-2, 4.4194434347e-5, 1.1844323105e-7, 2.0032973554e-8, 9.0138019559e-10, 2.2651156593e-11,
        3.6071154205e-13, 3.8493939883e-15, 2.8213521925e-17, 1.4251594779e-19, 4.8768662286e-22, 1.079553927e-24,
        1.3945027062e-27, 7.9795153927e-31,
      ],
    },
    {
      from: 0,
      to: 400,
      c: [
        0, 3.8748106364e-2, 3.329222788e-5, 2.0618243404e-7, -2.1882256846e-9, 1.0996880928e-11, -3.0815758772e-14,
        4.547913529e-17, -2.7512901673e-20,
      ],
    },
  ],
  E: [
    {
      from: -270,
      to: 0,
      c: [
        0, 5.8665508708e-2, 4.5410977124e-5, -7.7998048686e-7, -2.5800160843e-8, -5.9452583057e-10, -9.3214058667e-12,
        -1.0287605534e-13, -8.0370123621e-16, -4.3979497391e-18, -1.6414776355e-20, -3.9673619516e-23,
        -5.5827328721e-26, -3.4657842013e-29,
      ],
    },
    {
      from: 0,
      to: 1000,
      c: [
        0, 5.8665508708e-2, 4.5032275582e-5, 2.8908407212e-8, -3.3056896652e-10, 6.502440327e-13, -1.9197495504e-16,
        -1.2536600497e-18, 2.1489217569e-21, -1.4388041782e-24, 3.5960899481e-28,
      ],
    },
  ],
};

export const THERMOCOUPLE_TYPES: readonly ThermocoupleType[] = ['K', 'J', 'T', 'E'];

/** The lowest and highest temperature the reference functions cover for a type, in °C. */
export function thermocoupleRange(type: ThermocoupleType): [number, number] {
  const segments = TABLE[type];
  return [segments[0]!.from, segments[segments.length - 1]!.to];
}

/** Millivolts for a measuring junction at `celsius` against a cold junction at 0 °C; null outside the range. */
export function thermocoupleVoltage(type: ThermocoupleType, celsius: number): number | null {
  const [low, high] = thermocoupleRange(type);
  if (!(celsius >= low && celsius <= high)) return null;
  const segment = TABLE[type].find((s) => celsius >= s.from && celsius <= s.to)!;
  // Horner's rule keeps the many small terms accurate.
  let e = 0;
  for (let i = segment.c.length - 1; i >= 0; i--) e = e * celsius + segment.c[i]!;
  if (segment.extra) {
    const [a0, a1, a2] = segment.extra;
    e += a0 * Math.exp(a1 * (celsius - a2) ** 2);
  }
  return e;
}

/** Degrees Celsius for a voltage measured against a 0 °C cold junction; null when no temperature in range gives it. */
export function thermocoupleTemperature(type: ThermocoupleType, millivolts: number): number | null {
  const [low, high] = thermocoupleRange(type);
  const eLow = thermocoupleVoltage(type, low)!;
  const eHigh = thermocoupleVoltage(type, high)!;
  if (!(millivolts >= eLow && millivolts <= eHigh)) return null;
  let a = low;
  let b = high;
  for (let i = 0; i < 100; i++) {
    const mid = (a + b) / 2;
    if (thermocoupleVoltage(type, mid)! < millivolts) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}
