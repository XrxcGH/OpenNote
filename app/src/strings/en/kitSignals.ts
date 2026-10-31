// The signals kit: spectra, filters, discrete systems, biosignals, images, medical imaging physics, sound,
// communications, and RF (owner: the signals lane). Each namespace file has one owner, so
// parallel work never edits the same file.
//
// Only the words the palette needs load at start-up. Each tool's own words are in
// kitSignals/<tool>.ts and load with the tool (features/tools/signals/shared/words.ts), so the start-up bundle
// stays small; the type below still names every key.

import type { spectrum } from './kitSignals/spectrum';
import type { systems } from './kitSignals/systems';
import type { comms } from './kitSignals/comms';
import type { rf } from './kitSignals/rf';
import type { filters } from './kitSignals/filters';
import type { medimaging } from './kitSignals/medimaging';
import type { audio } from './kitSignals/audio';
import type { images } from './kitSignals/images';
import type { neurodata } from './kitSignals/neurodata';
import type { common } from './kitSignals/common';

const shared = {
  kit: {
    title: 'Signals and sound',
    tool: 'Tool',
    open: 'Open signals and sound tools',
    keywords: 'signals sound spectrum filter image audio communications rf engineering science',
  },
  tools: {
    spectrum: {
      title: 'Spectrum analyzer',
      open: 'Open spectrum analyzer',
      keywords: 'fft fourier frequency spectrum psd power density welch spectrogram band eeg vibration resonance',
      about: 'Amplitude, power, and density spectra with window corrections, spectrograms, band powers, and damping.',
    },
    systems: {
      title: 'Convolution, sampling, and discrete systems',
      open: 'Open convolution and sampling',
      keywords:
        'convolution correlation difference equation impulse sampling aliasing nyquist quantization sqnr resample',
      about:
        'Convolution step by step, correlation, difference equations, sampling and aliasing, quantization, and rate changes.',
    },
    comms: {
      title: 'Information, coding, and modulation',
      open: 'Open information, coding, and modulation',
      keywords: 'entropy mutual information capacity huffman lz78 hamming crc viterbi bpsk qpsk qam fsk bit error eye',
      about:
        'Entropy and capacity, source codes, block codes and CRCs, Viterbi decoding, and digital modulation with bit-error rates.',
    },
    rf: {
      title: 'Transmission lines and RF',
      open: 'Open transmission lines and RF',
      keywords:
        'smith chart vswr reflection impedance matching stub quarter wave microstrip coax s parameters noise friis antenna radar dbm',
      about:
        'Reflection and line impedance on a Smith chart, matching networks, line types, two-ports, noise, antennas, and decibels.',
    },
    filters: {
      title: 'Digital filter designer',
      open: 'Open digital filter designer',
      keywords:
        'filter fir iir butterworth chebyshev bilinear window kaiser lowpass highpass bandpass notch moving average median',
      about:
        'FIR and IIR filters from specifications, their responses and poles, rounded coefficients, and filtering data.',
    },
    medimaging: {
      title: 'Medical imaging physics',
      open: 'Open medical imaging physics',
      keywords:
        'mri larmor bloch t1 t2 spin echo k-space ct hounsfield window ultrasound doppler x-ray attenuation pet suv',
      about: 'MRI signals and a Bloch simulator, k-space, CT numbers, ultrasound, X-ray attenuation, and PET uptake.',
    },
    audio: {
      title: 'Sound analysis and acoustics',
      open: 'Open sound analysis and acoustics',
      keywords:
        'audio pitch yin formant lpc vowel spectrogram phonetics tuner cents tone chao audiogram decibel a-weighting',
      about:
        'Waveform, spectrogram, pitch, intensity, formants, vowel space, a tuner, tones, audiograms, and decibels.',
    },
    images: {
      title: 'Image lab',
      open: 'Open image lab',
      keywords:
        'image histogram threshold otsu count cells kernel sobel canny morphology fft ndvi band math ct radon back projection',
      about:
        'Adjust, threshold and count, filter, measure, and transform images; band math; and CT by filtered back-projection.',
    },
    neurodata: {
      title: 'Neural and physiological time series',
      open: 'Open neural and physiological time series',
      keywords:
        'erp epoch average eeg fmri hrf glm design matrix spike raster psth isi fano ecg heart rate hrv rmssd 10-20',
      about:
        'Event-related averages, fMRI regressors and fits, spike-train statistics, ECG heart-rate variability, and 10-20 maps.',
    },
  },
} as const;

/** Each tool's words, present once the tool has loaded. */
export interface SignalToolWords {
  readonly spectrum: typeof spectrum;
  readonly systems: typeof systems;
  readonly comms: typeof comms;
  readonly rf: typeof rf;
  readonly filters: typeof filters;
  readonly medimaging: typeof medimaging;
  readonly audio: typeof audio;
  readonly images: typeof images;
  readonly neurodata: typeof neurodata;
}

/** The words every tool shares, loaded with the first tool. */
type SignalCommonWords = typeof common;

export const kitSignals = shared as typeof shared & SignalToolWords & SignalCommonWords;
