// The code studio window: the editor, the file tree, the console, and the problems panel (DESIGN 5.1).
// Owner: code:L04 (B12). The tool window host loads this chunk the first time the window opens; in a window of its
// own (the pop-out) it edits the main window's project block through the relay.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isEnabled } from '../../../app/flags';
import { shownMounted } from '../../page';
import { onStudioTarget, studioTarget } from '../project/studioTarget';
import type { StudioTarget } from '../project/studioTarget';
import { chooseSource } from './choose';
import { StudioController } from './controller';
import { Studio } from './Studio';
import { installStudioTestHooks } from './testHooks';

installStudioTestHooks();

// What the studio's commands and the pop-out relay use (features/page/registrations/codeStudio.ts).
export { activeStudio } from './controller';
export { newProjectData, openScratchProject, projectLanguageOf, replaceScratchProject } from './newProject';
export { RELAY_CHANNEL, serveRelay } from './relay';
export { blockSource, fallbackOf } from './source';
export { setStudioTarget } from '../project/studioTarget';
export { default as CodeSettingsSection } from '../settings/CodeSettingsSection';

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
    // The studio follows the shown page: its project block binds again when its page comes back.
    const stopFollow = shownMounted.subscribe(() => controller.follow(shownMounted.get()));
    return () => {
      live = false;
      stop();
      stopFollow();
      unmount();
    };
  }, [controller]);

  if (!isEnabled('code.studio') || !controller.project()) return null;
  return <Studio controller={controller} />;
}
