//! A cloud service with the person's own key, chosen feature by feature (A1-33). Every feature runs on this device
//! unless the person picks "With my own key" for it, types a key, and confirms that the feature's input then goes to
//! the service. The key goes straight to Windows Credential Manager (`OpenNote/intel-cloud/<feature>`) and is never
//! handed back to the interface, written to a file or a log, or sent anywhere but the service's own host. A request
//! goes over HTTPS to the one pinned host only, and never while Work offline or safe mode is on. When it last ran
//! is kept for the Privacy panel.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    time::{SystemTime, UNIX_EPOCH},
};

use opennote_intel::wire::TranscriptLine;
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    connectors::{Body, HostPolicy, Http, HttpError, HttpRequest, Method, Secret, SecretStore},
    settings::file::write_atomic,
};

/// The service a key is for. One provider for now: its API shape is what the requests below speak.
pub const PROVIDER: &str = "openai";
/// The only host a key or a feature's input may go to.
pub const HOST: &str = "api.openai.com";
const BASE: &str = "https://api.openai.com/v1";

/// The longest answer read back.
const MAX_ANSWER_BYTES: usize = 4 * 1024 * 1024;
/// Audio goes up in pieces of this many seconds, so each request stays small and progress can be told.
const PIECE_SECONDS: usize = 120;
/// The most text a summary request carries.
const MAX_SUMMARY_CHARS: usize = 48_000;
/// What the service is told to do with the text.
const SUMMARY_PROMPT: &str = "Summarize these notes in three to five short, plain sentences. \
    Keep names, numbers, and terms exactly as written. Answer with the summary only.";
const LAST_USED_FILE: &str = "cloud-used.json";

/// The features that can use a cloud key. The others always run on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CloudFeature {
    Transcription,
    Summaries,
}

impl CloudFeature {
    pub const ALL: [CloudFeature; 2] = [CloudFeature::Transcription, CloudFeature::Summaries];

    pub fn id(self) -> &'static str {
        match self {
            CloudFeature::Transcription => "transcription",
            CloudFeature::Summaries => "summaries",
        }
    }

    pub fn parse(text: &str) -> Option<CloudFeature> {
        CloudFeature::ALL.into_iter().find(|feature| feature.id() == text)
    }

    fn target(self) -> String {
        format!("OpenNote/intel-cloud/{}", self.id())
    }
}

/// Why a cloud call didn't happen or failed. None of the messages holds the key or the input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudError {
    Offline,
    SafeMode,
    NoKey,
    /// The key isn't one a service could have issued: wrong length or characters.
    BadKey,
    /// The service refused the key.
    Refused,
    /// Too many requests, or the account is out of credit.
    Limited,
    Network,
    /// Windows Credential Manager could not be read or written.
    Store,
    /// The answer was not in the shape expected.
    Answer,
    Canceled,
}

impl CloudError {
    /// The code the interface reads, from the list `services/intel/ext.ts` knows.
    pub fn code(&self) -> &'static str {
        match self {
            CloudError::Offline => "offline",
            CloudError::SafeMode => "safeMode",
            CloudError::Network | CloudError::Limited | CloudError::Answer => "network",
            CloudError::Store => "io",
            CloudError::NoKey | CloudError::BadKey | CloudError::Refused => "invalid",
            CloudError::Canceled => "canceled",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            CloudError::Offline => "Work offline is on, so nothing is sent to the cloud service.",
            CloudError::SafeMode => "Safe mode is on, so nothing is sent to the cloud service.",
            CloudError::NoKey => "No key is saved for this feature.",
            CloudError::BadKey => "That doesn't look like a key. Paste the whole key, with no spaces.",
            CloudError::Refused => "The service didn't accept the key.",
            CloudError::Limited => "The service is busy or the account has no credit left. Try again later.",
            CloudError::Network => "The service couldn't be reached.",
            CloudError::Store => "Windows Credential Manager couldn't be used.",
            CloudError::Answer => "The service sent an answer OpenNote couldn't read.",
            CloudError::Canceled => "Stopped.",
        }
    }
}

/// Whether `key` could be a key: 20 to 400 printable ASCII characters with no spaces.
pub fn plausible_key(key: &str) -> bool {
    (20..=400).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_graphic())
}

/// A feature's line in Settings and the Privacy panel.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub feature: &'static str,
    pub provider: &'static str,
    pub host: &'static str,
    pub has_key: bool,
    pub last_used_unix: Option<u64>,
}

/// What the cloud calls need, so tests can swap the store and the network.
#[derive(Clone)]
pub struct Cloud {
    device: PathBuf,
    store: Arc<dyn SecretStore>,
    http: Arc<dyn Http>,
    lock: Arc<Mutex<()>>,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

impl Cloud {
    pub fn new(device: &Path, store: Arc<dyn SecretStore>, http: Arc<dyn Http>) -> Cloud {
        Cloud {
            device: device.to_path_buf(),
            store,
            http,
            lock: Arc::default(),
        }
    }

    fn policy() -> HostPolicy {
        HostPolicy::new([HOST])
    }

    fn last_used(&self) -> BTreeMap<String, u64> {
        fs::read_to_string(self.device.join(LAST_USED_FILE))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn mark_used(&self, feature: CloudFeature) {
        let _held = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let mut used = self.last_used();
        used.insert(feature.id().to_owned(), now_unix());
        if let Ok(text) = serde_json::to_vec(&used) {
            let _ = fs::create_dir_all(&self.device);
            let _ = write_atomic(&self.device.join(LAST_USED_FILE), &text);
        }
    }

    pub fn status(&self) -> Vec<CloudStatus> {
        let used = self.last_used();
        CloudFeature::ALL
            .into_iter()
            .map(|feature| CloudStatus {
                feature: feature.id(),
                provider: PROVIDER,
                host: HOST,
                has_key: matches!(self.store.get(&feature.target()), Ok(Some(secret)) if !secret.is_empty()),
                last_used_unix: used.get(feature.id()).copied(),
            })
            .collect()
    }

    /// Saves the key for a feature, replacing any key it had.
    pub fn set_key(&self, feature: CloudFeature, key: &str) -> Result<(), CloudError> {
        let key = key.trim();
        if !plausible_key(key) {
            return Err(CloudError::BadKey);
        }
        self.store
            .put(&feature.target(), &Secret::new(key))
            .map_err(|_| CloudError::Store)
    }

    pub fn forget(&self, feature: CloudFeature) -> Result<(), CloudError> {
        self.store.delete(&feature.target()).map_err(|_| CloudError::Store)
    }

    fn key(&self, feature: CloudFeature) -> Result<Secret, CloudError> {
        match self.store.get(&feature.target()) {
            Ok(Some(secret)) if !secret.is_empty() => Ok(secret),
            Ok(_) => Err(CloudError::NoKey),
            Err(_) => Err(CloudError::Store),
        }
    }

    fn send(&self, feature: CloudFeature, request: HttpRequest) -> Result<Value, CloudError> {
        let response = self
            .http
            .send(&Cloud::policy(), &request, MAX_ANSWER_BYTES)
            .map_err(|error| match error {
                HttpError::ForeignHost | HttpError::Network | HttpError::TooLarge => CloudError::Network,
            })?;
        self.mark_used(feature);
        match response.status {
            200..=299 => response.json().ok_or(CloudError::Answer),
            401 | 403 => Err(CloudError::Refused),
            429 | 402 => Err(CloudError::Limited),
            _ => Err(CloudError::Network),
        }
    }

    fn check_allowed(offline: bool, safe_mode: bool) -> Result<(), CloudError> {
        if safe_mode {
            Err(CloudError::SafeMode)
        } else if offline {
            Err(CloudError::Offline)
        } else {
            Ok(())
        }
    }

    /// A short summary of `text` from the service.
    pub fn summarize(&self, text: &str, offline: bool, safe_mode: bool) -> Result<String, CloudError> {
        Cloud::check_allowed(offline, safe_mode)?;
        let key = self.key(CloudFeature::Summaries)?;
        let text: String = text.chars().take(MAX_SUMMARY_CHARS).collect();
        let body = json!({
            "model": "gpt-4o-mini",
            "temperature": 0.2,
            "messages": [
                { "role": "system", "content": SUMMARY_PROMPT },
                { "role": "user", "content": text },
            ],
        });
        let request = HttpRequest::new(Method::Post, format!("{BASE}/chat/completions"))
            .header("Authorization", format!("Bearer {}", key.expose()));
        let request = HttpRequest {
            body: Some(Body::Bytes {
                content_type: "application/json".to_owned(),
                data: body.to_string().into_bytes(),
            }),
            ..request
        };
        let answer = self.send(CloudFeature::Summaries, request)?;
        answer["choices"][0]["message"]["content"]
            .as_str()
            .map(|summary| summary.trim().to_owned())
            .filter(|summary| !summary.is_empty())
            .ok_or(CloudError::Answer)
    }

    /// Transcribes 16 kHz mono audio read from `read`, piece by piece. `progress` hears the fraction done after each
    /// piece, and `canceled` is asked before each one.
    #[allow(clippy::too_many_arguments)]
    pub fn transcribe(
        &self,
        read: &mut dyn FnMut(&mut [f32]) -> Result<usize, String>,
        total_samples: Option<u64>,
        language: Option<&str>,
        prompt: &str,
        offline: bool,
        safe_mode: bool,
        progress: &dyn Fn(f32),
        canceled: &dyn Fn() -> bool,
    ) -> Result<Vec<TranscriptLine>, CloudError> {
        Cloud::check_allowed(offline, safe_mode)?;
        let key = self.key(CloudFeature::Transcription)?;
        let piece_len = PIECE_SECONDS * 16_000;
        let mut piece = vec![0.0_f32; piece_len];
        let mut lines = Vec::new();
        let mut offset_ms: u64 = 0;
        let mut done: u64 = 0;
        loop {
            if canceled() {
                return Err(CloudError::Canceled);
            }
            let mut filled = 0;
            while filled < piece_len {
                let count = read(&mut piece[filled..]).map_err(|_| CloudError::Answer)?;
                if count == 0 {
                    break;
                }
                filled += count;
            }
            if filled == 0 {
                break;
            }
            let request = transcription_request(&key, &piece[..filled], language, prompt);
            let answer = self.send(CloudFeature::Transcription, request)?;
            lines.extend(lines_of(&answer, offset_ms)?);
            offset_ms += filled as u64 * 1000 / 16_000;
            done += filled as u64;
            if let Some(total) = total_samples.filter(|&t| t > 0) {
                progress((done as f32 / total as f32).min(1.0));
            }
            if filled < piece_len {
                break;
            }
        }
        Ok(lines)
    }
}

/// 16-bit PCM WAV at 16 kHz, mono.
pub fn wav_16k(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16_u32.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&16_000_u32.to_le_bytes());
    out.extend_from_slice(&32_000_u32.to_le_bytes());
    out.extend_from_slice(&2_u16.to_le_bytes());
    out.extend_from_slice(&16_u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * 32_767.0).round() as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

fn transcription_request(key: &Secret, samples: &[f32], language: Option<&str>, prompt: &str) -> HttpRequest {
    let boundary = format!("opennote-{:x}", now_unix() ^ samples.len() as u64);
    let mut data = Vec::new();
    let mut field = |name: &str, value: &str| {
        data.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    };
    field("model", "whisper-1");
    field("response_format", "verbose_json");
    if let Some(language) = language {
        // The service takes the language part of the tag only.
        field("language", language.split('-').next().unwrap_or(language));
    }
    if !prompt.is_empty() {
        field("prompt", prompt);
    }
    data.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    data.extend_from_slice(&wav_16k(samples));
    data.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    HttpRequest {
        body: Some(Body::Bytes {
            content_type: format!("multipart/form-data; boundary={boundary}"),
            data,
        }),
        ..HttpRequest::new(Method::Post, format!("{BASE}/audio/transcriptions"))
            .header("Authorization", format!("Bearer {}", key.expose()))
    }
}

fn lines_of(answer: &Value, offset_ms: u64) -> Result<Vec<TranscriptLine>, CloudError> {
    let ms = |seconds: &Value| seconds.as_f64().map(|s| (s.max(0.0) * 1000.0).round() as u64);
    if let Some(segments) = answer["segments"].as_array() {
        return Ok(segments
            .iter()
            .filter_map(|segment| {
                let text = segment["text"].as_str()?.trim().to_owned();
                (!text.is_empty()).then(|| TranscriptLine {
                    start_ms: offset_ms + ms(&segment["start"]).unwrap_or(0),
                    end_ms: offset_ms + ms(&segment["end"]).unwrap_or(0),
                    text,
                    speaker: None,
                })
            })
            .collect());
    }
    let text = answer["text"].as_str().ok_or(CloudError::Answer)?.trim();
    Ok(if text.is_empty() {
        Vec::new()
    } else {
        vec![TranscriptLine {
            start_ms: offset_ms,
            end_ms: offset_ms,
            text: text.to_owned(),
            speaker: None,
        }]
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::{HttpResponse, MemoryStore};

    /// Answers every request with one reply, and keeps what was sent.
    struct Fake {
        reply: (u16, Value),
        sent: Mutex<Vec<(String, Vec<(String, String)>, usize)>>,
    }

    impl Http for Fake {
        fn send(&self, policy: &HostPolicy, request: &HttpRequest, _max: usize) -> Result<HttpResponse, HttpError> {
            if !policy.allows(&request.url) {
                return Err(HttpError::ForeignHost);
            }
            let len = match &request.body {
                Some(Body::Bytes { data, .. }) => data.len(),
                _ => 0,
            };
            self.sent
                .lock()
                .unwrap()
                .push((request.url.clone(), request.headers.clone(), len));
            Ok(HttpResponse {
                status: self.reply.0,
                content_type: Some("application/json".to_owned()),
                body: self.reply.1.to_string().into_bytes(),
            })
        }
    }

    fn key() -> String {
        // Built from pieces so the source holds nothing shaped like a key.
        ["test", "only", "0123456789", "abcdef"].join("-")
    }

    fn cloud(dir: &Path, status: u16, reply: Value) -> (Cloud, Arc<Fake>) {
        let fake = Arc::new(Fake {
            reply: (status, reply),
            sent: Mutex::default(),
        });
        let http: Arc<dyn Http> = fake.clone();
        (Cloud::new(dir, Arc::new(MemoryStore::default()), http), fake)
    }

    #[test]
    fn a_key_is_kept_in_the_store_and_only_its_presence_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let (cloud, _) = cloud(dir.path(), 200, json!({}));
        assert!(cloud.status().iter().all(|status| !status.has_key));
        assert_eq!(cloud.set_key(CloudFeature::Summaries, "short"), Err(CloudError::BadKey));
        assert_eq!(
            cloud.set_key(CloudFeature::Summaries, "has a space in it, 12345678"),
            Err(CloudError::BadKey)
        );
        cloud
            .set_key(CloudFeature::Summaries, &format!("  {}  ", key()))
            .unwrap();
        let status = cloud.status();
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains(&key()), "the status never carries the key");
        assert!(status.iter().any(|s| s.feature == "summaries" && s.has_key));
        assert!(status.iter().any(|s| s.feature == "transcription" && !s.has_key));
        cloud.forget(CloudFeature::Summaries).unwrap();
        assert!(cloud.status().iter().all(|status| !status.has_key));
        // Nothing about the key lands in the device folder.
        for entry in fs::read_dir(dir.path()).unwrap() {
            let text = fs::read_to_string(entry.unwrap().path()).unwrap_or_default();
            assert!(!text.contains(&key()));
        }
    }

    #[test]
    fn nothing_is_sent_offline_in_safe_mode_or_without_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let (cloud, fake) = cloud(dir.path(), 200, json!({}));
        assert_eq!(cloud.summarize("notes", false, false), Err(CloudError::NoKey));
        cloud.set_key(CloudFeature::Summaries, &key()).unwrap();
        assert_eq!(cloud.summarize("notes", true, false), Err(CloudError::Offline));
        assert_eq!(cloud.summarize("notes", false, true), Err(CloudError::SafeMode));
        assert!(fake.sent.lock().unwrap().is_empty());
    }

    #[test]
    fn a_summary_goes_to_the_pinned_host_with_the_key_and_marks_when_it_ran() {
        let dir = tempfile::tempdir().unwrap();
        let reply = json!({ "choices": [{ "message": { "content": " The cell makes energy. " } }] });
        let (cloud, fake) = cloud(dir.path(), 200, reply);
        cloud.set_key(CloudFeature::Summaries, &key()).unwrap();
        assert_eq!(
            cloud.summarize("notes", false, false).unwrap(),
            "The cell makes energy."
        );
        let sent = fake.sent.lock().unwrap();
        assert_eq!(sent[0].0, "https://api.openai.com/v1/chat/completions");
        assert!(sent[0]
            .1
            .iter()
            .any(|(name, value)| name == "Authorization" && value.ends_with(&key())));
        drop(sent);
        let used = cloud.status();
        assert!(used
            .iter()
            .any(|s| s.feature == "summaries" && s.last_used_unix.is_some()));
        assert!(used
            .iter()
            .any(|s| s.feature == "transcription" && s.last_used_unix.is_none()));
    }

    #[test]
    fn a_refused_key_and_a_busy_service_say_so() {
        let dir = tempfile::tempdir().unwrap();
        let (refused, _) = cloud(dir.path(), 401, json!({ "error": {} }));
        refused.set_key(CloudFeature::Summaries, &key()).unwrap();
        assert_eq!(refused.summarize("notes", false, false), Err(CloudError::Refused));
        let (busy, _) = cloud(dir.path(), 429, json!({}));
        busy.set_key(CloudFeature::Summaries, &key()).unwrap();
        assert_eq!(busy.summarize("notes", false, false), Err(CloudError::Limited));
    }

    #[test]
    fn audio_goes_up_in_pieces_and_the_lines_keep_their_place() {
        let dir = tempfile::tempdir().unwrap();
        let reply = json!({ "text": "x", "segments": [{ "start": 1.0, "end": 2.5, "text": " Hello. " }] });
        let (cloud, fake) = cloud(dir.path(), 200, reply);
        cloud.set_key(CloudFeature::Transcription, &key()).unwrap();
        let total = 16_000 * (PIECE_SECONDS + 30);
        let mut left = total;
        let mut read = |out: &mut [f32]| -> Result<usize, String> {
            let count = out.len().min(left);
            out[..count].fill(0.1);
            left -= count;
            Ok(count)
        };
        let fractions = Mutex::new(Vec::new());
        let lines = cloud
            .transcribe(
                &mut read,
                Some(total as u64),
                Some("en-US"),
                "ATP",
                false,
                false,
                &|f| fractions.lock().unwrap().push(f),
                &|| false,
            )
            .unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start_ms, 1000);
        assert_eq!(lines[1].start_ms, PIECE_SECONDS as u64 * 1000 + 1000);
        assert_eq!(lines[1].text, "Hello.");
        assert_eq!(fake.sent.lock().unwrap().len(), 2);
        assert_eq!(fractions.lock().unwrap().last().copied(), Some(1.0));
        let canceled = cloud.transcribe(&mut |_| Ok(0), None, None, "", false, false, &|_| {}, &|| true);
        assert_eq!(canceled, Err(CloudError::Canceled));
    }

    #[test]
    fn the_wav_header_matches_the_samples() {
        let wav = wav_16k(&[0.0, 1.0, -1.0]);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(wav.len(), 44 + 6);
        assert_eq!(i16::from_le_bytes([wav[46], wav[47]]), 32_767);
    }
}
