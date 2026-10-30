// The nuclear science tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { NUCLEAR } from './spec';

export default function NuclearTool(props: KitToolProps) {
  return <ModeTool spec={NUCLEAR} {...props} />;
}
