// The search methods Beta 4 added (see core_bridge/search/extras.rs), each one a call of the `search_call` command.
import type { SearchExtras } from '../../services/search/types';

export function createTauriSearchExtras(call: <T>(method: string, args?: Record<string, unknown>) => Promise<T>): SearchExtras {
  return {
    launchLink: () => call<string | null>('launchLink'),
  };
}
