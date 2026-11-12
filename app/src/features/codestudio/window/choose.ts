// The project the studio opens: the target block, the last block, or the scratch project. In a window of its own
// (the pop-out, `?tool=code` or the desktop shell's `__OPENNOTE_TOOL__`) the block comes through the relay.
import type { StudioTarget } from '../project/studioTarget';
import { currentBlock, inPoppedWindow, RELAY_CHANNEL, remoteSource } from './relay';
import type { Channel } from './relay';
import { blockSource, SCRATCH, scratchSource } from './source';
import type { ProjectSource } from './source';

export async function chooseSource(target: StudioTarget | null): Promise<ProjectSource> {
  if (target?.block === SCRATCH) return scratchSource();
  if (inPoppedWindow() && typeof BroadcastChannel === 'function') {
    const block = target?.block ?? currentBlock();
    if (block) {
      const channel = new BroadcastChannel(RELAY_CHANNEL) as unknown as Channel;
      const remote = await remoteSource(block, channel);
      if (remote) {
        const dispose = remote.dispose;
        return { ...remote, dispose: () => (dispose(), channel.close()) };
      }
      channel.close();
    }
    return scratchSource();
  }
  const block = target?.block ?? currentBlock();
  return (block && blockSource(block)) || scratchSource();
}
