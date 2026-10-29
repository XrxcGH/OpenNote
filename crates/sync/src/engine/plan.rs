//! Step 1 of a round: the plan, which is also the preview. It reads this device's folder and the new heads, merges
//! them, and lists what will change. It writes nothing.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::{digest, Action, Engine, LocalState, Plan, Store, Summary};
use crate::error::{Result, SyncError};
use crate::local::{self, Fingerprint};
use crate::manifest::{Entry, Manifest, Vv};
use crate::merge::{self, Merged};
use crate::vault;

/// The new heads to merge, and what this device will have seen after merging them.
struct Incoming {
    heads: Vec<Manifest>,
    seen: BTreeMap<String, u64>,
    own_max: u64,
}

impl Engine {
    /// Plans a round without changing anything: the preview.
    pub fn plan(&self) -> Result<Plan> {
        let state = self.state()?;
        let vault = vault::status(self.backend.as_ref(), &self.keys)?;
        // An older header than this device saw was put back: an old passphrase, or a removed device, may work again.
        if vault.generation < state.vault {
            return Err(SyncError::Rollback);
        }
        if !vault.devices.contains(&self.device) || vault::is_removed(self.backend.as_ref(), &self.keys, &self.device)?
        {
            return Err(SyncError::Removed);
        }
        let incoming = self.incoming(&state)?;
        let floor = self.floor(&state, &incoming.heads);
        let (local_manifest, prints) = self.scan_local(&state, &floor)?;

        let mut local_paths = HashMap::new();
        for (path, entry) in local_manifest.iter().filter(|(_, e)| e.live()) {
            local_paths
                .entry(entry.content.id.clone())
                .or_insert_with(|| path.clone());
        }
        let store = Store {
            engine: self,
            local_paths,
            pending: RefCell::new(HashMap::new()),
        };
        let mut inputs: Vec<&Manifest> = vec![&local_manifest, &state.deferred];
        inputs.extend(incoming.heads.iter());
        let merged = merge::merge(&inputs, &local_manifest, &store)?;
        let pending = store.pending.into_inner();

        let mut summary = Summary {
            conflicts: merged.conflicts.clone(),
            ..Summary::default()
        };
        let uploads = uploads(&state, &incoming.heads, &local_manifest, &pending, &mut summary);
        let actions = actions(&merged, &local_manifest, &mut summary);
        let publish = digest(&merged.entries) != state.published || incoming.own_max > state.generation;
        Ok(Plan {
            summary,
            local: local_manifest,
            prints,
            merged: merged.entries,
            seen: incoming.seen,
            own_max: incoming.own_max,
            vault: vault.generation,
            pending,
            uploads,
            actions,
            publish,
        })
    }

    /// The highest count of this device's own changes that anything it will merge already used, per path.
    ///
    /// Say a round published a head and stopped before saving its state, or the state came back from a backup. The
    /// state then knows a lower count than the head. Counting up from there would give a new edit the version
    /// vector the head already used for other bytes. A later version from another device would then hide it.
    fn floor(&self, state: &LocalState, heads: &[Manifest]) -> HashMap<String, u64> {
        let mut floor: HashMap<String, u64> = HashMap::new();
        for manifest in heads.iter().chain(std::iter::once(&state.deferred)) {
            for (path, entry) in manifest {
                if let Some(count) = entry.vv.get(&self.device) {
                    let slot = floor.entry(path.clone()).or_insert(0);
                    *slot = (*slot).max(*count);
                }
            }
        }
        floor
    }

    /// A version vector for a change this device made to `path`, from the version it was made on.
    fn fresh(&self, from: &Vv, path: &str, floor: &HashMap<String, u64>) -> Vv {
        let mut vv = from.clone();
        let used = floor.get(path).copied().unwrap_or(0);
        let slot = vv.entry(self.device.clone()).or_insert(0);
        *slot = (*slot).max(used) + 1;
        vv
    }

    /// This device's folder as a manifest: unchanged files keep their version, and changed ones count up.
    fn scan_local(
        &self,
        state: &LocalState,
        floor: &HashMap<String, u64>,
    ) -> Result<(Manifest, BTreeMap<String, Fingerprint>)> {
        let mut manifest = Manifest::new();
        let mut prints = BTreeMap::new();
        for (path, print) in local::scan(&self.root)? {
            let known = state.files.get(&path);
            let entry = match known {
                Some(k) if k.entry.live() && k.print == Some(print) => k.entry.clone(),
                _ => {
                    let file = local::join(&self.root, &path);
                    let content = local::hash_file(&file, &self.keys.chunk, &self.keys.content)?;
                    match known {
                        Some(k) if k.entry.live() && k.entry.content.id == content.id => k.entry.clone(),
                        Some(k) => Entry {
                            vv: self.fresh(&k.entry.vv, &path, floor),
                            content,
                            deleted: false,
                        },
                        None => Entry {
                            vv: self.fresh(&Vv::new(), &path, floor),
                            content,
                            deleted: false,
                        },
                    }
                }
            };
            prints.insert(path.clone(), print);
            manifest.insert(path, entry);
        }
        for (path, known) in &state.files {
            if manifest.contains_key(path) {
                continue;
            }
            let entry = if known.entry.live() {
                let vv = self.fresh(&known.entry.vv, path, floor);
                Entry {
                    vv,
                    content: known.entry.content.clone(),
                    deleted: true,
                }
            } else {
                known.entry.clone()
            };
            manifest.insert(path.clone(), entry);
        }
        Ok((manifest, prints))
    }

    /// The other devices' new heads. A device that shows less than this one already saw was rolled back.
    fn incoming(&self, state: &LocalState) -> Result<Incoming> {
        let (newest, own) = self.heads()?;
        let own_max = own.last().copied().unwrap_or(0);
        if state.generation > 0 && own_max < state.generation {
            return Err(SyncError::Rollback);
        }
        if state
            .seen
            .iter()
            .any(|(device, seen)| newest.get(device).copied().unwrap_or(0) < *seen)
        {
            return Err(SyncError::Rollback);
        }
        let mut incoming = Incoming {
            heads: Vec::new(),
            seen: state.seen.clone(),
            own_max,
        };
        for (device, generation) in &newest {
            if *device == self.device {
                // A head of this device's own that its state doesn't know: a round stopped after writing it.
                if *generation > state.generation {
                    incoming.heads.push(self.read_head(device, *generation)?.entries);
                }
            } else if *generation > state.seen.get(device).copied().unwrap_or(0) {
                incoming.heads.push(self.read_head(device, *generation)?.entries);
                incoming.seen.insert(device.clone(), *generation);
            }
        }
        Ok(incoming)
    }
}

/// The local files whose contents storage doesn't have yet. Storage has everything this device knew, and everything
/// in the heads it read, because a head is written only after its chunks.
fn uploads(
    state: &LocalState,
    heads: &[Manifest],
    local_manifest: &Manifest,
    pending: &HashMap<String, Vec<u8>>,
    summary: &mut Summary,
) -> Vec<String> {
    let mut known: BTreeSet<&str> = state.files.values().map(|k| k.entry.content.id.as_str()).collect();
    for manifest in heads.iter().chain(std::iter::once(&state.deferred)) {
        known.extend(manifest.values().map(|e| e.content.id.as_str()));
    }
    let mut out = Vec::new();
    for (path, entry) in local_manifest {
        if entry.live() && known.insert(entry.content.id.as_str()) {
            summary.bytes_up += entry.content.size;
            summary.upload.push(path.clone());
            out.push(path.clone());
        }
    }
    for (id, bytes) in pending {
        if !known.contains(id.as_str()) {
            summary.bytes_up += bytes.len() as u64;
        }
    }
    out
}

/// What changes in this device's folder.
fn actions(merged: &Merged, local_manifest: &Manifest, summary: &mut Summary) -> Vec<Action> {
    let mut actions = Vec::new();
    let mut taken: BTreeSet<String> = BTreeSet::new();
    for (path, entry) in &merged.entries {
        let here = local_manifest.get(path).filter(|e| e.live());
        if entry.deleted {
            if let Some(here) = here {
                summary.delete.push(path.clone());
                actions.push(Action::Delete {
                    path: path.clone(),
                    expect: here.content.id.clone(),
                });
            }
            continue;
        }
        // The merge already moved paths that differ only in case apart; this guards the disk if one slips by.
        if !local::valid_path(path) || !taken.insert(path.to_lowercase()) {
            continue;
        }
        if here.is_none_or(|h| h.content.id != entry.content.id) {
            summary.bytes_down += entry.content.size;
            summary.download.push(path.clone());
            let expect = here.map(|h| h.content.id.clone());
            actions.push(Action::Write {
                path: path.clone(),
                content: entry.content.clone(),
                expect,
            });
        }
    }
    // Deletes first: on a folder that ignores case, a path that goes must be gone before one differing only in
    // case is written.
    actions.sort_by_key(|action| !matches!(action, Action::Delete { .. }));
    actions
}
