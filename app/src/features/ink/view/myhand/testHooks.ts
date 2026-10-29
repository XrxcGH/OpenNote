// Test hooks for My handwriting, in `vite build --mode test` builds only: fill the calibration page with a made-up
// hand (leaving some boxes for a test to write with synthetic pen input), and read what the store holds.
import { syntheticProgress } from '../../myhand/fixtures';
import { isComplete } from '../../myhand/metrics';
import { finishCalibration, loadStyle, setProgressForTests, styleState } from './store';

export function installMyHandTestHooks(): () => void {
  const hooks = (window.__OPENNOTE_TEST__ ??= {});
  hooks.myHandSeed = async (leave: number) => {
    await loadStyle();
    await setProgressForTests(syntheticProgress(undefined, leave));
    return Object.keys(styleState.get().doc.progress.samples).length;
  };
  hooks.myHandFinish = () => finishCalibration();
  hooks.myHandState = () => {
    const { status, doc } = styleState.get();
    return {
      status,
      complete: isComplete(doc.progress),
      samples: Object.keys(doc.progress.samples).length,
      glyphs: doc.style ? Object.keys(doc.style.glyphs).length : 0,
      uploads: doc.style
        ? Object.values(doc.style.glyphs)
            .flat()
            .filter((g) => g.source === 'upload').length
        : 0,
      habits: doc.style?.math ?? null,
    };
  };
  return () => {
    delete hooks.myHandSeed;
    delete hooks.myHandFinish;
    delete hooks.myHandState;
  };
}
