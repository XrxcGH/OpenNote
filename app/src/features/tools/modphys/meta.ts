// The modern physics and astronomy tools: their ids, palette strings, and icons. Start-up code reads this list to
// register one command per tool, so it imports nothing.

export type ModPhysToolId = 'plasma' | 'stars';

export interface ModPhysMeta {
  id: ModPhysToolId;
  icon: string;
}

export const MODPHYS_TOOLS: readonly ModPhysMeta[] = [
  { id: 'stars', icon: 'Star' },
  { id: 'plasma', icon: 'Lightning' },
];

export const isModPhysTool = (value: unknown): value is ModPhysToolId =>
  MODPHYS_TOOLS.some((tool) => tool.id === value);

/** The tool window the tools share. */
export const MODPHYS_WINDOW = 'kit-modphys';
