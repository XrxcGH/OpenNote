# Signals and sound tools

These tools work signal, sound, and radio problems. Each one shows its steps, plots, and tables, and you can put any of them on the page. Everything works offline. Your work stays on this computer.

To open the window, use the command palette: **Open signals and sound tools**. You can also open one tool by its name, such as **Open spectrum analyzer**. The **Tool** list at the top picks a tool. Tabs pick a mode, and the arrow keys move between tabs. Results update as you type.

Each result has buttons to put part of it on the page at the caret: **Insert answer**, **Insert equation**, **Insert table**, **Insert steps**, and **Insert picture**.

## Signals and systems

- **Spectrum analyzer.** Paste samples to see their spectrum. It shows amplitude, power, and density views, Welch averages, and a spectrogram, with the window's effect corrected. It also adds up the power in bands (with presets for brain waves), picks peaks, and reads damping from the half-power points.
- **Convolution, sampling, and discrete systems.** See convolution as a table: flip, shift, multiply, and add. Find a delay by correlation. Run a difference equation and check its poles. Then explore aliasing, rebuilding a sampled signal, quantization noise, rate changes, and convolution of continuous signals.

## Communications

- **Information, coding, and modulation.** Find entropy, shared information, and the capacity of a channel. Build Huffman and Shannon-Fano codes with the tree drawn, and parse text the way the LZ78 compressor does. Encode and decode Hamming codes and other small block codes. Find standard checksums (cyclic redundancy checks, or CRCs) and work their long division. Decode a convolutional code with the Viterbi method. Compare ways to send bits over radio, such as phase shift keying (PSK) and quadrature amplitude modulation (QAM). Each has a constellation plot, an error-rate curve, and an eye diagram.

The CRC presets use the parameters in the CRC catalog by Greg Cook (reveng.sourceforge.io).
