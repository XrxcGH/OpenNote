// METAR and TAF reports decoded into parts, following the formats in the FAA Aeronautical Information Manual and
// Federal Meteorological Handbook No. 1 (US government, public domain). The decoder returns codes and numbers only;
// the form puts them into words. Groups it does not know are kept and listed, never guessed.

export interface Wind {
  /** Degrees true the wind blows from, or null for variable (VRB). */
  direction: number | null;
  speed: number;
  gust: number | null;
  unit: 'KT' | 'MPS' | 'KMH';
  /** A varying direction, such as 180V240. */
  from?: number;
  to?: number;
}

export interface Visibility {
  /** Statute miles, or meters when `meters` is set. */
  value: number;
  meters?: boolean;
  /** M (less than) or P (more than). */
  bound?: 'less' | 'more';
  cavok?: boolean;
}

export interface Weather {
  intensity: 'light' | 'moderate' | 'heavy' | 'vicinity';
  descriptor: string | null;
  phenomena: string[];
  code: string;
}

export interface Cloud {
  cover: 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV' | 'CLR' | 'SKC' | 'NSC' | 'NCD';
  /** Base in feet above ground, or null for clear skies. */
  base: number | null;
  type?: 'CB' | 'TCU';
}

export interface Conditions {
  wind?: Wind;
  visibility?: Visibility;
  weather: Weather[];
  clouds: Cloud[];
}

export interface Metar extends Conditions {
  kind: 'METAR' | 'SPECI';
  station: string;
  day?: number;
  time?: string;
  auto: boolean;
  correction: boolean;
  temperature?: number;
  dewPoint?: number;
  /** Altimeter setting in inHg (A group) or hPa (Q group). */
  altimeter?: { value: number; unit: 'inHg' | 'hPa' };
  remarks: {
    station?: 'AO1' | 'AO2';
    seaLevel?: number;
    precise?: { temperature: number; dewPoint: number | null };
    hourlyPrecip?: number;
    rising?: boolean;
    falling?: boolean;
    other: string[];
  };
  /** Runway visual range groups, kept as written. */
  runway: string[];
  unknown: string[];
}

export interface TafPeriod extends Conditions {
  change: 'BASE' | 'FM' | 'TEMPO' | 'BECMG' | 'PROB';
  probability?: number;
  start?: string;
  end?: string;
}

export interface Taf {
  station: string;
  issued?: string;
  validFrom?: string;
  validTo?: string;
  amended: boolean;
  periods: TafPeriod[];
  unknown: string[];
}

const DESCRIPTORS = ['MI', 'PR', 'BC', 'DR', 'BL', 'SH', 'TS', 'FZ'];
const PHENOMENA = [
  'DZ',
  'RA',
  'SN',
  'SG',
  'IC',
  'PL',
  'GR',
  'GS',
  'UP',
  'BR',
  'FG',
  'FU',
  'VA',
  'DU',
  'SA',
  'HZ',
  'PY',
  'PO',
  'SQ',
  'FC',
  'SS',
  'DS',
];

function wind(token: string): Wind | null {
  const m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/.exec(token);
  if (!m) return null;
  return {
    direction: m[1] === 'VRB' ? null : Number(m[1]),
    speed: Number(m[2]),
    gust: m[3] ? Number(m[3]) : null,
    unit: m[4] as Wind['unit'],
  };
}

function weather(token: string): Weather | null {
  const m = /^(\+|-|VC)?([A-Z]{2,})$/.exec(token);
  if (!m) return null;
  let rest = m[2];
  let descriptor: string | null = null;
  if (DESCRIPTORS.includes(rest.slice(0, 2))) {
    descriptor = rest.slice(0, 2);
    rest = rest.slice(2);
  }
  const phenomena: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const code = rest.slice(i, i + 2);
    if (!PHENOMENA.includes(code)) return null;
    phenomena.push(code);
  }
  if (phenomena.length === 0 && descriptor !== 'TS' && descriptor !== 'SH') return null;
  const intensity = m[1] === '+' ? 'heavy' : m[1] === '-' ? 'light' : m[1] === 'VC' ? 'vicinity' : 'moderate';
  return { intensity, descriptor, phenomena, code: token };
}

function cloud(token: string): Cloud | null {
  if (/^(CLR|SKC|NSC|NCD)$/.test(token)) return { cover: token as Cloud['cover'], base: null };
  const m = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/.exec(token);
  if (!m) return null;
  return {
    cover: m[1] as Cloud['cover'],
    base: m[2] === '///' ? null : Number(m[2]) * 100,
    ...(m[3] ? { type: m[3] as 'CB' | 'TCU' } : {}),
  };
}

/** Reads a visibility that may span two tokens (1 1/2SM); returns the value and how many tokens it used. */
function visibility(tokens: readonly string[], i: number): { vis: Visibility; used: number } | null {
  const token = tokens[i];
  if (token === 'CAVOK') return { vis: { value: 10, meters: true, cavok: true }, used: 1 };
  if (/^\d{4}$/.test(token)) return { vis: { value: Number(token), meters: true }, used: 1 };
  const fraction = (text: string) => {
    const [a, b] = text.split('/').map(Number);
    return b ? a / b : a;
  };
  const sm = /^(M|P)?(\d+(?:\/\d+)?)SM$/.exec(token);
  if (sm) {
    const bound = sm[1] === 'M' ? 'less' : sm[1] === 'P' ? 'more' : undefined;
    return { vis: { value: fraction(sm[2]), ...(bound ? { bound } : {}) }, used: 1 };
  }
  const next = tokens[i + 1];
  if (/^\d$/.test(token) && next && /^\d\/\d+SM$/.test(next)) {
    return { vis: { value: Number(token) + fraction(next.replace('SM', '')) }, used: 2 };
  }
  return null;
}

const signed = (text: string): number => (text.startsWith('M') ? -Number(text.slice(1)) : Number(text));

/** Reads wind, visibility, weather, and cloud groups from `tokens[i]`; returns how many tokens it took. */
function conditions(tokens: readonly string[], i: number, into: Conditions): number {
  const token = tokens[i];
  const w = wind(token);
  if (w) {
    into.wind = w;
    return 1;
  }
  const varying = /^(\d{3})V(\d{3})$/.exec(token);
  if (varying && into.wind) {
    into.wind.from = Number(varying[1]);
    into.wind.to = Number(varying[2]);
    return 1;
  }
  const v = visibility(tokens, i);
  if (v) {
    into.visibility = v.vis;
    return v.used;
  }
  const c = cloud(token);
  if (c) {
    into.clouds.push(c);
    return 1;
  }
  const x = weather(token);
  if (x) {
    into.weather.push(x);
    return 1;
  }
  return 0;
}

function remarks(tokens: readonly string[], out: Metar['remarks']): void {
  for (const token of tokens) {
    if (token === 'AO1' || token === 'AO2') out.station = token;
    else if (/^SLP\d{3}$/.test(token)) {
      const n = Number(token.slice(3)) / 10;
      out.seaLevel = n < 50 ? 1000 + n : 900 + n;
    } else if (/^T[01]\d{3}([01]\d{3})?$/.test(token)) {
      const part = (s: string) => (s[0] === '1' ? -1 : 1) * (Number(s.slice(1)) / 10);
      out.precise = {
        temperature: part(token.slice(1, 5)),
        dewPoint: token.length > 5 ? part(token.slice(5, 9)) : null,
      };
    } else if (/^P\d{4}$/.test(token)) out.hourlyPrecip = Number(token.slice(1)) / 100;
    else if (token === 'PRESRR') out.rising = true;
    else if (token === 'PRESFR') out.falling = true;
    else out.other.push(token);
  }
}

/** Decodes one METAR or SPECI report. Groups it cannot read are listed in `unknown`. */
export function decodeMetar(report: string): Metar {
  const all = report.trim().toUpperCase().replace(/=$/, '').split(/\s+/).filter(Boolean);
  const rmk = all.indexOf('RMK');
  const tokens = rmk >= 0 ? all.slice(0, rmk) : all;
  const out: Metar = {
    kind: 'METAR',
    station: '',
    auto: false,
    correction: false,
    weather: [],
    clouds: [],
    remarks: { other: [] },
    runway: [],
    unknown: [],
  };
  let i = 0;
  if (tokens[i] === 'METAR' || tokens[i] === 'SPECI') out.kind = tokens[i++] as 'METAR' | 'SPECI';
  if (tokens[i] && /^[A-Z][A-Z0-9]{3}$/.test(tokens[i])) out.station = tokens[i++];
  const time = /^(\d{2})(\d{4})Z$/.exec(tokens[i] ?? '');
  if (time) {
    out.day = Number(time[1]);
    out.time = time[2];
    i++;
  }
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === 'AUTO') out.auto = true;
    else if (token === 'COR') out.correction = true;
    else if (/^R\d{2}[LCR]?\//.test(token)) out.runway.push(token);
    else if (/^M?\d{2}\/(M?\d{2})?$/.test(token)) {
      const [tt, td] = token.split('/');
      out.temperature = signed(tt);
      if (td) out.dewPoint = signed(td);
    } else if (/^A\d{4}$/.test(token)) out.altimeter = { value: Number(token.slice(1)) / 100, unit: 'inHg' };
    else if (/^Q\d{4}$/.test(token)) out.altimeter = { value: Number(token.slice(1)), unit: 'hPa' };
    else {
      const used = conditions(tokens, i, out);
      if (used === 0) out.unknown.push(token);
      i += Math.max(used, 1);
      continue;
    }
    i++;
  }
  if (rmk >= 0) remarks(all.slice(rmk + 1), out.remarks);
  return out;
}

const period = (change: TafPeriod['change']): TafPeriod => ({ change, weather: [], clouds: [] });

/** Decodes a TAF into its base forecast and its FM, TEMPO, BECMG, and PROB periods. */
export function decodeTaf(report: string): Taf {
  const tokens = report.trim().toUpperCase().replace(/=$/, '').split(/\s+/).filter(Boolean);
  const out: Taf = { station: '', amended: false, periods: [], unknown: [] };
  let i = 0;
  if (tokens[i] === 'TAF') i++;
  if (tokens[i] === 'AMD' || tokens[i] === 'COR') {
    out.amended = true;
    i++;
  }
  if (tokens[i] && /^[A-Z][A-Z0-9]{3}$/.test(tokens[i])) out.station = tokens[i++];
  if (/^\d{6}Z$/.test(tokens[i] ?? '')) out.issued = tokens[i++].slice(0, 6);
  const valid = /^(\d{4})\/(\d{4})$/.exec(tokens[i] ?? '');
  if (valid) {
    out.validFrom = valid[1];
    out.validTo = valid[2];
    i++;
  }
  let current = period('BASE');
  out.periods.push(current);
  while (i < tokens.length) {
    const token = tokens[i];
    const fm = /^FM(\d{6})$/.exec(token);
    const prob = /^PROB(\d{2})$/.exec(token);
    if (fm) {
      current = { ...period('FM'), start: fm[1] };
      out.periods.push(current);
      i++;
      continue;
    }
    if (token === 'TEMPO' || token === 'BECMG' || prob) {
      current = period(prob ? 'PROB' : (token as 'TEMPO' | 'BECMG'));
      if (prob) {
        current.probability = Number(prob[1]);
        if (tokens[i + 1] === 'TEMPO') i++;
      }
      const span = /^(\d{4})\/(\d{4})$/.exec(tokens[i + 1] ?? '');
      if (span) {
        current.start = span[1];
        current.end = span[2];
        i++;
      }
      out.periods.push(current);
      i++;
      continue;
    }
    if (/^(WS\d{3}\/\d{5}KT|QNH\d{4}INS|NSW)$/.test(token)) {
      if (token === 'NSW')
        current.weather.push({ intensity: 'moderate', descriptor: null, phenomena: [], code: 'NSW' });
      i++;
      continue;
    }
    const used = conditions(tokens, i, current);
    if (used === 0) out.unknown.push(token);
    i += Math.max(used, 1);
  }
  return out;
}

/** Eighths of sky covered for a station-model circle: the most covered layer. */
export function skyEighths(clouds: readonly Cloud[]): number | null {
  const eighths: Record<Cloud['cover'], number> = {
    CLR: 0,
    SKC: 0,
    NSC: 0,
    NCD: 0,
    FEW: 2,
    SCT: 4,
    BKN: 6,
    OVC: 8,
    VV: 8,
  };
  if (clouds.length === 0) return null;
  return Math.max(...clouds.map((c) => eighths[c.cover]));
}
