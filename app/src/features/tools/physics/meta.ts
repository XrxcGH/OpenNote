// The physics tools, in the order the window lists them: id and icon. Each tool's title, palette command and
// keywords are kitPhysics.<id>.title, .open and .keywords. The palette registration keeps the same list
// (registrations/kitPhysics.ts), and a test checks the two agree.
export const PHYSICS_TOOLS = [
  { id: 'fields', icon: 'Magnet' },
  { id: 'waves', icon: 'WaveSine' },
  { id: 'geooptics', icon: 'Eyeglasses' },
  { id: 'waveoptics', icon: 'Rainbow' },
  { id: 'relativity', icon: 'HourglassMedium' },
  { id: 'nuclear', icon: 'Radioactive' },
  { id: 'orbits', icon: 'Planet' },
  { id: 'maneuvers', icon: 'RocketLaunch' },
  { id: 'spacecraft', icon: 'Rocket' },
] as const satisfies readonly {
  id: string;
  icon: string;
}[];

export type PhysicsToolId = (typeof PHYSICS_TOOLS)[number]['id'];
