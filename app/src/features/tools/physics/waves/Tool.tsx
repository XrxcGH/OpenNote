// The waves and sound tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { WAVES } from './spec';

export default function WavesTool(props: KitToolProps) {
  return <ModeTool spec={WAVES} {...props} />;
}
