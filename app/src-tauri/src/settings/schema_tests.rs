use serde_json::json;

use super::*;

#[test]
fn defaults_match_schema_version_1() {
    let mut expected = json!({
        "schemaVersion": 1,
        "minWriterSchema": 1,
        "appearance": {
            "theme": "system", "pageColor": "matchTheme", "textSize": 100, "uiScale": 100, "motion": "system",
            "density": "auto"
        },
        "storage": { "notesFolder": null },
        "startup": { "openLastPage": true },
        "shortcuts": {},
        "keymap": { "preset": "default" },
        "updates": { "install": "auto", "channel": "stable", "skippedVersion": null },
        "setup": { "completedSteps": [] },
        "experimental": { "flags": {} }
    });
    expected["editing"] = serde_json::to_value(EditingSettings::default()).expect("serializes");
    expected["ink"] = serde_json::to_value(InkSettings::default()).expect("serializes");
    assert_eq!(serde_json::to_value(Settings::default()).expect("serializes"), expected);
    assert_eq!(
        serde_json::from_value::<Settings>(json!({})).expect("parses"),
        Settings::default()
    );
}

#[test]
fn section_keys_match_their_serialized_names() {
    let defaults = serde_json::to_value(Settings::default()).expect("serializes");
    for section in SettingsSectionKey::ALL {
        assert_eq!(serde_json::to_value(section).expect("serializes"), json!(section.key()));
        assert!(defaults.get(section.key()).is_some(), "{}", section.key());
    }
}

#[test]
fn reads_only_the_offered_text_sizes() {
    for size in TEXT_SIZES {
        let parsed: TextSize = serde_json::from_value(json!(size)).expect("an offered size");
        assert_eq!(parsed.percent(), size);
    }
    assert!(serde_json::from_value::<TextSize>(json!(120)).is_err());
    assert!(serde_json::from_value::<TextSize>(json!("100")).is_err());
    assert_eq!(
        serde_json::to_value(TextSize::default()).expect("serializes"),
        json!(100)
    );
}

fn failed_field(settings: &Settings) -> Option<String> {
    settings.validate().err().and_then(|error| error.field)
}

#[test]
fn accepts_interface_sizes_from_90_to_150_percent() {
    let mut settings = Settings::default();
    for (ui_scale, valid) in [(90, true), (125, true), (150, true), (85, false), (175, false)] {
        settings.appearance.ui_scale = ui_scale;
        assert_eq!(settings.validate().is_ok(), valid, "{ui_scale}");
    }
}

#[test]
fn checks_paths_chords_and_versions() {
    let mut settings = Settings::default();
    settings.storage.notes_folder = Some("notes".into());
    assert_eq!(failed_field(&settings).as_deref(), Some("storage.notesFolder"));
    for network in [r"\\attacker.example\share", r"\\?\C:\Notes", "//attacker.example/share"] {
        settings.storage.notes_folder = Some(network.into());
        assert_eq!(
            failed_field(&settings).as_deref(),
            Some("storage.notesFolder"),
            "{network}"
        );
    }
    settings.storage.notes_folder = Some(if cfg!(windows) { "D:\\Notes" } else { "/notes" }.into());
    assert_eq!(failed_field(&settings), None);
    settings
        .shortcuts
        .insert("theme.toggle".into(), vec!["Ctrl+Alt+K".into()]);
    settings.shortcuts.insert("view.zoomIn".into(), vec![]);
    assert_eq!(failed_field(&settings), None);
    settings.shortcuts.insert("theme.toggle".into(), vec!["K".into()]);
    assert_eq!(failed_field(&settings).as_deref(), Some("shortcuts"));
    settings.shortcuts.clear();
    settings.updates.skipped_version = Some("soon".into());
    assert_eq!(failed_field(&settings).as_deref(), Some("updates.skippedVersion"));
    settings.updates.skipped_version = Some("0.5.0-beta.1".into());
    assert_eq!(failed_field(&settings), None);
}

#[test]
fn names_the_onenote_shortcut_set() {
    let keymap = Keymap {
        preset: KeymapPreset::OneNote,
    };
    assert_eq!(
        serde_json::to_value(keymap).expect("serializes"),
        json!({ "preset": "onenote" })
    );
}
