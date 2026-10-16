//! A track's files: the Ogg audio file and a small timeline file beside it.
//!
//! The timeline file grows as the recording does, so a crash loses no more of it than of the audio. It
//! holds a 24-byte header: `ONTIMEL2`, then the recording's [`ClockAnchor`] as a little-endian `i64`
//! Unix time in milliseconds and a little-endian `u64` capture time in nanoseconds. One 16-byte record
//! follows for each anchor of the timeline: a frame count and a capture time, both little-endian `u64`
//! values. A record cut short by a crash is ignored.
//!
//! In a notebook the audio file is an asset, and its name starts with the asset's ID (spec 10.1). The
//! timeline file starts with the same ID, so garbage collection keeps and removes them together.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::clock::ClockAnchor;
use super::timeline::Anchor;
use super::{AudioError, Result};

const MAGIC: &[u8; 8] = b"ONTIMEL2";
const HEADER_LEN: usize = 24;
const RECORD_LEN: usize = 16;

/// What a track records.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
    /// The default microphone.
    Microphone,
    /// What the default speakers play, through WASAPI loopback.
    SystemAudio,
}

impl TrackKind {
    /// The part of a file name that says which track it is.
    pub fn stem(self) -> &'static str {
        match self {
            TrackKind::Microphone => "mic",
            TrackKind::SystemAudio => "system",
        }
    }
}

/// A track of a recording: its kind, and the ID of the asset that holds its audio.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TrackRef {
    pub kind: TrackKind,
    pub asset: String,
}

/// The two files of one track.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackFiles {
    pub audio: PathBuf,
    pub timeline: PathBuf,
}

impl TrackFiles {
    /// The files for a track in `dir`, named `<asset>-mic.ogg` and so on, which fits the asset names in
    /// the file format. The asset may hold only letters, digits, `-`, and `_`.
    pub fn new(dir: &Path, asset: &str, kind: TrackKind) -> Result<Self> {
        let valid = !asset.is_empty() && asset.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !valid {
            return Err(AudioError::Format(format!("\"{asset}\" is not a usable asset ID.")));
        }
        Ok(Self::from_audio(dir.join(format!("{asset}-{}.ogg", kind.stem()))))
    }

    /// The files that go with an audio file.
    pub fn from_audio(audio: PathBuf) -> Self {
        let timeline = audio.with_extension("timeline");
        TrackFiles { audio, timeline }
    }
}

/// What a timeline file holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimelineFile {
    pub clock: ClockAnchor,
    pub anchors: Vec<Anchor>,
}

/// Creates the timeline file with its header. It fails if the file already exists, so a recording
/// never overwrites an earlier one.
pub fn create_timeline_file(path: &Path, clock: ClockAnchor) -> Result<File> {
    let mut file = create_track_file(path)?;
    file.write_all(&header_bytes(clock))?;
    Ok(file)
}

/// Creates a new file of a track for the recorder to write. It fails if the file exists. On Windows
/// other programs may read the file while it is open but not write to it, so recovery can't cut off
/// a file that is still being written.
pub fn create_track_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ);
    }
    Ok(options.open(path)?)
}

fn header_bytes(clock: ClockAnchor) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_LEN);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&clock.unix_ms.to_le_bytes());
    bytes.extend_from_slice(&clock.capture_ns.to_le_bytes());
    bytes
}

/// Appends one anchor.
pub fn append_anchor(file: &mut File, anchor: Anchor) -> Result<()> {
    let mut record = [0u8; RECORD_LEN];
    record[..8].copy_from_slice(&anchor.frame.to_le_bytes());
    record[8..].copy_from_slice(&anchor.time_ns.to_le_bytes());
    file.write_all(&record)?;
    Ok(())
}

/// Reads a timeline file. A missing file, or one cut off inside its header, gives `None`. A record cut
/// short by a crash is left out.
pub fn read_timeline_file(path: &Path) -> Result<Option<TimelineFile>> {
    let mut bytes = Vec::new();
    match File::open(path) {
        Ok(mut file) => file.read_to_end(&mut bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if bytes.len() < HEADER_LEN {
        return Ok(None);
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(AudioError::Corrupt(format!(
            "{} is not a timeline file.",
            path.display()
        )));
    }
    let clock = ClockAnchor {
        unix_ms: i64::from_le_bytes(bytes[8..16].try_into().expect("eight bytes")),
        capture_ns: u64::from_le_bytes(bytes[16..24].try_into().expect("eight bytes")),
    };
    let anchors = bytes[HEADER_LEN..]
        .as_chunks::<RECORD_LEN>()
        .0
        .iter()
        .map(|record| Anchor {
            frame: u64::from_le_bytes(record[..8].try_into().expect("eight bytes")),
            time_ns: u64::from_le_bytes(record[8..].try_into().expect("eight bytes")),
        })
        .collect();
    Ok(Some(TimelineFile { clock, anchors }))
}

/// Replaces a timeline file with exactly these anchors.
pub fn rewrite_timeline_file(path: &Path, clock: ClockAnchor, anchors: &[Anchor]) -> Result<()> {
    let mut bytes = header_bytes(clock);
    for anchor in anchors {
        bytes.extend_from_slice(&anchor.frame.to_le_bytes());
        bytes.extend_from_slice(&anchor.time_ns.to_le_bytes());
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLOCK: ClockAnchor = ClockAnchor {
        unix_ms: 1_700_000_000_123,
        capture_ns: 42,
    };

    #[test]
    fn file_names_follow_the_asset_pattern() {
        let files = TrackFiles::new(Path::new("assets"), "01abc-XYZ_9", TrackKind::SystemAudio).unwrap();
        assert!(files.audio.ends_with("01abc-XYZ_9-system.ogg"));
        assert!(files.timeline.ends_with("01abc-XYZ_9-system.timeline"));
        assert!(TrackFiles::new(Path::new("."), "../escape", TrackKind::Microphone).is_err());
        assert!(TrackFiles::new(Path::new("."), "", TrackKind::Microphone).is_err());
    }

    #[test]
    fn anchors_round_trip_and_a_torn_record_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.timeline");
        let mut file = create_timeline_file(&path, CLOCK).unwrap();
        let first = Anchor { frame: 0, time_ns: 123 };
        let second = Anchor {
            frame: 960,
            time_ns: u64::MAX,
        };
        append_anchor(&mut file, first).unwrap();
        append_anchor(&mut file, second).unwrap();
        file.write_all(&[1, 2, 3]).unwrap();
        let read = read_timeline_file(&path).unwrap().unwrap();
        assert_eq!(read.clock, CLOCK);
        assert_eq!(read.anchors, vec![first, second]);
        assert!(create_timeline_file(&path, CLOCK).is_err());
        assert!(read_timeline_file(&dir.path().join("missing")).unwrap().is_none());
    }

    #[test]
    fn a_file_cut_inside_its_header_has_no_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.timeline");
        std::fs::write(&path, &header_bytes(CLOCK)[..20]).unwrap();
        assert!(read_timeline_file(&path).unwrap().is_none());
    }

    #[test]
    fn a_rewritten_file_reads_back_the_same() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("d.timeline");
        let anchors = [Anchor { frame: 0, time_ns: 7 }, Anchor { frame: 48, time_ns: 9 }];
        rewrite_timeline_file(&path, CLOCK, &anchors).unwrap();
        let read = read_timeline_file(&path).unwrap().unwrap();
        assert_eq!((read.clock, read.anchors), (CLOCK, anchors.to_vec()));
    }

    #[test]
    fn a_file_that_is_not_a_timeline_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.timeline");
        std::fs::write(&path, b"not a timeline at all, not even close").unwrap();
        assert!(matches!(read_timeline_file(&path), Err(AudioError::Corrupt(_))));
    }
}
