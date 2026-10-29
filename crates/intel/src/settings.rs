//! Which on-device features the person has turned on. Every one starts off.

use serde::{Deserialize, Serialize};

/// A feature of this crate that the person turns on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Feature {
    /// Reading text in images and PDFs.
    Ocr,
    /// Turning handwriting into text.
    Handwriting,
    /// Reading a page aloud.
    ReadAloud,
    /// Summaries and keywords.
    Summaries,
    /// Turning recordings into text.
    Transcription,
}

impl Feature {
    /// Every feature, in the order the settings screen lists them.
    pub const ALL: [Feature; 5] = [
        Feature::Ocr,
        Feature::Handwriting,
        Feature::ReadAloud,
        Feature::Summaries,
        Feature::Transcription,
    ];

    /// The feature in plain words, for messages: "text recognition in images", and so on.
    pub fn label(self) -> &'static str {
        match self {
            Feature::Ocr => "text recognition in images",
            Feature::Handwriting => "handwriting recognition",
            Feature::ReadAloud => "read aloud",
            Feature::Summaries => "summaries and keywords",
            Feature::Transcription => "transcription",
        }
    }
}

impl std::fmt::Display for Feature {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

/// The person's choices. Nothing here is on until the person says so, in first-run setup or in
/// Settings. Missing fields read as off, so a settings file from an older version stays safe.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IntelSettings {
    /// Text recognition in images.
    pub ocr: bool,
    /// Handwriting recognition.
    pub handwriting: bool,
    /// Read aloud.
    pub read_aloud: bool,
    /// Summaries and keywords.
    pub summaries: bool,
    /// Transcription.
    pub transcription: bool,
}

impl IntelSettings {
    /// Everything on, for the "Recommended" choice in first-run setup.
    pub fn recommended() -> IntelSettings {
        IntelSettings {
            ocr: true,
            handwriting: true,
            read_aloud: true,
            summaries: true,
            transcription: true,
        }
    }

    /// Whether the feature is on.
    pub fn is_on(&self, feature: Feature) -> bool {
        match feature {
            Feature::Ocr => self.ocr,
            Feature::Handwriting => self.handwriting,
            Feature::ReadAloud => self.read_aloud,
            Feature::Summaries => self.summaries,
            Feature::Transcription => self.transcription,
        }
    }

    /// Turns a feature on or off.
    pub fn set(&mut self, feature: Feature, on: bool) {
        match feature {
            Feature::Ocr => self.ocr = on,
            Feature::Handwriting => self.handwriting = on,
            Feature::ReadAloud => self.read_aloud = on,
            Feature::Summaries => self.summaries = on,
            Feature::Transcription => self.transcription = on,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_starts_off() {
        let settings = IntelSettings::default();
        assert!(Feature::ALL.iter().all(|&f| !settings.is_on(f)));
        let from_empty: IntelSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(from_empty, settings, "a settings file with no fields means off");
    }

    #[test]
    fn set_and_is_on_agree_for_every_feature() {
        for feature in Feature::ALL {
            let mut settings = IntelSettings::default();
            settings.set(feature, true);
            let on: Vec<Feature> = Feature::ALL.into_iter().filter(|&f| settings.is_on(f)).collect();
            assert_eq!(on, [feature]);
            settings.set(feature, false);
            assert_eq!(settings, IntelSettings::default());
        }
        let all = IntelSettings::recommended();
        assert!(Feature::ALL.iter().all(|&f| all.is_on(f)));
    }

    #[test]
    fn settings_use_camel_case_names_in_json() {
        let json = serde_json::to_value(IntelSettings::recommended()).unwrap();
        assert_eq!(json["readAloud"], true);
        assert_eq!(serde_json::to_value(Feature::ReadAloud).unwrap(), "readAloud");
    }
}
