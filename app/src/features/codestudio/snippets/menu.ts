// What the Snippets and examples menu shows and does: an example's title, and the patch that adds it to a
// project. The example's files go in (a file of the same name is replaced), its entry becomes the main file, and its
// tests replace the tests of an earlier example; the person's own tests stay.

import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import type { CodeProject } from '../contracts';
import { nextId, nextOrder } from '../project/model';
import { pathKey } from '../project/paths';
import { EXAMPLE_TEST_PREFIX } from './examples';
import type { Example } from './examples';

export const exampleTitle = (example: Example): string => t(`codeStudio.studio.examples.${example.name}` as MessageKey);

/**
 * The example's paths that the project already holds with other text: inserting it would replace them. Paths match
 * without regard to letter case, as the project's paths are unique that way (gap V2-9).
 */
export function exampleCollisions(project: CodeProject, example: Example): string[] {
  return Object.entries(example.files)
    .filter(([path, text]) =>
      Object.values(project.files).some((file) => pathKey(file.path) === pathKey(path) && file.text !== text),
    )
    .map(([path]) => path);
}

/** The merge patch that adds an example, and the ID of its entry file. */

export function examplePatch(
  project: CodeProject,
  example: Example,
): { patch: Record<string, unknown>; entry: string } {
  const files: Record<string, unknown> = {};
  const taken: Record<string, unknown> = { ...project.files };
  let order = nextOrder(project.files);
  let entry = '';
  for (const [path, text] of Object.entries(example.files)) {
    // A file of the same name in other letter case is the same file: it takes the example's text and keeps its path.
    const existing = Object.entries(project.files).find(([, file]) => pathKey(file.path) === pathKey(path))?.[0];
    const id = existing ?? nextId('f', taken);
    taken[id] = true;
    files[id] = existing ? { text } : { path, text, order: order++ };
    if (path === example.entry) entry = id;
  }
  const tests: Record<string, unknown> = {};
  for (const id of Object.keys(project.tests)) if (id.startsWith(EXAMPLE_TEST_PREFIX)) tests[id] = null;
  for (const test of example.tests) tests[test.id] = test;
  return { patch: { files, tests, main: entry }, entry };
}
