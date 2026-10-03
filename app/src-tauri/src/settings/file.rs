//! Files that survive a crash at any moment (ARCHITECTURE.md section 16.5). A write goes to `<name>.tmp` and is
//! flushed to disk with `sync_all`. Then it's renamed over the old file in the same folder (`MoveFileExW` with
//! replace), so a reader always finds either the old file or the new one. Also: copies for `.bak` and backups,
//! keeping the newest few, and the UTC timestamps in their names.

use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::Value;

/// Writes `value` as indented JSON with a final newline, atomically.
pub fn write_json(path: &Path, value: &Value) -> io::Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    bytes.push(b'\n');
    write_atomic(path, &bytes)
}

/// Replaces `path` with `bytes` so that a crash leaves either the old content or the new.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let temporary = with_suffix(path, ".tmp");
    {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    rename_with_retries(&temporary, path)
}

/// Renames the file. It retries briefly when an antivirus scan holds the target open, or a search indexer does.
fn rename_with_retries(from: &Path, to: &Path) -> io::Result<()> {
    let mut attempt = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) if attempt < 5 && error.kind() == io::ErrorKind::PermissionDenied => {
                attempt += 1;
                thread::sleep(Duration::from_millis(20 * attempt));
            }
            Err(error) => return Err(error),
        }
    }
}

/// `path` with `suffix` added to its file name: `settings.json` becomes `settings.json.bak`.
pub fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Copies `path` into `folder` as `<prefix><timestamp>.json`, keeping only the `keep` newest copies with that
/// prefix. Returns the new copy's path.
pub fn backup(path: &Path, folder: &Path, prefix: &str, keep: usize) -> io::Result<PathBuf> {
    fs::create_dir_all(folder)?;
    let mut target = folder.join(format!("{prefix}{}.json", timestamp(SystemTime::now())));
    let mut extra = 1;
    while target.exists() {
        extra += 1;
        target = folder.join(format!("{prefix}{}-{extra}.json", timestamp(SystemTime::now())));
    }
    fs::copy(path, &target)?;
    prune(folder, prefix, keep)?;
    Ok(target)
}

/// Deletes all but the `keep` newest files in `folder` whose names start with `prefix`.
fn prune(folder: &Path, prefix: &str, keep: usize) -> io::Result<()> {
    let mut copies: Vec<(SystemTime, PathBuf)> = fs::read_dir(folder)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(prefix))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    copies.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, stale) in copies.into_iter().skip(keep) {
        fs::remove_file(stale)?;
    }
    Ok(())
}

/// A UTC timestamp for file names, such as `20261001-0905` (to the minute) or `20261001-090512` (seconds).
pub fn timestamp(time: SystemTime) -> String {
    let seconds = time.duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs());
    let (year, month, day) = civil_date(seconds / 86_400);
    let of_day = seconds % 86_400;
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        of_day / 3_600,
        of_day % 3_600 / 60,
        of_day % 60
    )
}

/// The Gregorian date of a day count since 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil_date(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_replace_the_old_file_and_leave_no_temporary() {
        let folder = tempfile::tempdir().expect("a folder");
        let path = folder.path().join("settings.json");
        write_json(&path, &serde_json::json!({ "a": 1 })).expect("writes");
        write_json(&path, &serde_json::json!({ "a": 2 })).expect("writes again");
        assert_eq!(fs::read_to_string(&path).expect("reads"), "{\n  \"a\": 2\n}\n");
        assert!(!with_suffix(&path, ".tmp").exists());
    }

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(timestamp(UNIX_EPOCH), "19700101-000000");
        let october = UNIX_EPOCH + Duration::from_secs(1_790_845_512);
        assert_eq!(timestamp(october), "20261001-090512");
        let leap_day = UNIX_EPOCH + Duration::from_secs(951_782_400);
        assert_eq!(timestamp(leap_day), "20000229-000000");
    }

    #[test]
    fn keeps_the_newest_backups() {
        let folder = tempfile::tempdir().expect("a folder");
        let source = folder.path().join("settings.json");
        fs::write(&source, "{}").expect("writes");
        let backups = folder.path().join("backups");
        for _ in 0..5 {
            backup(&source, &backups, "settings-v1-", 3).expect("backs up");
            thread::sleep(Duration::from_millis(15));
        }
        let names: Vec<_> = fs::read_dir(&backups).expect("lists").filter_map(Result::ok).collect();
        assert_eq!(names.len(), 3);
    }
}
