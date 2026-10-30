// The spacecraft sizing and link budgets tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { SPACECRAFT } from './spec';

export default function SpacecraftTool(props: KitToolProps) {
  return <ModeTool spec={SPACECRAFT} {...props} />;
}
