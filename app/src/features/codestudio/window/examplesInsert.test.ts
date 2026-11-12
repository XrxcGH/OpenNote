// @vitest-environment jsdom
// An example never replaces a project file of the same name silently (review gap G5), and New project never
// replaces scratch work silently (gap G6). A scratch project has no page undo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm } from '../../../ui';
import { EXAMPLES } from '../snippets/examples';
import { exampleCollisions } from '../snippets/menu';
import { StudioController } from './controller';
import { newProjectData, replaceScratchProject, scratchHasWork } from './newProject';
import { resetScratch, scratchSource, storedScratch } from './source';

vi.mock('../../../ui', async (original) => ({ ...(await original<object>()), confirm: vi.fn() }));

const hello = EXAMPLES.find((one) => one.language === 'python' && one.name === 'hello')!;
const helloPath = hello.entry;

beforeEach(() => localStorage.clear());
afterEach(() => vi.mocked(confirm).mockReset());

/** A scratch studio with the hello example in it, its file then edited. */
async function edited() {
  const controller = new StudioController();
  controller.open(scratchSource());
  expect(await controller.insertExample(hello, () => Promise.resolve(true))).toBe(true);
  const id = controller.fileIds().find((one) => controller.pathOf(one) === helloPath)!;
  controller.store!.editFile(id, 'my own work');
  controller.store!.flush();
  return { controller, id };
}

describe('inserting an example over a file of the same name', () => {
  it('finds only the files whose text differs', () => {
    const controller = new StudioController();
    controller.open(scratchSource());
    expect(exampleCollisions(controller.project()!, hello)).toEqual([]);
  });

  it('asks first, and keeps the file when the person says no', async () => {
    const { controller, id } = await edited();
    const ask = vi.fn(() => Promise.resolve(false));
    expect(await controller.insertExample(hello, ask)).toBe(false);
    expect(ask).toHaveBeenCalledWith([helloPath]);
    expect(controller.project()!.files[id]!.text).toBe('my own work');
  });

  it('replaces the file when the person says yes', async () => {
    const { controller, id } = await edited();
    expect(await controller.insertExample(hello, () => Promise.resolve(true))).toBe(true);
    expect(controller.project()!.files[id]!.text).toBe(hello.files[helloPath]);
  });

  it('says so when the example becomes the main file', async () => {
    const controller = new StudioController();
    controller.open(scratchSource());
    const other = EXAMPLES.find(
      (one) => one.language === 'python' && one.entry !== controller.pathOf(controller.project()!.main),
    )!;
    expect(await controller.insertExample(other, () => Promise.resolve(true))).toBe(true);
    expect(controller.notice).toMatch(/is now the main file/);
  });
});

describe('New project with no page', () => {
  it('replaces a scratch project with no work in it without asking', async () => {
    resetScratch(newProjectData('python'));
    expect(scratchHasWork()).toBe(false);
    expect(await replaceScratchProject(newProjectData('lua'))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before replacing scratch work, and keeps it on Cancel', async () => {
    resetScratch(newProjectData('python', 'print("mine")'));
    expect(scratchHasWork()).toBe(true);
    vi.mocked(confirm).mockResolvedValue(false);
    expect(await replaceScratchProject(newProjectData('lua'))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(storedScratch())).toContain('print(\\"mine\\")');
  });
});
