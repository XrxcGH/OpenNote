//! The speech hub behind the read-aloud commands: the interface pulls one chunk at a time, the engine stays
//! a few chunks ahead at most, and no sound outlives its session. Runs on every platform.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use opennote_intel::mock::{MockSpeech, ReplayInk, ReplayOcr};
use opennote_intel::speech::{SpeakOptions, SpeechAudio, SpeechSynthesizer, Voice, MAX_READ_ALOUD_CHARS};
use opennote_intel::wire::{ReadAloudNotice, ReadAloudRequest, SpeechHub, SynthesizeRequest, MAX_CLIPS, MAX_SESSIONS};
use opennote_intel::{Engines, Feature, IntelError, IntelSettings};

/// Counts how many chunks the engine has been asked to make.
struct Counting(MockSpeech, Arc<AtomicUsize>);

impl SpeechSynthesizer for Counting {
    fn voices(&self) -> Result<Vec<Voice>, IntelError> {
        self.0.voices()
    }

    fn synthesize(&self, text: &str, options: &SpeakOptions) -> Result<SpeechAudio, IntelError> {
        self.1.fetch_add(1, Ordering::SeqCst);
        self.0.synthesize(text, options)
    }
}

fn engines() -> (Engines, Arc<AtomicUsize>) {
    let made = Arc::new(AtomicUsize::new(0));
    let engines = Engines::mock(IntelSettings::recommended(), ReplayInk::default(), ReplayOcr::default())
        .with_speech_engine(Arc::new(Counting(MockSpeech::new(), Arc::clone(&made))));
    (engines, made)
}

fn page(text: &str) -> ReadAloudRequest {
    ReadAloudRequest {
        text: text.to_owned(),
        speak: SpeakOptions::default(),
        max_chunk_chars: Some(60),
    }
}

fn long_page() -> ReadAloudRequest {
    page(&"A short sentence of words. ".repeat(200))
}

fn clip_of(notice: &ReadAloudNotice) -> &str {
    match notice {
        ReadAloudNotice::Chunk { clip_id, .. } => clip_id,
        other => panic!("expected a chunk, got {other:?}"),
    }
}

#[test]
fn the_engine_stays_a_few_chunks_ahead_of_the_pulls() {
    let (engines, made) = engines();
    let hub = SpeechHub::new();
    let started = hub.start(&engines, long_page()).unwrap();
    assert!(started.total_chunks > 50);
    let first = hub.next(&started.session_id).unwrap();
    assert_eq!(hub.clip_audio(clip_of(&first)).unwrap()[..4], *b"RIFF");
    std::thread::sleep(Duration::from_millis(300));
    let ahead = made.load(Ordering::SeqCst);
    assert!(ahead <= 4, "{ahead} chunks were made for one pulled");
    assert_eq!(hub.held(), (1, 0), "the fetched clip is gone");
    hub.cancel(&started.session_id);
    let at_cancel = made.load(Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(
        made.load(Ordering::SeqCst),
        at_cancel,
        "no work continues after the cancel"
    );
}

#[test]
fn a_session_keeps_two_unfetched_clips_and_drops_them_when_it_ends() {
    let (engines, _) = engines();
    let hub = SpeechHub::new();
    let id = hub.start(&engines, long_page()).unwrap().session_id;
    let skipped: Vec<String> = (0..5).map(|_| clip_of(&hub.next(&id).unwrap()).to_owned()).collect();
    assert_eq!(hub.held(), (1, 2), "only the newest two clips of the session are kept");
    assert!(
        hub.clip_audio(&skipped[0]).is_err(),
        "a skipped chunk's sound was dropped"
    );
    assert!(hub.clip_audio(&skipped[4]).is_ok());
    hub.cancel(&id);
    assert_eq!(hub.held(), (0, 0));
    assert!(hub.clip_audio(&skipped[3]).is_err(), "the cancel dropped the rest");
    assert_eq!(hub.next(&id), Err(IntelError::Canceled));
    hub.cancel(&id);
}

#[test]
fn finishing_releases_the_session_and_its_sound() {
    let (engines, _) = engines();
    let hub = SpeechHub::new();
    let started = hub
        .start(&engines, page("One sentence here. Another one follows it."))
        .unwrap();
    let mut chunks = 0;
    loop {
        match hub.next(&started.session_id).unwrap() {
            ReadAloudNotice::Chunk { .. } => chunks += 1,
            ReadAloudNotice::Finished => break,
            failed => panic!("{failed:?}"),
        }
    }
    assert_eq!(chunks, started.total_chunks);
    assert_eq!(hub.held(), (0, 0), "nothing outlives the finished session");
    assert_eq!(hub.next(&started.session_id), Err(IntelError::Canceled));
}

#[test]
fn sessions_and_clips_are_capped() {
    let (engines, _) = engines();
    let hub = SpeechHub::new();
    let ids: Vec<String> = (0..=MAX_SESSIONS)
        .map(|_| hub.start(&engines, long_page()).unwrap().session_id)
        .collect();
    assert_eq!(hub.held().0, MAX_SESSIONS);
    assert_eq!(
        hub.next(&ids[0]),
        Err(IntelError::Canceled),
        "the oldest session was ended"
    );
    let phrase = SynthesizeRequest {
        text: "Hello there.".to_owned(),
        speak: SpeakOptions::default(),
    };
    let first = hub.synthesize(&engines, phrase.clone()).unwrap();
    for _ in 0..MAX_CLIPS {
        hub.synthesize(&engines, phrase.clone()).unwrap();
    }
    assert_eq!(hub.held().1, MAX_CLIPS);
    assert!(
        hub.clip_audio(&first.clip_id).is_err(),
        "the oldest unfetched clip was dropped"
    );
}

#[test]
fn a_page_over_the_limit_is_refused_at_once() {
    let (engines, made) = engines();
    let book = page(&"Word. ".repeat(MAX_READ_ALOUD_CHARS / 6 + 1));
    assert!(matches!(
        SpeechHub::new().start(&engines, book),
        Err(IntelError::InvalidInput(_))
    ));
    assert_eq!(made.load(Ordering::SeqCst), 0);
}

#[test]
fn turning_read_aloud_off_ends_the_session_with_its_code() {
    let (mut engines, _) = engines();
    let hub = SpeechHub::new();
    let id = hub.start(&engines, long_page()).unwrap().session_id;
    hub.next(&id).unwrap();
    let mut settings = engines.settings();
    settings.set(Feature::ReadAloud, false);
    engines.set_settings(settings);
    let last = loop {
        match hub.next(&id).unwrap() {
            ReadAloudNotice::Chunk { .. } => {}
            other => break other,
        }
    };
    assert!(
        matches!(&last, ReadAloudNotice::Failed { error } if error.code == "disabled"),
        "{last:?}"
    );
    assert_eq!(hub.held(), (0, 0));
}
