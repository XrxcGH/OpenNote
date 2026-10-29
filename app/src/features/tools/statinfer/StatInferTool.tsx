// The statistics kit's window: the kit foundation's tabbed window over the kit's tools.
import { KitWindow } from '../kits/ui/KitWindow';
import { STAT_KIT } from './kit';

export function StatInferTool() {
  return <KitWindow kit={STAT_KIT} />;
}
