//! The flags the shell itself reads, for the install, updater, local API, share target, and phone scan features.
//! Each one has the channel default the interface's `FLAGS` registry gives it (`app/src/app/flags.ts` and
//! `features/integrations/flags.ts`), and development and nightly builds take overrides in the same order as the
//! interface's `initFlags`: the `OPENNOTE_FLAGS` variable, then `settings.experimental.flags`. A test reads the
//! two TypeScript files, so the defaults here can't drift from the interface's.

use std::collections::BTreeMap;

use crate::boot::{self, Channel};

/// A per-user entry in Installed apps, with `OpenNote.exe --uninstall`.
pub const UNINSTALL_ENTRY: &str = "install.uninstallEntry";
/// Resume a download that stopped partway.
pub const UPDATES_RESUME: &str = "updates.resume";
/// Wait for an unmetered network before an automatic download.
pub const UPDATES_METERED: &str = "updates.meteredCheck";
/// The local API, its app permissions, the `opennote` tool, and the MCP server. Off means no listener.
pub const API_LOCAL: &str = "api.local";
/// "Share to OpenNote" from other apps.
pub const SHARE_TARGET: &str = "integrations.shareTarget";
/// Insert > From phone.
pub const PHONE_SCAN: &str = "integrations.phoneScan";

/// Every flag above. Each is on in development, nightly, and beta builds, and off in Stable.
pub const BETA_BUILD_FLAGS: [&str; 6] = [
    UNINSTALL_ENTRY,
    UPDATES_RESUME,
    UPDATES_METERED,
    API_LOCAL,
    SHARE_TARGET,
    PHONE_SCAN,
];

/// The channel of this exe, as the boot payload reports it.
pub fn channel() -> Channel {
    boot::channel_for(
        env!("CARGO_PKG_VERSION"),
        cfg!(debug_assertions) || cfg!(feature = "test-endpoints"),
    )
}

/// Whether `id` is on in `channel`, with `overrides` applied in order, the last one that names the flag winning.
/// Overrides apply only to development and nightly builds. A flag this module doesn't know is off.
pub fn is_on(channel: Channel, id: &str, overrides: &[&BTreeMap<String, bool>]) -> bool {
    let default = BETA_BUILD_FLAGS.contains(&id) && !matches!(channel, Channel::Stable);
    if !matches!(channel, Channel::Dev | Channel::Nightly) {
        return default;
    }
    overrides
        .iter()
        .rev()
        .find_map(|overrides| overrides.get(id).copied())
        .unwrap_or(default)
}

/// Whether `id` is on for this exe, with the `OPENNOTE_FLAGS` variable and the settings' experimental flags.
pub fn is_on_now(id: &str, settings_flags: &BTreeMap<String, bool>) -> bool {
    let env = boot::flag_overrides(&std::env::var("OPENNOTE_FLAGS").unwrap_or_default());
    is_on(channel(), id, &[&env, settings_flags])
}

/// Whether `id` is on for the running app, reading its settings.
pub fn is_on_for(app: &tauri::AppHandle, id: &str) -> bool {
    use tauri::Manager;
    let flags = app
        .try_state::<crate::settings::SettingsStore>()
        .map(|store| store.get().experimental.flags)
        .unwrap_or_default();
    is_on_now(id, &flags)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overrides(id: &str, on: bool) -> BTreeMap<String, bool> {
        BTreeMap::from([(id.to_owned(), on)])
    }

    #[test]
    fn every_flag_is_on_in_beta_and_off_in_stable() {
        for id in BETA_BUILD_FLAGS {
            assert!(is_on(Channel::Beta, id, &[]), "{id}");
            assert!(is_on(Channel::Nightly, id, &[]), "{id}");
            assert!(is_on(Channel::Dev, id, &[]), "{id}");
            assert!(!is_on(Channel::Stable, id, &[]), "{id}");
        }
        assert!(!is_on(Channel::Dev, "something.else", &[]));
    }

    #[test]
    fn overrides_count_only_in_development_and_nightly_builds() {
        let off = overrides(API_LOCAL, false);
        let on = overrides(API_LOCAL, true);
        assert!(!is_on(Channel::Dev, API_LOCAL, &[&off]));
        assert!(is_on(Channel::Nightly, API_LOCAL, &[&off, &on]));
        assert!(is_on(Channel::Beta, API_LOCAL, &[&off]));
        assert!(!is_on(Channel::Stable, API_LOCAL, &[&on]));
    }

    /// The interface's registry gives each of these flags the same default, `betaBuilds`.
    #[test]
    fn the_defaults_match_the_interfaces_registry() {
        let registry = [
            include_str!("../../src/app/flags.ts"),
            include_str!("../../src/features/integrations/flags.ts"),
        ]
        .concat();
        for id in BETA_BUILD_FLAGS {
            let line = registry
                .lines()
                .skip_while(|line| !line.contains(&format!("flag('{id}'")) && !line.contains(&format!("'{id}',")))
                .take(4)
                .collect::<Vec<_>>()
                .join(" ");
            assert!(
                line.contains("betaBuilds"),
                "{id} isn't betaBuilds in the interface: {line}"
            );
        }
    }
}
