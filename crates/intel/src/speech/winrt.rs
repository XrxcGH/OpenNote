//! The Windows synthesizer, on top of Windows.Media.SpeechSynthesis.

use std::sync::{Mutex, PoisonError};

use windows::core::{Interface, HSTRING};
use windows::Media::Core::{IMediaCue, SpeechCue};
use windows::Media::SpeechSynthesis::{SpeechSynthesizer as WinSynth, VoiceGender as WinGender, VoiceInformation};
use windows::Storage::Streams::DataReader;

use super::wav::read_info;
use super::{
    finish_boundaries, validate_request, Boundary, BoundaryKind, SpeakOptions, SpeechAudio, SpeechInfo,
    SpeechSynthesizer, Voice, VoiceGender,
};
use crate::error::IntelError;
use crate::geometry::Language;
use crate::text::Span;

/// Two syntheses at once in one process crashed a test run with a fail-fast error, which showed only under
/// heavy load. Every call takes this lock, so calls run one at a time.
static SYNTHESIS: Mutex<()> = Mutex::new(());

/// Speech through Windows.Media.SpeechSynthesis, with the voices installed on the computer. It runs
/// on the device, and the voices that ship with Windows need no network.
#[derive(Debug, Default)]
pub struct WindowsSpeech;

impl WindowsSpeech {
    /// Creates the synthesizer. The Windows synthesizer is made for each call.
    pub fn new() -> WindowsSpeech {
        WindowsSpeech
    }
}

impl SpeechSynthesizer for WindowsSpeech {
    fn voices(&self) -> Result<Vec<Voice>, IntelError> {
        let _one_at_a_time = SYNTHESIS.lock().unwrap_or_else(PoisonError::into_inner);
        let mut found = Vec::new();
        for voice in WinSynth::AllVoices()? {
            found.push(convert_voice(&voice)?);
        }
        Ok(found)
    }

    fn synthesize(&self, text: &str, options: &SpeakOptions) -> Result<SpeechAudio, IntelError> {
        validate_request(text, options)?;
        let _one_at_a_time = SYNTHESIS.lock().unwrap_or_else(PoisonError::into_inner);
        let synthesizer = synthesizer_with_voice(options.voice.as_deref())?;
        let settings = synthesizer.Options()?;
        settings.SetSpeakingRate(f64::from(options.rate))?;
        settings.SetAudioPitch(f64::from(options.pitch))?;
        settings.SetAudioVolume(f64::from(options.volume))?;
        settings.SetIncludeWordBoundaryMetadata(true)?;
        settings.SetIncludeSentenceBoundaryMetadata(true)?;

        let stream = synthesizer.SynthesizeTextToStreamAsync(&HSTRING::from(text))?.join()?;
        let size = u32::try_from(stream.Size()?)
            .map_err(|_| IntelError::Engine("the synthesized sound is too large".to_owned()))?;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.join()?;
        let mut wav = vec![0_u8; size as usize];
        reader.ReadBytes(&mut wav)?;

        let duration_ms = read_info(&wav)?.duration_ms();
        let mut boundaries = Vec::new();
        for track in stream.TimedMetadataTracks()? {
            let kind = match track.Id()?.to_string().as_str() {
                "SpeechWord" => BoundaryKind::Word,
                "SpeechSentence" => BoundaryKind::Sentence,
                _ => continue,
            };
            for cue in track.Cues()? {
                boundaries.push(convert_cue(&cue, kind)?);
            }
        }
        finish_boundaries(&mut boundaries, duration_ms);
        Ok(SpeechAudio {
            wav,
            info: SpeechInfo {
                duration_ms,
                boundaries,
            },
        })
    }
}

/// A Windows synthesizer with the chosen voice, or the default one when `voice` is `None`.
fn synthesizer_with_voice(voice: Option<&str>) -> Result<WinSynth, IntelError> {
    let voices = WinSynth::AllVoices()?;
    // Without a voice Windows fails with a bare error code, which tells the person nothing.
    if voices.Size()? == 0 {
        return Err(IntelError::VoiceUnavailable);
    }
    let synthesizer = WinSynth::new()?;
    if let Some(id) = voice {
        let chosen = voices
            .into_iter()
            .find(|v| v.Id().is_ok_and(|found| found == id))
            .ok_or_else(|| IntelError::InvalidInput(format!("the voice \"{id}\" is not installed")))?;
        synthesizer.SetVoice(&chosen)?;
    }
    Ok(synthesizer)
}

fn convert_voice(voice: &VoiceInformation) -> Result<Voice, IntelError> {
    let gender = match voice.Gender()? {
        WinGender::Female => VoiceGender::Female,
        WinGender::Male => VoiceGender::Male,
        _ => VoiceGender::Unspecified,
    };
    Ok(Voice {
        id: voice.Id()?.to_string(),
        name: voice.DisplayName()?.to_string(),
        language: Language::new(&voice.Language()?.to_string())?,
        gender,
    })
}

/// Windows counts time in 100-nanosecond ticks.
fn ticks_to_ms(ticks: i64) -> u64 {
    u64::try_from(ticks).unwrap_or(0) / 10_000
}

/// Reads one cue. Windows gives no length for a cue, so `end_ms` starts equal to `start_ms` and
/// [`finish_boundaries`] fills it in. Windows also gives the position of the last character, not the one after it.
fn convert_cue(cue: &IMediaCue, kind: BoundaryKind) -> Result<Boundary, IntelError> {
    let start_ms = ticks_to_ms(cue.StartTime()?.Duration);
    let speech: SpeechCue = cue.cast()?;
    let position = |value: windows::Foundation::IReference<i32>| -> Result<usize, IntelError> {
        Ok(usize::try_from(value.Value()?).unwrap_or(0))
    };
    let start = position(speech.StartPositionInInput()?)?;
    let last = position(speech.EndPositionInInput()?)?;
    Ok(Boundary {
        kind,
        start_ms,
        end_ms: start_ms,
        text: Span {
            start,
            end: last.max(start) + 1,
        },
    })
}
