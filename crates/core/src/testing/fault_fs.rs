//! A fault-injecting file system with durability models and power cuts (plan 6). Owned by WP2.
//!
//! [`FaultFs`] keeps what the running app sees apart from what a power cut would leave. Each durable call does
//! what `StdFs` does on that platform, step by step: the temporary file, its flush, the rename, and the flushes
//! after it. File data is volatile until its file is flushed. A rename, create, or delete is volatile until its
//! model's condition holds:
//!
//! - NTFS and network shares: the next flush of anything on the volume, because the metadata log is written in
//!   order. At a power cut, an in-order prefix of the volatile changes survives. A network share honors
//!   flushes too, but no durable call there is ever confirmed (spec 17.5).
//! - ext4: a flush of the folder the change is in. Each volatile change may survive a power cut on its own.
//! - FAT: a flush of the folder, and for a rename also of the renamed file.
//!
//! Unflushed file data survives a power cut in one of four ways. It is lost, cut to a prefix, cut and padded
//! with zero bytes to its written length, or cut and padded with random bytes. Every choice comes from the
//! power cut's seed, so a failing case can be replayed. An app crash keeps every volatile change, and they stay
//! volatile after the restart.
//!
//! Every call counts, including failed ones: [`FaultFs::crash_at_call`] names a call by its number from 0. An
//! app crash stops before that call. A power cut stops partway through it, after the steps the seed picks.
//! A crash can therefore leave a temporary file, or a rename that isn't flushed yet. Faults and hostile
//! readers count calls, not retries: `FaultFs` never retries, and a Busy call fails at once.

mod call;
mod checks;
mod inspect;
mod ops;
mod state;
mod sync;
mod tree;

pub use sync::{ConflictStyle, FolderSnapshot, SyncAction, SyncSim};

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::error::{FsError, FsErrorKind};
use crate::store::fs::SyncTool;
use call::Call;
use state::{Disk, Rng};
use tree::{key_of, Key};

/// Which file system's durability rules a [`FaultFs`] follows (plan 6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DurabilityModel {
    /// A rename is durable once the renamed handle is flushed.
    Ntfs,
    /// A rename is durable once its folder is flushed.
    Ext4,
    /// FAT32, exFAT, or FAT: both flushes are needed.
    Fat,
    /// A network share: nothing is confirmed.
    Network,
}

/// How a [`FaultFs`] stops.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CrashKind {
    /// The app stops. Every volatile change survives.
    App,
    /// The power fails. Volatile changes survive or not, chosen by the seed.
    PowerCut {
        /// The seed of the choices.
        seed: u64,
    },
}

/// A file system call, as logged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FsCall {
    /// The call's number, from 0.
    pub index: u64,
    /// The call, such as `"replace_durable"`.
    pub op: &'static str,
    /// The path it worked on.
    pub path: PathBuf,
}

/// A fault to inject on paths that contain `pattern`.
///
/// `DiskFull`, `Blocked`, `ReadOnlyFile`, and `AlreadyExists` apply only to calls that change something, and
/// `CloudPlaceholder` only to reads. Every other kind applies to every call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaultRule {
    /// A substring of the paths the fault applies to.
    pub pattern: String,
    /// The error to report.
    pub kind: FsErrorKind,
    /// How many calls fail before the fault clears. `None` never clears.
    pub times: Option<u32>,
}

/// Calls that change something.
const MUTATING: [&str; 12] = [
    "replace_durable",
    "create_durable",
    "write_derived",
    "create_dir_durable",
    "rename_dir",
    "remove_file",
    "remove_dir_all",
    "clear_read_only",
    "open_append",
    "append",
    "sync",
    "try_lock",
];

impl FaultRule {
    fn applies(&self, op: &str, path: &str) -> bool {
        let op_fits = match self.kind {
            FsErrorKind::DiskFull | FsErrorKind::Blocked | FsErrorKind::ReadOnlyFile | FsErrorKind::AlreadyExists => {
                MUTATING.contains(&op)
            }
            FsErrorKind::CloudPlaceholder => ["read", "read_prefix", "read_range"].contains(&op),
            _ => true,
        };
        op_fits && path.contains(&self.pattern)
    }
}

/// What a call does to a file or folder another program may hold open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Blocks {
    Replace,
    Delete,
    RenameFolder,
    DeleteFolder,
}

/// A file held open by another program.
#[derive(Clone, Debug)]
struct Hold {
    key: Key,
    share_delete: bool,
    calls: u32,
}

/// The whole state behind one [`FaultFs`].
struct State {
    disk: Disk,
    boot: u32,
    locks: BTreeSet<Key>,
    holds: Vec<Hold>,
    rules: Vec<FaultRule>,
    calls: u64,
    log: Vec<FsCall>,
    crash_at: Option<(u64, CrashKind)>,
    crashed: Option<CrashKind>,
    scheduled: Vec<(u64, SyncAction)>,
    temps: u32,
}

impl State {
    fn fresh(disk: Disk, boot: u32) -> State {
        State {
            disk,
            boot,
            locks: BTreeSet::new(),
            holds: Vec::new(),
            rules: Vec::new(),
            calls: 0,
            log: Vec::new(),
            crash_at: None,
            crashed: None,
            scheduled: Vec::new(),
            temps: 0,
        }
    }

    /// Whether a hold makes a call Busy, by what the call does and the volume's model (measurement M6).
    fn blocked(&self, key: &Key, call: Blocks) -> bool {
        self.holds.iter().any(|hold| {
            let (target, inside) = (&hold.key == key, hold.key.starts_with(key));
            let model = self.disk.model_of(&hold.key);
            let posix = model == DurabilityModel::Ntfs;
            match (call, model) {
                // Unix lets programs replace, delete, and rename files and folders others hold open.
                (_, DurabilityModel::Ext4) => false,
                // Only NTFS offers POSIX semantics, which replace a file held with delete sharing.
                (Blocks::Replace, _) => target && (!hold.share_delete || !posix),
                (Blocks::Delete, _) => target && !hold.share_delete,
                (Blocks::RenameFolder, _) => inside,
                // Elsewhere a deleted file keeps its name until it is closed, so its folder isn't empty.
                (Blocks::DeleteFolder, _) => inside && (!hold.share_delete || !posix),
            }
        })
    }

    /// The fault that fails this call, if any. Using a fault counts one of its times.
    fn fault_for(&mut self, op: &str, path: &Path) -> Option<FsErrorKind> {
        let text = path.to_string_lossy().replace('\\', "/");
        let index = self.rules.iter().position(|rule| rule.applies(op, &text))?;
        let rule = self.rules.get_mut(index)?;
        let kind = rule.kind;
        if let Some(times) = rule.times.as_mut() {
            *times = times.saturating_sub(1);
            if *times == 0 {
                self.rules.remove(index);
            }
        }
        Some(kind)
    }

    /// A temporary file's name next to `target`, as `store::layout::temp_name` makes them, but deterministic.
    fn temp_key(&mut self, target: &[String]) -> Key {
        self.temps = self.temps.wrapping_add(1);
        let mut key = tree::parent(target);
        let name = target.last().map_or("", String::as_str);
        key.push(format!("~{name}.{:08x}.tmp", self.temps));
        key
    }

    /// Runs the outside changes scheduled before the current call.
    fn run_scheduled(&mut self) {
        let now = self.calls;
        let (due, later): (Vec<_>, Vec<_>) = std::mem::take(&mut self.scheduled)
            .into_iter()
            .partition(|(call, _)| *call <= now);
        self.scheduled = later;
        for (_, action) in due {
            sync::apply(&mut self.disk, &action);
        }
    }
}

/// The fault-injecting file system. Clones share the same state.
#[derive(Clone)]
pub struct FaultFs {
    shared: Arc<Mutex<State>>,
}

impl FaultFs {
    /// An empty file system that follows `model`.
    pub fn new(model: DurabilityModel) -> FaultFs {
        FaultFs::from_state(State::fresh(Disk::new(model), 1))
    }

    fn from_state(state: State) -> FaultFs {
        FaultFs {
            shared: Arc::new(Mutex::new(state)),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Puts every path under `prefix` on a volume of its own that follows `model`, such as a notebook on a
    /// network share while the journal is on an NTFS system drive.
    pub fn add_volume(&self, prefix: &Path, model: DurabilityModel) {
        let prefix = key_of(prefix).unwrap_or_default();
        self.lock().disk.volumes.push(state::Volume {
            prefix,
            model,
            sync_root: None,
        });
    }

    /// Makes `volume` report that a sync tool manages the volume `path` is on.
    pub fn set_sync_root(&self, path: &Path, tool: Option<SyncTool>) {
        let key = key_of(path).unwrap_or_default();
        let mut state = self.lock();
        let index = state.disk.volume_of(&key);
        if let Some(volume) = state.disk.volumes.get_mut(index) {
            volume.sync_root = tool;
        }
    }

    /// Crashes at call number `call`. Every call from then on returns `Crashed`. A call number already past
    /// crashes at the next call, and a crash that no call reaches happens at [`FaultFs::reboot`].
    pub fn crash_at_call(&self, call: u64, kind: CrashKind) {
        let mut state = self.lock();
        let at = call.max(state.calls);
        state.crash_at = Some((at, kind));
    }

    /// Whether this file system has crashed.
    pub fn crashed(&self) -> bool {
        self.lock().crashed.is_some()
    }

    /// The durable state after the crash, as a new file system. Without a crash, the app stopped: everything
    /// survives, and volatile changes stay volatile. This file system and its open files fail with `Crashed`
    /// from now on. Locks, holds, faults, and the call log start empty, and a power cut changes the boot ID.
    pub fn reboot(&self) -> FaultFs {
        let mut state = self.lock();
        let kind = state.crashed.or(state.crash_at.map(|(_, kind)| kind));
        state.crashed = Some(kind.unwrap_or(CrashKind::App));
        let mut disk = state.disk.clone();
        let mut boot = state.boot;
        if let Some(CrashKind::PowerCut { seed }) = kind {
            let mut rng = Rng::new(seed ^ 0x5eed_cafe_f00d_d00d);
            let (tree, inodes) = disk.power_cut(&mut rng);
            disk.live = tree.clone();
            disk.base = tree;
            disk.pending.clear();
            disk.inodes = inodes;
            boot = boot.saturating_add(1);
        }
        FaultFs::from_state(State::fresh(disk, boot))
    }

    /// A copy of this file system as it is now, sharing nothing with it, so that a test can try many power cuts
    /// from one state. Open files and locks stay with the original, and so does a crash that already happened.
    pub fn fork(&self) -> FaultFs {
        let state = self.lock();
        FaultFs::from_state(State {
            disk: state.disk.clone(),
            boot: state.boot,
            locks: BTreeSet::new(),
            holds: state.holds.clone(),
            rules: state.rules.clone(),
            calls: state.calls,
            log: state.log.clone(),
            crash_at: state.crash_at,
            crashed: None,
            scheduled: state.scheduled.clone(),
            temps: state.temps,
        })
    }

    /// How many calls were made.
    pub fn calls(&self) -> u64 {
        self.lock().calls
    }

    /// Every call made.
    pub fn log(&self) -> Vec<FsCall> {
        self.lock().log.clone()
    }

    /// Injects a fault.
    pub fn inject(&self, rule: FaultRule) {
        self.lock().rules.push(rule);
    }

    /// Holds a file open like a hostile reader for `calls` calls, with or without delete sharing. What a hold
    /// blocks follows measurement M6. On NTFS, a hold without delete sharing makes replacing or deleting the
    /// file Busy, and deleting its folder too. On FAT and network shares, which have no POSIX semantics, any hold
    /// makes replacing the file and deleting its folder Busy. On Windows, renaming a folder with a held file
    /// inside is always Busy. On ext4 a hold blocks nothing, as on Unix.
    pub fn hold_open(&self, path: &Path, share_delete: bool, calls: u32) {
        if let Ok(key) = key_of(path) {
            self.lock().holds.push(Hold {
                key,
                share_delete,
                calls,
            });
        }
    }

    /// A sync tool working on this file system.
    pub fn sync_tool(&self) -> SyncSim {
        SyncSim::new(self.clone())
    }

    /// Starts a call. An app crash due at this call stops it before it does anything, and a power cut due
    /// at this call stops it partway, in [`Call::run`].
    fn call(&self, op: &'static str, path: &Path) -> Result<Call<'_>, FsError> {
        let mut state = self.lock();
        if state.crashed.is_some() {
            return Err(FsError::new(FsErrorKind::Crashed, path));
        }
        state.run_scheduled();
        let mut power_cut = None;
        if let Some((at, kind)) = state.crash_at {
            if at <= state.calls {
                match kind {
                    CrashKind::App => {
                        state.crashed = Some(kind);
                        return Err(FsError::new(FsErrorKind::Crashed, path));
                    }
                    CrashKind::PowerCut { seed } => power_cut = Some(seed),
                }
            }
        }
        let fault = state.fault_for(op, path);
        let call = Call {
            state,
            op,
            path: path.to_path_buf(),
            power_cut,
        };
        match fault {
            Some(kind) => Err(call.fail(kind)),
            None => Ok(call),
        }
    }
}

pub(super) fn path_of(key: &[String]) -> PathBuf {
    let mut path = PathBuf::from(std::path::MAIN_SEPARATOR_STR);
    for (index, part) in key.iter().enumerate() {
        if index == 0 && part.ends_with(':') {
            path = PathBuf::from(format!("{part}{}", std::path::MAIN_SEPARATOR));
        } else {
            path.push(part);
        }
    }
    path
}
