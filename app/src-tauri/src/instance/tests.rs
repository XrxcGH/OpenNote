//! The instance lock with real Windows mutexes and windows, keyed by throwaway profile keys so they never meet a
//! running copy of the app.

use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use windows::{
    core::HSTRING,
    Win32::{
        Foundation::CloseHandle,
        System::Threading::{CreateMutexW, ReleaseMutex},
    },
};

use super::*;

fn unique_key(name: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    format!("test-{name}-{}-{nanos}", std::process::id())
}

fn payload(args: &[&str]) -> Forwarded {
    Forwarded {
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        cwd: "C:\\work".into(),
    }
}

/// A launch from another thread, as a second process would be.
fn launch_elsewhere(key: &str, args: &[&str]) -> &'static str {
    let key = key.to_owned();
    let payload = payload(args);
    let launch =
        thread::spawn(
            move || match acquire_with(&key, &payload, Duration::from_secs(2), Duration::from_millis(200)) {
                InstanceOutcome::Owner(_) => "owner",
                InstanceOutcome::Forwarded => "forwarded",
                InstanceOutcome::Unavailable => "unavailable",
            },
        );
    launch.join().expect("the launch finishes")
}

fn own(key: &str) -> InstanceGuard {
    match acquire_with(key, &payload(&[]), Duration::from_secs(2), Duration::from_secs(1)) {
        InstanceOutcome::Owner(guard) => guard,
        _ => panic!("the first launch owns the profile"),
    }
}

#[test]
fn a_second_launch_forwards_its_arguments_to_the_owner() {
    let key = unique_key("forward");
    let owner = own(&key);
    let (received, forwarded) = mpsc::channel();
    owner.on_forwarded(move |args| {
        let _ = received.send(args);
    });
    assert_eq!(launch_elsewhere(&key, &["notes.onepkg"]), "forwarded");
    let args = forwarded
        .recv_timeout(Duration::from_secs(5))
        .expect("the owner gets the arguments");
    assert_eq!(args, payload(&["notes.onepkg"]));
}

#[test]
fn arguments_that_arrive_before_the_handler_wait_for_it() {
    let key = unique_key("queue");
    let owner = own(&key);
    assert_eq!(launch_elsewhere(&key, &["early"]), "forwarded");
    let (received, forwarded) = mpsc::channel();
    owner.on_forwarded(move |args| {
        let _ = received.send(args.args);
    });
    assert_eq!(
        forwarded.recv_timeout(Duration::from_secs(1)).ok(),
        Some(vec!["early".to_owned()])
    );
}

#[test]
fn two_profiles_run_side_by_side() {
    let one = own(&unique_key("one"));
    let two = own(&unique_key("two"));
    drop((one, two));
}

#[test]
fn a_released_profile_can_be_owned_again() {
    let key = unique_key("again");
    drop(own(&key));
    assert_eq!(launch_elsewhere(&key, &[]), "owner");
}

#[test]
fn waits_for_an_owner_that_is_shutting_down() {
    let key = unique_key("closing");
    let (mutex_name, _) = super::win::names_for_tests(&key);
    let (held, release) = mpsc::channel::<()>();
    let (taken, is_taken) = mpsc::channel();
    let closing = thread::spawn(move || {
        // A process that holds the lock but has already closed its window.
        let name = HSTRING::from(mutex_name);
        // SAFETY: a named mutex owned by this thread, released and closed on the same thread.
        let mutex = unsafe { CreateMutexW(None, true, &name) }.expect("the mutex");
        taken.send(()).expect("the test waits");
        let _ = release.recv();
        thread::sleep(Duration::from_millis(300));
        // SAFETY: as above.
        unsafe {
            let _ = ReleaseMutex(mutex);
            let _ = CloseHandle(mutex);
        }
    });
    is_taken.recv().expect("the lock is taken");
    held.send(()).expect("the holder waits");
    let started = Instant::now();
    let outcome = acquire_with(&key, &payload(&[]), Duration::from_millis(300), Duration::from_secs(5));
    assert!(matches!(outcome, InstanceOutcome::Owner(_)));
    assert!(started.elapsed() >= Duration::from_millis(250));
    closing.join().expect("the holder finishes");
}

#[test]
fn gives_up_on_an_owner_that_never_lets_go() {
    let key = unique_key("stuck");
    let (mutex_name, _) = super::win::names_for_tests(&key);
    let (taken, is_taken) = mpsc::channel();
    let (done, finish) = mpsc::channel::<()>();
    let stuck = thread::spawn(move || {
        let name = HSTRING::from(mutex_name);
        // SAFETY: as in the test above.
        let mutex = unsafe { CreateMutexW(None, true, &name) }.expect("the mutex");
        taken.send(()).expect("the test waits");
        let _ = finish.recv();
        // SAFETY: as above.
        unsafe {
            let _ = ReleaseMutex(mutex);
            let _ = CloseHandle(mutex);
        }
    });
    is_taken.recv().expect("the lock is taken");
    let outcome = acquire_with(
        &key,
        &payload(&[]),
        Duration::from_millis(100),
        Duration::from_millis(200),
    );
    assert!(matches!(outcome, InstanceOutcome::Unavailable));
    done.send(()).expect("the holder waits");
    stuck.join().expect("the holder finishes");
}
