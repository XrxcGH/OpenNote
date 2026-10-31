// The signals and sound kit's window: a tool picker, the chosen tool's purpose in a line, and the tool itself. Each
// tool loads the first time it is chosen, so the window stays small. A palette command can open the kit at a tool.
import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { t } from '../../../strings/t';
import { CHOSEN_KEY, CHOOSE_EVENT, RESTORE_EVENT, SIGNAL_TOOLS, isSignalToolId, type SignalToolId } from './meta';
import { Choice, SignalToolContext } from './shared/ui';
import styles from './shared/kit.module.css';
import { loadWords } from './shared/words';

const TOOL_BODIES: Record<SignalToolId, LazyExoticComponent<ComponentType>> = {
  spectrum: lazy(() =>
    Promise.all([import('./spectrum/SpectrumTool'), loadWords('spectrum')]).then(([m]) => ({
      default: m.SpectrumTool,
    })),
  ),
  filters: lazy(() =>
    Promise.all([import('./filters/FiltersTool'), loadWords('filters')]).then(([m]) => ({ default: m.FiltersTool })),
  ),
  systems: lazy(() =>
    Promise.all([import('./systems/SystemsTool'), loadWords('systems')]).then(([m]) => ({ default: m.SystemsTool })),
  ),
  neurodata: lazy(() =>
    Promise.all([import('./neurodata/NeuroTool'), loadWords('neurodata')]).then(([m]) => ({ default: m.NeuroTool })),
  ),
  images: lazy(() =>
    Promise.all([import('./images/ImagesTool'), loadWords('images')]).then(([m]) => ({ default: m.ImagesTool })),
  ),
  medimaging: lazy(() =>
    Promise.all([import('./medimaging/MedImagingTool'), loadWords('medimaging')]).then(([m]) => ({
      default: m.MedImagingTool,
    })),
  ),
  audio: lazy(() =>
    Promise.all([import('./audio/AudioTool'), loadWords('audio')]).then(([m]) => ({ default: m.AudioTool })),
  ),
  comms: lazy(() =>
    Promise.all([import('./comms/CommsTool'), loadWords('comms')]).then(([m]) => ({ default: m.CommsTool })),
  ),
  rf: lazy(() => Promise.all([import('./rf/RfTool'), loadWords('rf')]).then(([m]) => ({ default: m.RfTool }))),
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
  // Bumped when a live calculation block puts a tool's fields back, so the tool mounts again and reads them.
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    const choose = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (isSignalToolId(id)) setTool(id);
    };
    const restore = () => setRestored((n) => n + 1);
    window.addEventListener(CHOOSE_EVENT, choose);
    window.addEventListener(RESTORE_EVENT, restore);
    return () => {
      window.removeEventListener(CHOOSE_EVENT, choose);
      window.removeEventListener(RESTORE_EVENT, restore);
    };
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
      <SignalToolContext.Provider value={{ id: tool, title: t(meta.title) }}>
        <Suspense fallback={null}>
          <Body key={`${tool}.${restored}`} />
        </Suspense>
      </SignalToolContext.Provider>
    </div>
  );
}
