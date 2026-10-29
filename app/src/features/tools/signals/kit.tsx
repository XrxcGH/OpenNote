// The signals and sound kit's window: a tool picker, the chosen tool's purpose in a line, and the tool itself. Each
// tool loads the first time it is chosen, so the window stays small. A palette command can open the kit at a tool.
import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { t } from '../../../strings/t';
import { CHOSEN_KEY, CHOOSE_EVENT, SIGNAL_TOOLS, isSignalToolId, type SignalToolId } from './meta';
import { Choice } from './shared/ui';
import styles from './shared/kit.module.css';

const TOOL_BODIES: Record<SignalToolId, LazyExoticComponent<ComponentType>> = {
  spectrum: lazy(() => import('./spectrum/SpectrumTool').then((m) => ({ default: m.SpectrumTool }))),
  filters: lazy(() => import('./filters/FiltersTool').then((m) => ({ default: m.FiltersTool }))),
  systems: lazy(() => import('./systems/SystemsTool').then((m) => ({ default: m.SystemsTool }))),
  medimaging: lazy(() => import('./medimaging/MedImagingTool').then((m) => ({ default: m.MedImagingTool }))),
  audio: lazy(() => import('./audio/AudioTool').then((m) => ({ default: m.AudioTool }))),
  comms: lazy(() => import('./comms/CommsTool').then((m) => ({ default: m.CommsTool }))),
  rf: lazy(() => import('./rf/RfTool').then((m) => ({ default: m.RfTool }))),
};

function firstTool(): SignalToolId {
  try {
    const saved = window.localStorage.getItem(CHOSEN_KEY);
    if (isSignalToolId(saved)) return saved;
  } catch {
    // Storage can be off; start at the first tool.
  }
  return SIGNAL_TOOLS[0]!.id;
}

export function SignalsKit() {
  const [tool, setTool] = useState<SignalToolId>(firstTool);
  useEffect(() => {
    const choose = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (isSignalToolId(id)) setTool(id);
    };
    window.addEventListener(CHOOSE_EVENT, choose);
    return () => window.removeEventListener(CHOOSE_EVENT, choose);
  }, []);
  const pick = (id: SignalToolId) => {
    setTool(id);
    try {
      window.localStorage.setItem(CHOSEN_KEY, id);
    } catch {
      // The choice lasts for this visit.
    }
  };
  const meta = SIGNAL_TOOLS.find((one) => one.id === tool)!;
  const Body = TOOL_BODIES[tool];
  return (
    <div className={styles.kit}>
      <div className={styles.picker}>
        <Choice
          label={t('kitSignals.kit.tool')}
          value={tool}
          options={SIGNAL_TOOLS.map((one) => one.id)}
          name={(id) => t(SIGNAL_TOOLS.find((one) => one.id === id)!.title)}
          onChange={pick}
        />
        <p className={styles.about}>{t(meta.about)}</p>
      </div>
      <Suspense fallback={null}>
        <Body key={tool} />
      </Suspense>
    </div>
  );
}
