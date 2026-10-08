//! The opt-in gate: nothing runs until the person turns it on. Runs on every platform.

use std::sync::Arc;
use std::time::Duration;

use opennote_intel::mock::{MockSpeech, ReplayInk, ReplayOcr};
use opennote_intel::speech::{ReadAloudEvent, ReadAloudOptions};
use opennote_intel::transcribe::{
    AudioSource, Device, EngineSettings, JobControl, JobRequest, JobStatus, MemoryAudio, TranscribeOptions, Transcript,
    TranscriptionEngine,
};
use opennote_intel::{Engines, Feature, IntelError, IntelSettings};

fn mocked(settings: IntelSettings) -> Engines {
    Engines::mock(settings, ReplayInk::default(), ReplayOcr::default())
}

#[test]
fn every_feature_is_refused_until_the_person_turns_it_on() {
    let engines = mocked(IntelSettings::default());
    assert!(matches!(engines.ocr(), Err(IntelError::Disabled(Feature::Ocr))));
    assert!(matches!(engines.ink(), Err(IntelError::Disabled(Feature::Handwriting))));
    assert!(matches!(
        engines.speech(),
        Err(IntelError::Disabled(Feature::ReadAloud))
    ));
    assert!(matches!(
        engines.summarizer(),
        Err(IntelError::Disabled(Feature::Summaries))
    ));
    assert!(matches!(
        engines.transcription(),
        Err(IntelError::Disabled(Feature::Transcription))
    ));
    assert!(matches!(
        engines.read_aloud("Hello there.", ReadAloudOptions::default()),
        Err(IntelError::Disabled(Feature::ReadAloud))
    ));
}

#[test]
fn the_local_text_and_ink_tools_are_gated_too() {
    use opennote_intel::ink::InkRecognition;
    use opennote_intel::summarize::ChapterOptions;
    use opennote_intel::tidy::TidyOperation;
    use opennote_intel::vocabulary::Vocabulary;

    let transcript = Transcript {
        language: None,
        device: Device::Cpu,
        segments: vec![],
    };
    let off = mocked(IntelSettings::default());
    let recognition = InkRecognition::default();
    assert!(matches!(
        off.tidy(&[], &recognition, &TidyOperation::Straighten),
        Err(IntelError::Disabled(Feature::Handwriting))
    ));
    assert!(matches!(
        off.action_items(&transcript),
        Err(IntelError::Disabled(Feature::Summaries))
    ));
    assert!(matches!(
        off.chapters(&transcript, &ChapterOptions::default()),
        Err(IntelError::Disabled(Feature::Summaries))
    ));
    let list = Vocabulary::parse("ATP");
    assert!(matches!(
        off.vocabulary_offer(&list, "adp", "ADP"),
        Err(IntelError::Disabled(Feature::Transcription))
    ));

    let on = mocked(IntelSettings::recommended());
    assert!(on
        .tidy(&[], &recognition, &TidyOperation::Straighten)
        .unwrap()
        .moves
        .is_empty());
    assert!(on.action_items(&transcript).unwrap().is_empty());
    assert!(on.chapters(&transcript, &ChapterOptions::default()).unwrap().is_empty());
    assert!(on.vocabulary_offer(&list, "adp", "ADP").unwrap().is_some());
}

#[test]
fn turning_one_feature_on_leaves_the_others_off() {
    let mut settings = IntelSettings::default();
    settings.set(Feature::Summaries, true);
    let engines = mocked(settings);
    assert!(engines.summarizer().is_ok());
    assert!(engines.ocr().is_err() && engines.ink().is_err() && engines.speech().is_err());
}

fn turn_off(engines: &mut Engines, feature: Feature) {
    let mut settings = engines.settings();
    settings.set(feature, false);
    engines.set_settings(settings);
}

#[test]
fn turning_a_feature_off_stops_the_engines_handed_out_before() {
    let mut engines = mocked(IntelSettings::recommended());
    let ocr = engines.ocr().expect("on");
    let summarizer = engines.summarizer().expect("on");
    assert!(ocr.available_languages().is_ok());
    turn_off(&mut engines, Feature::Ocr);
    assert!(engines.ocr().is_err());
    assert_eq!(ocr.available_languages(), Err(IntelError::Disabled(Feature::Ocr)));
    assert!(
        summarizer.keywords("Cells divide.", &Default::default()).is_ok(),
        "other features stay on"
    );
    engines.set_settings(IntelSettings::recommended());
    assert!(ocr.available_languages().is_ok(), "turning it on again restores it");
}

#[test]
fn turning_read_aloud_off_mid_page_stops_the_session() {
    let mut engines = mocked(IntelSettings::recommended());
    let page = "A short sentence of words. ".repeat(100);
    let session = engines.read_aloud(&page, ReadAloudOptions::default()).unwrap();
    let wait = Duration::from_secs(5);
    assert!(matches!(session.next_event(wait), Some(ReadAloudEvent::Chunk(_))));
    turn_off(&mut engines, Feature::ReadAloud);
    let mut chunks = 1;
    let last = loop {
        match session.next_event(wait).expect("the session reports how it ended") {
            ReadAloudEvent::Chunk(_) => chunks += 1,
            other => break other,
        }
    };
    assert!(
        matches!(last, ReadAloudEvent::Failed(IntelError::Disabled(Feature::ReadAloud))),
        "{last:?}"
    );
    assert!(
        chunks < session.total_chunks() / 2,
        "only the chunks made ahead arrive: {chunks}"
    );
}

/// Runs until its job is canceled, checking every 10 milliseconds for up to 5 seconds.
struct UntilCanceled;

impl TranscriptionEngine for UntilCanceled {
    fn name(&self) -> String {
        "until canceled".to_owned()
    }

    fn devices(&self) -> Vec<Device> {
        vec![Device::Cpu]
    }

    fn transcribe(
        &self,
        _audio: &mut dyn AudioSource,
        _settings: &EngineSettings,
        control: &JobControl,
    ) -> Result<Transcript, IntelError> {
        for _ in 0..500 {
            control.check_canceled()?;
            std::thread::sleep(Duration::from_millis(10));
        }
        Err(IntelError::Engine("the job was never stopped".to_owned()))
    }
}

#[test]
fn turning_transcription_off_stops_the_running_job_and_the_waiting_ones() {
    let mut engines = mocked(IntelSettings::recommended()).with_transcription_engine(Arc::new(UntilCanceled));
    let queue = engines.transcription_queue(|_| {}).unwrap();
    let job = || JobRequest {
        audio: Box::new(MemoryAudio::new(vec![0.0; 16_000])),
        options: TranscribeOptions::default(),
    };
    let (running, waiting) = (queue.submit(job()), queue.submit(job()));
    while !matches!(running.status(), JobStatus::Running { .. }) {
        std::thread::sleep(Duration::from_millis(5));
    }
    turn_off(&mut engines, Feature::Transcription);
    let wait = Duration::from_secs(5);
    let disabled = Some(Err(IntelError::Disabled(Feature::Transcription)));
    assert_eq!(running.wait_timeout(wait).map(|r| r.map(|_| ())), disabled);
    assert_eq!(waiting.wait_timeout(wait).map(|r| r.map(|_| ())), disabled);
}

#[test]
fn a_page_can_be_read_aloud_once_the_feature_is_on() {
    let mut settings = IntelSettings::default();
    settings.set(Feature::ReadAloud, true);
    let engines = mocked(settings);
    let session = engines
        .read_aloud("One sentence. Another sentence.", ReadAloudOptions::default())
        .expect("read aloud is on");
    assert!(session.total_chunks() >= 1);
}

#[test]
fn status_tells_the_settings_screen_what_is_on_and_what_exists() {
    let mut settings = IntelSettings::default();
    settings.set(Feature::Summaries, true);
    settings.set(Feature::Transcription, true);
    let status = mocked(settings).status();
    assert_eq!(status.len(), Feature::ALL.len());
    let of = |feature| status.iter().find(|s| s.feature == feature).unwrap();
    assert!(of(Feature::Summaries).enabled && of(Feature::Summaries).available);
    assert!(!of(Feature::Ocr).enabled && of(Feature::Ocr).available);
    // No speech model is downloaded yet, and the screen says so.
    assert!(of(Feature::Transcription).enabled && !of(Feature::Transcription).available);
    assert!(of(Feature::Transcription)
        .unavailable_reason
        .as_deref()
        .unwrap()
        .contains("speech model"));
}

#[test]
fn status_says_when_a_feature_that_is_on_lacks_a_language_pack_or_a_voice() {
    let engines = mocked(IntelSettings::recommended()).with_speech_engine(Arc::new(MockSpeech::new().without_voices()));
    let status = engines.status();
    let of = |feature| status.iter().find(|s| s.feature == feature).unwrap();
    // The replay OCR engine has no recordings, so it knows no language.
    assert!(!of(Feature::Ocr).available);
    assert!(of(Feature::Ocr)
        .unavailable_reason
        .as_deref()
        .unwrap()
        .contains("no recognizer"));
    assert!(!of(Feature::ReadAloud).available);
    assert_eq!(
        of(Feature::ReadAloud).unavailable_reason.as_deref(),
        Some("no voice is installed on this computer")
    );
    assert!(of(Feature::Handwriting).available);
    // Reading aloud then fails with a code the interface can explain, not a raw system error.
    let error = engines
        .speech()
        .unwrap()
        .synthesize("Hello.", &Default::default())
        .unwrap_err();
    assert_eq!(error.info().code, "voiceUnavailable");

    // A feature that is off is not asked, and the engine's existence is all that shows.
    let off = mocked(IntelSettings::default()).with_speech_engine(Arc::new(MockSpeech::new().without_voices()));
    let status = off.status();
    let probed = [Feature::Ocr, Feature::Handwriting, Feature::ReadAloud];
    assert!(
        status
            .iter()
            .filter(|s| probed.contains(&s.feature))
            .all(|s| s.available),
        "{status:?}"
    );
}

#[test]
fn the_platform_engines_exist_only_where_the_platform_has_them() {
    let status = Engines::platform(IntelSettings::recommended()).status();
    let of = |feature| status.iter().find(|s| s.feature == feature).unwrap();
    let windows = cfg!(all(windows, feature = "winrt"));
    assert_eq!(of(Feature::Ocr).available, windows);
    assert_eq!(of(Feature::Handwriting).available, windows);
    assert_eq!(of(Feature::ReadAloud).available, windows);
    assert!(of(Feature::Summaries).available, "the summarizer works everywhere");
    if !windows {
        assert!(of(Feature::Ocr)
            .unavailable_reason
            .as_deref()
            .unwrap()
            .contains("not available"));
    }
}

#[test]
fn errors_carry_a_code_and_the_feature_to_offer() {
    let info = IntelError::Disabled(Feature::Ocr).info();
    assert_eq!(info.code, "disabled");
    assert_eq!(info.feature, Some(Feature::Ocr));
    assert!(info.message.contains("text recognition in images is turned off"));
    assert_eq!(IntelError::Canceled.info().code, "canceled");
    assert_eq!(IntelError::Canceled.info().feature, None);
}
