//! Speech to text, with a job queue that runs one recording at a time in the background.
//!
//! [`TranscriptionEngine`] is the interface for an engine such as whisper.cpp.
//!
//! [`TranscriptionQueue`] runs jobs on a low-priority thread and reports progress. It picks the
//! NPU when the engine has one and the processor otherwise, and it cancels on request.
//!
//! [`StubEngine`] stands in until the whisper.cpp engine lands. No model is downloaded here. The
//! interface asks first, and a missing model is [`IntelError::ModelMissing`].

use serde::{Deserialize, Serialize};

use crate::error::IntelError;
use crate::geometry::Language;

mod audio;
mod control;
mod job;
mod priority;
mod queue;
mod stub;

pub use audio::{AudioSource, MemoryAudio, SAMPLES_PER_SECOND};
pub use control::{EngineEvent, JobControl};
pub use job::{JobEvent, JobEventKind, JobId, JobRequest, JobStatus};
pub use priority::enter_background_mode;
pub use queue::{JobHandle, TranscriptionQueue};
pub use stub::StubEngine;

/// The hardware that runs the model.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Device {
    /// A neural processing unit, which is fast and easy on the battery.
    Npu,
    /// The processor, which every computer has.
    Cpu,
}

impl std::fmt::Display for Device {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Device::Npu => "NPU",
            Device::Cpu => "processor",
        })
    }
}

/// Which device the person or the app prefers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum DevicePreference {
    /// The NPU when there is one, and the processor otherwise. If the NPU fails, try the processor.
    #[default]
    Auto,
    /// Only the NPU.
    Npu,
    /// Only the processor.
    Cpu,
}

/// Picks the device to run on from what the engine offers.
pub fn resolve_device(preference: DevicePreference, available: &[Device]) -> Result<Device, IntelError> {
    let has = |device: Device| available.contains(&device);
    match preference {
        DevicePreference::Npu if has(Device::Npu) => Ok(Device::Npu),
        DevicePreference::Npu => Err(IntelError::DeviceUnavailable(Device::Npu)),
        DevicePreference::Cpu if has(Device::Cpu) => Ok(Device::Cpu),
        DevicePreference::Cpu => Err(IntelError::DeviceUnavailable(Device::Cpu)),
        DevicePreference::Auto if has(Device::Npu) => Ok(Device::Npu),
        DevicePreference::Auto if has(Device::Cpu) => Ok(Device::Cpu),
        DevicePreference::Auto => Err(IntelError::Engine("the engine offers no device to run on".to_owned())),
    }
}

/// What the person asked for, before a device is chosen.
#[derive(Clone, Debug, Default)]
pub struct TranscribeOptions {
    /// The spoken language. `None` lets the engine detect it.
    pub language: Option<Language>,
    /// The device to prefer.
    pub device: DevicePreference,
    /// Words to prefer, such as the notebook's vocabulary, given to the engine before the audio. Empty for none.
    pub prompt: String,
}

/// What an engine receives: the language and the device the queue chose.
#[derive(Clone, Debug)]
pub struct EngineSettings {
    /// The spoken language, or `None` to detect it.
    pub language: Option<Language>,
    /// The device to run on. It is always one the engine listed.
    pub device: Device,
    /// Words to prefer, such as the notebook's vocabulary. Empty for none.
    pub prompt: String,
}

/// A stretch of speech and its text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// When the stretch starts, in milliseconds from the start of the recording.
    pub start_ms: u64,
    /// When it ends.
    pub end_ms: u64,
    /// The words spoken.
    pub text: String,
}

/// The finished transcript of one recording.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    /// The language spoken, as given or as detected.
    pub language: Option<Language>,
    /// The device that ran the job.
    pub device: Device,
    /// The segments in time order.
    pub segments: Vec<Segment>,
}

impl Transcript {
    /// All the text, with a space between segments.
    pub fn text(&self) -> String {
        let texts: Vec<&str> = self
            .segments
            .iter()
            .map(|s| s.text.trim())
            .filter(|t| !t.is_empty())
            .collect();
        texts.join(" ")
    }
}

/// A speech engine. Every call runs on the device and makes no network request.
pub trait TranscriptionEngine: Send + Sync {
    /// A short name for logs and settings, such as "whisper.cpp base.en".
    fn name(&self) -> String;

    /// The devices this engine can run on here, which always include the processor.
    fn devices(&self) -> Vec<Device>;

    /// The model file the engine reads, if it reads one. Settings use it to tell whether the model is still there.
    fn model_file(&self) -> Option<std::path::PathBuf> {
        None
    }

    /// Transcribes one recording from the start of `audio`.
    ///
    /// The engine reports progress and each finished segment through `control`, and stops with
    /// [`IntelError::Canceled`] soon after `control.is_canceled()` turns true. If it starts
    /// helper threads, each one should call [`enter_background_mode`].
    fn transcribe(
        &self,
        audio: &mut dyn AudioSource,
        settings: &EngineSettings,
        control: &JobControl,
    ) -> Result<Transcript, IntelError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_prefers_the_npu_and_falls_back_to_the_processor() {
        let both = [Device::Cpu, Device::Npu];
        assert_eq!(resolve_device(DevicePreference::Auto, &both), Ok(Device::Npu));
        assert_eq!(resolve_device(DevicePreference::Auto, &[Device::Cpu]), Ok(Device::Cpu));
        assert_eq!(resolve_device(DevicePreference::Cpu, &both), Ok(Device::Cpu));
    }

    #[test]
    fn a_named_device_must_exist() {
        assert_eq!(
            resolve_device(DevicePreference::Npu, &[Device::Cpu]),
            Err(IntelError::DeviceUnavailable(Device::Npu))
        );
        assert!(resolve_device(DevicePreference::Auto, &[]).is_err());
    }
}
