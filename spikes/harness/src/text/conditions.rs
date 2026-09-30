//! The typing conditions: zoom, ink, the number of editors, the note typed into, and a few changes that test
//! why typing in the 20-page note is slower.

use serde_json::{json, Value};

/// One typing condition. `editors` counts the editors on the page, always including the one typed into.
pub struct Condition {
    pub name: &'static str,
    pub zoom: f64,
    /// "svg" draws the ink as SVG paths in the zoomed world, "canvas" on a window-sized canvas, and "tiles" as
    /// tiles drawn by a worker. "off" hides it.
    pub ink: &'static str,
    pub editors: usize,
    /// "short" types at the end of a short note; "long" types mid-paragraph halfway through the 20-page note.
    pub target: &'static str,
    pub tweak: Tweak,
}

/// A change to the page that may explain or fix slow typing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tweak {
    None,
    /// Turns off the browser's spell check in every editor.
    NoSpellcheck,
    /// Gives each top-level block of the notes `content-visibility: auto`, so blocks off screen skip rendering.
    ContentVisibility,
    /// Gives each top-level block `contain: paint`, which splits a note's painted content into one piece per
    /// block, without skipping any rendering.
    ContainPaint,
    /// Turns on the renderer's accessibility tree, as a screen reader would, through CDP.
    Accessibility,
}

impl Tweak {
    pub fn name(self) -> &'static str {
        match self {
            Tweak::None => "none",
            Tweak::NoSpellcheck => "no-spellcheck",
            Tweak::ContentVisibility => "content-visibility",
            Tweak::ContainPaint => "contain-paint",
            Tweak::Accessibility => "accessibility",
        }
    }

    /// The CSS the page applies to each top-level block of the notes.
    fn blocks(self) -> &'static str {
        match self {
            Tweak::ContentVisibility | Tweak::ContainPaint => self.name(),
            _ => "normal",
        }
    }
}

const fn condition(
    name: &'static str,
    zoom: f64,
    ink: &'static str,
    editors: usize,
    target: &'static str,
) -> Condition {
    Condition {
        name,
        zoom,
        ink,
        editors,
        target,
        tweak: Tweak::None,
    }
}

impl Condition {
    const fn with(self, tweak: Tweak) -> Condition {
        Condition { tweak, ..self }
    }

    /// The arguments for the page's `setup` function.
    pub fn setup_args(&self) -> Value {
        json!({
            "zoom": self.zoom,
            "ink": self.ink,
            "editors": self.editors,
            "target": self.target,
            "spellcheck": self.tweak != Tweak::NoSpellcheck,
            "blocks": self.tweak.blocks(),
        })
    }
}

/// The baseline, then one change at a time, then the 20-page note with the changes that might speed it up, and
/// then with the ink as tiles too. Each condition starts from a freshly loaded page. The last condition repeats
/// the plain 20-page note as a control.
pub const CONDITIONS: &[Condition] = &[
    condition("baseline", 1.0, "svg", 8, "short"),
    condition("zoom-50", 0.5, "svg", 8, "short"),
    condition("zoom-200", 2.0, "svg", 8, "short"),
    condition("no-ink", 1.0, "off", 8, "short"),
    condition("canvas-ink", 1.0, "canvas", 8, "short"),
    condition("tiles-ink", 1.0, "tiles", 8, "short"),
    condition("one-editor", 1.0, "svg", 1, "short"),
    condition("long", 1.0, "svg", 8, "long"),
    condition("long-zoom-50", 0.5, "svg", 8, "long"),
    condition("long-alone", 1.0, "svg", 1, "long"),
    condition("long-no-spellcheck", 1.0, "svg", 8, "long").with(Tweak::NoSpellcheck),
    condition("long-content-visibility", 1.0, "svg", 8, "long").with(Tweak::ContentVisibility),
    condition("long-contain-paint", 1.0, "svg", 8, "long").with(Tweak::ContainPaint),
    condition("long-tiles-contain-paint", 1.0, "tiles", 8, "long").with(Tweak::ContainPaint),
    condition("short-accessibility", 1.0, "svg", 8, "short").with(Tweak::Accessibility),
    condition("long-accessibility", 1.0, "svg", 8, "long").with(Tweak::Accessibility),
    condition("long-control", 1.0, "svg", 8, "long"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conditions_cover_every_factor() {
        let names: Vec<&str> = CONDITIONS.iter().map(|condition| condition.name).collect();
        assert_eq!(names.len(), 17);
        assert!(CONDITIONS.iter().any(|condition| condition.zoom == 0.5));
        assert!(CONDITIONS.iter().any(|condition| condition.zoom == 2.0));
        assert!(CONDITIONS.iter().any(|condition| condition.ink == "off"));
        assert!(CONDITIONS.iter().any(|condition| condition.editors == 1));
        assert!(CONDITIONS.iter().any(|condition| condition.target == "long"));
        let last = CONDITIONS.last().unwrap();
        assert_eq!((last.target, last.tweak), ("long", Tweak::None));
    }

    #[test]
    fn tweaks_reach_the_page() {
        let plain = CONDITIONS[0].setup_args();
        assert_eq!(plain["spellcheck"], true);
        assert_eq!(plain["blocks"], "normal");
        let quiet = condition("x", 1.0, "off", 1, "long")
            .with(Tweak::NoSpellcheck)
            .setup_args();
        assert_eq!(quiet["spellcheck"], false);
        let lazy = condition("x", 1.0, "off", 1, "long")
            .with(Tweak::ContentVisibility)
            .setup_args();
        assert_eq!(lazy["blocks"], "content-visibility");
        let contained = condition("x", 1.0, "off", 1, "long")
            .with(Tweak::ContainPaint)
            .setup_args();
        assert_eq!(contained["blocks"], "contain-paint");
        assert_eq!(Tweak::Accessibility.blocks(), "normal");
    }
}
