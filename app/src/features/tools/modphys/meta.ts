// The modern physics and astronomy tools: their ids, palette strings, and icons. Start-up code reads this list to
// register one command per tool, so it imports nothing.

export type ModPhysToolId =
  'schrodinger' | 'atoms' | 'spin' | 'molecules' | 'solids' | 'plasma' | 'stars' | 'sky' | 'cosmos';

export interface ModPhysMeta {
  id: ModPhysToolId;
  icon: string;
}

export const MODPHYS_TOOLS: readonly ModPhysMeta[] = [
  { id: 'schrodinger', icon: 'Waveform' },
  { id: 'atoms', icon: 'Rainbow' },
  { id: 'spin', icon: 'Atom' },
  { id: 'molecules', icon: 'Hexagon' },
  { id: 'solids', icon: 'Cpu' },
  { id: 'plasma', icon: 'Lightning' },
  { id: 'stars', icon: 'Star' },
  { id: 'sky', icon: 'SunHorizon' },
  { id: 'cosmos', icon: 'Spiral' },
];

export const isModPhysTool = (value: unknown): value is ModPhysToolId =>
  MODPHYS_TOOLS.some((tool) => tool.id === value);

/** The tool window the tools share. */
export const MODPHYS_WINDOW = 'kit-modphys';
