// The spectrum analyzer's whole calculation, from the fields (and a sound, when one is open) to the spectrum, its
// peaks, and band powers. Pure, so it runs in the signals worker for a long recording and on the main thread for a
// short one.
import type { WindowName } from '../shared/fft';
import { num } from '../shared/num';
import { readSignal, type SignalText } from '../shared/signalInput';
import { step } from '../shared/steps';
import { bandPowers, peaks, readBands, spectrogram, spectrum, welch, type Detrend } from './engine';

export type SpectrumView = 'amplitude' | 'power' | 'psd' | 'welch' | 'spectrogram';

/** The fields the calculation reads. */
export interface SpectrumSettings {
  samples: string;
  rate: string;
  window: WindowName;
  beta: string;
  detrend: Detrend;
  view: SpectrumView;
  segment: string;
  overlap: string;
  bands: string;
}

export interface SpectrumJob {
  settings: SpectrumSettings;
  /** An opened sound, which stands in for the typed samples and the table. */
  sound: { samples: Float32Array; rate: number } | null;
  /** The value (and time) columns of a table, read by the tool, which stand in for the typed samples. */
  table: SignalText | null;
}

export function analyseSpectrum(
  { settings: state, sound, table }: SpectrumJob,
  progress: (fraction: number) => void = () => {},
) {
  const signal = sound ? { samples: Array.from(sound.samples) } : (table ?? readSignal(state.samples));
  const rate = sound ? sound.rate : (signal.rate ?? num(state.rate));
  const input = { samples: signal.samples, rate, window: state.window, detrend: state.detrend, beta: num(state.beta) };
  progress(0.1);
  const whole = spectrum(input);
  progress(0.5);
  const segment = { ...input, segment: num(state.segment), overlap: num(state.overlap) / 100 };
  const averaged = state.view === 'welch' ? welch(segment) : null;
  const heat = state.view === 'spectrogram' ? spectrogram(segment) : null;
  progress(0.9);
  const shown =
    state.view === 'power' ? whole.power : state.view === 'psd' ? whole.psd : averaged ? averaged.psd : whole.amplitude;
  const freq = averaged ? averaged.freq : whole.freq;
  const found = peaks(freq, shown, 5);
  const bands = bandPowers(freq, averaged ? averaged.psd : whole.psd, readBands(state.bands));
  const steps = [...whole.steps, ...(averaged?.steps ?? []), step('peakRead'), step('bandPower', 'P = Σ PSD(f) Δf')];
  // Only the rate the times gave goes back: the samples themselves stay where they were read.
  return { signal: { rate: signal.rate }, rate, whole, averaged, heat, shown, freq, found, bands, steps };
}

export type SpectrumAnalysis = ReturnType<typeof analyseSpectrum>;
