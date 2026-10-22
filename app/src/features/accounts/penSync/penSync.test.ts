// checks-disable-file brand-consistency: the test colors are inputs to the code under test, not design colors

// Pen settings sync: the per-item merge (pure), the items a device offers and takes. It ends with a full sync of two devices
// through mocks of Google's app data folder and OneDrive's app folder.
import { describe, expect, it } from 'vitest';
import type { PenSlot } from '../../../platform/bindings/PenSlot';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { addAppFolders } from '../../../../../tests/mock-servers/storage';
import { createFakeConnectors } from '../../connectors';
import { channelFor } from './channel';
import { collect, patchesFor, PREF_KEYS } from './items';
import type { Patches, PenState } from './items';
import { EMPTY_SYNC, mergeItems } from './merge';
import { syncPenSettings } from './sync';
import type { PenDevice } from './sync';

const pen = (id: string, color = 'Ink', width = 0.5): PenSlot => ({ id, tool: 'pen', color, width });
const prefs = {
  hover: true,
  ruler: false,
  protractor: false,
  gridSnap: false,
  gridMm: 5,
  rulerUnits: 'auto',
  zoomBox: false,
  penEdit: { strike: true },
};

const stateOf = (pens: PenSlot[], extra: Partial<PenState> = {}): PenState => ({
  pens,
  formattingBar: 'touchAndPen',
  handedness: 'right',
  prefs,
  ...extra,
});

/** A device in memory that applies the patches the way the app does. */
function device(initial: PenState): PenDevice & { state: PenState; applied: Patches[] } {
  const self = {
    state: initial,
    applied: [] as Patches[],
    read: () => self.state,
    apply(patches: Patches) {
      self.applied.push(patches);
      self.state = {
        ...self.state,
        ...(patches.pens ? { pens: patches.pens } : {}),
        ...(patches.formattingBar ? { formattingBar: patches.formattingBar } : {}),
        ...(patches.handedness ? { handedness: patches.handedness } : {}),
        prefs: { ...self.state.prefs, ...(patches.prefs ?? {}) } as PenState['prefs'],
      };
    },
  };
  return self;
}

describe('the items', () => {
  it('offers each pen by its ID, the order, and the bar choices, and not the settings of a physical pen', () => {
    const items = collect(stateOf([pen('a'), pen('b')]));
    expect(Object.keys(items).sort()).toEqual(
      [
        'pens:order',
        'pen:a',
        'pen:b',
        'bar:formattingBar',
        'bar:handedness',
        ...PREF_KEYS.map((key) => `bar:${key}`),
      ].sort(),
    );
    expect(items['pens:order']).toEqual(['a', 'b']);
  });

  it('takes pens in the order given, keeps pens the order lacks, and ignores a damaged pen', () => {
    const state = stateOf([pen('a'), pen('local')]);
    const patches = patchesFor(
      state,
      { 'pens:order': ['c', 'a', 'broken'], 'pen:c': pen('x', 'Sky'), 'pen:broken': { id: 'broken', tool: 'laser' } },
      [],
    );
    expect(patches.pens?.map((one) => one.id)).toEqual(['c', 'a', 'local']);
    expect(patches.pens?.[0]).toMatchObject({ id: 'c', color: 'Sky' });
  });

  it('removes a pen that was removed elsewhere', () => {
    expect(patchesFor(stateOf([pen('a'), pen('b')]), {}, ['pen:a']).pens?.map((one) => one.id)).toEqual(['b']);
  });
});

describe('the merge', () => {
  const at = Date.parse('2026-10-05T12:00:00Z');

  it('sends everything when there is no file, and sends nothing the second time', () => {
    const items = collect(stateOf([pen('a')]));
    const first = mergeItems(items, null, EMPTY_SYNC, at);
    expect(first.dirty).toBe(true);
    expect(first.pushed).toBe(Object.keys(items).length);
    const second = mergeItems(items, first.doc, first.state, at + 1000);
    expect(second).toMatchObject({ dirty: false, pushed: 0, pulled: 0, conflicts: 0 });
  });

  it('merges a pen added on each device without losing either', () => {
    const a = mergeItems(collect(stateOf([pen('a'), pen('p1')])), null, EMPTY_SYNC, at);
    // Device B has synced once, then adds its own pen.
    const bFirst = mergeItems(collect(stateOf([pen('a'), pen('p1')])), a.doc, a.state, at + 1);
    const bItems = collect(stateOf([pen('a'), pen('p1'), pen('fromB')]));
    const b = mergeItems(bItems, a.doc, bFirst.state, at + 2);
    // Device A adds a different pen before it hears from B.
    const aItems = collect(stateOf([pen('a'), pen('p1'), pen('fromA')]));
    const aAgain = mergeItems(aItems, b.doc, a.state, at + 3);
    expect(Object.keys(aAgain.apply)).toContain('pen:fromB');
    expect(aAgain.doc.items['pen:fromA']?.value).toMatchObject({ id: 'fromA' });
    expect(aAgain.doc.items['pen:fromB']?.value).toMatchObject({ id: 'fromB' });
  });

  it('keeps the newer change when both devices changed one pen, and the account’s on a first sync', () => {
    const start = mergeItems(collect(stateOf([pen('a', 'Ink')])), null, EMPTY_SYNC, at);
    const remote = structuredClone(start.doc);
    remote.items['pen:a'] = { value: pen('a', 'Sky'), updated: '2026-10-05T13:00:00Z' };
    // Changed here at 12:30, there at 13:00: there is newer.
    const state = structuredClone(start.state);
    state.seen['pen:a'] = Date.parse('2026-10-05T12:30:00Z');
    const lost = mergeItems(collect(stateOf([pen('a', 'Honey')])), remote, state, Date.parse('2026-10-05T14:00:00Z'));
    expect(lost.conflicts).toBe(1);
    expect(lost.apply['pen:a']).toMatchObject({ color: 'Sky' });
    // Changed here at 13:30: here is newer.
    state.seen['pen:a'] = Date.parse('2026-10-05T13:30:00Z');
    const won = mergeItems(collect(stateOf([pen('a', 'Honey')])), remote, state, Date.parse('2026-10-05T14:00:00Z'));
    expect(won.doc.items['pen:a']?.value).toMatchObject({ color: 'Honey' });
    // A device that has never synced takes the account's version.
    const first = mergeItems(
      collect(stateOf([pen('a', 'Honey')])),
      remote,
      EMPTY_SYNC,
      Date.parse('2026-10-05T14:00:00Z'),
    );
    expect(first.apply['pen:a']).toMatchObject({ color: 'Sky' });
  });

  it('removes a pen on both devices when one removed it and the other did not change it', () => {
    const both = collect(stateOf([pen('a'), pen('b')]));
    const first = mergeItems(both, null, EMPTY_SYNC, at);
    const removedHere = mergeItems(collect(stateOf([pen('a')])), first.doc, first.state, at + 1);
    expect(removedHere.doc.items['pen:b']).toMatchObject({ deleted: true });
    const other = mergeItems(both, removedHere.doc, first.state, at + 2);
    expect(other.remove).toContain('pen:b');
  });
});

describe('two devices through the cloud', () => {
  it('moves a pen and the toolbar from one device to the other through Google’s app data folder', async () => {
    const server = new MockServer();
    const folders = addAppFolders(server);
    const { client } = createFakeConnectors({ connected: { google: 'sam@example.com' }, respond: server.respond });
    const channel = channelFor('google', client);
    const laptop = device(
      stateOf([pen('a'), pen('custom', '#aa2200', 1.2)], { formattingBar: 'always', handedness: 'left' }),
    );
    const first = await syncPenSettings(channel, laptop, EMPTY_SYNC);
    expect(first.result.pushed).toBeGreaterThan(0);
    expect(folders.drive.parents).toEqual(['appDataFolder']);
    expect(JSON.parse(folders.drive.content).v).toBe(1);

    const tablet = device(stateOf([pen('a')]));
    const second = await syncPenSettings(channel, tablet, EMPTY_SYNC);
    expect(second.result.pulled).toBeGreaterThan(0);
    expect(tablet.state.pens.map((one) => one.id)).toEqual(['a', 'custom']);
    expect(tablet.state.formattingBar).toBe('always');
    expect(tablet.state.handedness).toBe('left');
    // A third sync with nothing new writes nothing.
    const versions = folders.drive.versions;
    await syncPenSettings(channel, tablet, second.state);
    expect(folders.drive.versions).toBe(versions);
  });

  it('works through OneDrive’s app folder too, and reads a damaged file as none', async () => {
    const server = new MockServer();
    const folders = addAppFolders(server);
    const { client } = createFakeConnectors({ connected: { microsoft: 'sam@example.com' }, respond: server.respond });
    const channel = channelFor('microsoft', client);
    const desk = device(stateOf([pen('a'), pen('b')]));
    await syncPenSettings(channel, desk, EMPTY_SYNC);
    expect(JSON.parse(folders.onedrive.content ?? '{}').items['pen:b'].value.id).toBe('b');
    folders.onedrive.content = '{ not json';
    expect(await channel.read()).toBeNull();
  });
});
