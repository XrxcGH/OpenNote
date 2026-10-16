// @vitest-environment node
// The notes contract suite against the app's notes bridge and a real core, through the notes harness. CI builds
// the harness before it runs this file; without a build, the suite is skipped and says so.

import { afterAll, describe, it } from 'vitest';
import { describeNotesService } from '../contract';
import { harnessPath, NotesHarness } from './harness';
import { createCoreNotesService } from './service';

const path = harnessPath();
let harness: NotesHarness | null = null;

afterAll(() => harness?.close());

if (path) {
  describeNotesService('the core', async () => {
    harness ??= new NotesHarness(path);
    return createCoreNotesService(await harness.reset());
  });
} else {
  describe('notes contract: the core', () => {
    it.skip('needs the notes harness: cargo build -p opennote --example notes_harness', () => {});
  });
}
