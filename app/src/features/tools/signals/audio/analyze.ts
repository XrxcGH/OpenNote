// The sound analysis behind the Analyze tab: a pitch and intensity track, a spectrogram, and the formants at the
// cursor, for the stretch of the clip between two times. Pure, so a long clip runs in the signals worker.
import { num } from '../shared/num';
import { spectrogram } from '../spectrum/engine';
import { formants, pitchTrack } from './engine';

export interface AnalyzeSettings {
  from: string;
  to: string;
  preset: 'wide' | 'narrow';
  cursor: string;
}

export interface AnalyzeJob {
  samples: Float32Array;
  rate: number;
  settings: AnalyzeSettings;
}

export function analyzeClip(
  { samples, rate, settings: state }: AnalyzeJob,
  progress: (fraction: number) => void = () => {},
) {
  const from = Math.max(0, Math.round(num(state.from) * rate) || 0);
  const to = Math.min(samples.length, Math.round(num(state.to) * rate) || samples.length);
  const x = Array.from(samples.subarray(from, to));
  const track = pitchTrack(x, rate, { progress: (f) => progress(0.7 * f) });
  const segment = rate * (state.preset === 'wide' ? 0.005 : 0.03);
  const heat = spectrogram({
    samples: x,
    rate,
    window: 'hann',
    detrend: 'mean',
    segment: 2 ** Math.round(Math.log2(segment)),
    overlap: 0.5,
  });
  progress(0.9);
  const at = Math.round((num(state.cursor) - from / rate) * rate);
  const half = Math.round(0.0125 * rate);
  const centre = Math.min(Math.max(half, at), x.length - half);
  const found = formants(x.slice(centre - half, centre + half), rate);
  const frame = track.times.findIndex((time) => time >= centre / rate);
  // The waveform goes back thinned to about 2000 points, not the whole stretch.
  const step = Math.max(1, Math.floor(x.length / 2000));
  return {
    wave: x.filter((_, i) => i % step === 0),
    step,
    from: from / rate,
    track,
    heat,
    found,
    frame: Math.max(0, frame),
  };
}

export type ClipAnalysis = ReturnType<typeof analyzeClip>;
