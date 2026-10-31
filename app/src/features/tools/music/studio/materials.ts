// Materials arithmetic for studio work: fabric yardage, the weight of a sculpture, and ceramic glaze recipes taken to
// the Seger unity formula, with loss on ignition. Molar masses come from the chemistry tools' formula reader.
import { molarMass } from '../../chem/calc/formula';

export interface Piece {
  width: number;
  length: number;
  quantity: number;
}

export interface Yardage {
  /** Length of fabric needed along the bolt. */
  length: number;
  rows: number;
  /** Pieces placed across the width in each row. */
  across: number[];
}

/**
 * A shelf estimate of the fabric length for rectangular pieces on a bolt. With nap every piece keeps its direction
 * (its length runs along the bolt). Without nap a piece may turn, and the better of two plans is used: the shorter
 * side across the bolt, or the longer. A repeat rounds the length up to a whole repeat.
 */
export function yardage(pieces: readonly Piece[], fabricWidth: number, nap: boolean, repeat = 0): Yardage | null {
  const plans = nap ? [false] : [false, true];
  let best: Yardage | null = null;
  for (const longAcross of plans) {
    const plan = shelves(pieces, fabricWidth, nap, longAcross);
    if (plan && (!best || plan.length < best.length)) best = plan;
  }
  if (best && repeat > 0) best = { ...best, length: Math.ceil(best.length / repeat - 1e-9) * repeat };
  return best;
}

function shelves(pieces: readonly Piece[], fabricWidth: number, nap: boolean, longAcross: boolean): Yardage | null {
  const oriented: { across: number; along: number }[] = [];
  for (const p of pieces) {
    let across = p.width;
    let along = p.length;
    if (!nap) {
      const [short, long] = [Math.min(across, along), Math.max(across, along)];
      [across, along] = longAcross ? [long, short] : [short, long];
    }
    if (across > fabricWidth + 1e-9) return null;
    for (let i = 0; i < p.quantity; i++) oriented.push({ across, along });
  }
  oriented.sort((a, b) => b.along - a.along);
  const rows: { used: number; height: number; count: number }[] = [];
  for (const piece of oriented) {
    const row = rows.find((r) => r.used + piece.across <= fabricWidth + 1e-9);
    if (row) {
      row.used += piece.across;
      row.count += 1;
    } else {
      rows.push({ used: piece.across, height: piece.along, count: 1 });
    }
  }
  return { length: rows.reduce((sum, r) => sum + r.height, 0), rows: rows.length, across: rows.map((r) => r.count) };
}

export type Shape = 'block' | 'cylinder' | 'sphere' | 'volume';

/** Volume in cubic units of a simple form; `b` is the second size (depth, or unused). */
export function shapeVolume(shape: Shape, a: number, b: number, c: number): number {
  switch (shape) {
    case 'block':
      return a * b * c;
    case 'cylinder':
      return Math.PI * (a / 2) ** 2 * b;
    case 'sphere':
      return (Math.PI * a ** 3) / 6;
    case 'volume':
      return a;
  }
}

/** Densities in g/cm³ of common sculpture materials (rounded handbook values; stone and alloys vary). */
export const DENSITIES: Record<string, number> = {
  water: 1,
  aluminum: 2.7,
  marble: 2.7,
  iron: 7.87,
  bronze: 8.8,
  copper: 8.96,
  lead: 11.34,
};

export const FLUXES: ReadonlySet<string> = new Set(['Li2O', 'Na2O', 'K2O', 'CaO', 'MgO', 'BaO', 'SrO', 'ZnO', 'PbO']);
export const ALKALI: ReadonlySet<string> = new Set(['Li2O', 'Na2O', 'K2O']);
export const VOLATILE: ReadonlySet<string> = new Set(['CO2', 'H2O', 'SO3', 'SO2']);

export interface Material {
  label: string;
  /** The oxides it is made of, with the number of each in one formula unit. */
  oxides: { oxide: string; count: number; mass: number }[];
  /** Grams of the material in the recipe. */
  grams: number;
  /** Molar mass of one formula unit. */
  mass: number;
}

/** Reads "Label: CaO.CO2 20" or "CaO.CO2 20": a formula of oxides joined by dots, then the grams. */
export function parseMaterial(line: string): Material | null {
  const match = /^(?:([^:]+):)?\s*(\S+)\s+(\d*\.?\d+)\s*$/.exec(line.trim());
  if (!match) return null;
  const formula = match[2]!;
  const oxides: Material['oxides'] = [];
  for (const part of formula.replace(/[·*]/g, '.').split('.')) {
    const piece = /^(\d*\.?\d*)([A-Z][A-Za-z0-9()]*)$/.exec(part);
    if (!piece) return null;
    const mass = molarMass(piece[2]!);
    if (mass === null) return null;
    oxides.push({ oxide: piece[2]!, count: piece[1] ? Number(piece[1]) : 1, mass });
  }
  const mass = oxides.reduce((sum, o) => sum + o.count * o.mass, 0);
  return { label: match[1]?.trim() || formula, oxides, grams: Number(match[3]), mass };
}

export interface Glaze {
  totalGrams: number;
  /** Moles of each oxide that stays in the glaze, by oxide. */
  moles: Map<string, number>;
  fluxMoles: number;
  /** Each fired oxide in moles per mole of flux (the Seger unity formula). */
  unity: Map<string, number>;
  alkali: number;
  alkalineEarth: number;
  /** Silica to alumina ratio, or null with no alumina. */
  silicaAlumina: number | null;
  /** Loss on ignition as a fraction of the batch weight. */
  loi: number;
}

export function glaze(materials: readonly Material[]): Glaze | null {
  const moles = new Map<string, number>();
  let lost = 0;
  let totalGrams = 0;
  for (const m of materials) {
    totalGrams += m.grams;
    const units = m.grams / m.mass;
    for (const o of m.oxides) {
      if (VOLATILE.has(o.oxide)) lost += units * o.count * o.mass;
      else moles.set(o.oxide, (moles.get(o.oxide) ?? 0) + units * o.count);
    }
  }
  let fluxMoles = 0;
  for (const [oxide, amount] of moles) if (FLUXES.has(oxide)) fluxMoles += amount;
  if (fluxMoles <= 0) return null;
  const unity = new Map([...moles].map(([oxide, amount]) => [oxide, amount / fluxMoles]));
  let alkali = 0;
  for (const [oxide, amount] of unity) if (ALKALI.has(oxide)) alkali += amount;
  const alumina = unity.get('Al2O3');
  return {
    totalGrams,
    moles,
    fluxMoles,
    unity,
    alkali,
    alkalineEarth: 1 - alkali,
    silicaAlumina: alumina ? (unity.get('SiO2') ?? 0) / alumina : null,
    loi: lost / totalGrams,
  };
}

/** Grams of each material when the recipe is scaled to a batch weight. */
export const scaleBatch = (materials: readonly Material[], batch: number): number[] => {
  const total = materials.reduce((sum, m) => sum + m.grams, 0);
  return materials.map((m) => (m.grams / total) * batch);
};

/** Loss on ignition of a single material as a fraction of its weight. */
export function lossOnIgnition(material: Material): number {
  const lost = material.oxides.filter((o) => VOLATILE.has(o.oxide)).reduce((sum, o) => sum + o.count * o.mass, 0);
  return lost / material.mass;
}
