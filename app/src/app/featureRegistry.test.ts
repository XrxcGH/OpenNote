// The feature list reads what the app registers, not a hand list. This test loads every feature. It compares the
// commands, title bar items, tool windows, settings sections, and setup steps with docs/tools/registry.json.
// docs/tools/featureList.ts turns that file into docs/FEATURE-LIST.md. `npm run docs:features` rewrites the file,
// since it sets OPENNOTE_WRITE_REGISTRY. The test also fails when something registered has no place in the list.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../features';
import { commands, settingsSections, setupSteps, titleBarItems } from '../registries';
import type { MessageKey } from '../strings/t';
import { t } from '../strings/t';
import { TOOLS } from '../features/tools';
import {
  categoryOfCommand,
  categoryOfTool,
  readRegistry,
  TITLE_BAR,
  TOOL_ENTRIES,
  type Registry,
} from '../../../docs/tools/featureList';

const file = join(import.meta.dirname, '..', '..', '..', 'docs', 'tools', 'registry.json');
const words = (key: string) =>
  t(key as MessageKey)
    .replace(/\s+/g, ' ')
    .trim();
const inOrder = <T extends { order: number }>(items: readonly T[]) => [...items].sort((a, b) => a.order - b.order);

function registered(): Registry {
  return {
    // Commands keep the order they register in, so a kit's tabs are listed in the kit's own order.
    commands: commands.list().map((def) => ({
      id: def.id,
      title: words(def.title),
      category: def.category,
      keys: [...(def.keys ?? [])],
      ...(def.flag ? { flag: def.flag } : {}),
      ...(def.palette === false ? { palette: false as const } : {}),
    })),
    titleBar: [...titleBarItems.list()]
      .sort((a, b) => b.side.localeCompare(a.side) || a.order - b.order)
      .map((item) => ({ id: item.id, side: item.side })),
    tools: TOOLS.map((tool) => ({ id: tool.id, title: words(tool.title) })),
    settings: inOrder(settingsSections.list()).map((s) => ({ id: s.id, title: words(s.title) })),
    setup: inOrder(setupSteps.list()).map((s) => ({ id: s.id, title: words(s.title) })),
  };
}

describe('feature registry', () => {
  const now = registered();
  if (process.env.OPENNOTE_WRITE_REGISTRY) writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);

  it('is what docs/tools/registry.json says, so the feature list cannot miss a new command or tool', () => {
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(now);
    expect(readRegistry()).toEqual(now);
  });

  it('gives every registered tool window an entry with a sentence', () => {
    const described = (id: string) => TOOL_ENTRIES[id]?.feature ?? TOOL_ENTRIES[id]?.text;
    expect(now.tools.filter((tool) => !described(tool.id)).map((tool) => tool.id)).toEqual([]);
    for (const tool of now.tools) expect(categoryOfTool(tool.id), tool.id).toBeTruthy();
  });

  it('gives every title bar item an entry with a sentence', () => {
    expect(now.titleBar.filter((item) => !TITLE_BAR[item.id]).map((item) => item.id)).toEqual([]);
  });

  it('puts every command in a category', () => {
    expect(now.commands.filter((c) => !categoryOfCommand(c)).map((c) => c.id)).toEqual([]);
  });
});
