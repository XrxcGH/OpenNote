# opennote-intel-engines

The native engines behind OpenNote's on-device intelligence. `opennote-intel` holds the interfaces, the person's opt-in gate, and engines written in plain Rust. This crate holds the engines that bring native libraries along, so that crate stays free of C++ code and of anything that could reach a network.

| Feature | Engine | Used for |
|---|---|---|
| `whisper-cpp` | whisper.cpp through whisper-rs | Transcription, dictation, and live captions. It installs itself into `opennote_intel::whisper` as the speech backend. A model it cannot load falls back to the Rust reader. |
| `whisper-vulkan` | whisper.cpp with Vulkan | Lets whole-recording jobs use the graphics card (`Device::Gpu`). Needs the Vulkan SDK to build, so no release uses it yet. |
| `onnx` | ONNX Runtime through ort | `onnx::Translator` (a Marian model for one language pair) and `onnx::Embedder` (a MiniLM model that gives vectors of 384 numbers). |

`protocol` is always built. It holds the messages between the app and the language model program, `crates/llm-host`. llama.cpp and whisper.cpp each bundle ggml, so one program cannot link both. That is why llama.cpp runs in its own program. The app starts it when a language model is downloaded and the person asks Ask or a writing tool for something.

Building the engines needs CMake, a C++ compiler, and libclang (`LIBCLANG_PATH`). Without a feature, nothing here compiles those. The app turns them on with its `native-engines` feature.

Nothing here makes a network request or loads a model before the first call that needs it. A model file reaches the disk only through the app's download code (`app/src-tauri/src/intel/models.rs`). The person agrees to its size first, the address is pinned to a commit, and the file is checked against a published checksum.

## Tests

`tests/onnx.rs` runs the whole ONNX path on tiny models in `tests/fixtures` (made by `make_fixtures.py`, which needs the onnx and numpy Python packages; the output is committed). Three tests run only when you point them at real files, so the owner can judge quality without a download in CI:

- `OPENNOTE_SPEECH_MODEL` and `OPENNOTE_SPEECH_WAV` (whisper.cpp, 16 kHz mono WAV)
- `OPENNOTE_TRANSLATE_PACK` (a downloaded `translate-en-es` folder)
- `OPENNOTE_LLM_MODEL` (a `.gguf` file, for `crates/llm-host`)
