// Engineering materials: density, Young's modulus, yield strength, thermal conductivity, and specific heat at room
// temperature. Values are rounded typical values for the named condition. Each row names its sources by id (see
// MATERIAL_SOURCES); all of them are public-domain or openly licensed. Confirm a value with its source before using it
// for a design, because real stock varies with heat treatment and supplier.

export type MaterialGroup = 'aluminum' | 'steel' | 'otherMetal' | 'polymer' | 'ceramic' | 'wood';

export interface Material {
  id: string;
  name: string;
  group: MaterialGroup;
  /** kg/m³ */
  density: number;
  /** GPa */
  modulus: number;
  /** MPa, or null where the material has no yield point (brittle materials, wood, pure heavy metals). */
  yield: number | null;
  /** W/(m·K) */
  conductivity: number;
  /** J/(kg·K) */
  specificHeat: number;
  /** Condition or note, such as the temper. */
  condition: string;
  /** Ids into MATERIAL_SOURCES, mechanical first. */
  sources: readonly string[];
}

export const MATERIAL_SOURCES: Readonly<Record<string, { name: string; license: string; url: string }>> = {
  MIL5: {
    name: 'MIL-HDBK-5J, Metallic Materials and Elements for Aerospace Vehicle Structures (2003)',
    license: 'US Department of Defense publication, public domain',
    url: 'https://quicksearch.dla.mil/',
  },
  NIST: {
    name: 'NIST Standard Reference Data and Cryogenic Materials Database',
    license: 'US Government work, public domain',
    url: 'https://trc.nist.gov/cryogenics/materials/materialproperties.htm',
  },
  FPL: {
    name: 'Wood Handbook: Wood as an Engineering Material, FPL-GTR-190 (2010)',
    license: 'US Forest Products Laboratory, public domain',
    url: 'https://www.fpl.fs.usda.gov/documnts/fplgtr/fplgtr190.pdf',
  },
  ACI: {
    name: 'Modulus of elasticity of normal-weight concrete, Ec = 4700 sqrt(f′c) MPa (ACI 318 relation, used as a formula)',
    license: 'Formula, not copyrightable',
    url: 'https://www.concrete.org/',
  },
  NASA: {
    name: 'NASA Technical Reports Server: engineering properties of common structural materials',
    license: 'US Government work, public domain',
    url: 'https://ntrs.nasa.gov/',
  },
};

const m = (
  id: string,
  name: string,
  group: MaterialGroup,
  condition: string,
  density: number,
  modulus: number,
  yieldStrength: number | null,
  conductivity: number,
  specificHeat: number,
  sources: readonly string[],
): Material => ({
  id,
  name,
  group,
  condition,
  density,
  modulus,
  yield: yieldStrength,
  conductivity,
  specificHeat,
  sources,
});

export const MATERIALS: readonly Material[] = [
  m('al6061', 'Aluminum 6061', 'aluminum', 'T6', 2700, 68.9, 276, 167, 896, ['MIL5', 'NIST']),
  m('al2024', 'Aluminum 2024', 'aluminum', 'T3', 2780, 73.1, 345, 121, 875, ['MIL5', 'NIST']),
  m('al7075', 'Aluminum 7075', 'aluminum', 'T6', 2810, 71.7, 503, 130, 960, ['MIL5', 'NIST']),
  m('al1100', 'Aluminum 1100', 'aluminum', 'O (annealed)', 2710, 68.9, 34, 222, 904, ['MIL5', 'NIST']),
  m('s1020', 'Steel AISI 1020', 'steel', 'hot rolled', 7870, 205, 210, 51.9, 486, ['MIL5', 'NIST']),
  m('s1045', 'Steel AISI 1045', 'steel', 'hot rolled', 7850, 205, 310, 49.8, 486, ['MIL5', 'NIST']),
  m('s4140', 'Steel AISI 4140', 'steel', 'annealed', 7850, 205, 415, 42.6, 473, ['MIL5', 'NIST']),
  m('ss304', 'Stainless steel 304', 'steel', 'annealed', 8000, 193, 215, 16.2, 500, ['MIL5', 'NIST']),
  m('ss316', 'Stainless steel 316', 'steel', 'annealed', 8000, 193, 205, 16.3, 500, ['MIL5', 'NIST']),
  m('gci', 'Gray cast iron', 'steel', 'ASTM class 30', 7100, 100, null, 46, 490, ['MIL5', 'NIST']),
  m('ti64', 'Titanium Ti-6Al-4V', 'otherMetal', 'annealed', 4430, 114, 880, 6.7, 526, ['MIL5', 'NIST']),
  m('cu', 'Copper C11000', 'otherMetal', 'annealed', 8960, 117, 70, 401, 385, ['MIL5', 'NIST']),
  m('brass', 'Brass C26000', 'otherMetal', 'annealed', 8530, 110, 75, 120, 380, ['MIL5', 'NIST']),
  m('mg', 'Magnesium AZ31B', 'otherMetal', 'sheet, H24', 1770, 45, 200, 96, 1000, ['MIL5', 'NIST']),
  m('ni200', 'Nickel 200', 'otherMetal', 'annealed', 8890, 204, 148, 70, 456, ['MIL5', 'NIST']),
  m('in718', 'Inconel 718', 'otherMetal', 'aged', 8190, 200, 1034, 11.4, 435, ['MIL5', 'NIST']),
  m('pb', 'Lead', 'otherMetal', 'pure', 11340, 16, null, 35, 129, ['NIST']),
  m('zn', 'Zinc', 'otherMetal', 'pure', 7140, 108, null, 116, 388, ['NIST']),
  m('w', 'Tungsten', 'otherMetal', 'pure', 19300, 411, null, 173, 132, ['NIST']),
  m('au', 'Gold', 'otherMetal', 'pure', 19300, 79, null, 317, 129, ['NIST']),
  m('ag', 'Silver', 'otherMetal', 'pure', 10490, 83, null, 429, 235, ['NIST']),
  m('abs', 'ABS', 'polymer', 'general purpose', 1050, 2.3, 40, 0.17, 1400, ['NASA', 'NIST']),
  m('nylon', 'Nylon 6/6', 'polymer', 'dry, as molded', 1140, 2.9, 80, 0.25, 1670, ['NASA', 'NIST']),
  m('hdpe', 'Polyethylene HDPE', 'polymer', 'high density', 950, 1, 26, 0.46, 1900, ['NASA', 'NIST']),
  m('pvc', 'PVC', 'polymer', 'rigid', 1400, 3, 45, 0.16, 1000, ['NASA', 'NIST']),
  m('ptfe', 'PTFE', 'polymer', 'virgin', 2200, 0.5, 23, 0.25, 1050, ['NASA', 'NIST']),
  m('pc', 'Polycarbonate', 'polymer', 'general purpose', 1200, 2.4, 62, 0.2, 1200, ['NASA', 'NIST']),
  m('pmma', 'Acrylic (PMMA)', 'polymer', 'cast', 1180, 3.1, 70, 0.2, 1460, ['NASA', 'NIST']),
  m('conc', 'Concrete', 'ceramic', 'normal weight, f′c = 28 MPa', 2400, 24.9, null, 1.4, 880, ['ACI', 'NIST']),
  m('glass', 'Glass', 'ceramic', 'soda-lime', 2500, 70, null, 1, 840, ['NIST']),
  m('silica', 'Fused silica', 'ceramic', 'amorphous', 2200, 73, null, 1.4, 740, ['NIST']),
  m('fir', 'Douglas-fir', 'wood', 'coast type, 12% moisture, along the grain', 510, 13.4, null, 0.12, 1700, ['FPL']),
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();

/** Materials whose name, condition, or group contains every word of the query. */
export function searchMaterials(query: string, groupName?: (group: MaterialGroup) => string): Material[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...MATERIALS];
  return MATERIALS.filter((one) => {
    const haystack = normalize(`${one.name} ${one.condition} ${groupName ? groupName(one.group) : one.group}`);
    return words.every((word) => haystack.includes(word));
  });
}
