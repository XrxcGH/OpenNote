// The earth, atmosphere, and ocean sciences kit's tools: their ids and palette icons. The palette reads this list
// at start-up (through ../flags.ts), so it holds plain data only; each tool's code loads when its window opens.

export const EARTH_TOOL_IDS = ['air', 'seismic', 'geophysics', 'ocean'] as const;

export type EarthToolId = (typeof EARTH_TOOL_IDS)[number];

const ICONS: Record<EarthToolId, string> = {
  air: 'Wind',
  seismic: 'Pulse',
  geophysics: 'Magnet',
  ocean: 'Waves',
};

export const EARTH_TOOLS: readonly { id: EarthToolId; icon: string }[] = EARTH_TOOL_IDS.map((id) => ({
  id,
  icon: ICONS[id],
}));

export const isEarthTool = (value: unknown): value is EarthToolId =>
  typeof value === 'string' && (EARTH_TOOL_IDS as readonly string[]).includes(value);
