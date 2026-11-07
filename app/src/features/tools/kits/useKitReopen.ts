// The React side of a live calculation block's Open in tool: a kit window calls this with its kit id, the tool it is
// showing, and the panel that holds the tool (marked with data-kit-form). See panelForm.ts.
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { watchKitReopen } from './panelForm';

export function useKitReopen(kit: string, tool: string, panel: RefObject<HTMLElement | null>): void {
  useEffect(() => watchKitReopen(kit, tool, () => panel.current), [kit, tool, panel]);
}
