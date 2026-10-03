//! The disk of a [`FaultFs`](super::FaultFs). It holds the live tree the running app sees, the durable tree,
//! the metadata changes still in flight, and the file contents with how much of each is flushed.
//!
//! A metadata change (create, rename, delete) is applied to the live tree at once and queued as pending. It
//! becomes durable when its model's condition holds (plan 6), and is then folded into the durable tree once
//! every earlier change is durable too. A power cut keeps the pending changes the model allows, replayed in
//! order onto the durable tree. A change whose preconditions no longer hold is skipped.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::tree::{Entry, Inode, Key, MetaOp, Tree};
use super::DurabilityModel;

/// When a pending change becomes durable.
#[derive(Clone, Debug)]
pub(super) enum Needs {
    /// NTFS and network shares: the next flush of anything on the volume, because the metadata log is written
    /// in order.
    AnyFlush,
    /// ext4 and FAT: flushes of these folders, and on FAT of the renamed file, after the change.
    Flushes { folders: Vec<Key>, file: Option<u128> },
}

/// A change not yet folded into the durable tree.
#[derive(Clone, Debug)]
pub(super) struct Pending {
    pub(super) op: MetaOp,
    pub(super) volume: usize,
    pub(super) needs: Needs,
    pub(super) committed: bool,
}

/// A volume: every path under `prefix` follows `model`.
#[derive(Clone, Debug)]
pub(super) struct Volume {
    pub(super) prefix: Key,
    pub(super) model: DurabilityModel,
    pub(super) sync_root: Option<crate::store::fs::SyncTool>,
}

/// The file systems' shared tables.
#[derive(Clone, Debug)]
pub(super) struct Disk {
    pub(super) live: Tree,
    pub(super) base: Tree,
    pub(super) pending: Vec<Pending>,
    pub(super) inodes: BTreeMap<u128, Inode>,
    pub(super) volumes: Vec<Volume>,
    pub(super) next_ino: u128,
    pub(super) tick: i64,
}

impl Disk {
    pub(super) fn new(model: DurabilityModel) -> Disk {
        let mut tree = Tree::new();
        tree.insert(Key::new(), Entry::Dir(1));
        Disk {
            live: tree.clone(),
            base: tree,
            pending: Vec::new(),
            inodes: BTreeMap::new(),
            volumes: vec![Volume {
                prefix: Key::new(),
                model,
                sync_root: None,
            }],
            next_ino: 2,
            tick: 0,
        }
    }

    pub(super) fn new_ino(&mut self) -> u128 {
        self.next_ino = self.next_ino.saturating_add(1);
        self.next_ino
    }

    pub(super) fn touch(&mut self) -> i64 {
        self.tick = self.tick.saturating_add(1);
        self.tick
    }

    /// A new file with `bytes`, of which `durable` bytes are flushed.
    pub(super) fn new_file(&mut self, bytes: Vec<u8>, durable: bool) -> u128 {
        let ino = self.new_ino();
        let modified = self.touch();
        let durable_len = if durable { bytes.len() } else { 0 };
        self.inodes.insert(
            ino,
            Inode {
                data: Arc::new(bytes),
                durable_len,
                modified,
                read_only: false,
                placeholder: false,
            },
        );
        ino
    }

    /// The volume a key is on: the one with the longest matching prefix.
    pub(super) fn volume_of(&self, key: &[String]) -> usize {
        let matching = self
            .volumes
            .iter()
            .enumerate()
            .filter(|(_, v)| key.starts_with(&v.prefix));
        matching
            .max_by_key(|(_, v)| v.prefix.len())
            .map_or(0, |(index, _)| index)
    }

    pub(super) fn model_of(&self, key: &[String]) -> DurabilityModel {
        self.volumes
            .get(self.volume_of(key))
            .map_or(DurabilityModel::Ntfs, |volume| volume.model)
    }

    /// Applies a change to the live tree and queues it. `renamed` is the file that a rename on FAT also needs flushed.
    pub(super) fn change(&mut self, op: MetaOp, renamed: Option<u128>) -> bool {
        if !op.apply(&mut self.live) {
            return false;
        }
        let key = match &op {
            MetaOp::Create { key, .. } | MetaOp::Put { key, .. } | MetaOp::Remove { key } => key.clone(),
            MetaOp::RemoveTree { key } => key.clone(),
            MetaOp::Rename { to, .. } | MetaOp::RenameDir { to, .. } => to.clone(),
        };
        let volume = self.volume_of(&key);
        let needs = match self.model_of(&key) {
            DurabilityModel::Ntfs | DurabilityModel::Network => Needs::AnyFlush,
            DurabilityModel::Ext4 => Needs::Flushes {
                folders: op.folders(),
                file: None,
            },
            DurabilityModel::Fat => Needs::Flushes {
                folders: op.folders(),
                file: renamed,
            },
        };
        self.pending.push(Pending {
            op,
            volume,
            needs,
            committed: false,
        });
        true
    }

    /// A change made from outside, such as by a sync tool: durable at once, after everything before it.
    pub(super) fn external(&mut self, op: MetaOp) {
        if op.apply(&mut self.live) {
            let volume = self.volume_of(&[]);
            self.pending.push(Pending {
                op,
                volume,
                needs: Needs::AnyFlush,
                committed: true,
            });
            self.fold();
        }
    }

    /// Flushes a file: its content becomes durable, and so do the changes the model ties to the flush.
    pub(super) fn flush_file(&mut self, ino: u128, key: &[String]) {
        if let Some(inode) = self.inodes.get_mut(&ino) {
            inode.durable_len = inode.data.len();
        }
        let volume = self.volume_of(key);
        let model = self.model_of(key);
        for pending in self.pending.iter_mut().filter(|p| p.volume == volume && !p.committed) {
            match (&mut pending.needs, model) {
                (Needs::AnyFlush, _) => pending.committed = true,
                (Needs::Flushes { folders, file }, DurabilityModel::Fat) => {
                    if *file == Some(ino) {
                        *file = None;
                    }
                    pending.committed = folders.is_empty() && file.is_none();
                }
                _ => {}
            }
        }
        self.fold();
    }

    /// Flushes a folder.
    pub(super) fn flush_dir(&mut self, dir: &[String]) {
        let volume = self.volume_of(dir);
        for pending in self.pending.iter_mut().filter(|p| p.volume == volume && !p.committed) {
            match &mut pending.needs {
                Needs::AnyFlush => pending.committed = true,
                Needs::Flushes { folders, file } => {
                    folders.retain(|folder| folder.as_slice() != dir);
                    pending.committed = folders.is_empty() && file.is_none();
                }
            }
        }
        self.fold();
    }

    /// Moves durable changes at the front of the queue into the durable tree.
    fn fold(&mut self) {
        let durable = self.pending.iter().take_while(|p| p.committed).count();
        for pending in self.pending.drain(..durable) {
            pending.op.apply(&mut self.base);
        }
    }

    /// The tree that survives any power cut now.
    pub(super) fn durable_tree(&self) -> Tree {
        let mut tree = self.base.clone();
        for pending in self.pending.iter().filter(|p| p.committed) {
            pending.op.apply(&mut tree);
        }
        tree
    }

    /// The tree and contents after a power cut now, with choices drawn from `rng`.
    pub(super) fn power_cut(&self, rng: &mut Rng) -> (Tree, BTreeMap<u128, Inode>) {
        let volatile = |volume: usize| {
            self.pending
                .iter()
                .filter(|p| p.volume == volume && !p.committed)
                .count()
        };
        let keep: Vec<usize> = (0..self.volumes.len())
            .map(|volume| rng.below(volatile(volume).saturating_add(1)))
            .collect();
        let mut seen = vec![0usize; self.volumes.len()];
        let mut tree = self.base.clone();
        for pending in &self.pending {
            let survives = pending.committed || {
                let index = seen.get(pending.volume).copied().unwrap_or(0);
                if let Some(slot) = seen.get_mut(pending.volume) {
                    *slot = index.saturating_add(1);
                }
                match self.volumes.get(pending.volume).map(|v| v.model) {
                    // A metadata log is written in order, so a prefix of the changes survives.
                    Some(DurabilityModel::Ntfs | DurabilityModel::Network) => {
                        index < keep.get(pending.volume).copied().unwrap_or(0)
                    }
                    _ => rng.below(2) == 1,
                }
            };
            if survives {
                pending.op.apply(&mut tree);
            }
        }
        let inodes = self
            .inodes
            .iter()
            .map(|(ino, inode)| (*ino, cut_data(inode, rng)))
            .collect();
        (tree, inodes)
    }
}

/// A file's content after a power cut. Unflushed data is lost, cut to a prefix, cut and padded with zero bytes
/// to its written length, or cut and padded with random bytes (plan 6).
fn cut_data(inode: &Inode, rng: &mut Rng) -> Inode {
    let len = inode.data.len();
    let durable = inode.durable_len.min(len);
    let mut data = inode.data.to_vec();
    if durable < len {
        let outcome = rng.below(4);
        let cut = if outcome == 0 {
            durable
        } else {
            durable + rng.below(len - durable + 1)
        };
        data.truncate(cut);
        match outcome {
            2 => data.resize(len, 0),
            3 => data.extend((cut..len).map(|_| rng.next() as u8)),
            _ => {}
        }
    }
    Inode {
        durable_len: data.len(),
        data: Arc::new(data),
        ..inode.clone()
    }
}

/// A small deterministic generator (SplitMix64), so every seed gives the same power cut.
#[derive(Clone, Debug)]
pub(super) struct Rng(u64);

impl Rng {
    pub(super) fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    pub(super) fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A number below `n`, or 0 when `n` is 0.
    pub(super) fn below(&mut self, n: usize) -> usize {
        match u64::try_from(n) {
            Ok(0) | Err(_) => 0,
            Ok(n) => usize::try_from(self.next() % n).unwrap_or(0),
        }
    }
}
