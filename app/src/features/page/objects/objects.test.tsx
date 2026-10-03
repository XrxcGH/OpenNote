// Blocks as objects in a real browser: the focus model and its keys, nudges and widths, locks, deleting, z-order,
// the grip drag, the marquee, and focus surviving a reorder.
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../../app/flags';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { PageFixture } from '../../../services/pages/memory';
import type { BlockJson, Edit } from '../../../services/pages/types';
import { announcements } from '../../../test';
import { mountPage } from '../mount';
import type { MountedPage } from '../mount';
import { pageSelection } from '../seams/selectionStore';
import { textPageFixture } from '../test/fixtures';

const shown: { mounted: MountedPage; container: HTMLElement }[] = [];

afterEach(async () => {
  for (const { mounted, container } of shown.splice(0)) {
    await mounted.destroy();
    container.remove();
  }
  pageSelection.set({ blocks: [], strokes: [] });
});

const ids = ['01k6f0000000000000000t0000', '01k6f0000000000000000t0001', '01k6f0000000000000000t0002'] as const;

function boxes(specs: { markdown: string; x: number; y: number; lock?: 'position' | 'all' }[]): PageFixture {
  const base = textPageFixture('').page;
  const blocks = specs.map((spec, i): BlockJson => ({
    id: ids[i]!,
    type: 'text',
    order: `a${i}`,
    created: base.created,
    modified: base.created,
    frame: { x: spec.x, y: spec.y },
    ...(spec.lock ? { lock: spec.lock } : {}),
    data: { markdown: spec.markdown },
  }));
  return { page: { ...base, blocks } };
}

async function open(fixture: PageFixture) {
  initFlags('dev', { 'page.editor': true });
  const service = createMemoryPageService([fixture]);
  const page = await service.open(fixture.page.id, { viewport: null });
  const container = document.body.appendChild(document.createElement('div'));
  Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: '900px', height: '600px' });
  const mounted = mountPage(container, page, { classNames: { viewport: '', world: '', underlay: '' }, shown: false });
  shown.push({ mounted, container });
  const edits = () => service.sent(page.id).flatMap((batch) => batch.edits);
  const batches = () => service.sent(page.id);
  return { mounted, edits, batches };
}

const wrapper = (mounted: MountedPage, id: string) => mounted.layer.view(id)!.element;
const root = (mounted: MountedPage, id: string) => mounted.layer.view(id)!.editRoot!;

function pointer(target: Element, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
  const buttons = type === 'pointerup' ? 0 : 1;
  const init = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true };
  target.dispatchEvent(
    new PointerEvent(type, {
      ...init,
      button: type === 'pointermove' ? -1 : 0,
      buttons,
      clientX: x,
      clientY: y,
      ...extra,
    }),
  );
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe('the focus model', () => {
  it('selects a block with Escape from text, moves by Tab in reading order, and goes back with Enter', async () => {
    const { mounted } = await open(
      boxes([
        { markdown: 'Second', x: 300, y: 40 },
        { markdown: 'First', x: 40, y: 40 },
      ]),
    );
    root(mounted, ids[1]).focus();
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(wrapper(mounted, ids[1]));
    expect(pageSelection.get().blocks).toEqual([ids[1]]);
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(wrapper(mounted, ids[0]));
    expect(pageSelection.get().blocks).toEqual([ids[0]]);
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(root(mounted, ids[0]));
    expect(pageSelection.get().blocks).toEqual([]);
  });

  it('adds and removes the focused block with Space, and says how many are selected', async () => {
    const { mounted } = await open(
      boxes([
        { markdown: 'One', x: 40, y: 40 },
        { markdown: 'Two', x: 300, y: 40 },
      ]),
    );
    mounted.objects.select([ids[0]], { focus: true });
    await userEvent.keyboard('{Tab}');
    mounted.objects.select([ids[0], ids[1]]);
    await userEvent.keyboard(' ');
    expect(pageSelection.get().blocks).toEqual([ids[0]]);
    expect(announcements().at(-1)).toBe('1 item selected.');
  });
});

describe('moving and resizing from the keyboard', () => {
  it('moves 8 units with an arrow and 1 with Ctrl, as one gesture while keys come quickly', async () => {
    const { mounted, batches } = await open(boxes([{ markdown: 'Box', x: 100, y: 100 }]));
    mounted.objects.select([ids[0]], { focus: true });
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Control>}{ArrowDown}{/Control}');
    const moves = batches().filter((batch) => batch.edits[0]?.edit === 'moveBlock');
    expect(moves.map((batch) => batch.edits[0])).toEqual([
      { edit: 'moveBlock', block: ids[0], frame: { x: 108, y: 100 } },
      { edit: 'moveBlock', block: ids[0], frame: { x: 116, y: 100 } },
      { edit: 'moveBlock', block: ids[0], frame: { x: 116, y: 101 } },
    ]);
    expect(new Set(moves.map((batch) => batch.coalesce?.target)).size).toBe(1);
    expect(wrapper(mounted, ids[0]).style.left).toBe('116px');
  });

  it('changes a text box width with Shift and arrows, never below 120 units', async () => {
    const { mounted, edits } = await open(boxes([{ markdown: 'Box', x: 100, y: 100 }]));
    mounted.objects.select([ids[0]], { focus: true });
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(edits().at(-1)).toEqual({ edit: 'moveBlock', block: ids[0], frame: { x: 100, y: 100, w: 120 } });
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(edits().at(-1)).toEqual({ edit: 'moveBlock', block: ids[0], frame: { x: 100, y: 100, w: 128 } });
  });

  it('refuses to move a locked block and says how to unlock it', async () => {
    const { mounted, edits } = await open(boxes([{ markdown: 'Pinned', x: 100, y: 100, lock: 'position' }]));
    mounted.objects.select([ids[0]], { focus: true });
    await userEvent.keyboard('{ArrowRight}');
    expect(edits()).toEqual([]);
    expect(announcements()).toContain('This text box is locked in place. Unlock it from its menu.');
  });

  it('keeps focus, the selection, and its place in the DOM order when a nudge changes the reading order', async () => {
    const { mounted } = await open(
      boxes([
        { markdown: 'A', x: 40, y: 40 },
        { markdown: 'B', x: 40, y: 60 },
      ]),
    );
    mounted.objects.select([ids[1]], { focus: true });
    for (let i = 0; i < 4; i += 1) await userEvent.keyboard('{ArrowUp}');
    expect(mounted.layer.blocks().map((block) => block.id)).toEqual([ids[1], ids[0]]);
    expect(document.activeElement).toBe(wrapper(mounted, ids[1]));
    expect(pageSelection.get().blocks).toEqual([ids[1]]);
    const children = [...mounted.flow.element.children];
    expect(children.indexOf(wrapper(mounted, ids[1]))).toBeLessThan(children.indexOf(wrapper(mounted, ids[0])));
  });
});

describe('object commands', () => {
  it('deletes the selection with an Undo toast', async () => {
    const { mounted, edits } = await open(
      boxes([
        { markdown: 'Gone', x: 40, y: 40 },
        { markdown: 'Stays', x: 300, y: 40 },
      ]),
    );
    mounted.objects.select([ids[0]], { focus: true });
    await userEvent.keyboard('{Backspace}');
    await expect.poll(edits).toContainEqual({ edit: 'deleteBlocks', blocks: [ids[0]] });
    expect(mounted.layer.block(ids[0])).toBeNull();
    expect(document.activeElement).toBe(wrapper(mounted, ids[1]));
  });

  it('brings a block to the front, and says so at the end', async () => {
    const { mounted, edits } = await open(
      boxes([
        { markdown: 'Back', x: 40, y: 40 },
        { markdown: 'Front', x: 60, y: 50 },
      ]),
    );
    mounted.objects.select([ids[0]]);
    expect(mounted.objects.enabled('bringToFront')).toBe(true);
    mounted.objects.command('bringToFront');
    await expect.poll(() => edits().at(-1)).toEqual<Edit>({ edit: 'moveBlock', block: ids[0], after: ids[1] });
    mounted.objects.select([ids[1]]);
    mounted.objects.command('bringToFront');
    expect(announcements().at(-1)).toBe('Already in front');
  });
});

describe('pointer moves', () => {
  it('moves a text box by its grip in one batch when the drag ends', async () => {
    const { mounted, batches } = await open(boxes([{ markdown: 'Drag me', x: 100, y: 100 }]));
    mounted.objects.select([ids[0]]);
    await frame();
    await frame();
    const grip = mounted.chrome.element.querySelector<HTMLElement>('[data-handle="grip"]')!;
    const box = grip.getBoundingClientRect();
    const [x, y] = [box.left + 10, box.top + box.height / 2];
    pointer(grip, 'pointerdown', x, y);
    pointer(grip, 'pointermove', x + 30, y + 20);
    pointer(grip, 'pointermove', x + 50, y + 40);
    expect(wrapper(mounted, ids[0]).style.transform).toBe('translate(50px, 40px)');
    pointer(grip, 'pointerup', x + 50, y + 40);
    const moved = () => batches().filter((batch) => batch.edits[0]?.edit === 'moveBlock');
    await expect.poll(() => moved().length).toBe(1);
    const moves = moved();
    expect(moves[0]!.edits).toEqual([{ edit: 'moveBlock', block: ids[0], frame: { x: 150, y: 140 } }]);
    expect(moves[0]!.coalesce?.kind).toBe('drag');
    expect(wrapper(mounted, ids[0]).style.transform).toBe('');
  });

  it('selects the blocks a marquee touches', async () => {
    const { mounted } = await open(
      boxes([
        { markdown: 'In', x: 100, y: 100 },
        { markdown: 'Also in', x: 200, y: 140 },
        { markdown: 'Out', x: 600, y: 400 },
      ]),
    );
    const world = mounted.viewport.world;
    const origin = mounted.viewport.toClient(60, 60);
    const end = mounted.viewport.toClient(320, 200);
    pointer(world, 'pointerdown', origin.x, origin.y);
    pointer(world, 'pointermove', origin.x + 20, origin.y + 20);
    pointer(world, 'pointermove', end.x, end.y);
    pointer(world, 'pointerup', end.x, end.y);
    expect([...pageSelection.get().blocks].sort()).toEqual([ids[0], ids[1]]);
    expect(mounted.layer.blocks()).toHaveLength(3);
  });
});
