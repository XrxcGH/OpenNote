# Signals and sound tools

These tools work signal, sound, and radio problems. Each one shows its steps, plots, and tables, and you can put any of them on the page. Everything works offline. Your work stays on this computer.

To open the window, use the command palette: **Open signals and sound tools**. You can also open one tool by its name, such as **Open spectrum analyzer**. The **Tool** list at the top picks a tool. Tabs pick a mode, and the arrow keys move between tabs. Results update as you type.

Each result has buttons to put part of it on the page at the caret: **Insert answer**, **Insert equation**, **Insert table**, **Insert steps**, and **Insert picture**.

## Signals and systems

- **Spectrum analyzer.** Paste samples to see their spectrum. It shows amplitude, power, and density views, Welch averages, and a spectrogram, with the window's effect corrected. It also adds up the power in bands (with presets for brain waves), picks peaks, and reads damping from the half-power points.
- **Digital filter designer.** Design FIR filters by the window method and IIR filters from Butterworth, Chebyshev, and elliptic prototypes, or a simple notch or moving average. See the gain, phase, delay, impulse and step responses, and the poles and zeros. Round the coefficients to fixed point to see what changes, then run the filter on your own samples, once or forward and backward.
- **Convolution, sampling, and discrete systems.** See convolution as a table: flip, shift, multiply, and add. Find a delay by correlation. Run a difference equation and check its poles. Then explore aliasing, rebuilding a sampled signal, quantization noise, rate changes, and convolution of continuous signals.

## Brain and body signals

- **Neural and physiological time series.** Cut epochs around events, remove the baseline, reject noisy trials, and average them with a standard-error band, then read peaks and mean amplitudes. Build fMRI regressors from the canonical response, fit a voxel by least squares, and read t for a contrast. Draw spike rasters and firing rates, with interval statistics. Find R peaks in an ECG and work out heart rate and its variability, and map a value per electrode on the 10-20 layout.

## Sound

- **Sound analysis and acoustics.** Open a sound file or record from the microphone; the app asks first, and the sound stays on this computer. See the waveform and a wide- or narrow-band spectrogram, and track pitch, intensity, and formants at a cursor. Label stretches of time and get their durations, and read jitter and shimmer for voice work. A tuner names the nearest note in cents, tone practice lays your pitch over Chao tone numbers, and a vowel chart plots F1 against F2. It also draws audiograms with the pure-tone average, adds and subtracts decibels with A-weighting, and makes tones to play.

## Images

- **Image lab.** Open a PNG or JPEG image, or use the example cells. Adjust its window, level, contrast, and gamma with the histogram beside it. Threshold it by hand or by Otsu's method and count the objects, with each one's area and center. Blur, sharpen, or find edges with standard kernels, your own kernel, or the Canny method, and erode, dilate, open, or close it. See its 2D spectrum and mask it, calibrate a scale and measure distances and rectangles, and work band math such as NDVI, false-color composites, and simple classes. A CT tab turns the Shepp-Logan phantom into a sinogram and back by filtered back-projection.

## Medical imaging

- **Medical imaging physics.** Work the physics of MRI: the Larmor frequency, the spin-echo, gradient-echo, and inversion-recovery signals, and how two tissues contrast as TR changes. Watch the magnetization move after RF pulses, and see what an image loses when part of k-space is dropped. It also works CT numbers and windows, ultrasound echoes and Doppler shifts, X-ray attenuation, and the standardized uptake value in PET.

## Communications

- **Information, coding, and modulation.** Find entropy, shared information, and the capacity of a channel. Build Huffman and Shannon-Fano codes with the tree drawn, and parse text the way the LZ78 compressor does. Encode and decode Hamming codes and other small block codes. Find standard checksums (cyclic redundancy checks, or CRCs) and work their long division. Decode a convolutional code with the Viterbi method. Compare ways to send bits over radio, such as phase shift keying (PSK) and quadrature amplitude modulation (QAM). Each has a constellation plot, an error-rate curve, and an eye diagram.

- **Transmission lines and radio frequency (RF).** See how a load reflects, and move along the line on a Smith chart to read the input impedance. Design L-section, stub, and quarter-wave matches. Find the impedance of coax, two-wire, and microstrip lines. Convert two-port matrices, check stability, and cascade stages. Add up noise through a chain of amplifiers, and work antenna links, radar range, and decibel units.

The CRC presets use the parameters in the CRC catalog by Greg Cook (reveng.sourceforge.io). The microstrip formulas are the Hammerstad-Jensen closed forms, and the matching formulas follow Pozar's Microwave Engineering.
