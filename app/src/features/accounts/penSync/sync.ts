// One sync of the pen settings: read the file at the service, merge it with the device's items, write the file if it
// changed, and apply what came from the service to the device. The device and the service are passed in, so the sync is
// tested without a screen or an account.
import type { Channel } from './channel';
import { collect, patchesFor } from './items';
import type { Patches, PenState } from './items';
import { mergeItems } from './merge';
import type { PenSyncState } from './merge';

export interface PenDevice {
  read(): PenState;
  apply(patches: Patches): Promise<void> | void;
}

export interface PenSyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

export async function syncPenSettings(
  channel: Channel,
  device: PenDevice,
  state: PenSyncState,
  now?: number,
): Promise<{ state: PenSyncState; result: PenSyncResult }> {
  const remote = await channel.read();
  const before = device.read();
  const merged = mergeItems(collect(before), remote, state, now);
  if (merged.dirty) await channel.write(merged.doc);
  if (Object.keys(merged.apply).length > 0 || merged.remove.length > 0) {
    await device.apply(patchesFor(before, merged.apply, merged.remove));
  }
  return {
    state: merged.state,
    result: { pushed: merged.pushed, pulled: merged.pulled, conflicts: merged.conflicts },
  };
}
