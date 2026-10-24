// Extended surfaces: straight and pin fins with every common tip condition, annular fins, and fin arrays.
import { besselI, besselK, fmt, need, positive, type Step } from '../numeric';

export type FinShape = 'pin' | 'rectangular';
export type TipCondition = 'adiabatic' | 'convective' | 'infinite' | 'temperature' | 'corrected';

export interface FinInput {
  shape: FinShape;
  /** Pin diameter (m), or the thickness of a rectangular fin. */
  size: number;
  /** Width of a rectangular fin (m), ignored for a pin. */
  width?: number;
  length: number;
  k: number;
  h: number;
  /** Base excess temperature theta_b = T_base - T_fluid (K). */
  thetaBase: number;
  /** Tip excess temperature for the fixed-temperature tip condition (K). */
  thetaTip?: number;
}

export interface FinGeometry {
  perimeter: number;
  crossSection: number;
  /** Length that gives the adiabatic-tip fin the same heat as a convecting tip: L + Ac/P. */
  correctedLength: number;
}

export function finGeometry(inp: Pick<FinInput, 'shape' | 'size' | 'width' | 'length'>): FinGeometry {
  positive(inp.size, inp.shape === 'pin' ? 'The diameter' : 'The thickness');
  if (inp.shape === 'pin') {
    const p = Math.PI * inp.size;
    const a = (Math.PI * inp.size ** 2) / 4;
    return { perimeter: p, crossSection: a, correctedLength: inp.length + a / p };
  }
  positive(inp.width ?? NaN, 'The width');
  const w = inp.width!;
  const p = 2 * (w + inp.size);
  const a = w * inp.size;
  return { perimeter: p, crossSection: a, correctedLength: inp.length + a / p };
}

export interface FinResult {
  /** Fin parameter m = sqrt(hP/kA) (1/m) and M = sqrt(hPkA) theta_b (W). */
  m: number;
  M: number;
  /** Heat rate for each tip condition (W). The fixed-temperature entry exists only when a tip temperature is given. */
  q: Record<TipCondition, number | undefined>;
  /** Efficiency tanh(mL)/mL of the adiabatic-tip fin. */
  efficiency: number;
  efficiencyCorrected: number;
  /** Effectiveness q/(h Ac theta_b) for the chosen tip condition. */
  effectiveness: Record<TipCondition, number | undefined>;
  biot: number;
  warnings: string[];
  steps: Step[];
}

export function fin(inp: FinInput): FinResult {
  positive(inp.length, 'The length');
  positive(inp.k, 'The conductivity');
  positive(inp.h, 'The heat transfer coefficient');
  need(
    Number.isFinite(inp.thetaBase) && inp.thetaBase !== 0,
    'theta',
    'The base excess temperature must be a nonzero number.',
  );
  const g = finGeometry(inp);
  const m = Math.sqrt((inp.h * g.perimeter) / (inp.k * g.crossSection));
  const M = Math.sqrt(inp.h * g.perimeter * inp.k * g.crossSection) * inp.thetaBase;
  const L = inp.length;
  const hmk = inp.h / (m * inp.k);
  const mL = m * L;
  const q: FinResult['q'] = {
    infinite: M,
    adiabatic: M * Math.tanh(mL),
    convective: (M * (Math.sinh(mL) + hmk * Math.cosh(mL))) / (Math.cosh(mL) + hmk * Math.sinh(mL)),
    corrected: M * Math.tanh(m * g.correctedLength),
    temperature:
      inp.thetaTip === undefined ? undefined : (M * (Math.cosh(mL) - inp.thetaTip / inp.thetaBase)) / Math.sinh(mL),
  };
  const ac = g.crossSection * inp.h * inp.thetaBase;
  const effectiveness = Object.fromEntries(
    Object.entries(q).map(([key, v]) => [key, v === undefined ? undefined : v / ac]),
  ) as FinResult['effectiveness'];
  const warnings: string[] = [];
  const biot = (inp.h * (inp.shape === 'pin' ? inp.size / 2 : inp.size / 2)) / inp.k;
  if (biot > 0.1) warnings.push('fhFinsWarnBiot');
  if (mL < 0.1) warnings.push('fhFinsWarnShort');
  if (mL > 5) warnings.push('fhFinsWarnLong');
  const steps: Step[] = [
    { key: 'fhFinsM', vars: { m: fmt(m) }, math: `m = \\sqrt{\\frac{hP}{kA_c}} = ${fmt(m)}\\ \\mathrm{m^{-1}}` },
    { key: 'fhFinsBigM', vars: { M: fmt(M) }, math: `M = \\sqrt{hPkA_c}\\,\\theta_b = ${fmt(M)}\\ \\mathrm{W}` },
    {
      key: 'fhFinsAdiabatic',
      vars: { q: fmt(q.adiabatic!) },
      math: `q_f = M\\tanh(mL) = ${fmt(q.adiabatic!)}\\ \\mathrm{W}`,
    },
    {
      key: 'fhFinsConvective',
      vars: { q: fmt(q.convective!) },
      math: `q_f = M\\,\\frac{\\sinh mL + (h/mk)\\cosh mL}{\\cosh mL + (h/mk)\\sinh mL} = ${fmt(q.convective!)}\\ \\mathrm{W}`,
    },
    {
      key: 'fhFinsEfficiency',
      vars: { e: fmt(Math.tanh(mL) / mL) },
      math: `\\eta_f = \\frac{\\tanh mL}{mL} = ${fmt(Math.tanh(mL) / mL)}`,
    },
  ];
  return {
    m,
    M,
    q,
    efficiency: Math.tanh(mL) / mL,
    efficiencyCorrected: Math.tanh(m * g.correctedLength) / (m * g.correctedLength),
    effectiveness,
    biot,
    warnings,
    steps,
  };
}

/** Excess temperature along the fin, theta(x)/theta_b, for the given tip condition (x from the base). */
export function finProfile(inp: FinInput, tip: TipCondition, points = 41): { x: number[]; ratio: number[] } {
  const g = finGeometry(inp);
  const m = Math.sqrt((inp.h * g.perimeter) / (inp.k * g.crossSection));
  const L = tip === 'corrected' ? g.correctedLength : inp.length;
  const hmk = inp.h / (m * inp.k);
  const x = Array.from({ length: points }, (_, i) => (inp.length * i) / (points - 1));
  const ratio = x.map((xi) => {
    switch (tip) {
      case 'infinite':
        return Math.exp(-m * xi);
      case 'adiabatic':
      case 'corrected':
        return Math.cosh(m * (L - xi)) / Math.cosh(m * L);
      case 'convective':
        return (Math.cosh(m * (L - xi)) + hmk * Math.sinh(m * (L - xi))) / (Math.cosh(m * L) + hmk * Math.sinh(m * L));
      case 'temperature': {
        const tt = (inp.thetaTip ?? 0) / inp.thetaBase;
        return (tt * Math.sinh(m * xi) + Math.sinh(m * (L - xi))) / Math.sinh(m * L);
      }
    }
  });
  return { x, ratio };
}

export interface AnnularInput {
  innerRadius: number;
  outerRadius: number;
  thickness: number;
  k: number;
  h: number;
  thetaBase: number;
}

export interface AnnularResult {
  efficiency: number;
  /** Heat rate with the corrected outer radius r2 + t/2 (W). */
  q: number;
  finArea: number;
  m: number;
  correctedOuterRadius: number;
  steps: Step[];
}

/** Annular fin of constant thickness with an adiabatic tip at the corrected radius r2c = r2 + t/2. */
export function annularFin(inp: AnnularInput): AnnularResult {
  positive(inp.innerRadius, 'The inner radius');
  positive(inp.outerRadius, 'The outer radius');
  positive(inp.thickness, 'The thickness');
  positive(inp.k, 'The conductivity');
  positive(inp.h, 'The heat transfer coefficient');
  need(inp.outerRadius > inp.innerRadius, 'radii', 'The outer radius must be larger than the inner radius.');
  need(Number.isFinite(inp.thetaBase), 'theta', 'The base excess temperature must be a number.');
  const r1 = inp.innerRadius;
  const r2c = inp.outerRadius + inp.thickness / 2;
  const m = Math.sqrt((2 * inp.h) / (inp.k * inp.thickness));
  need(
    m * r2c < 300,
    'long',
    'The fin is so large for its conductivity that the Bessel functions overflow; reduce the size.',
  );
  const x1 = m * r1;
  const x2 = m * r2c;
  const num = besselK(1, x1) * besselI(1, x2) - besselI(1, x1) * besselK(1, x2);
  const den = besselI(0, x1) * besselK(1, x2) + besselK(0, x1) * besselI(1, x2);
  const eta = ((2 * r1) / (m * (r2c * r2c - r1 * r1))) * (num / den);
  const area = 2 * Math.PI * (r2c * r2c - r1 * r1);
  const q = eta * inp.h * area * inp.thetaBase;
  return {
    efficiency: eta,
    q,
    finArea: area,
    m,
    correctedOuterRadius: r2c,
    steps: [
      {
        key: 'fhFinsAnnularM',
        vars: { m: fmt(m) },
        math: `m = \\sqrt{\\frac{2h}{kt}} = ${fmt(m)}\\ \\mathrm{m^{-1}},\\ r_{2c} = r_2 + t/2 = ${fmt(r2c)}\\ \\mathrm{m}`,
      },
      {
        key: 'fhFinsAnnularEta',
        vars: { e: fmt(eta, 5) },
        math:
          `\\eta_f = \\frac{2r_1}{m(r_{2c}^2 - r_1^2)}\\,\\frac{K_1(mr_1)I_1(mr_{2c}) - ` +
          `I_1(mr_1)K_1(mr_{2c})}{I_0(mr_1)K_1(mr_{2c}) + K_0(mr_1)I_1(mr_{2c})} = ${fmt(eta, 5)}`,
      },
    ],
  };
}

export interface ArrayInput {
  /** Number of fins. */
  count: number;
  /** Heat rate of one fin (W), its efficiency, and its surface area (m2). */
  finHeat: number;
  finEfficiency: number;
  finArea: number;
  /** Base cross-section area taken up by one fin (m2). */
  finBaseArea: number;
  /** Total base surface area before finning (m2). */
  baseArea: number;
  h: number;
  thetaBase: number;
}

export interface ArrayResult {
  total: number;
  unfinned: number;
  unfinnedArea: number;
  bare: number;
  overallEfficiency: number;
  /** Heat rate with fins divided by the heat rate of the bare base. */
  enhancement: number;
  steps: Step[];
}

/** N fins on a base: q = N q_fin + h (A_base - N A_c) theta_b, with overall surface efficiency. */
export function finArray(inp: ArrayInput): ArrayResult {
  need(Number.isInteger(inp.count) && inp.count > 0, 'count', 'The number of fins must be a whole number above zero.');
  positive(inp.baseArea, 'The base area');
  positive(inp.h, 'The heat transfer coefficient');
  positive(inp.finArea, 'The fin area');
  need(
    inp.finBaseArea > 0 && inp.count * inp.finBaseArea < inp.baseArea,
    'area',
    'The fins cover more than the whole base: reduce the count or the fin size.',
  );
  const unfinnedArea = inp.baseArea - inp.count * inp.finBaseArea;
  const unfinned = inp.h * unfinnedArea * inp.thetaBase;
  const total = inp.count * inp.finHeat + unfinned;
  const at = unfinnedArea + inp.count * inp.finArea;
  const overall = 1 - ((inp.count * inp.finArea) / at) * (1 - inp.finEfficiency);
  const bare = inp.h * inp.baseArea * inp.thetaBase;
  return {
    total,
    unfinned,
    unfinnedArea,
    bare,
    overallEfficiency: overall,
    enhancement: total / bare,
    steps: [
      {
        key: 'fhFinsArray',
        vars: { q: fmt(total) },
        math: `q_t = N q_f + h(A_b - N A_c)\\theta_b = ${fmt(total)}\\ \\mathrm{W}`,
      },
      {
        key: 'fhFinsOverall',
        vars: { e: fmt(overall) },
        math: `\\eta_o = 1 - \\frac{N A_f}{A_t}(1 - \\eta_f) = ${fmt(overall)}`,
      },
    ],
  };
}
