// Where the pinned cross-check tools live and how to find them. See docs/CHECKS.md, "Cross-checks".

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export interface Pin {
  repo: string;
  rev: string;
}

export type ToolName = 'wordcraft-cli' | 'gridcraft-cli' | 'deckcraft-cli' | 'pdfcraft-cli';

export function readPins(): Record<ToolName, Pin> {
  const file = JSON.parse(readFileSync(join(here, 'pins.json'), 'utf8')) as { tools: Record<ToolName, Pin> };
  return file.tools;
}

/** The folder `cargo install --root` fills. CROSSCHECK_ROOT overrides it, and the folder is not tracked. */
export function installRoot(): string {
  return process.env.CROSSCHECK_ROOT ?? join(here, '.tools');
}

/** The path of an installed tool, or undefined when it is not there. GRIDCRAFT_CLI and the like override it. */
export function findTool(name: ToolName): string | undefined {
  const override = process.env[name.toUpperCase().replace('-', '_')];
  if (override !== undefined && override !== '') return existsSync(override) ? override : undefined;
  const exe = join(installRoot(), 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(exe) ? exe : undefined;
}
