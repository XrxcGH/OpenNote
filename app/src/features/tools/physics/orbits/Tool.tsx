// The orbital mechanics tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { ORBITS } from './spec';

export default function OrbitsTool(props: KitToolProps) {
  return <ModeTool spec={ORBITS} {...props} />;
}
