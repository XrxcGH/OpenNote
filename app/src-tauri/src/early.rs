//! Everything the exe does before Tauri starts (ARCHITECTURE.md section 8.2). First it parses the arguments and
//! waits for any process being replaced. Then it finds the folders and takes the instance lock. When another
//! process holds the lock, it forwards the arguments there and exits. Last, it runs the update start guard and
//! checks the WebView2 Runtime. `main.rs` calls [`run`], then starts the app.
//!
//! The order is the point: a second launch forwards its arguments before the guard runs, so it never counts as
//! a start of a pending update. The steps go through [`Steps`], so tests can check the order without side effects.

use crate::{
    args::{self, Args},
    boot,
    instance::{self, InstanceGuard, InstanceOutcome},
    paths::{self, Paths, PROFILE_DIR_VAR},
    perf,
    updater::{self, GuardOutcome},
    window::webview::{self, RuntimeCheck},
};

/// The exit code when start-up can't continue.
pub const EXIT_FAILURE: i32 = 1;

// Built once per start and moved straight into the app, so the size difference between variants costs nothing.
#[allow(clippy::large_enum_variant)]
pub enum EarlyOutcome {
    /// Start the app with this context.
    Continue(EarlyContext),
    /// Exit now with this code: the arguments went to another process, the guard relaunched, or a check failed.
    Exit(i32),
}

/// What the app needs from the early steps. The instance guard must live until the process exits.
pub struct EarlyContext {
    pub args: Args,
    pub paths: Paths,
    pub instance: InstanceGuard,
    pub guard: GuardOutcome,
    /// The installed WebView2 Runtime's version, for the boot payload.
    pub webview2_version: String,
}

/// The early steps, one method each.
pub trait Steps {
    fn parse_args(&self) -> Args;
    fn wait_for_exit(&self, pid: u32);
    fn resolve_paths(&self) -> std::io::Result<Paths>;
    fn acquire_instance(&self, paths: &Paths, args: &Args) -> InstanceOutcome;
    fn guard(&self, paths: &Paths) -> GuardOutcome;
    fn check_webview(&self) -> RuntimeCheck;
}

/// The real steps.
struct System;

impl Steps for System {
    fn parse_args(&self) -> Args {
        args::parse()
    }

    fn wait_for_exit(&self, pid: u32) {
        let _ = args::wait_for_exit(pid, args::WAIT_PID_TIMEOUT);
    }

    fn resolve_paths(&self) -> std::io::Result<Paths> {
        let program_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf));
        let paths = Paths::resolve(paths::profile_override(
            std::env::var_os(PROFILE_DIR_VAR).map(Into::into),
            program_dir.as_deref(),
        ))?;
        // Logging starts as soon as it has a folder, so the steps after this one are on record.
        let profile = std::env::var_os("USERPROFILE")
            .map(std::path::PathBuf::from)
            .unwrap_or_default();
        crate::log::init(&paths.logs, &profile);
        Ok(paths)
    }

    fn acquire_instance(&self, paths: &Paths, args: &Args) -> InstanceOutcome {
        instance::acquire(paths, args)
    }

    fn guard(&self, paths: &Paths) -> GuardOutcome {
        updater::guard_on_start(paths)
    }

    fn check_webview(&self) -> RuntimeCheck {
        let check = webview::check_runtime();
        webview::show_runtime_message(&check);
        check
    }
}

/// Runs the early steps for this process.
pub fn run() -> EarlyOutcome {
    perf::init();
    perf::mark_at("processCreated", boot::process_start_epoch_ms(), None);
    perf::mark("mainEntered", None);
    // Logging the marker also keeps it in test-endpoints exes, where the release build job looks for it.
    if let Some(marker) = updater::TEST_ENDPOINTS_MARKER {
        log::warn!("{marker}: this build accepts test update endpoints and a test key.");
    }
    // `--uninstall` from Installed apps, and the copy that finishes it, never start the app.
    if let Some(code) = crate::install::uninstall::run_from_args() {
        return EarlyOutcome::Exit(code);
    }
    run_with(&System)
}

/// Runs the early steps in order, stopping at the first one that ends the start.
pub fn run_with(steps: &impl Steps) -> EarlyOutcome {
    let args = steps.parse_args();
    if let Some(pid) = args.wait_pid {
        steps.wait_for_exit(pid);
    }
    let paths = match steps.resolve_paths() {
        Ok(paths) => paths,
        Err(error) => {
            log::error!("Couldn't find the app's folders: {error}");
            return EarlyOutcome::Exit(EXIT_FAILURE);
        }
    };
    // A "Share to OpenNote" launch saves what was shared first, because a second launch exits at the lock below.
    // Any other launch returns at once.
    crate::share::receive_launch(&paths);
    let instance = match steps.acquire_instance(&paths, &args) {
        InstanceOutcome::Owner(guard) => guard,
        InstanceOutcome::Forwarded => return EarlyOutcome::Exit(0),
        InstanceOutcome::Unavailable => return EarlyOutcome::Exit(EXIT_FAILURE),
    };
    let guard = steps.guard(&paths);
    if guard == GuardOutcome::Relaunched {
        return EarlyOutcome::Exit(0);
    }
    let RuntimeCheck::Supported { version } = steps.check_webview() else {
        return EarlyOutcome::Exit(EXIT_FAILURE);
    };
    EarlyOutcome::Continue(EarlyContext {
        args,
        paths,
        instance,
        guard,
        webview2_version: version,
    })
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, io, path::Path};

    use super::*;

    /// Records each step it runs, and answers with the outcomes a test chooses.
    struct Fake {
        calls: RefCell<Vec<&'static str>>,
        args: Args,
        paths_fail: bool,
        forwarded: bool,
        guard: GuardOutcome,
        webview: RuntimeCheck,
    }

    impl Default for Fake {
        fn default() -> Self {
            Self {
                calls: RefCell::default(),
                args: Args::default(),
                paths_fail: false,
                forwarded: false,
                guard: GuardOutcome::Continue { counted_attempt: None },
                webview: RuntimeCheck::Supported {
                    version: "141.0.0.0".into(),
                },
            }
        }
    }

    impl Fake {
        fn called(&self, step: &'static str) {
            self.calls.borrow_mut().push(step);
        }

        fn run(&self) -> (EarlyOutcome, Vec<&'static str>) {
            let outcome = run_with(self);
            (outcome, self.calls.take())
        }
    }

    impl Steps for Fake {
        fn parse_args(&self) -> Args {
            self.called("args");
            self.args.clone()
        }

        fn wait_for_exit(&self, _pid: u32) {
            self.called("wait");
        }

        fn resolve_paths(&self) -> io::Result<Paths> {
            self.called("paths");
            if self.paths_fail {
                Err(io::Error::other("no profile"))
            } else {
                Ok(Paths::under_profile(Path::new("C:\\profile")))
            }
        }

        fn acquire_instance(&self, _paths: &Paths, _args: &Args) -> InstanceOutcome {
            self.called("instance");
            if self.forwarded {
                InstanceOutcome::Forwarded
            } else {
                InstanceOutcome::Owner(InstanceGuard::for_tests())
            }
        }

        fn guard(&self, _paths: &Paths) -> GuardOutcome {
            self.called("guard");
            self.guard.clone()
        }

        fn check_webview(&self) -> RuntimeCheck {
            self.called("webview");
            self.webview.clone()
        }
    }

    fn exit_code(outcome: &EarlyOutcome) -> Option<i32> {
        match outcome {
            EarlyOutcome::Exit(code) => Some(*code),
            EarlyOutcome::Continue(_) => None,
        }
    }

    #[test]
    fn runs_every_step_in_order() {
        let (outcome, calls) = Fake::default().run();
        assert_eq!(exit_code(&outcome), None);
        assert_eq!(calls, ["args", "paths", "instance", "guard", "webview"]);
    }

    #[test]
    fn waits_for_the_replaced_process_first() {
        let args = Args {
            wait_pid: Some(42),
            ..Args::default()
        };
        let (_, calls) = Fake {
            args,
            ..Fake::default()
        }
        .run();
        assert_eq!(calls[..3], ["args", "wait", "paths"]);
    }

    #[test]
    fn a_forwarded_launch_never_runs_the_guard() {
        let (outcome, calls) = Fake {
            forwarded: true,
            ..Fake::default()
        }
        .run();
        assert_eq!(exit_code(&outcome), Some(0));
        assert_eq!(calls, ["args", "paths", "instance"]);
    }

    #[test]
    fn stops_when_a_step_ends_the_start() {
        let (outcome, calls) = Fake {
            paths_fail: true,
            ..Fake::default()
        }
        .run();
        assert_eq!(
            (exit_code(&outcome), calls),
            (Some(EXIT_FAILURE), vec!["args", "paths"])
        );

        let (outcome, calls) = Fake {
            guard: GuardOutcome::Relaunched,
            ..Fake::default()
        }
        .run();
        assert_eq!((exit_code(&outcome), calls.last().copied()), (Some(0), Some("guard")));

        let (outcome, _) = Fake {
            webview: RuntimeCheck::Missing,
            ..Fake::default()
        }
        .run();
        assert_eq!(exit_code(&outcome), Some(EXIT_FAILURE));
    }
}
