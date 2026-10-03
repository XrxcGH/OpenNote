// Keeps every tracked path short enough for a plain `git clone` on Windows. Without `core.longpaths`,
// Windows fails on full paths of 260 characters or more. A clone root such as
// `C:\Users\<name>\Documents\GitHub\OpenNote` takes about 60 of them, and 180 for the path inside the
// repository leaves room to spare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const LIMIT = 180;

test(`every tracked path is at most ${LIMIT} characters`, () => {
  const listing = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const paths = listing.split('\0').filter((path) => path !== '');
  assert.ok(paths.length > 0, 'git ls-files listed no files');
  const long = paths.filter((path) => path.length > LIMIT).map((path) => `${path.length} ${path}`);
  assert.deepEqual(long, [], `paths longer than ${LIMIT} characters:\n${long.join('\n')}`);
});
