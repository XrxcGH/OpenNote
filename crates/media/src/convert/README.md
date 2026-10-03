# Converting recordings

This folder makes a new copy of a recording's audio. It is the core of two features in FEATURES.md: "Voice enhancement", and the compress half of "Recording storage".

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [The voice enhancer](#the-voice-enhancer)
- [Testing](#testing)
- [What the UI wiring needs](#what-the-ui-wiring-needs)

## What it does

A conversion decodes each track, passes it through an optional `Processor`, and encodes it again into a new asset. The recording it starts from is never touched, because assets are immutable (spec 10.3). The copy has exactly as many frames as the original, so its timeline is the old one unchanged. Positions, flags, strokes, and text marks keep their place. With a plan from `RecordingPlan::replacing`, the copy keeps the recording's ID too, so it replaces the original in the page without any other change.

The work runs offline, as fast as the decoder and encoder allow. If anything fails, the files already written are removed.

## Public API

| Item | Does |
|---|---|
| `compress(dir, summary, plan, decoders, quality)` | A smaller copy of the audio. `Quality::Smaller` is 16 kbps, about half the size. `Quality::Smallest` is 10 kbps, about a third. |
| `enhance(dir, summary, plan, decoders, encoders, settings)` | A copy with the noise reduced and the voice leveled. |
| `transcode(dir, summary, plan, decoders, encoders, processors)` | The general form. `processors` gives a `Processor` for each track, or none. |
| `Processor` | A stage that audio streams through, with a `latency`, `process`, and `finish`. |
| `Enhancer`, `Settings` | The enhancer, and its two switches (`reduce_noise`, `level_voice`) and the most noise reduction it may apply. |
| `Quality::bitrate`, `Quality::encoders` | The bitrate and the Opus encoder factory of a level. |

The [storage module](../README.md#storage) gives the size of a recording, what compressing would free, and removal of the audio.

## The voice enhancer

**Noise reduction** is spectral gating. Overlapping frames of 512 samples are turned into frequencies, and each frequency is turned down in proportion to how little it rises above the lowest power it reached lately. That lowest power is the room, and it follows a fan that speeds up, with no sample of the room needed. The gain falls by at most 18 dB, rises quickly when speech starts, and falls slowly, so words start cleanly and noise does not flutter.

**Leveling** moves speech toward a steady level, with at most 12 dB of boost or cut. It acts only on blocks well above the room, so pauses are not pumped up. A soft limiter keeps loud peaks from clipping.

Both work on a copy. The original stays, so a screen can switch between the two while listening, and the transcript can use either one.

## Testing

```sh
cargo test -p opennote-media --lib convert         # the transform and the enhancer
cargo test -p opennote-media --test convert        # whole recordings through the pipeline
cargo test -p opennote-media --release --features opus --test convert   # real Opus, needs CMake
```

The enhancer tests use hiss, a two-tone voice, and loud and quiet speech. They check that the room falls by more than 10 dB while the voice moves by less than 1.5 dB. They also check that the loud and quiet gap shrinks by 8 dB or more, and that a pause is not pumped up. The pipeline tests check that a copy with no processor is exact, that the timeline is unchanged, and that a failure leaves no files. The Opus test checks that a 60 s recording shrinks to under 65 percent at the smaller level and that the estimate is within 15 percent.

## What the UI wiring needs

- Run a conversion in the background and show progress by the position that has been written. Canceling means dropping the result and deleting the new files.
- Save the page with the new recording entry and assets before dropping the old ones, as for the [edit module](../edit/README.md#what-the-ui-wiring-needs).
- For "Enhance voice", keep both versions in the entry (for example `enhanced` beside `tracks`), play the one that is chosen, and let the switch change which one the playback session opens.
- Before compressing, show `space_freed_by_compressing` and ask for confirmation.
