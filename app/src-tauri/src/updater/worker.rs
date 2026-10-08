//! The worker thread (ARCHITECTURE.md sections 18.4 and 18.5). It runs in Windows background mode, checks on the
//! schedule and on request, downloads and verifies updates, and follows the install choice. It wakes at least
//! once a minute, so a check that fell due while the PC slept runs soon after it wakes.

use std::{
    cell::Cell,
    sync::mpsc::{Receiver, RecvTimeoutError},
    time::{Duration, Instant, SystemTime},
};

use opennote_updater::{
    schedule::{random_jitter, Scheduler},
    time, CheckOutcome, FetchError, NetworkCost, Offer, UpdateError,
};
use semver::Version;

use super::{
    service::{Message, Service},
    system, ErrorCode, PreviousInfo, UpdaterPhase,
};
use crate::settings::schema::{InstallPolicy, Settings};

/// How often a download reports its progress to the interface.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// The flag that makes automatic mode wait for an unmetered network (section 18.4).
const METERED_FLAG: &str = "updates.meteredCheck";

/// Who asked for a check. Scheduled checks skip quietly when offline; a person sees why a check failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    Schedule,
    Person,
}

pub fn run(service: &Service, receiver: &Receiver<Message>) {
    system::enter_background_mode();
    restore(service);
    let mut scheduler = Scheduler::new();
    let mut started = false;
    loop {
        let wait = scheduler.sleep_for(SystemTime::now());
        match receiver.recv_timeout(wait) {
            Ok(Message::Start) => {
                started = true;
                plan(service, &mut scheduler);
            }
            Ok(Message::Check) => check(service, &mut scheduler, Trigger::Person),
            Ok(Message::Download) => download_offer(service),
            Ok(Message::SettingsChanged) => settings_changed(service, &mut scheduler, started),
            Err(RecvTimeoutError::Timeout) if scheduler.is_due(SystemTime::now()) => {
                check(service, &mut scheduler, Trigger::Schedule);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn skipped(settings: &Settings) -> Option<Version> {
    settings
        .updates
        .skipped_version
        .as_deref()
        .and_then(|text| Version::parse(text).ok())
}

/// At start: a staged update that still verifies is ready at once, and the previous copy's hash is checked.
fn restore(service: &Service) {
    let Some(updater) = service.updater() else {
        return;
    };
    let previous = updater.previous().map(|previous| PreviousInfo {
        version: previous.version.to_string(),
        available: true,
    });
    let damaged = || {
        updater.previous_version_unchecked().map(|version| PreviousInfo {
            version: version.to_string(),
            available: false,
        })
    };
    service.shared().previous = previous.or_else(damaged);
    if let Some(staged) = updater.staged(skipped(&service.settings()).as_ref()) {
        let ready = UpdaterPhase::Ready {
            version: staged.version.to_string(),
            notes: staged.notes,
            blocked_by: None,
        };
        service.shared().phase = Some(ready);
    }
    service.publish();
}

/// Automatic checks start at the first `app_ready`, unless the person only checks by hand.
fn plan(service: &Service, scheduler: &mut Scheduler) {
    if service.settings().updates.install == InstallPolicy::Manual {
        scheduler.stop();
        return;
    }
    let backoff = service
        .updater()
        .and_then(|updater| updater.state().backoff_until)
        .and_then(|text| time::parse(&text));
    scheduler.start(SystemTime::now(), backoff);
}

fn is_ready(phase: Option<&UpdaterPhase>) -> bool {
    matches!(phase, Some(UpdaterPhase::Ready { .. }))
}

pub fn check(service: &Service, scheduler: &mut Scheduler, trigger: Trigger) {
    let Some(updater) = service.updater() else {
        return;
    };
    let settings = service.settings();
    let before = service.shared().phase.clone();
    if crate::hardening::offline() {
        // Work offline: no request is made. A scheduled check waits quietly; a person is told why nothing happened.
        failed(service, &UpdateError::Fetch(FetchError::Offline), trigger, before, None);
        if trigger == Trigger::Schedule {
            scheduler.failed(SystemTime::now());
        }
        return;
    }
    // A ready update stays ready while a scheduled check runs.
    if trigger == Trigger::Person || !is_ready(before.as_ref()) {
        service.set_phase(Some(UpdaterPhase::Checking));
    }
    let now = SystemTime::now();
    let result = updater.check(skipped(&settings).as_ref());
    let backoff_until = match &result {
        Ok(_) => {
            scheduler.succeeded(now, random_jitter());
            None
        }
        Err(_) => scheduler.failed(now).map(time::format),
    };
    let saved = updater.change_state(|state| state.backoff_until = backoff_until.clone());
    if let Err(error) = saved {
        log::warn!("Couldn't save the update back-off: {error}");
    }
    service.shared().last_check = updater.state().last_check;
    match result {
        Ok(outcome) => offered(service, outcome, &settings, before),
        Err(error) => failed(service, &error, trigger, before, backoff_until),
    }
}

/// Shows why a check failed, except that a scheduled check skips quietly when offline, and a ready update stays
/// ready.
fn failed(
    service: &Service,
    error: &UpdateError,
    trigger: Trigger,
    before: Option<UpdaterPhase>,
    retry: Option<String>,
) {
    log::warn!("The update check failed: {error}");
    let offline = matches!(error, UpdateError::Fetch(FetchError::Offline));
    if trigger == Trigger::Schedule && (offline || is_ready(before.as_ref())) {
        service.set_phase(before);
        return;
    }
    service.set_phase(Some(UpdaterPhase::Error {
        code: ErrorCode::from_code(error.code()),
        retry_at: retry,
    }));
}

fn offered(service: &Service, outcome: CheckOutcome, settings: &Settings, before: Option<UpdaterPhase>) {
    let offer = match outcome {
        CheckOutcome::Available(offer) => offer,
        CheckOutcome::UpToDate | CheckOutcome::NoUpdateForPlatform => {
            let phase = if is_ready(before.as_ref()) {
                before
            } else {
                Some(UpdaterPhase::UpToDate)
            };
            service.set_phase(phase);
            return;
        }
    };
    if super::phase_version(before.as_ref()) == Some(offer.version.to_string()) && is_ready(before.as_ref()) {
        service.set_phase(before);
        return;
    }
    let waiting = settings.updates.install == InstallPolicy::Auto && must_wait_for_unmetered(settings);
    if settings.updates.install == InstallPolicy::Auto && !waiting {
        download(service, offer);
        return;
    }
    service.shared().phase = Some(available(&offer, waiting));
    service.shared().offer = Some(offer);
    service.publish();
}

fn available(offer: &Offer, waiting_for_unmetered: bool) -> UpdaterPhase {
    UpdaterPhase::Available {
        version: offer.version.to_string(),
        notes: offer.notes.clone(),
        size: offer.size,
        waiting_for_unmetered,
    }
}

/// Behind `updates.meteredCheck`, automatic mode waits for a network without a data limit.
fn must_wait_for_unmetered(settings: &Settings) -> bool {
    settings.experimental.flags.get(METERED_FLAG).copied().unwrap_or(false) && system::WindowsNetworkCost.is_metered()
}

/// Downloads the version the last check offered, after the person chose Download.
fn download_offer(service: &Service) {
    if crate::hardening::offline() {
        log::info!("Ignored Download: Work offline is on.");
        return;
    }
    let offer = service.shared().offer.clone();
    match offer {
        Some(offer) => download(service, offer),
        None => log::info!("Ignored Download: no version is on offer."),
    }
}

fn download(service: &Service, offer: Offer) {
    let Some(updater) = service.updater() else {
        return;
    };
    let version = offer.version.to_string();
    service.set_phase(Some(UpdaterPhase::Downloading {
        version: version.clone(),
        received: 0,
        total: offer.size,
    }));
    let last = Cell::new(Instant::now());
    let progress = |received: u64, total: u64| {
        if received == total {
            service.set_phase(Some(UpdaterPhase::Verifying {
                version: version.clone(),
            }));
        } else if last.get().elapsed() >= PROGRESS_EVERY {
            last.set(Instant::now());
            let phase = UpdaterPhase::Downloading {
                version: version.clone(),
                received,
                total,
            };
            service.set_phase(Some(phase));
        }
    };
    match updater.download(&offer, &progress) {
        Ok(staged) => {
            service.shared().offer = None;
            service.set_phase(Some(UpdaterPhase::Ready {
                version,
                notes: staged.notes,
                blocked_by: None,
            }));
        }
        Err(error) => {
            log::warn!("The update download failed: {error}");
            service.shared().offer = Some(offer);
            let code = ErrorCode::from_code(error.code());
            service.set_phase(Some(UpdaterPhase::Error { code, retry_at: None }));
        }
    }
}

/// Follows a change of the install choice or the skipped version.
fn settings_changed(service: &Service, scheduler: &mut Scheduler, started: bool) {
    let settings = service.settings();
    let manual = settings.updates.install == InstallPolicy::Manual;
    if started && manual {
        scheduler.stop();
    } else if started && scheduler.next().is_none() {
        plan(service, scheduler);
    }
    let mut shared = service.shared();
    let skipped = settings.updates.skipped_version.clone();
    if skipped.is_some() && super::phase_version(shared.phase.as_ref()) == skipped {
        shared.phase = Some(UpdaterPhase::UpToDate);
        shared.offer = None;
    }
    let chose_auto = matches!(
        shared.phase,
        Some(UpdaterPhase::Available {
            waiting_for_unmetered: false,
            ..
        })
    ) && settings.updates.install == InstallPolicy::Auto;
    let offer = shared.offer.clone().filter(|_| chose_auto);
    drop(shared);
    match offer {
        Some(offer) => download(service, offer),
        None => service.publish(),
    }
}
