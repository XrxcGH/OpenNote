// The orbital maneuvers tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { MANEUVERS } from './spec';

export default function ManeuversTool(props: KitToolProps) {
  return <ModeTool spec={MANEUVERS} {...props} />;
}
