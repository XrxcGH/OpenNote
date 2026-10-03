// @vitest-environment node
// Favorite folders and "Update the copy" in the export flow, against the web fake and a stand-in for the host's memory.

import { describe, expect, it } from 'vitest';
import type { ExportRequest, InteropClient } from '../../platform/interop';
import { createWebInterop } from '../../platform/web/interop';
import { createMemoryNotesService } from '../../services/notes/memory';
import { createExportFlow, folderOf } from './exportFlow';
import { resolveTarget } from './exportTarget';

async function setup() {
  const web = createWebInterop();
  const notes = createMemoryNotesService({ seed: 'sample' });
  const notebook = (await notes.listNotebooks())[0];
  const start = (await notes.listChildren(notebook.id))[0];
  const target = await resolveTarget(notes, start.id);
  if (!target) throw new Error('no target');
  const calls: { op: string; args?: Record<string, unknown> }[] = [];
  const requests: ExportRequest[] = [];
  const state = { favorites: [] as string[], copies: [] as { node: string; format: string; path: string }[] };
  const interop: InteropClient = {
    ...web,
    exportTo: (job, request) => {
      requests.push(request);
      return web.exportTo(job, request);
    },
    more: <T>(op: string, args?: Record<string, unknown>) => {
      calls.push({ op, args });
      if (op === 'send_favorite') {
        const path = String(args?.path);
        state.favorites = args?.add ? [path] : state.favorites.filter((f) => f !== path);
      }
      if (op === 'send_record') state.copies = [args as (typeof state.copies)[number]];
      return Promise.resolve(state as T);
    },
  };
  const flow = createExportFlow({ interop, notes, target, announce: () => undefined });
  return { flow, calls, requests, target };
}

describe('sending a copy to a folder', () => {
  it('keeps a favorite folder and lists it for the next export', async () => {
    const { flow } = await setup();
    flow.useFolder('C:\\Users\\Sample\\OneDrive\\Notes');
    await flow.toggleFavorite();
    expect(flow.extras.get().favorites).toEqual(['C:\\Users\\Sample\\OneDrive\\Notes']);
    await flow.toggleFavorite();
    expect(flow.extras.get().favorites).toEqual([]);
  });

  it('remembers a one-file export and replaces that file when it is updated', async () => {
    const { flow, requests, target } = await setup();
    flow.useFolder('C:\\Users\\Sample\\OneDrive\\Notes');
    flow.setFormat('docx');
    await flow.start();
    expect(flow.extras.get().copies).toHaveLength(1);
    const copy = flow.extras.get().copies[0];
    expect(copy.node).toBe(target.choices.find((choice) => choice.scope === target.initial)?.node.id);
    expect(requests[0].replace).toBeUndefined();
    await flow.update({ ...copy, format: 'docx', path: 'C:\\Users\\Sample\\OneDrive\\Notes\\Plan.docx' });
    expect(requests[1].replace).toBe('C:\\Users\\Sample\\OneDrive\\Notes\\Plan.docx');
    expect(requests[1].folder).toBe('C:\\Users\\Sample\\OneDrive\\Notes');
  });

  it('finds the folder of a path with either slash', () => {
    expect(folderOf('C:\\a\\b\\c.docx')).toBe('C:\\a\\b');
    expect(folderOf('C:/a/b/c.docx')).toBe('C:/a/b');
  });
});
