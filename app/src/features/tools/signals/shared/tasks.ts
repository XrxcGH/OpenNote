// The signals engines that can take long on a big input (a long recording, a large image), by name, for the signals
// worker and for the main thread alike. Each returns its value or the engine's problem as plain data, so a
// SignalError's key and values survive the trip back from the worker.
import type { TaskContext } from '../../subjects/num/worker';
import { analyzeClip, type AnalyzeJob } from '../audio/analyze';
import { pitchTrack } from '../audio/engine';
import { backProject, canny, radon, type Gray, type ReconFilter } from '../images/engine';
import { analyseSpectrum, type SpectrumJob } from '../spectrum/analyse';
import { isSignalError } from './errors';

export type TaskReply<O> =
  { ok: true; value: O } | { ok: false; key: string; vars: Record<string, string | number>; message: string };

const wrap =
  <I, O>(run: (input: I, progress: (fraction: number) => void) => O) =>
  (input: I, ctx: TaskContext): TaskReply<O> => {
    try {
      return { ok: true, value: run(input, (fraction) => ctx.progress(fraction)) };
    } catch (error) {
      if (isSignalError(error)) return { ok: false, key: error.key, vars: { ...error.vars }, message: '' };
      return { ok: false, key: '', vars: {}, message: error instanceof Error ? error.message : String(error) };
    }
  };

export const SIGNAL_TASKS = {
  spectrum: wrap((job: SpectrumJob, progress) => analyseSpectrum(job, progress)),
  analyzeClip: wrap((job: AnalyzeJob, progress) => analyzeClip(job, progress)),
  pitch: wrap((job: { samples: Float32Array; rate: number }, progress) =>
    pitchTrack(Array.from(job.samples), job.rate, { progress }),
  ),
  ct: wrap((job: { object: Gray; angles: number; filter: ReconFilter }, progress) => {
    const { sinogram } = radon(job.object, job.angles);
    progress(0.5);
    const side = Math.max(job.object.width, job.object.height);
    return { sinogram, image: backProject(sinogram, side, job.filter) };
  }),
  canny: wrap((job: { image: Gray; sigma: number; low: number; high: number }) =>
    canny(job.image, job.sigma, job.low, job.high),
  ),
};

export type SignalTask = keyof typeof SIGNAL_TASKS;
export type TaskInput<N extends SignalTask> = Parameters<(typeof SIGNAL_TASKS)[N]>[0];
export type TaskOutput<N extends SignalTask> = Extract<ReturnType<(typeof SIGNAL_TASKS)[N]>, { ok: true }>['value'];
