//! Playback through a cpal output device in shared mode.
//!
//! A thread owns the cpal stream, since a stream can't always move between threads. It builds the
//! stream when playback starts and drops it when playback stops, which frees the device.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Device, DeviceId, FromSample, OutputCallbackInfo, SampleFormat, SizedSample, Stream, SupportedStreamConfig,
};

use super::audio_output::{AudioOutput, FillFn, OutputFormat};
use crate::audio::{AudioError, Result};

fn device_error(error: cpal::Error) -> AudioError {
    AudioError::Device(error.to_string())
}

/// An output device: the default one, or one chosen by its ID from the device catalog.
pub struct CpalOutput {
    device: Device,
    config: SupportedStreamConfig,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CpalOutput {
    pub fn new(id: Option<&str>) -> Result<Self> {
        let host = cpal::default_host();
        let device = match id {
            None => host
                .default_output_device()
                .ok_or_else(|| AudioError::Device("There is no output device.".into()))?,
            Some(id) => {
                let parsed: DeviceId = id
                    .parse()
                    .map_err(|_| AudioError::Device(format!("\"{id}\" is not a device ID.")))?;
                host.device_by_id(&parsed)
                    .ok_or_else(|| AudioError::Device(format!("The output device \"{id}\" is not connected.")))?
            }
        };
        let config = device.default_output_config().map_err(device_error)?;
        Ok(CpalOutput {
            device,
            config,
            stop: Arc::new(AtomicBool::new(false)),
            thread: None,
        })
    }
}

impl AudioOutput for CpalOutput {
    fn format(&self) -> OutputFormat {
        OutputFormat {
            rate: self.config.sample_rate(),
            channels: self.config.channels(),
        }
    }

    fn start(&mut self, fill: FillFn) -> Result<()> {
        self.stop();
        self.stop.store(false, Ordering::SeqCst);
        let (device, config, stop) = (self.device.clone(), self.config, Arc::clone(&self.stop));
        let (ready, ready_rx) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("opennote-audio-output".into())
            .spawn(move || {
                let stream = open(&device, &config, fill);
                let opened = stream
                    .as_ref()
                    .map(|_| ())
                    .map_err(|error| AudioError::Device(error.to_string()));
                let _ = ready.send(opened);
                if stream.is_ok() {
                    while !stop.load(Ordering::SeqCst) {
                        thread::park();
                    }
                }
            })
            .map_err(|error| AudioError::Device(error.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok(())) => {
                self.thread = Some(thread);
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(_) => Err(AudioError::Device(
                "The output thread ended before the device opened.".into(),
            )),
        }
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
}

impl Drop for CpalOutput {
    fn drop(&mut self) {
        self.stop();
    }
}

fn open(device: &Device, config: &SupportedStreamConfig, fill: FillFn) -> Result<Stream> {
    let stream = match config.sample_format() {
        SampleFormat::F32 => build::<f32>(device, config, fill),
        SampleFormat::I16 => build::<i16>(device, config, fill),
        SampleFormat::I32 => build::<i32>(device, config, fill),
        other => Err(AudioError::Format(format!("{other} samples"))),
    }?;
    stream.play().map_err(device_error)?;
    Ok(stream)
}

fn build<T>(device: &Device, config: &SupportedStreamConfig, mut fill: FillFn) -> Result<Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let mut scratch: Vec<f32> = Vec::new();
    let on_data = move |data: &mut [T], _: &OutputCallbackInfo| {
        scratch.resize(data.len(), 0.0);
        fill(&mut scratch);
        for (slot, sample) in data.iter_mut().zip(&scratch) {
            *slot = T::from_sample(*sample);
        }
    };
    device
        .build_output_stream::<T, _, _>(config.config(), on_data, |_| {}, None)
        .map_err(device_error)
}
