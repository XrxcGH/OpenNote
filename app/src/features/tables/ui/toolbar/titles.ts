// The title of a cell format command, for the palette and menus. A module of its own so start-up loads no actions.
import type { MessageKey } from '../../../../strings/t';

export const commandTitle = (key: string): MessageKey => `sheetToolbar.commands.${key}` as MessageKey;
