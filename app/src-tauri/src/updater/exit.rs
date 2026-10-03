//! The updater's lifecycle hooks (ARCHITECTURE.md sections 18.7, 18.8, and 18.10). On ready, the start counts as
//! healthy after 5 s and automatic checks start. On exit, after the handshake allowed it, a ready update swaps in
//! for "Restart to update", and at close under "Install automatically"; "Go back" swaps the previous copy in.
//! Nothing swaps during Windows shutdown, or while this version's own start isn't healthy yet.

use std::sync::Arc;

use opennote_updater::{Applied, Relaunch as When};
use serde_json::json;
use tauri::AppHandle;

use super::{
    service::{AppUpdater, Service},
    ErrorCode, UpdaterPhase,
};
use crate::{
    lifecycle::{ExitPlan, ExitReason, LifecycleHooks, Relaunch},
    settings::schema::InstallPolicy,
};

/// What an exit does with updates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitAction {
    Nothing,
    /// Swap in the staged update, then restart now or leave the next launch to start it.
    Apply(When),
    GoBack,
}

/// The decision for each reason (section 18.7): never during Windows shutdown or a move.
pub fn exit_action(reason: ExitReason, policy: InstallPolicy) -> ExitAction {
    match reason {
        ExitReason::RestartToUpdate => ExitAction::Apply(When::Now),
        ExitReason::Close if policy == InstallPolicy::Auto => ExitAction::Apply(When::NextLaunch),
        ExitReason::GoBack => ExitAction::GoBack,
        ExitReason::Close | ExitReason::MoveApp | ExitReason::SessionEnd => ExitAction::Nothing,
    }
}

/// The relaunch after a swap: the swapped exe, told which version it came from.
pub fn relaunch_after(applied: &Applied) -> Relaunch {
    Relaunch {
        exe: applied.exe.clone(),
        args: vec!["--after-update".into(), applied.from.to_string()],
    }
}

/// Starts this exe again, for a restart whose swap couldn't happen.
fn restart_unchanged() -> ExitPlan {
    ExitPlan {
        relaunch: std::env::current_exe()
            .ok()
            .map(|exe| Relaunch { exe, args: Vec::new() }),
    }
}

pub struct UpdaterHooks(pub Arc<Service>);

impl LifecycleHooks for UpdaterHooks {
    fn on_ready(&self, app: &AppHandle) {
        self.0.on_ready(app);
    }

    fn on_exit(&self, app: &AppHandle, reason: ExitReason) -> ExitPlan {
        let service = &self.0;
        service.attach(app);
        // A start that reached app_ready and then closed normally is healthy (section 18.8).
        if service.is_ready() {
            service.mark_healthy();
        }
        let Some(updater) = service.updater() else {
            return ExitPlan::default();
        };
        match exit_action(reason, service.settings().updates.install) {
            ExitAction::Nothing => ExitPlan::default(),
            ExitAction::Apply(when) => apply(service, &updater, when),
            ExitAction::GoBack => go_back(service, &updater),
        }
    }
}

/// Swaps the staged update in. Only a healthy start of this version may, so a failing version never becomes the
/// previous copy.
fn apply(service: &Service, updater: &AppUpdater, when: When) -> ExitPlan {
    let state = updater.state();
    let own_start_pending = state
        .pending
        .as_ref()
        .is_some_and(|pending| pending.version == updater.config().current.to_string());
    let Some(staged) = state.staged.filter(|_| service.blocked.is_none() && !own_start_pending) else {
        return if when == When::Now {
            restart_unchanged()
        } else {
            ExitPlan::default()
        };
    };
    service.set_phase(Some(UpdaterPhase::Applying {
        version: staged.version.clone(),
    }));
    match updater.apply(when) {
        Ok(applied) => {
            log::info!("Installed {} over {}.", applied.to, applied.from);
            ExitPlan {
                relaunch: (when == When::Now).then(|| relaunch_after(&applied)),
            }
        }
        Err(error) => {
            log::error!("Couldn't install {}: {error}", staged.version);
            let code = ErrorCode::from_code(error.code());
            service.set_phase(Some(UpdaterPhase::Error { code, retry_at: None }));
            if when == When::Now {
                restart_unchanged()
            } else {
                ExitPlan::default()
            }
        }
    }
}

/// Swaps the previous copy in and skips the version being left, so it isn't offered again.
fn go_back(service: &Service, updater: &AppUpdater) -> ExitPlan {
    match updater.go_back() {
        Ok(applied) => {
            log::info!("Went back from {} to {}.", applied.from, applied.to);
            let skip = json!({ "updates": { "skippedVersion": applied.from.to_string() } });
            if let Err(error) = service.update_settings(skip) {
                log::error!("Couldn't skip {} after going back: {error}", applied.from);
            }
            ExitPlan {
                relaunch: Some(Relaunch {
                    exe: applied.exe,
                    args: Vec::new(),
                }),
            }
        }
        Err(error) => {
            log::error!("Couldn't go back: {error}");
            restart_unchanged()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use semver::Version;

    use super::*;

    #[test]
    fn applies_only_on_restart_close_in_automatic_mode_and_goes_back_on_request() {
        use ExitReason::*;
        let auto = InstallPolicy::Auto;
        assert_eq!(
            exit_action(RestartToUpdate, InstallPolicy::Manual),
            ExitAction::Apply(When::Now)
        );
        assert_eq!(exit_action(Close, auto), ExitAction::Apply(When::NextLaunch));
        assert_eq!(exit_action(Close, InstallPolicy::Ask), ExitAction::Nothing);
        assert_eq!(exit_action(Close, InstallPolicy::Manual), ExitAction::Nothing);
        assert_eq!(exit_action(GoBack, auto), ExitAction::GoBack);
        assert_eq!(
            exit_action(SessionEnd, auto),
            ExitAction::Nothing,
            "never during shutdown"
        );
        assert_eq!(exit_action(MoveApp, auto), ExitAction::Nothing);
    }

    #[test]
    fn relaunches_the_new_version_with_the_old_one_named() {
        let applied = Applied {
            from: Version::new(0, 4, 0),
            to: Version::new(0, 5, 0),
            exe: PathBuf::from("C:\\OpenNote\\OpenNote.exe"),
            relaunch: When::Now,
        };
        assert_eq!(
            relaunch_after(&applied),
            Relaunch {
                exe: applied.exe.clone(),
                args: vec!["--after-update".into(), "0.4.0".into()],
            }
        );
    }
}
