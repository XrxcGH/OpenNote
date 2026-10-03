// The page service contract inside the real app (owner: WP2). page.contract.spec.ts bundles this file and runs it in
// the app's webview, against Phase 3's core through the Tauri adapter. Each case gets pages of its own, seeded with
// CONTRACT_PAGE's title and blocks by a client the case never sees, so its undo stack starts empty.
import { createCoreClient } from '../../../app/src/core/client';
import type { CoreInvoke } from '../../../app/src/core/client';
import type { ImagesClient } from '../../../app/src/platform/types';
import { CONTRACT_CASES, CONTRACT_PAGE } from '../../../app/src/services/pages/contractCases';
import { createTauriPageService } from '../../../app/src/services/pages/tauri';
import type { PageService } from '../../../app/src/services/pages/types';

export interface CaseResult {
  name: string;
  error: string | null;
}

/** A service where CONTRACT_PAGE's ID opens a fresh core page holding its title and blocks. */
async function seededService(invoke: CoreInvoke, run: string): Promise<PageService> {
  const service = createTauriPageService(createCoreClient({ invoke }), {} as ImagesClient);
  const fresh = `${CONTRACT_PAGE.id}-${run}`;
  const seed = await service.open(fresh, { viewport: null });
  await seed.send({
    edits: [
      { edit: 'setPage', title: CONTRACT_PAGE.title },
      ...CONTRACT_PAGE.blocks.map((block) => ({
        edit: 'insertBlock' as const,
        block: { id: block.id, type: block.type, data: block.data },
      })),
    ],
  });
  await seed.close();
  return { open: (pageId, options) => service.open(pageId === CONTRACT_PAGE.id ? fresh : pageId, options) };
}

export async function runContract(invoke: CoreInvoke): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const stamp = Date.now().toString(36);
  for (const [index, contractCase] of CONTRACT_CASES.entries()) {
    try {
      await contractCase.run(() => seededService(invoke, `${stamp}-${index}`));
      results.push({ name: contractCase.name, error: null });
    } catch (error) {
      results.push({ name: contractCase.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
