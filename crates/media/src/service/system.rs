//! The service on the real devices: cpal for capture, and cpal for playback.

use std::sync::Arc;

use opennote_core::Clock as CoreClock;

use super::{DeviceFactory, Services};
use crate::audio::device::CpalSource;
use crate::audio::device_catalog::CpalCatalog;
use crate::audio::encoder::opus_factory;
use crate::audio::{AudioSource, Options, Result, SystemClock, SystemEnvironment};
use crate::playback::output::CpalOutput;
use crate::playback::{opus_decoder_factory, AudioOutput};

/// Opens the microphone, loopback, and speakers through cpal.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemDevices;

impl DeviceFactory for SystemDevices {
    fn microphone(&self, id: Option<&str>) -> Result<Box<dyn AudioSource>> {
        Ok(Box::new(CpalSource::input(id)?))
    }

    fn system_audio(&self, id: Option<&str>) -> Result<Box<dyn AudioSource>> {
        Ok(Box::new(CpalSource::loopback(id)?))
    }

    fn output(&self, id: Option<&str>) -> Result<Box<dyn AudioOutput>> {
        Ok(Box::new(CpalOutput::new(id)?))
    }
}

impl Services {
    /// The real machine. `session` is the app's clock, the one the note format anchors its times to.
    pub fn system(session: Arc<dyn CoreClock>) -> Self {
        Services {
            catalog: Arc::new(CpalCatalog),
            environment: Arc::new(SystemEnvironment),
            devices: Arc::new(SystemDevices),
            clock: Arc::new(SystemClock),
            session,
            encoder: opus_factory(),
            decoder: opus_decoder_factory(),
            options: Options::default(),
        }
    }
}
