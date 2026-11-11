// The code studio window: the editor, the file tree, the console, and the problems panel (DESIGN 5.1).
// Owner: code:L04 (B12). The tool window host loads this chunk the first time the window opens; in a window of its
// own (the pop-out) it edits the main window's project block through the relay.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isEnabled } from '../../../app/flags';
import { onStudioTarget, studioTarget } from '../project/studioTarget';
import type { StudioTarget } from '../project/studioTarget';
import { StudioController } from './controller';
import { currentBlock, inPoppedWindow, RELAY_CHANNEL, remoteSource } from './relay';
import type { Channel } from './relay';
import { blockSource, SCRATCH, scratchSource } from './source';
import type { ProjectSource } from './source';
import { Studio } from './Studio';
import { installStudioTestHooks } from './testHooks';

installStudioTestHooks();

// What the studio's commands and the pop-out relay use (features/page/registrations/codeStudio.ts).
export { activeStudio } from './controller';
export { newProjectData, openScratchProject, projectLanguageOf } from './newProject';
export { RELAY_CHANNEL, serveRelay } from './relay';
export { blockSource, fallbackOf } from './source';
export { setStudioTarget } from '../project/studioTarget';
export { default as CodeSettingsSection } from '../settings/CodeSettingsSection';

/** The project the studio opens: the target block, the last block, or the scratch project. */
async function chooseSource(target: StudioTarget | null): Promise<ProjectSource> {
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

export function CodeStudioWindow() {
  const [controller] = useState(() => new StudioController());
  useSyncExternalStore(controller.subscribe, controller.snapshot);

  useEffect(() => {
    let live = true;
    const unmount = controller.mount();
    const show = async (target: StudioTarget | null) => {
      const source = await chooseSource(target);
      if (!live) return source.dispose();
      controller.open(source);
      if (target?.run && source.key === target.block) controller.run();
    };
    void show(studioTarget());
    const stop = onStudioTarget((target) => void show(target));
    return () => {
      live = false;
      stop();
      unmount();
    };
  }, [controller]);

  if (!isEnabled('code.studio') || !controller.project()) return null;
  return <Studio controller={controller} />;
}
