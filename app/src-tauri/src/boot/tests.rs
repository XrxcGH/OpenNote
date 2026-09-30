use serde_json::json;

use super::*;
use crate::{
    settings::schema::ThemePreference::{Dark, Light, System},
    updater::UpdaterPhase,
};

const SYSTEM_WINDOW: Rgb = Rgb(0, 0, 0);

fn os(dark: bool, contrast: bool) -> OsAppearance {
    OsAppearance {
        dark,
        contrast,
        ..OsAppearance::default()
    }
}

fn sample_payload(settings: &Settings) -> BootData {
    let startup = Startup {
        first_run: false,
        settings_read_only: false,
        notices: Vec::new(),
        webview2_version: "141.0.3537.57".into(),
        process_start_epoch_ms: 1.0,
        updater: UpdaterStatus::new(UpdaterPhase::Idle),
        flag_overrides: flag_overrides("notes.memorySnapshot=1"),
    };
    let install = InstallStatus {
        exe_path: "C:\\OpenNote.exe".into(),
        in_user_programs: false,
        folder_writable: true,
        has_start_menu_shortcut: false,
        is_dev_build: true,
    };
    payload(
        &startup,
        settings,
        &DeviceState::default(),
        &OsAppearance::default(),
        install,
    )
}

#[test]
fn serializes_notices_by_kind() {
    let notice = Notice::SettingsReset {
        saved_as: "settings.corrupt-20261001-0905.json".into(),
    };
    assert_eq!(
        serde_json::to_value(notice).expect("serializes"),
        json!({ "kind": "settingsReset", "savedAs": "settings.corrupt-20261001-0905.json" })
    );
    let notice = Notice::RollbackUnavailable {
        from: "0.5.0".into(),
        previous: None,
    };
    assert_eq!(
        serde_json::to_value(notice).expect("serializes"),
        json!({ "kind": "rollbackUnavailable", "from": "0.5.0", "previous": null })
    );
}

#[test]
fn names_the_architecture_as_the_interface_does() {
    let names = [Architecture::X64, Architecture::X86, Architecture::Arm64].map(|a| serde_json::to_value(a).ok());
    assert_eq!(names, [Some(json!("x64")), Some(json!("x86")), Some(json!("arm64"))]);
    let expected = match std::env::consts::ARCH {
        "x86" => Architecture::X86,
        "aarch64" => Architecture::Arm64,
        _ => Architecture::X64,
    };
    assert_eq!(Architecture::current(), expected);
}

#[test]
fn picks_the_window_color_for_all_twelve_combinations() {
    let (light, dark) = (SURFACE_APP.light, SURFACE_APP.dark);
    for (preference, windows_dark, contrast, expected) in [
        (Light, false, false, light),
        (Light, true, false, light),
        (Dark, false, false, dark),
        (Dark, true, false, dark),
        (System, false, false, light),
        (System, true, false, dark),
        (Light, false, true, SYSTEM_WINDOW),
        (Light, true, true, SYSTEM_WINDOW),
        (Dark, false, true, SYSTEM_WINDOW),
        (Dark, true, true, SYSTEM_WINDOW),
        (System, false, true, SYSTEM_WINDOW),
        (System, true, true, SYSTEM_WINDOW),
    ] {
        assert_eq!(
            window_color(preference, &os(windows_dark, contrast), SYSTEM_WINDOW),
            expected,
            "{preference:?}, Windows dark {windows_dark}, contrast {contrast}"
        );
    }
}

#[test]
fn the_payload_carries_the_resolved_theme_and_the_setting() {
    let mut settings = Settings::default();
    settings.appearance.theme = Dark;
    let data = sample_payload(&settings);
    assert_eq!(data.resolved_theme, ThemeName::Dark);
    assert_eq!(data.boot_version, 1);
    let json = serde_json::to_value(&data).expect("serializes");
    assert_eq!(json["settings"]["appearance"]["theme"], json!("dark"));
    assert_eq!(json["resolvedTheme"], json!("dark"));
    assert_eq!(json["perf"]["processStartEpochMs"], json!(1.0));
}

#[test]
fn the_script_escapes_hostile_strings() {
    let hostile = "C:\\</script><script>alert(1)</script>\u{2028}\u{2029}&";
    let mut settings = Settings::default();
    settings.storage.notes_folder = Some(hostile.into());
    let script = initialization_script(&sample_payload(&settings));
    assert!(script.starts_with("window.__OPENNOTE_BOOT__ = {"));
    assert!(script.ends_with("};"));
    for bad in ["<", ">", "&", "\u{2028}", "\u{2029}"] {
        assert!(!script.contains(bad), "the script still holds {bad:?}");
    }
    let json = script
        .trim_start_matches("window.__OPENNOTE_BOOT__ = ")
        .trim_end_matches(';');
    let parsed: serde_json::Value = serde_json::from_str(json).expect("the script is still JSON");
    assert_eq!(parsed["settings"]["storage"]["notesFolder"], json!(hostile));
}

#[test]
fn flag_overrides_belong_to_development_and_nightly_builds() {
    assert_eq!(channel_for("0.5.0", true), Channel::Dev);
    assert_eq!(channel_for("0.5.0-nightly.3", false), Channel::Nightly);
    assert_eq!(channel_for("0.5.0-beta.1", false), Channel::Beta);
    assert_eq!(channel_for("0.5.0", false), Channel::Stable);
    // The tests run as a debug build, which is a development build.
    let data = sample_payload(&Settings::default());
    assert_eq!(data.flag_overrides.get("notes.memorySnapshot"), Some(&true));
}

#[test]
fn reads_flag_overrides_leniently() {
    let flags = flag_overrides("a.b=1, c=off,broken,=1,d=maybe,e=true");
    assert_eq!(
        flags.into_iter().collect::<Vec<_>>(),
        [("a.b".into(), true), ("c".into(), false), ("e".into(), true)]
    );
}

#[test]
fn a_relaunch_reports_what_it_was_for() {
    let launch = Launch {
        args: Args {
            after_update: Some("0.4.0".into()),
            moved_from: Some("C:\\Downloads\\OpenNote.exe".into()),
            ..Args::default()
        },
        guard: GuardOutcome::RollbackUnavailable {
            from: "0.5.0".into(),
            previous: None,
        },
    };
    let kinds: Vec<_> = launch
        .notices("0.5.0")
        .iter()
        .map(|notice| serde_json::to_value(notice).expect("serializes")["kind"].clone())
        .collect();
    assert_eq!(kinds, [json!("updated"), json!("rollbackUnavailable"), json!("moved")]);
}
