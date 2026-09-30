// The start-up regression check (ARCHITECTURE.md section 20.5). WP1 builds it: it launches the exe several times
// with OPENNOTE_PERF_LOG and a seeded profile, and compares the medians with the latest main baseline.
// Until then it only reports that the check isn't built, so CI can already call it with its final arguments:
//   node tests/perf/startup.ts --runs 5 --exe target/e2e/opennote.exe --compare-with main

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    exe: { type: 'string' },
    'compare-with': { type: 'string' },
    report: { type: 'boolean', default: false },
    record: { type: 'boolean', default: false },
  },
});

console.log(`The start-up check isn't built yet (WP1), so nothing was measured. Arguments: ${JSON.stringify(values)}`);
