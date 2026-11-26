// The page service contract inside the real app (owner: WP2). page.contract.spec.ts bundles this file and runs it in
// the app's webview, against Phase 3's core through the Tauri adapter. Each case gets pages of its own, seeded with
// CONTRACT_PAGE's title and blocks by a client the case never sees, so its undo stack starts empty.
import { createCoreClient } from '../../../app/src/core/client';
import type { CoreInvoke } from '../../../app/src/core/client';
import type { ImagesClient } from '../../../app/src/platform/types';
import { CONTRACT_CASES, CONTRACT_PAGE } from '../../../app/src/services/pages/contractCases';
import { createTauriPageService } from '../../../app/src/services/pages/tauri';
import type { NewBlock, PageService } from '../../../app/src/services/pages/types';

export interface CaseResult {
  name: string;
  error: string | null;
}

interface Node {
  id: string;
  kind: string;
}

/** A new page in the first section of the first notebook, because the core opens only pages that a notebook holds. */
async function newPageId(invoke: CoreInvoke): Promise<string> {
  const notebooks = (await invoke('notes_list_notebooks')) as Node[];
  const sections = (await invoke('notes_list_children', { parentId: notebooks[0].id })) as Node[];
  const section = sections.find((node) => node.kind === 'section') ?? sections[0];
  const page = (await invoke('notes_create', {
    input: { kind: 'page', placement: { parentId: section.id }, title: 'Contract' },
  })) as Node;
  return page.id;
}

/** A service where CONTRACT_PAGE's ID opens a fresh core page holding its title and blocks. */
async function seededService(invoke: CoreInvoke): Promise<PageService> {
  const service = createTauriPageService(createCoreClient({ invoke }), {} as ImagesClient);
  const fresh = await newPageId(invoke);
  const seed = await service.open(fresh, { viewport: null });
  await seed.send({
    edits: [
      { edit: 'setPage', title: CONTRACT_PAGE.title },
      ...CONTRACT_PAGE.blocks.map((block) => ({
        edit: 'insertBlock' as const,
        // The contract page holds version 1 blocks only.
        block: { id: block.id, type: block.type as NewBlock['type'], data: block.data },
      })),
    ],
  });
  await seed.close();
  return { open: (pageId, options) => service.open(pageId === CONTRACT_PAGE.id ? fresh : pageId, options) };
}

export async function runContract(invoke: CoreInvoke): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const contractCase of CONTRACT_CASES) {
    try {
      await contractCase.run(() => seededService(invoke));
      results.push({ name: contractCase.name, error: null });
    } catch (error) {
      results.push({ name: contractCase.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
