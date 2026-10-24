// A small table of nuclides for the nuclear science tool. Atomic masses of neutral atoms, in u, are from the 2020
// Atomic Mass Evaluation (AME2020, Wang et al., Chinese Physics C 45, 030003). Half-lives are from NUBASE2020 (Kondev
// et al., Chinese Physics C 45, 030001). The Atomic Mass Data Center publishes both. Masses and half-lives are
// measured facts; the table keeps the digits a course needs, not each value's uncertainty.

const Y = 365.25 * 86_400;
const D = 86_400;

export interface Nuclide {
  /** Written as the tool reads it: element symbol, a hyphen, and the mass number, such as 'He-4'. */
  id: string;
  Z: number;
  A: number;
  /** Atomic mass of the neutral atom, u. */
  mass: number;
  /** Half-life in seconds; absent for a stable nuclide. */
  halfLife?: number;
}

export const NUCLIDES: readonly Nuclide[] = [
  { id: 'n', Z: 0, A: 1, mass: 1.00866491595 },
  { id: 'H-1', Z: 1, A: 1, mass: 1.00782503223 },
  { id: 'H-2', Z: 1, A: 2, mass: 2.01410177812 },
  { id: 'H-3', Z: 1, A: 3, mass: 3.01604928132, halfLife: 12.32 * Y },
  { id: 'He-3', Z: 2, A: 3, mass: 3.01602932197 },
  { id: 'He-4', Z: 2, A: 4, mass: 4.00260325413 },
  { id: 'Li-6', Z: 3, A: 6, mass: 6.0151228874 },
  { id: 'Li-7', Z: 3, A: 7, mass: 7.0160034366 },
  { id: 'Be-9', Z: 4, A: 9, mass: 9.012183065 },
  { id: 'B-10', Z: 5, A: 10, mass: 10.01293695 },
  { id: 'B-11', Z: 5, A: 11, mass: 11.00930536 },
  { id: 'C-12', Z: 6, A: 12, mass: 12 },
  { id: 'C-13', Z: 6, A: 13, mass: 13.00335483507 },
  { id: 'C-14', Z: 6, A: 14, mass: 14.0032419884, halfLife: 5700 * Y },
  { id: 'N-14', Z: 7, A: 14, mass: 14.00307400443 },
  { id: 'N-15', Z: 7, A: 15, mass: 15.00010889888 },
  { id: 'O-16', Z: 8, A: 16, mass: 15.99491461957 },
  { id: 'O-17', Z: 8, A: 17, mass: 16.9991317565 },
  { id: 'O-18', Z: 8, A: 18, mass: 17.99915961286 },
  { id: 'Ar-40', Z: 18, A: 40, mass: 39.9623831237 },
  { id: 'K-40', Z: 19, A: 40, mass: 39.963998166, halfLife: 1.248e9 * Y },
  { id: 'Fe-56', Z: 26, A: 56, mass: 55.93493633 },
  { id: 'Co-60', Z: 27, A: 60, mass: 59.93381554, halfLife: 1925.28 * D },
  { id: 'Ni-60', Z: 28, A: 60, mass: 59.93078588 },
  { id: 'Ni-62', Z: 28, A: 62, mass: 61.92834537 },
  { id: 'I-131', Z: 53, A: 131, mass: 130.9061263, halfLife: 8.0252 * D },
  { id: 'Cs-137', Z: 55, A: 137, mass: 136.9070895, halfLife: 30.08 * Y },
  { id: 'Ba-137', Z: 56, A: 137, mass: 136.9058274 },
  { id: 'Pb-206', Z: 82, A: 206, mass: 205.9744653 },
  { id: 'Pb-208', Z: 82, A: 208, mass: 207.9766521 },
  { id: 'Po-210', Z: 84, A: 210, mass: 209.9828737, halfLife: 138.376 * D },
  { id: 'Rn-222', Z: 86, A: 222, mass: 222.0175782, halfLife: 3.8215 * D },
  { id: 'Ra-226', Z: 88, A: 226, mass: 226.0254103, halfLife: 1600 * Y },
  { id: 'U-235', Z: 92, A: 235, mass: 235.0439301, halfLife: 7.04e8 * Y },
  { id: 'U-238', Z: 92, A: 238, mass: 238.0507884, halfLife: 4.468e9 * Y },
  { id: 'Pu-239', Z: 94, A: 239, mass: 239.0521636, halfLife: 24_110 * Y },
  { id: 'Am-241', Z: 95, A: 241, mass: 241.0568293, halfLife: 432.6 * Y },
];

/** Particles a reaction may name: with atomic masses, an electron is already counted in the neutral atom it joins. */
const ALIASES: Record<string, string> = {
  p: 'H-1',
  d: 'H-2',
  t: 'H-3',
  alpha: 'He-4',
  a: 'He-4',
  α: 'He-4',
};

export interface Particle {
  Z: number;
  A: number;
  /** Its mass in the atomic-mass bookkeeping, u. */
  mass: number;
}

/** The nuclide or particle a word names (He-4, he4, 4He, alpha, n, gamma, e-, e+, nu), or null. */
export function findParticle(word: string, electronMass: number): Particle | null {
  const raw = word.trim();
  const lower = raw.toLowerCase();
  if (['gamma', 'g', 'γ', 'nu', 'ν', 'antinu', 'v'].includes(lower)) return { Z: 0, A: 0, mass: 0 };
  // Beta minus: its electron joins the daughter atom, so it adds no mass. Beta plus: the daughter atom also sheds an
  // electron, so the positron counts as 2 electron masses.
  if (['e-', 'e', 'beta-', 'β-', 'β⁻'].includes(lower)) return { Z: -1, A: 0, mass: 0 };
  if (['e+', 'beta+', 'β+', 'β⁺'].includes(lower)) return { Z: 1, A: 0, mass: 2 * electronMass };
  const id = ALIASES[lower] ?? canonical(raw);
  const found = id ? NUCLIDES.find((one) => one.id.toLowerCase() === id.toLowerCase()) : undefined;
  return found ? { Z: found.Z, A: found.A, mass: found.mass } : null;
}

/** He-4, he4, 4He, and He4 all name the same nuclide. */
function canonical(word: string): string | null {
  if (word.toLowerCase() === 'n') return 'n';
  const after = /^([A-Za-z]{1,2})-?(\d{1,3})$/.exec(word);
  if (after) return `${after[1]}-${after[2]}`;
  const before = /^(\d{1,3})-?([A-Za-z]{1,2})$/.exec(word);
  return before ? `${before[2]}-${before[1]}` : null;
}

export const nuclideById = (id: string): Nuclide | undefined => NUCLIDES.find((one) => one.id === id);
