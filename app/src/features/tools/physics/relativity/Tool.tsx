// The special relativity tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { RELATIVITY } from './spec';

export default function RelativityTool(props: KitToolProps) {
  return <ModeTool spec={RELATIVITY} {...props} />;
}
