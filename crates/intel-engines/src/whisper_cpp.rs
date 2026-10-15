//! whisper.cpp through whisper-rs.
//!
//! The model is a ggml file, the same file the Rust reader in `opennote_intel::whisper` reads. The context loads on
//! the first request and stays in memory for dictation, captions, and later jobs, until the model changes or the
//! person turns transcription off. A model that whisper.cpp cannot load is answered with `Unsupported`, and the
//! Rust reader takes over.
//!
//! A long recording is read in stretches of ten minutes, so memory stays small. Each stretch is transcribed on
//! its own, with the times moved to where the stretch begins.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use opennote_intel::geometry::Language;
use opennote_intel::transcribe::{
    enter_background_mode, AudioSource, Device, EngineSettings, JobControl, Segment, Transcript, SAMPLES_PER_SECOND,
};
use opennote_intel::whisper::{install_backend, SpeechBackend};
use opennote_intel::IntelError;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// The longest stretch transcribed in one call, in samples.
const STRETCH: usize = SAMPLES_PER_SECOND as usize * 60 * 10;
/// The most characters of vocabulary prompt given to the model, as in the Rust reader.
const MAX_PROMPT_CHARS: usize = 400;

struct Loaded {
    path: PathBuf,
    gpu: bool,
    context: Arc<WhisperContext>,
}

/// whisper.cpp as a speech backend.
#[derive(Default)]
pub struct CppBackend {
    loaded: Mutex<Option<Loaded>>,
}

/// Installs whisper.cpp as the speech backend of `opennote_intel`.
pub fn install() {
    install_backend(Arc::new(CppBackend::default()));
}

fn unsupported() -> IntelError {
    IntelError::Unsupported { feature: "whisper.cpp" }
}

fn threads() -> i32 {
    let cores = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
    // Leave a core for the page the person is writing on.
    i32::try_from(cores.saturating_sub(1).clamp(1, 8)).unwrap_or(4)
}

impl CppBackend {
    fn context(&self, path: &Path, gpu: bool) -> Result<Arc<WhisperContext>, IntelError> {
        let mut loaded = self.loaded.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(held) = loaded.as_ref() {
            if held.path == path && held.gpu == gpu {
                return Ok(Arc::clone(&held.context));
            }
        }
        // Free the old model before the new one is read, so two never sit in memory together.
        *loaded = None;
        let mut parameters = WhisperContextParameters::default();
        parameters.use_gpu(gpu);
        let context = WhisperContext::new_with_params(path, parameters).map_err(|_| unsupported())?;
        let context = Arc::new(context);
        *loaded = Some(Loaded {
            path: path.to_path_buf(),
            gpu,
            context: Arc::clone(&context),
        });
        Ok(context)
    }
}

/// The language to give whisper.cpp: the one asked for, English for an English-only model, or detection.
fn language_of(path: &Path, language: Option<&Language>) -> String {
    if let Some(language) = language {
        return language.primary();
    }
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().to_lowercase());
    if name.contains(".en.") || name.ends_with(".en") {
        "en".to_owned()
    } else {
        "auto".to_owned()
    }
}

/// What one run heard.
struct Heard {
    segments: Vec<Segment>,
    language: Option<String>,
}

/// Transcribes `samples` with `context`. Times are in milliseconds from the start of `samples`. `stop` is asked
/// often and ends the run early when it turns true.
fn run(
    context: &WhisperContext,
    samples: &[f32],
    language: &str,
    prompt: &str,
    stop: impl FnMut() -> bool + 'static,
) -> Result<Heard, IntelError> {
    let mut state = context
        .create_state()
        .map_err(|error| IntelError::Engine(error.to_string()))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language));
    params.set_n_threads(threads());
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    // Silence and noise give no words; whisper.cpp otherwise makes some up.
    params.set_no_speech_thold(0.6);
    let hint: String = prompt.chars().take(MAX_PROMPT_CHARS).collect();
    if !hint.trim().is_empty() {
        params.set_initial_prompt(hint.trim());
    }
    params.set_abort_callback_safe(stop);
    state
        .full(params, samples)
        .map_err(|error| IntelError::Engine(error.to_string()))?;
    let language = whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_owned);
    let mut segments = Vec::new();
    for segment in state.as_iter() {
        let text = segment
            .to_str_lossy()
            .map_err(|error| IntelError::Engine(error.to_string()))?
            .trim()
            .to_owned();
        if text.is_empty() {
            continue;
        }
        // whisper.cpp counts in centiseconds.
        let start = u64::try_from(segment.start_timestamp().max(0)).unwrap_or(0) * 10;
        let end = u64::try_from(segment.end_timestamp().max(0)).unwrap_or(0) * 10;
        segments.push(Segment {
            start_ms: start,
            end_ms: end.max(start),
            text,
        });
    }
    Ok(Heard { segments, language })
}

impl SpeechBackend for CppBackend {
    fn name(&self) -> &'static str {
        "whisper.cpp"
    }

    fn devices(&self) -> Vec<Device> {
        if cfg!(feature = "whisper-vulkan") {
            vec![Device::Gpu]
        } else {
            Vec::new()
        }
    }

    fn transcribe_samples(
        &self,
        model: &Path,
        samples: &[f32],
        language: Option<&Language>,
        prompt: &str,
    ) -> Result<Vec<Segment>, IntelError> {
        // Live captions and dictation read short clips, and starting the graphics card for them costs more than it
        // saves, so they run on the processor.
        let context = self.context(model, false)?;
        let heard = run(&context, samples, &language_of(model, language), prompt, || false)?;
        Ok(heard.segments)
    }

    fn transcribe(
        &self,
        model: &Path,
        audio: &mut dyn AudioSource,
        settings: &EngineSettings,
        control: &JobControl,
    ) -> Result<Transcript, IntelError> {
        enter_background_mode();
        let gpu = settings.device == Device::Gpu;
        let context = self.context(model, gpu)?;
        let language = language_of(model, settings.language.as_ref());
        let total = audio.total_samples().filter(|&t| t > 0);
        let mut chunk = vec![0.0_f32; SAMPLES_PER_SECOND as usize * 5];
        let mut buffer: Vec<f32> = Vec::with_capacity(STRETCH);
        let mut segments = Vec::new();
        let mut detected: Option<String> = None;
        let mut done = 0_u64;
        let mut ended = false;
        while !ended {
            control.check_canceled()?;
            while buffer.len() < STRETCH {
                let count = audio.read(&mut chunk)?;
                if count == 0 {
                    ended = true;
                    break;
                }
                buffer.extend_from_slice(&chunk[..count]);
            }
            if buffer.len() < SAMPLES_PER_SECOND as usize / 2 {
                break;
            }
            let offset_ms = done * 1000 / u64::from(SAMPLES_PER_SECOND);
            let stopped = Arc::new(AtomicBool::new(false));
            let watcher = {
                let (control, stopped) = (control.clone(), Arc::clone(&stopped));
                move || {
                    let now = control.is_canceled();
                    stopped.store(now, Ordering::Relaxed);
                    now
                }
            };
            let heard = run(&context, &buffer, &language, &settings.prompt, watcher)?;
            if stopped.load(Ordering::Relaxed) {
                return Err(IntelError::Canceled);
            }
            detected = detected.or(heard.language);
            for mut segment in heard.segments {
                segment.start_ms += offset_ms;
                segment.end_ms += offset_ms;
                control.emit_segment(segment.clone());
                segments.push(segment);
            }
            done += buffer.len() as u64;
            buffer.clear();
            if let Some(total) = total {
                control.report_progress((done as f32 / total as f32).min(1.0));
            }
        }
        control.report_progress(1.0);
        let language = settings
            .language
            .clone()
            .or_else(|| detected.and_then(|code| Language::new(&code).ok()));
        Ok(Transcript {
            language,
            device: settings.device,
            segments,
        })
    }

    fn unload(&self) {
        *self.loaded.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opennote_intel::transcribe::MemoryAudio;

    #[test]
    fn the_library_links_and_names_its_version() {
        assert!(!whisper_rs::get_whisper_version().is_empty());
    }

    #[test]
    fn a_file_that_is_not_a_model_is_unsupported_so_the_rust_reader_takes_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ggml-broken.bin");
        std::fs::write(&path, b"this is not a whisper model").unwrap();
        let backend = CppBackend::default();
        let samples = vec![0.0_f32; 16_000];
        let error = backend.transcribe_samples(&path, &samples, None, "").unwrap_err();
        assert!(matches!(error, IntelError::Unsupported { .. }), "{error:?}");
        let mut audio = MemoryAudio::silence(1);
        let settings = EngineSettings {
            language: None,
            device: Device::Cpu,
            prompt: String::new(),
        };
        let error = backend
            .transcribe(&path, &mut audio, &settings, &JobControl::detached())
            .unwrap_err();
        assert!(matches!(error, IntelError::Unsupported { .. }), "{error:?}");
        // Nothing was read before the refusal, so the fallback can start from the first sample.
        assert_eq!(audio.total_samples(), Some(16_000));
    }

    #[test]
    fn the_language_follows_the_request_then_the_model() {
        let english = Path::new("ggml-base.en.bin");
        let many = Path::new("ggml-base.bin");
        assert_eq!(language_of(english, None), "en");
        assert_eq!(language_of(many, None), "auto");
        assert_eq!(language_of(many, Some(&Language::new("fr-CA").unwrap())), "fr");
    }

    /// Runs only when `OPENNOTE_SPEECH_MODEL` names a ggml file and `OPENNOTE_SPEECH_WAV` a 16 kHz mono WAV of
    /// speech, so the owner can check real accuracy. It is skipped everywhere else, and no model is downloaded.
    #[test]
    fn a_real_model_hears_real_speech() {
        let (Some(model), Some(wav)) = (
            std::env::var_os("OPENNOTE_SPEECH_MODEL"),
            std::env::var_os("OPENNOTE_SPEECH_WAV"),
        ) else {
            return;
        };
        let bytes = std::fs::read(wav).unwrap();
        // A canonical 44-byte header, then 16-bit samples.
        let samples: Vec<f32> = bytes[44..]
            .chunks_exact(2)
            .map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32768.0)
            .collect();
        let backend = CppBackend::default();
        let heard = backend
            .transcribe_samples(Path::new(&model), &samples, None, "")
            .unwrap();
        assert!(!heard.is_empty());
    }
}
