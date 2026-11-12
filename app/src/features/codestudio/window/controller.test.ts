// @vitest-environment jsdom
// The studio follows the shown page (review gap G1). Text typed after the project's page closed is never reported
// as sent. The project binds again when its page comes back. A keystroke or a caret move redraws only what shows it
// (gap G5).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MountedPage } from '../../page';
import { shownMounted } from '../../page';
import { CODE_PROJECT_TYPE } from '../contracts';
import type { CodeEditor } from '../editor/create';
import { starterProject } from '../project/model';
import { StudioController } from './controller';
import type { Channel, RelayMessage } from './relay';
import { remoteSource, serveRelay } from './relay';
import { blockSource, PAGE_LEAVING_EVENT, scratchSource } from './source';
import type { ProjectSource } from './source';

const BLOCK = 'p1';

/** A page view with one project block, as much of it as a block source reads. */
function fakeMount(data: Record<string, unknown>) {
  let block: { data: Record<string, unknown> } | null = { id: BLOCK, type: CODE_PROJECT_TYPE, data } as unknown as {
    data: Record<string, unknown>;
  };
  const sent: Record<string, unknown>[] = [];
  const changes = new Set<() => void>();
  const state = { upserts: 0, refuse: null as string | null };
  const mounted = {
    page: { readOnly: null },
    layer: {
      block: (id: string) => (id === BLOCK ? block : null),
      onChange: (listener: () => void) => {
        changes.add(listener);
        return () => changes.delete(listener);
      },
      upsert: (next: NonNullable<typeof block>) => {
        state.upserts += 1;
        block = next;
      },
    },
    sync: {
      send: (batch: { edits: { data: Record<string, unknown> }[] }) => {
        // A closed page or a missing block refuses the send, as the page's sync does.
        if (state.refuse) return Promise.reject(new Error(state.refuse));
        sent.push(batch.edits[0]!.data);
        return Promise.resolve();
      },
    },
  } as unknown as MountedPage;
  const changed = () => changes.forEach((listener) => listener());
  /** The block is deleted on the page, then brought back as undo does. */
  const remove = () => {
    const was = block;
    block = null;
    changed();
    return () => {
      block = was;
      changed();
    };
  };
  /** The texts each patch carried for a file. */
  const texts = (id: string) =>
    sent.map((data) => (data.files as Record<string, { text?: string }> | undefined)?.[id]?.text).filter(Boolean);
  return { mounted, texts, data: () => block!.data, remove, state };
}

/** A page view with no project block. */
const otherMount = () =>
  ({ page: { readOnly: null }, layer: { block: () => null, onChange: () => () => {} } }) as unknown as MountedPage;

function fakeEditor(text: string) {
  const editor = {
    text,
    readOnly: false,
    getText: () => editor.text,
    setText: (next: string) => {
      editor.text = next;
    },
    setReadOnly: (value: boolean) => {
      editor.readOnly = value;
    },
    destroy: () => {},
    ready: Promise.resolve(),
  };
  return editor;
}

/** The studio as its window wires it: bound to the shown page's block, following the shown page. */
function studioOn(mounted: MountedPage) {
  shownMounted.set(mounted);
  const controller = new StudioController();
  const source = blockSource(BLOCK);
  expect(source).not.toBeNull();
  controller.open(source!);
  const stopFollow = shownMounted.subscribe(() => controller.follow(shownMounted.get()));
  const id = controller.project()!.main;
  const editor = fakeEditor(controller.project()!.files[id]!.text);
  controller.attachEditor(id, editor as unknown as CodeEditor);
  /** Types the whole text, as the editor's onChange reports it. */
  const type = (text: string) => {
    editor.text = text;
    controller.edited(id, text);
  };
  return { controller, id, editor, type, stop: () => (stopFollow(), controller.dispose()) };
}

afterEach(() => shownMounted.set(null));

describe('the studio and the shown page', () => {
  it('sends the waiting text as the page closes, then refuses edits and keeps them marked as not sent', () => {
    const first = fakeMount(starterProject('One', 'print(0)') as unknown as Record<string, unknown>);
    const studio = studioOn(first.mounted);
    studio.type('seen = 1');
    // The page view starts to close: the hook's event comes first, then another page is shown. As in
    // features/page/mount.ts, the hook gets a copy of the MountedPage, not the object the shown page holds.
    const hookCopy = { ...first.mounted, destroy: () => Promise.resolve() };
    window.dispatchEvent(new CustomEvent(PAGE_LEAVING_EVENT, { detail: hookCopy }));
    // The page then sends its last changes and closes: a send after that is refused.
    first.state.refuse = 'The page is closed.';
    shownMounted.set(otherMount());
    expect(first.texts(studio.id)).toEqual(['seen = 1']);
    expect(studio.editor.readOnly).toBe(true);
    expect(studio.controller.store?.editable).toBe(false);
    expect(studio.controller.notice).toMatch(/read-only/);

    // Text that still reaches the store on the other page is never sent and never reported as sent.
    studio.type('lost = 42');
    studio.controller.store?.flush();
    expect(first.texts(studio.id)).toEqual(['seen = 1']);
    expect(studio.controller.dirty.has(studio.id)).toBe(true);
    studio.stop();
  });

  it('binds to the block again when its page comes back, and sends the text that was not sent', () => {
    const first = fakeMount(starterProject('One', 'print(0)') as unknown as Record<string, unknown>);
    const studio = studioOn(first.mounted);
    window.dispatchEvent(new CustomEvent(PAGE_LEAVING_EVENT, { detail: first.mounted }));
    shownMounted.set(otherMount());
    studio.controller.edited(studio.id, 'kept = 7');
    studio.editor.text = 'kept = 7';

    const back = fakeMount(first.data());
    shownMounted.set(back.mounted);
    expect(studio.controller.store?.editable).toBe(true);
    expect(studio.editor.readOnly).toBe(false);
    studio.controller.store?.flush();
    expect(back.texts(studio.id)).toEqual(['kept = 7']);
    expect(studio.controller.dirty.has(studio.id)).toBe(false);

    studio.type('more = 8');
    studio.controller.store?.flush();
    expect(back.texts(studio.id)).toEqual(['kept = 7', 'more = 8']);
    studio.stop();
  });
});

describe('a send the page refuses, and a block deleted on the page', () => {
  it('keeps the text marked as not sent when the page refuses it', async () => {
    const first = fakeMount(starterProject('One', 'print(0)') as unknown as Record<string, unknown>);
    const studio = studioOn(first.mounted);
    first.state.refuse = 'The page is closed.';
    studio.type('late = 3');
    studio.controller.store?.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(studio.controller.dirty.has(studio.id)).toBe(true);
    expect(studio.editor.text).toBe('late = 3');
    expect(studio.controller.store?.editable).toBe(false);
    studio.stop();
  });

  it('turns read-only with a notice when the block is deleted, and binds again on undo', () => {
    const first = fakeMount(starterProject('One', 'print(0)') as unknown as Record<string, unknown>);
    const studio = studioOn(first.mounted);
    studio.type('kept = 1');
    const undo = first.remove();
    expect(studio.controller.store?.editable).toBe(false);
    expect(studio.editor.readOnly).toBe(true);
    expect(studio.controller.notice).toMatch(/removed from the page/);
    const upserts = first.state.upserts;
    // The waiting text is not sent to a block that is gone, and no ghost card comes back.
    studio.controller.store?.flush();
    expect(first.state.upserts).toBe(upserts);
    expect(first.texts(studio.id)).toEqual([]);
    expect(studio.controller.dirty.has(studio.id)).toBe(true);
    expect(studio.editor.text).toBe('kept = 1');

    undo();
    expect(studio.controller.store?.editable).toBe(true);
    expect(studio.editor.readOnly).toBe(false);
    expect(studio.controller.notice).toBe('');
    studio.controller.store?.flush();
    expect(first.texts(studio.id)).toEqual(['kept = 1']);
    expect(studio.controller.dirty.has(studio.id)).toBe(false);
    studio.stop();
  });
});

describe('what a keystroke redraws', () => {
  it('moves the caret without redrawing the window, and redraws once per file newly marked as not sent', () => {
    const first = fakeMount(starterProject('One', 'print(0)') as unknown as Record<string, unknown>);
    const studio = studioOn(first.mounted);
    const window_ = vi.fn();
    const caret = vi.fn();
    studio.controller.subscribe(window_);
    studio.controller.subscribeCursor(caret);
    studio.controller.setCursor({ line: 1, column: 3 });
    expect(caret).toHaveBeenCalledTimes(1);
    expect(window_).not.toHaveBeenCalled();
    studio.type('a');
    studio.type('ab');
    studio.type('abc');
    expect(window_).toHaveBeenCalledTimes(1);
    studio.stop();
  });
});

describe('the window closing or reloading (gap V2-3)', () => {
  it('sends the text typed just before the window hides, without waiting for the typing delay', () => {
    const first = fakeMount(starterProject('One', 'print(0)') as unknown as Record<string, unknown>);
    const studio = studioOn(first.mounted);
    const unmount = studio.controller.mount();
    studio.type('late = 1');
    expect(first.texts(studio.id)).toEqual([]);
    window.dispatchEvent(new Event('pagehide'));
    expect(first.texts(studio.id)).toEqual(['late = 1']);
    unmount();
    studio.stop();
  });

  it('keeps scratch text typed just before a reload', () => {
    localStorage.removeItem('opennote.codestudio.scratch');
    const controller = new StudioController();
    const unmount = controller.mount();
    controller.open(scratchSource());
    const id = controller.project()!.main;
    controller.edited(id, 'kept = 2');
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem('opennote.codestudio.scratch')).toContain('kept = 2');
    unmount();
  });

  it('lets a popped studio post close to the main window as its window hides', () => {
    const posted: RelayMessage[] = [];
    const channel: Channel = {
      postMessage: (message) => posted.push(message),
      addEventListener: () => {},
      removeEventListener: () => {},
      close: () => {},
    };
    let data: Record<string, unknown> = starterProject('One', 'print(0)') as unknown as Record<string, unknown>;
    const source: ProjectSource = {
      key: BLOCK,
      kind: 'remote',
      data: () => data,
      readOnly: () => false,
      patch: (patch, fallback) => {
        data = { ...data };
        channel.postMessage({ kind: 'patch', block: BLOCK, data: patch, fallback });
      },
      subscribe: () => () => {},
      live: () => true,
      onLeave: () => () => {},
      dispose: () => channel.postMessage({ kind: 'close', block: BLOCK }),
    };
    const controller = new StudioController();
    const unmount = controller.mount();
    controller.open(source);
    controller.edited(controller.project()!.main, 'popped = 3');
    window.dispatchEvent(new Event('pagehide'));
    expect(posted.map((message) => message.kind)).toEqual(['patch', 'close']);
    unmount();
  });
});

describe('the popped studio told why its block is read-only (gap V2-5)', () => {
  /** Two ends of one channel, delivering on a later turn as BroadcastChannel does. */
  function pair(): [Channel, Channel] {
    const targets = [new EventTarget(), new EventTarget()];
    return targets.map((target, at) => ({
      postMessage: (message: RelayMessage) =>
        setTimeout(() => targets[1 - at]!.dispatchEvent(new MessageEvent('message', { data: message })), 0),
      addEventListener: (type: 'message', listener: (event: MessageEvent) => void) =>
        target.addEventListener(type, listener as EventListener),
      removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) =>
        target.removeEventListener(type, listener as EventListener),
      close: () => {},
    })) as unknown as [Channel, Channel];
  }
  const turn = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('shows the page-closed notice when the main window leaves the page, and clears it when the page is back', async () => {
    const first = fakeMount(starterProject('One', 'print(0)') as unknown as Record<string, unknown>);
    shownMounted.set(first.mounted);
    const [main, popped] = pair();
    const stop = serveRelay(main, (block) => blockSource(block), shownMounted.subscribe);
    const remote = (await remoteSource(BLOCK, popped))!;
    const controller = new StudioController();
    controller.open(remote);
    shownMounted.set(otherMount());
    await turn();
    expect(controller.store?.editable).toBe(false);
    expect(controller.notice).toBe(
      'The page with this project is not shown, so the project is read-only. Go back to the page to edit it.',
    );
    shownMounted.set(first.mounted);
    await turn();
    expect(controller.store?.editable).toBe(true);
    expect(controller.notice).toBe('');
    controller.dispose();
    stop();
  });
});
