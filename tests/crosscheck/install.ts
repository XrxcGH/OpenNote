// Builds the cross-check tools from their pinned revisions: node tests/crosscheck/install.ts [tool...]
// Needs a Rust toolchain. The first build takes several minutes. The tools stay on this machine and in CI; nothing
// from them ships with OpenNote.

import { spawnSync } from 'node:child_process';
import { findTool, installRoot, readPins, type ToolName } from './tools.ts';

const pins = readPins();
const wanted = process.argv.slice(2) as ToolName[];
const names = (wanted.length > 0 ? wanted : Object.keys(pins)) as ToolName[];
let failed = false;
for (const name of names) {
  const pin = pins[name] as { repo: string; rev: string } | undefined;
  if (pin === undefined) {
    console.error(`Unknown tool ${name}. Known tools: ${Object.keys(pins).join(', ')}`);
    process.exit(2);
  }
  if (findTool(name) !== undefined && process.env.CROSSCHECK_FORCE === undefined) {
    console.log(`${name}: already installed (set CROSSCHECK_FORCE=1 to rebuild)`);
    continue;
  }
  console.log(`${name}: building ${pin.repo} at ${pin.rev}`);
  const run = spawnSync(
    'cargo',
    ['install', '--git', pin.repo, '--rev', pin.rev, '--locked', '--root', installRoot(), '--force', name],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) {
    console.error(`${name}: the build failed. The cross-check skips this tool.`);
    failed = true;
  }
}
// A failed build is a warning, not a reason to stop the job: the checks are advisory.
process.exit(failed && process.env.CROSSCHECK_STRICT !== undefined ? 1 : 0);
