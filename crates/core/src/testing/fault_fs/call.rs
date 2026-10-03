//! One call to a [`FaultFs`](super::FaultFs): its steps, and the accounting when it ends.

use std::path::PathBuf;
use std::sync::{Arc, MutexGuard};

use super::state::Rng;
use super::tree::{Entry, Key, MetaOp};
use super::{CrashKind, FsCall, State};
use crate::error::{FsError, FsErrorKind};

/// One call in progress. Dropping it counts the call, unless the file system crashed in it.
pub(super) struct Call<'a> {
    pub(super) state: MutexGuard<'a, State>,
    pub(super) op: &'static str,
    pub(super) path: PathBuf,
    pub(super) power_cut: Option<u64>,
}

/// A step of a call, so that a power cut can stop the call partway.
pub(super) enum Step {
    NewFile { key: Key, bytes: Vec<u8> },
    Append { ino: u128, bytes: Vec<u8> },
    FlushFile { key: Key },
    FlushIno { ino: u128, key: Key },
    Rename { from: Key, to: Key, replace: bool },
    FlushDir { key: Key },
    CreateDir { key: Key },
    RenameDir { from: Key, to: Key },
    Remove { key: Key },
    RemoveTree { key: Key },
}

impl Call<'_> {
    /// An error of this call.
    pub(super) fn fail(&self, kind: FsErrorKind) -> FsError {
        FsError::new(kind, &self.path)
    }

    /// Runs the call's steps. When a power cut is due, it runs only the first few, then cuts the power.
    pub(super) fn run(&mut self, steps: Vec<Step>) -> Result<(), FsError> {
        let (take, crash) = match self.power_cut.take() {
            None => (steps.len(), None),
            Some(seed) => (Rng::new(seed).below(steps.len().saturating_add(1)), Some(seed)),
        };
        for step in steps.into_iter().take(take) {
            self.perform(step);
        }
        match crash {
            None => Ok(()),
            Some(seed) => {
                self.state.crashed = Some(CrashKind::PowerCut { seed });
                Err(self.fail(FsErrorKind::Crashed))
            }
        }
    }

    fn perform(&mut self, step: Step) {
        let disk = &mut self.state.disk;
        match step {
            Step::NewFile { key, bytes } => {
                let entry = Entry::File(disk.new_file(bytes, false));
                disk.change(MetaOp::Create { key, entry }, None);
            }
            Step::Append { ino, bytes } => {
                let modified = disk.touch();
                if let Some(inode) = disk.inodes.get_mut(&ino) {
                    Arc::make_mut(&mut inode.data).extend_from_slice(&bytes);
                    inode.modified = modified;
                }
            }
            Step::FlushFile { key } => {
                if let Some(Entry::File(ino)) = disk.live.get(&key).copied() {
                    disk.flush_file(ino, &key);
                }
            }
            Step::FlushIno { ino, key } => disk.flush_file(ino, &key),
            Step::Rename { from, to, replace } => {
                if let Some(Entry::File(ino)) = disk.live.get(&from).copied() {
                    disk.change(MetaOp::Rename { from, to, ino, replace }, Some(ino));
                }
            }
            Step::FlushDir { key } => disk.flush_dir(&key),
            Step::CreateDir { key } => {
                let entry = Entry::Dir(disk.new_ino());
                disk.change(MetaOp::Create { key, entry }, None);
            }
            Step::RenameDir { from, to } => {
                disk.change(MetaOp::RenameDir { from, to }, None);
            }
            Step::Remove { key } => {
                disk.change(MetaOp::Remove { key }, None);
            }
            Step::RemoveTree { key } => {
                disk.change(MetaOp::RemoveTree { key }, None);
            }
        }
    }
}

impl Drop for Call<'_> {
    fn drop(&mut self) {
        if let Some(seed) = self.power_cut {
            // The power failed during a call that had no steps to take.
            self.state.crashed = Some(CrashKind::PowerCut { seed });
        }
        if self.state.crashed.is_some() {
            return;
        }
        let index = self.state.calls;
        let (op, path) = (self.op, std::mem::take(&mut self.path));
        self.state.log.push(FsCall { index, op, path });
        self.state.calls = index.saturating_add(1);
        for hold in &mut self.state.holds {
            hold.calls = hold.calls.saturating_sub(1);
        }
        self.state.holds.retain(|hold| hold.calls > 0);
    }
}
