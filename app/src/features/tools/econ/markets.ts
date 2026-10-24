// Supply and demand with linear curves, Qd = a - bP and Qs = c + dP. Areas are exact for linear curves.

export interface Curves {
  a: number;
  b: number;
  c: number;
  d: number;
}

export const demandAt = (k: Curves, p: number): number => Math.max(0, k.a - k.b * p);
export const supplyAt = (k: Curves, p: number): number => Math.max(0, k.c + k.d * p);
/** The price buyers will pay for the Qth unit. */
export const buyerPrice = (k: Curves, q: number): number => (k.a - q) / k.b;
/** The price sellers need for the Qth unit. */
export const sellerPrice = (k: Curves, q: number): number => (q - k.c) / k.d;

export function validCurves(k: Curves): boolean {
  return k.b > 0 && k.d > 0 && k.a / k.b > Math.max(0, -k.c / k.d) && Number.isFinite(k.a + k.b + k.c + k.d);
}

export interface Equilibrium {
  price: number;
  quantity: number;
  consumerSurplus: number;
  producerSurplus: number;
  demandElasticity: number;
  supplyElasticity: number;
}

/** Consumer surplus when Q units are bought at the price p: the area under demand above p. */
export const consumerSurplus = (k: Curves, q: number, p: number): number => (k.a * q - (q * q) / 2) / k.b - p * q;
/** Producer surplus when Q units are sold at the price p: the area above supply below p. */
export const producerSurplus = (k: Curves, q: number, p: number): number => p * q - ((q * q) / 2 - k.c * q) / k.d;

export function equilibrium(k: Curves): Equilibrium | null {
  if (!validCurves(k)) return null;
  const price = (k.a - k.c) / (k.b + k.d);
  const quantity = k.a - k.b * price;
  if (!(quantity > 0) || price < 0) return null;
  return {
    price,
    quantity,
    consumerSurplus: consumerSurplus(k, quantity, price),
    producerSurplus: producerSurplus(k, quantity, price),
    demandElasticity: (-k.b * price) / quantity,
    supplyElasticity: (k.d * price) / quantity,
  };
}

export interface Arc {
  elasticity: number;
  revenueChange: number;
  range: 'elastic' | 'inelastic' | 'unit';
}

/** Midpoint (arc) elasticity between two price and quantity points. */
export function arcElasticity(p1: number, q1: number, p2: number, q2: number): Arc | null {
  if (p1 === p2 || p1 + p2 === 0 || q1 + q2 === 0) return null;
  const elasticity = (q2 - q1) / ((q1 + q2) / 2) / ((p2 - p1) / ((p1 + p2) / 2));
  const size = Math.abs(elasticity);
  return {
    elasticity,
    revenueChange: p2 * q2 - p1 * q1,
    range: Math.abs(size - 1) < 1e-9 ? 'unit' : size > 1 ? 'elastic' : 'inelastic',
  };
}

export interface Tax {
  buyersPay: number;
  sellersGet: number;
  quantity: number;
  /** Tax revenue, or the cost of the subsidy as a negative number. */
  revenue: number;
  deadweightLoss: number;
  buyerShare: number;
  sellerShare: number;
  consumerSurplus: number;
  producerSurplus: number;
}

function taxOutcome(k: Curves, e: Equilibrium, buyersPay: number, sellersGet: number): Tax {
  const quantity = demandAt(k, buyersPay);
  const wedge = buyersPay - sellersGet;
  return {
    buyersPay,
    sellersGet,
    quantity,
    revenue: wedge * quantity,
    deadweightLoss: (Math.abs(wedge) * Math.abs(e.quantity - quantity)) / 2,
    buyerShare: wedge === 0 ? 0 : (buyersPay - e.price) / wedge,
    sellerShare: wedge === 0 ? 0 : (e.price - sellersGet) / wedge,
    consumerSurplus: consumerSurplus(k, quantity, buyersPay),
    producerSurplus: producerSurplus(k, quantity, sellersGet),
  };
}

/** A per-unit tax (or, when negative, a subsidy); who it is levied on does not change the result. */
export function unitTax(k: Curves, t: number): Tax | null {
  const e = equilibrium(k);
  if (!e) return null;
  const buyersPay = (k.a - k.c + k.d * t) / (k.b + k.d);
  const quantity = k.a - k.b * buyersPay;
  if (quantity <= 0 || buyersPay - t < 0) return null;
  return taxOutcome(k, e, buyersPay, buyersPay - t);
}

/** A tax of rate r on the sellers' price: buyers pay (1 + r) times what sellers keep. */
export function valueTax(k: Curves, rate: number): Tax | null {
  const e = equilibrium(k);
  if (!e || rate <= -1) return null;
  const buyersPay = (k.a - k.c) / (k.b + k.d / (1 + rate));
  const sellersGet = buyersPay / (1 + rate);
  if (demandAt(k, buyersPay) <= 0 || sellersGet < 0) return null;
  return taxOutcome(k, e, buyersPay, sellersGet);
}

export interface Control {
  binding: boolean;
  price: number;
  quantityDemanded: number;
  quantitySupplied: number;
  traded: number;
  /** Shortage under a ceiling or surplus under a floor. */
  gap: number;
  consumerSurplus: number;
  producerSurplus: number;
  deadweightLoss: number;
}

/** A price ceiling (kind 'ceiling') or floor (kind 'floor'). */
export function priceControl(k: Curves, kind: 'ceiling' | 'floor', level: number): Control | null {
  const e = equilibrium(k);
  if (!e || level < 0) return null;
  const binding = kind === 'ceiling' ? level < e.price : level > e.price;
  const price = binding ? level : e.price;
  const qd = demandAt(k, price);
  const qs = supplyAt(k, price);
  const traded = Math.min(qd, qs);
  // Buyers are served in order of willingness to pay and sellers in order of cost, so surplus is read at the traded amount.
  const cs = consumerSurplus(k, traded, price);
  const ps = producerSurplus(k, traded, price);
  return {
    binding,
    price,
    quantityDemanded: qd,
    quantitySupplied: qs,
    traded,
    gap: Math.abs(qd - qs),
    consumerSurplus: cs,
    producerSurplus: ps,
    deadweightLoss: e.consumerSurplus + e.producerSurplus - cs - ps,
  };
}

export interface Quota {
  binding: boolean;
  buyersPay: number;
  sellersGet: number;
  rentPerUnit: number;
  rent: number;
  deadweightLoss: number;
}

/** A cap on the quantity sold. The gap between what buyers pay and sellers need is the quota rent. */
export function quota(k: Curves, limit: number): Quota | null {
  const e = equilibrium(k);
  if (!e || limit < 0) return null;
  if (limit >= e.quantity) {
    return { binding: false, buyersPay: e.price, sellersGet: e.price, rentPerUnit: 0, rent: 0, deadweightLoss: 0 };
  }
  const buyersPay = buyerPrice(k, limit);
  const sellersGet = sellerPrice(k, limit);
  return {
    binding: true,
    buyersPay,
    sellersGet,
    rentPerUnit: buyersPay - sellersGet,
    rent: (buyersPay - sellersGet) * limit,
    deadweightLoss: ((buyersPay - sellersGet) * (e.quantity - limit)) / 2,
  };
}

export interface Trade {
  autarkyPrice: number;
  worldPrice: number;
  consumption: number;
  production: number;
  /** Positive imports or exports, whichever the country does. */
  flow: number;
  direction: 'imports' | 'exports' | 'none';
  consumerSurplus: number;
  producerSurplus: number;
  totalSurplus: number;
  gainFromTrade: number;
}

function tradeAt(k: Curves, world: number, domestic: number, e: Equilibrium): Trade {
  const consumption = demandAt(k, domestic);
  const production = supplyAt(k, domestic);
  const flow = consumption - production;
  const cs = consumerSurplus(k, consumption, domestic);
  const ps = producerSurplus(k, production, domestic);
  return {
    autarkyPrice: e.price,
    worldPrice: world,
    consumption,
    production,
    flow: Math.abs(flow),
    direction: Math.abs(flow) < 1e-12 ? 'none' : flow > 0 ? 'imports' : 'exports',
    consumerSurplus: cs,
    producerSurplus: ps,
    totalSurplus: cs + ps,
    gainFromTrade: cs + ps - e.consumerSurplus - e.producerSurplus,
  };
}

/** A small open economy that takes the world price. */
export function openEconomy(k: Curves, world: number): Trade | null {
  const e = equilibrium(k);
  return e && world >= 0 ? tradeAt(k, world, world, e) : null;
}

export interface Tariff {
  trade: Trade;
  domesticPrice: number;
  revenue: number;
  deadweightLoss: number;
}

/** A per-unit tariff, or an import quota (kind 'quota' with the quantity in `level`) on an importing country. */
export function importPolicy(k: Curves, world: number, kind: 'tariff' | 'quota', level: number): Tariff | null {
  const e = equilibrium(k);
  const free = openEconomy(k, world);
  if (!e || !free || free.direction !== 'imports' || level < 0) return null;
  let domestic: number;
  if (kind === 'tariff') domestic = Math.min(world + level, e.price);
  else {
    if (level >= free.flow) domestic = world;
    else domestic = Math.min((k.a - k.c - level) / (k.b + k.d), e.price);
  }
  const trade = tradeAt(k, world, domestic, e);
  return {
    trade,
    domesticPrice: domestic,
    revenue: (domestic - world) * trade.flow,
    deadweightLoss: free.totalSurplus - (trade.totalSurplus + (domestic - world) * trade.flow),
  };
}

export interface Externality {
  marketQuantity: number;
  efficientQuantity: number;
  correctiveTax: number;
  deadweightLoss: number;
  priceBuyersPay: number;
}

/** A constant external cost per unit (a negative number is an external benefit). */
export function externality(k: Curves, external: number): Externality | null {
  const e = equilibrium(k);
  if (!e) return null;
  const efficient = (k.a / k.b - -k.c / k.d - external) / (1 / k.b + 1 / k.d);
  if (efficient <= 0) return null;
  return {
    marketQuantity: e.quantity,
    efficientQuantity: efficient,
    correctiveTax: external,
    deadweightLoss: (Math.abs(external) * Math.abs(e.quantity - efficient)) / 2,
    priceBuyersPay: buyerPrice(k, efficient),
  };
}

export interface Labor {
  competitiveWage: number;
  competitiveEmployment: number;
  monopsonyWage: number;
  monopsonyEmployment: number;
}

/** Labor demand (the marginal revenue product) w = m0 - m1 L against supply w = s0 + s1 L, with a monopsony. */
export function labor(m0: number, m1: number, s0: number, s1: number): Labor | null {
  if (!(m1 > 0) || !(s1 > 0) || !(m0 > s0)) return null;
  const competitiveEmployment = (m0 - s0) / (m1 + s1);
  const monopsonyEmployment = (m0 - s0) / (m1 + 2 * s1);
  return {
    competitiveWage: s0 + s1 * competitiveEmployment,
    competitiveEmployment,
    monopsonyWage: s0 + s1 * monopsonyEmployment,
    monopsonyEmployment,
  };
}
