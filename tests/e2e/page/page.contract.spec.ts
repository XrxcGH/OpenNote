// The page service contract against Phase 3's real core (PLAN.md section 6.5; owner: WP2). The same cases as the
// memory service's Vitest run are bundled with the Tauri adapter and run inside the app's webview.
// Run with: node --test tests/e2e/page/page.contract.spec.ts

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { build } from 'rolldown';
import { launchApp, ROOT, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import type { CaseResult } from './contractEntry.ts';

/** contractEntry.ts as one script that defines window.__OPENNOTE_CONTRACT__. */
async function bundle(): Promise<string> {
  const result = await build({
    input: join(ROOT, 'tests', 'e2e', 'page', 'contractEntry.ts'),
    output: { format: 'iife', name: '__OPENNOTE_CONTRACT__' },
    write: false,
  });
  return result.output[0].code;
}

describe('the page service contract against the core', { skip: skipReason() }, () => {
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
  });

  it('passes every case of describePageService', async () => {
    const script = await bundle();
    session = await launchApp();
    await session.browser.execute(`${script}; window.__OPENNOTE_CONTRACT__ = __OPENNOTE_CONTRACT__;`);
    const results = (await session.browser.execute(() => {
      const win = window as unknown as {
        __OPENNOTE_CONTRACT__: { runContract(invoke: unknown): Promise<CaseResult[]> };
        __TAURI_INTERNALS__: { invoke(command: string, args?: unknown): Promise<unknown> };
      };
      return win.__OPENNOTE_CONTRACT__.runContract((command: string, args?: unknown) =>
        win.__TAURI_INTERNALS__.invoke(command, args),
      );
    })) as CaseResult[];
    const failed = results.filter((result) => result.error !== null);
    assert.ok(results.length > 0, 'the cases ran');
    assert.deepEqual(failed, [], failed.map((result) => `${result.name}: ${result.error}`).join('\n'));
  });
});
