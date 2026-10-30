// The geometric optics and Gaussian beams tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { GEO_OPTICS } from './spec';

export default function GeoOpticsTool(props: KitToolProps) {
  return <ModeTool spec={GEO_OPTICS} {...props} />;
}
