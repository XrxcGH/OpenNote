// The spreadsheet's public face (ADR 0056). Importing it runs every lane's `contribute.ts` under this folder once,
// so each lane adds its commands, menu items, and toolbar groups from its own file (registry.ts).
import.meta.glob('./*/contribute.ts', { eager: true });

export {
  SHEET_CONTEXT_MENU,
  SHEET_LANES,
  SHEET_MENUS,
  contribute,
  sheetMenu,
  sheetMenuItems,
  sheetToolbar,
  sheetToolbarGroups,
} from './registry';
export type { SheetContribution, SheetLane, SheetMenu, SheetMenuItem, SheetToolbarGroup } from './registry';
