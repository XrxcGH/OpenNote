// The interference, diffraction, and polarization tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { WAVE_OPTICS } from './spec';

export default function WaveOpticsTool(props: KitToolProps) {
  return <ModeTool spec={WAVE_OPTICS} {...props} />;
}
