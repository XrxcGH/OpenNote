// The electric and magnetic fields tool's tab: its calculations on the shared physics tool form.
import type { KitToolProps } from '../kit/types';
import { ModeTool } from '../ui/ModeTool';
import { FIELDS } from './spec';

export default function FieldsTool(props: KitToolProps) {
  return <ModeTool spec={FIELDS} {...props} />;
}
