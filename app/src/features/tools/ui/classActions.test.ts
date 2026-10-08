// Opening a class makes the day's page from the class template and goes to it; Record does the same and then asks for
// a recording, only because it was pressed. Opening a class never records.
import { describe, expect, it, vi } from 'vitest';
import type { ClassSlot } from '../upcoming';
import {
  DEFAULT_CLASS_TEMPLATE,
  classPageTitle,
  ensureClassPage,
  openClass,
  recordClass,
  renderClassTemplate,
} from './classActions';
import type { ClassDeps } from './classActions';

const day = { year: 2026, month: 10, day: 7 };
const biology: ClassSlot = {
  id: 'k1',
  name: 'Biology 101',
  days: [3],
  start: '09:00',
  end: '09:50',
  room: 'Hall B',
  section: { id: 'sec1', label: 'Biology, Lectures', notebookId: 'nb1' },
};

function world(existing: string[] = []) {
  const created: { title: string; parent: string }[] = [];
  const edits: unknown[] = [];
  const titles = [...existing];
  const notes = {
    get: async (id: string) => (id === 'sec1' ? { id: 'sec1', kind: 'section', title: 'Lectures' } : null),
    listChildren: async () => titles.map((title, index) => ({ id: `p${index}`, kind: 'page', title })),
    create: async (input: { title: string; placement: { parentId: string } }) => {
      created.push({ title: input.title, parent: input.placement.parentId });
      titles.push(input.title);
      return { id: 'new', kind: 'page', title: input.title };
    },
  };
  const pages = {
    open: async () => ({
      send: async (batch: unknown) => void edits.push(batch),
      close: async () => undefined,
    }),
  };
  const deps = { notes, pages, template: DEFAULT_CLASS_TEMPLATE } as unknown as ClassDeps;
  return { deps, created, edits };
}

describe('the page for a class on a day', () => {
  it('is titled with the class and the date, so the same title finds the same page', () => {
    expect(classPageTitle(biology, day)).toBe('Biology 101 2026-10-07');
  });

  it('is made in the class section from the template the first time', async () => {
    const { deps, created, edits } = world();
    const result = await ensureClassPage(biology, day, deps);
    expect(result).toMatchObject({ ok: true, made: true });
    expect(created).toEqual([{ title: 'Biology 101 2026-10-07', parent: 'sec1' }]);
    const batch = edits[0] as { edits: { block: { data: { markdown: string } } }[] };
    expect(batch.edits[0].block.data.markdown).toContain('Biology 101,');
  });

  it('is found, not made again, the next time', async () => {
    const { deps, created } = world(['Biology 101 2026-10-07']);
    const result = await ensureClassPage(biology, day, deps);
    expect(result).toMatchObject({ ok: true, made: false });
    expect(created).toEqual([]);
  });

  it('says so when the class has no section, or its section is gone', async () => {
    const { deps } = world();
    expect(await ensureClassPage({ ...biology, section: undefined }, day, deps)).toEqual({
      ok: false,
      reason: 'noSection',
    });
    expect(await ensureClassPage({ ...biology, section: { ...biology.section!, id: 'lost' } }, day, deps)).toEqual({
      ok: false,
      reason: 'sectionGone',
    });
  });
});

describe('the class template', () => {
  it('fills in the class, the day, and the room, and leaves other braces alone', () => {
    const text = renderClassTemplate('{class} {date} in {room} {unknown}', biology, day);
    expect(text).toBe('Biology 101 2026-10-07 in Hall B {unknown}');
  });
});

describe('opening and recording a class', () => {
  it('opens the page and does not record', async () => {
    const { deps } = world();
    const open = vi.fn(async () => true);
    const record = vi.fn(async () => undefined);
    const result = await openClass(biology, day, deps, open);
    expect(result.ok).toBe(true);
    expect(open).toHaveBeenCalledWith(deps.notes, 'new');
    expect(record).not.toHaveBeenCalled();
  });

  it('asks for a recording only through Record, after the page is open', async () => {
    const { deps } = world();
    const order: string[] = [];
    const open = vi.fn(async () => (order.push('open'), true));
    const record = vi.fn(async () => void order.push('record'));
    await recordClass(biology, day, record, deps, open);
    expect(order).toEqual(['open', 'record']);
  });

  it('does not record when the class has nowhere to open', async () => {
    const { deps } = world();
    const record = vi.fn(async () => undefined);
    const result = await recordClass({ ...biology, section: undefined }, day, record, deps, async () => true);
    expect(result.ok).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
});
