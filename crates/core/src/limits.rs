//! Every limit of spec section 16 and every constant of spec Appendix A.
//!
//! [`Limits`] bound what readers accept. [`Timings`] hold the times and sizes that drive saving and the
//! journal. [`Policy`] holds the counts behind writer policy, such as compaction and history.

use std::time::Duration;

const KIB: u64 = 1024;
const MIB: u64 = 1024 * KIB;
const DAY: Duration = Duration::from_secs(86_400);

/// Limits that readers check before they allocate memory (spec 16).
#[derive(Clone, Debug, PartialEq)]
pub struct Limits {
    /// Largest `page.json`, and largest tree, Trash, or history JSON file.
    pub page_json_bytes: u64,
    /// Deepest JSON nesting.
    pub json_depth: u32,
    /// Most blocks on one page.
    pub blocks_per_page: u32,
    /// Largest Markdown string in one text block.
    pub markdown_bytes: u64,
    /// Most live strokes on one page.
    pub strokes_per_page: u32,
    /// Most points in one stroke.
    pub points_per_stroke: u32,
    /// Largest ink segment file.
    pub segment_bytes: u64,
    /// Most segments in one page's list.
    pub segments_per_page: u32,
    /// Largest journal record payload.
    pub journal_payload: u64,
    /// Largest decompressed history snapshot or journal base.
    pub gunzip_bytes: u64,
    /// Largest absolute value of a geometry value.
    pub geometry_abs: f64,
    /// Longest order key.
    pub order_key_len: u32,
    /// Longest page title, in characters.
    pub title_chars: u32,
    /// Most tags on one page, or on one text element.
    pub tags_per_page: u32,
    /// Longest tag, in characters.
    pub tag_chars: u32,
    /// Most element IDs in one text block (spec 6.6).
    pub elements_per_block: u32,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            page_json_bytes: 64 * MIB,
            json_depth: 128,
            blocks_per_page: 100_000,
            markdown_bytes: 4 * MIB,
            strokes_per_page: 1_000_000,
            points_per_stroke: 200_000,
            segment_bytes: 256 * MIB,
            segments_per_page: 4_096,
            journal_payload: 64 * MIB,
            gunzip_bytes: 64 * MIB,
            geometry_abs: 10_000_000.0,
            order_key_len: 256,
            title_chars: 1_000,
            tags_per_page: 1_000,
            tag_chars: 200,
            elements_per_block: 100_000,
        }
    }
}

/// Times and sizes that drive autosave, the journal, retries, and clean-up (spec Appendix A).
#[derive(Clone, Debug, PartialEq)]
pub struct Timings {
    /// Autosave after the last change.
    pub autosave_idle: Duration,
    /// Longest time a page stays dirty while editing continues.
    pub max_dirty: Duration,
    /// Journal bytes since the last save that force a save.
    pub journal_force_bytes: u64,
    /// Generation size before a page journal rotates.
    pub rotate_bytes: u64,
    /// Size before a tree journal starts a new generation.
    pub tree_rotate_bytes: u64,
    /// Longest wait before the journal flushes (group commit).
    pub group_commit: Duration,
    /// Waits between retries of a busy file.
    pub busy_retries: Vec<Duration>,
    /// Waits between autosave retries after a failed save. The last one repeats.
    pub save_backoff: Vec<Duration>,
    /// How often a blocked save tries again on its own.
    pub blocked_retry: Duration,
    /// How often a save stopped by a full disk checks for space.
    pub disk_full_check: Duration,
    /// History versions while editing continues.
    pub history_interval: Duration,
    /// When to look for sync-tool conflict copies after a save.
    pub conflict_copy_checks: [Duration; 2],
    /// Progress records for a stroke still being drawn.
    pub ink_progress: Duration,
    /// The interface sends changed text this long after typing pauses.
    pub text_pause: Duration,
    /// The interface sends changed text at least this often while typing continues.
    pub text_max: Duration,
    /// Age before temporary files and partial copies are deleted.
    pub temp_age: Duration,
    /// Wait before unreferenced segments and assets are deleted.
    pub gc_grace: Duration,
    /// Days an item stays in Trash.
    pub trash_days: u32,
    /// Age before copies of tree files in `.opennote/conflicts/` are deleted.
    pub tree_conflict_age: Duration,
    /// Age before files in `.damaged/` are deleted.
    pub damaged_age: Duration,
    /// Age before an entry whose page folder is missing is dropped.
    pub unavailable_age: Duration,
    /// Wait before "Some parts of this page haven't arrived."
    pub not_arrived_notice: Duration,
    /// Wait before the app offers to export journals whose notebook is gone.
    pub waiting_export_offer: Duration,
    /// Shortest time between rewrites of `index.md`.
    pub index_md_debounce: Duration,
}

impl Default for Timings {
    fn default() -> Timings {
        let ms = Duration::from_millis;
        let secs = Duration::from_secs;
        Timings {
            autosave_idle: secs(1),
            max_dirty: secs(10),
            journal_force_bytes: 4 * MIB,
            rotate_bytes: MIB,
            tree_rotate_bytes: 64 * KIB,
            group_commit: ms(200),
            busy_retries: [5, 10, 20, 40, 80, 160, 320, 640].map(ms).to_vec(),
            save_backoff: [1, 2, 5, 10, 30].map(secs).to_vec(),
            blocked_retry: secs(5 * 60),
            disk_full_check: secs(30),
            history_interval: secs(10 * 60),
            conflict_copy_checks: [secs(5), secs(60)],
            ink_progress: ms(500),
            text_pause: ms(150),
            text_max: ms(300),
            temp_age: secs(24 * 3_600),
            gc_grace: DAY * 30,
            trash_days: 30,
            tree_conflict_age: DAY * 30,
            damaged_age: DAY * 90,
            unavailable_age: DAY * 30,
            not_arrived_notice: secs(10 * 60),
            waiting_export_offer: DAY * 90,
            index_md_debounce: secs(5),
        }
    }
}

impl Timings {
    /// Short timings for the kill harness, so saves, rotations, and compactions happen constantly.
    ///
    /// Trash and clean-up ages stay long, so a running script never loses an item it will restore.
    pub fn for_crash_tests() -> Timings {
        let ms = Duration::from_millis;
        Timings {
            autosave_idle: ms(50),
            max_dirty: ms(200),
            journal_force_bytes: 64 * KIB,
            rotate_bytes: 16 * KIB,
            tree_rotate_bytes: 4 * KIB,
            group_commit: ms(20),
            busy_retries: [1, 2, 4, 8].map(ms).to_vec(),
            save_backoff: [10, 20, 50].map(ms).to_vec(),
            blocked_retry: ms(100),
            disk_full_check: ms(100),
            history_interval: ms(500),
            conflict_copy_checks: [ms(50), ms(200)],
            ink_progress: ms(50),
            text_pause: ms(15),
            text_max: ms(30),
            index_md_debounce: ms(100),
            ..Timings::default()
        }
    }
}

/// Counts and sizes behind writer policy (spec Appendix A).
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// Minor compaction runs when a page has more segments than this.
    pub minor_compaction_segments: u32,
    /// Major compaction runs when more segments than this remain.
    pub major_compaction_segments: u32,
    /// Major compaction also runs when dead bytes pass this share of the page's ink bytes.
    pub major_compaction_dead_share: f64,
    /// Earlier revisions kept in a revision's `ancestors`.
    pub revision_ancestors: usize,
    /// Siblings get new keys when any key grows past this length.
    pub order_key_rekey_len: usize,
    /// History of one page beyond which the oldest unnamed versions go.
    pub history_bytes: u64,
    /// A change that removes more blocks than this saves a version first.
    pub large_delete_blocks: usize,
    /// A change that removes more strokes than this saves a version first.
    pub large_delete_strokes: usize,
    /// Migration backup sets kept per notebook.
    pub backup_sets: usize,
    /// A notebook folder path longer than this gets a warning.
    pub path_warning_chars: usize,
    /// Deepest nesting of section groups.
    pub group_depth: u32,
    /// Longest chain of page parents.
    pub page_depth: u8,
}

impl Default for Policy {
    fn default() -> Policy {
        Policy {
            minor_compaction_segments: 8,
            major_compaction_segments: 16,
            major_compaction_dead_share: 0.5,
            revision_ancestors: 32,
            order_key_rekey_len: 64,
            history_bytes: 50 * MIB,
            large_delete_blocks: 20,
            large_delete_strokes: 200,
            backup_sets: 3,
            path_warning_chars: 90,
            group_depth: 4,
            page_depth: 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_retries_add_up_to_about_one_point_three_seconds() {
        let total: Duration = Timings::default().busy_retries.iter().sum();
        assert_eq!(total, Duration::from_millis(1_275));
    }

    #[test]
    fn crash_test_timings_are_shorter_but_keep_trash() {
        let (normal, short) = (Timings::default(), Timings::for_crash_tests());
        assert!(short.autosave_idle < normal.autosave_idle);
        assert!(short.rotate_bytes < normal.rotate_bytes);
        assert!(short.group_commit < normal.group_commit);
        assert_eq!(short.trash_days, normal.trash_days);
        assert_eq!(short.gc_grace, normal.gc_grace);
    }

    #[test]
    fn limits_match_the_spec() {
        let limits = Limits::default();
        assert_eq!(limits.page_json_bytes, 67_108_864);
        assert_eq!(limits.segments_per_page, 4_096);
        assert_eq!(limits.order_key_len as usize, crate::order::MAX_KEY_LEN);
    }
}
