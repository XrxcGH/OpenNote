//! The pen corpus in `tests/fixtures/pen/`: real recordings that the budget page and measurement M2 share
//! (amendment C11). Without any recordings, the generator keeps drawing synthetic handwriting.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use opennote_core::model::Point;
use serde::Deserialize;

use super::Rng;

/// A recording file.
#[derive(Debug, Deserialize)]
struct Recording {
    profile: String,
    #[serde(default)]
    strokes: Vec<Recorded>,
}

#[derive(Debug, Deserialize)]
struct Recorded {
    /// `[x, y, pressure, tiltX, tiltY, ms]` for every report.
    points: Vec<[f64; 6]>,
}

/// The recorded strokes for one pen profile.
#[derive(Clone, Debug, Default)]
pub struct Corpus {
    profile: String,
    strokes: Vec<Vec<[f64; 6]>>,
}

impl Corpus {
    /// Where the corpus lives in the repository.
    pub fn default_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/pen")
    }

    /// Reads every `*.pen.json` file of `dir` that is for `profile`. A missing folder, an unreadable file, and a
    /// file for another profile give no strokes, and strokes with fewer than 2 points are skipped.
    pub fn load(dir: &Path, profile: &str) -> Corpus {
        let mut names: Vec<PathBuf> = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.to_string_lossy().ends_with(".pen.json"))
            .collect();
        names.sort();
        let mut strokes = Vec::new();
        for path in names {
            let Some(recording) = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Recording>(&bytes).ok())
            else {
                continue;
            };
            if recording.profile == profile {
                strokes.extend(recording.strokes.into_iter().map(|s| s.points).filter(|p| p.len() >= 2));
            }
        }
        Corpus {
            profile: profile.to_owned(),
            strokes,
        }
    }

    /// The recordings of the repository for `profile`, read once.
    pub fn recorded(profile: &str) -> Option<&'static Corpus> {
        static ALL: OnceLock<Vec<Corpus>> = OnceLock::new();
        let all = ALL.get_or_init(|| {
            ["surface_pen", "wacom", "fine_tilt"]
                .iter()
                .map(|name| Corpus::load(&Corpus::default_dir(), name))
                .collect()
        });
        all.iter().find(|c| c.profile == profile && !c.strokes.is_empty())
    }

    /// How many strokes the corpus holds.
    pub fn len(&self) -> usize {
        self.strokes.len()
    }

    /// Whether the corpus holds no stroke.
    pub fn is_empty(&self) -> bool {
        self.strokes.is_empty()
    }

    /// A recorded stroke picked by `rng`, moved so that it starts at `(x0, y0)`, in 1/64 page units.
    pub fn stroke(&self, rng: &mut Rng, (x0, y0): (f64, f64)) -> Vec<Point> {
        let Some(recorded) = self.strokes.get(rng.below(self.strokes.len() as u64) as usize) else {
            return Vec::new();
        };
        let [first_x, first_y, ..] = recorded[0];
        let mut last_t = 0u32;
        recorded
            .iter()
            .map(|&[x, y, pressure, tilt_x, tilt_y, ms]| {
                last_t = last_t.max((ms.max(0.0) * 10.0).round() as u32);
                Point {
                    x: ((x0 + x - first_x) * 64.0).round() as i32,
                    y: ((y0 + y - first_y) * 64.0).round() as i32,
                    pressure: (pressure.clamp(0.0, 1.0) * 65_535.0).round() as u16,
                    tilt_x: (tilt_x.clamp(-90.0, 90.0) * 100.0).round() as i16,
                    tilt_y: (tilt_y.clamp(-90.0, 90.0) * 100.0).round() as i16,
                    t: last_t,
                }
            })
            .collect()
    }
}
