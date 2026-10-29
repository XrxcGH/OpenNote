//! Recovery and housekeeping: trusting storage after a rollback warning, and garbage collection that is safe
//! across devices (ADR 0049, "Safety").

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{Seek, SeekFrom};

use super::{chunk_name, digest, head_name, request_name, Engine, GcMark, LocalState, GC_GRACE_MS};
use crate::crypto::{hex, mac, open, pad, padded_len, seal, OVERHEAD};
use crate::error::{Result, SyncError};
use crate::local;
use crate::manifest::{self, Head, Manifest};
use crate::vault;

/// How often a device lists storage to check that the chunks of its own files are still there: once a day.
pub const CHECK_MS: i64 = 24 * 60 * 60 * 1000;
/// The most chunks one round asks for, so a badly broken storage doesn't fill with requests.
const MAX_REQUESTS: usize = 64;

impl Engine {
    /// Accepts the storage as it is after a rollback warning, such as after restoring it from a backup on purpose.
    /// This device then writes a new head, newer than any it wrote before, so the others see its files again.
    pub fn trust_storage(&self) -> Result<()> {
        let mut state = self.state()?;
        let (newest, own) = self.heads()?;
        state.seen = newest.into_iter().filter(|(d, _)| *d != self.device).collect();
        state.vault = vault::status(self.backend.as_ref(), &self.keys)?.generation;
        let generation = super::later(state.generation.max(own.last().copied().unwrap_or(0)), 1)?;
        let mut entries: Manifest = state.files.iter().map(|(p, k)| (p.clone(), k.entry.clone())).collect();
        entries.extend(state.deferred.iter().map(|(p, e)| (p.clone(), e.clone())));
        let head = Head {
            v: 1,
            device: self.device.clone(),
            generation,
            seen: state.seen.clone(),
            at: super::now_ms(),
            entries,
        };
        let name = head_name(&self.device, generation);
        let sealed = seal(
            &self.keys.seal,
            &self.keys.id,
            "head",
            &name,
            &pad(&manifest::encode(&head)?),
        )?;
        self.backend.put(&name, &sealed)?;
        state.generation = generation;
        state.published = digest(&head.entries);
        self.save_state(&state)
    }

    /// Asks, under `m/<chunk id>`, for the chunks this engine found missing, so a device that has them sends them
    /// again. A chunk can go missing after its head was written: a sync tool that never copied one file, a provider
    /// that lost it, or a crash. The device whose files they are sees nothing wrong otherwise.
    pub(super) fn ask_for_missing(&self) -> Result<()> {
        let missing = std::mem::take(&mut *self.missing.lock().unwrap_or_else(std::sync::PoisonError::into_inner));
        for id in missing.iter().take(MAX_REQUESTS) {
            let name = request_name(id);
            if !self.backend.exists(&name)? {
                let note = seal(&self.keys.seal, &self.keys.id, "missing", &name, b"")?;
                self.backend.put(&name, &note)?;
            }
        }
        Ok(())
    }

    /// Sends again the chunks of this device's own files that storage lost: those another device asked for, and,
    /// once every [`CHECK_MS`], any of the newest own head's that a listing of storage doesn't show. A request is
    /// removed once its chunk is back. Returns how many chunks were sent.
    pub fn repair(&self, now: i64) -> Result<usize> {
        let mut state = self.state()?;
        let mut wanted: BTreeSet<String> = BTreeSet::new();
        let mut requests: HashMap<String, String> = HashMap::new();
        for name in self.backend.list("m/")? {
            let Some(id) = name.strip_prefix("m/").filter(|id| manifest::is_id(id)) else {
                continue;
            };
            let genuine = self
                .backend
                .get(&name)?
                .is_some_and(|sealed| open(&self.keys.seal, &self.keys.id, "missing", &name, &sealed).is_some());
            if genuine {
                wanted.insert(id.to_owned());
                requests.insert(id.to_owned(), name);
            }
        }
        // Where this device holds each chunk: a file on disk whose bytes matched the version it knows.
        let mut held: HashMap<&str, (&str, usize)> = HashMap::new();
        for (path, known) in &state.files {
            if known.entry.live() && known.print.is_some() {
                for (index, id) in known.entry.content.chunks.iter().enumerate() {
                    held.entry(id.as_str()).or_insert((path.as_str(), index));
                }
            }
        }
        // Chunks to send even though storage has one under the name: another device found it damaged, or its size
        // is not the size OpenNote writes for it (a half-copied file).
        let mut damaged: BTreeSet<String> = requests.keys().cloned().collect();
        let daily = now - state.checked >= CHECK_MS;
        if daily && state.generation > 0 {
            let stored: HashMap<String, Option<u64>> = match self.backend.sizes("c/")? {
                Some(sizes) => sizes.into_iter().map(|(name, size)| (name, Some(size))).collect(),
                None => self.backend.list("c/")?.into_iter().map(|name| (name, None)).collect(),
            };
            let stored: HashMap<&str, Option<u64>> = stored
                .iter()
                .filter_map(|(name, size)| Some((name.rsplit('/').next()?, *size)))
                .collect();
            // Only what this device's newest head names: other versions it knows may have been collected on purpose.
            match self.read_head(&self.device, state.generation) {
                Ok(head) => {
                    for entry in head.entries.values().filter(|e| e.live()) {
                        for (index, id) in entry.content.chunks.iter().enumerate() {
                            match stored.get(id.as_str()) {
                                None => {
                                    wanted.insert(id.clone());
                                }
                                Some(Some(size)) if *size != sealed_chunk_size(entry.content.size, index) => {
                                    wanted.insert(id.clone());
                                    damaged.insert(id.clone());
                                }
                                Some(_) => {}
                            }
                        }
                    }
                }
                Err(SyncError::Incomplete) => {}
                Err(error) => return Err(error),
            }
        }
        let mut sent = 0;
        let mut buf = Vec::with_capacity(local::CHUNK);
        for id in &wanted {
            let again = damaged.contains(id);
            let mut back = !again && self.backend.exists(&chunk_name(id))?;
            if !back {
                if let Some((path, index)) = held.get(id.as_str()) {
                    // The file may have changed since: send only bytes that still have this chunk's name.
                    if self.read_held(path, *index, &mut buf)? && hex(&mac(self.keys.chunk.as_ref(), &[&buf])) == *id {
                        if again {
                            self.replace_chunk(id, &buf)?;
                            sent += 1;
                        } else {
                            sent += usize::from(self.put_chunk(id, &buf)?);
                        }
                        back = true;
                    }
                }
            }
            // A device that doesn't hold the chunk leaves the request for one that does.
            if let Some(name) = requests.get(id).filter(|_| back) {
                self.backend.delete(name)?;
            }
        }
        if daily {
            state.checked = now;
            self.save_state(&state)?;
        }
        Ok(sent)
    }

    /// Reads chunk `index` of a local file into `buf`. `false` when the file is gone or shorter.
    fn read_held(&self, path: &str, index: usize, buf: &mut Vec<u8>) -> Result<bool> {
        let Ok(mut file) = fs::File::open(local::join(&self.root, path)) else {
            return Ok(false);
        };
        file.seek(SeekFrom::Start((index * local::CHUNK) as u64))
            .map_err(SyncError::local)?;
        Ok(local::read_chunk(&mut file, buf)? > 0)
    }

    /// Removes chunks that nothing refers to, safely across devices: a chunk is first marked, and removed only on a
    /// later run at least [`GC_GRACE_MS`] later, after every device has written a newer head, and if still unused.
    /// Returns how many chunks were removed.
    pub fn collect_garbage(&self, now: i64) -> Result<usize> {
        let mut state = self.state()?;
        let (newest, _) = self.heads()?;
        let listed = vault::status(self.backend.as_ref(), &self.keys)?.devices;
        let mut used: BTreeSet<String> = BTreeSet::new();
        let mut add = |manifest: &Manifest| {
            for entry in manifest.values() {
                used.extend(entry.content.chunks.iter().cloned());
            }
        };
        let mut heads: BTreeMap<String, Head> = BTreeMap::new();
        for (device, generation) in &newest {
            let head = self.read_head(device, *generation)?;
            add(&head.entries);
            heads.insert(device.clone(), head);
        }
        add(&state.deferred);
        for known in state.files.values() {
            used.extend(known.entry.content.chunks.iter().cloned());
        }
        let stored: BTreeSet<String> = self
            .backend
            .list("c/")?
            .into_iter()
            .filter_map(|name| name.rsplit('/').next().map(str::to_owned))
            .collect();
        let unused: BTreeSet<String> = stored.difference(&used).cloned().collect();
        // A request for a chunk no head names any more can't be answered and isn't needed: a device that still
        // wants it asks again.
        for name in self.backend.list("m/")? {
            if name.strip_prefix("m/").is_some_and(|id| !used.contains(id)) {
                self.backend.delete(&name)?;
            }
        }
        let mut removed = BTreeSet::new();
        // Two newer heads of every device, not one: a round that was already under way when the chunks were marked
        // may have found one in storage and still be about to write the head that needs it.
        let ready = state.gc.as_ref().is_some_and(|mark| {
            now - mark.at >= GC_GRACE_MS
                && mark.generations.iter().all(|(device, g)| {
                    super::later(*g, 2).is_ok_and(|after| newest.get(device).is_some_and(|n| *n >= after))
                        || !listed.contains(device)
                        || vault::is_removed(self.backend.as_ref(), &self.keys, device).unwrap_or(false)
                })
        });
        // A head written since this run listed them may need a chunk it found unused: then wait for the next run.
        let ready = ready && self.heads()?.0 == newest;
        if let Some(mark) = state.gc.take_if(|_| ready) {
            for id in mark.chunks.intersection(&unused) {
                self.backend.delete(&chunk_name(id))?;
                removed.insert(id.clone());
            }
            self.prune_tombstones(&mut state, &mark, &heads, &listed);
        }
        // A pruned path that no head names any more can't come back from one, so it needn't be remembered.
        state
            .pruned
            .retain(|path, _| heads.values().any(|head| head.entries.contains_key(path)));
        let left: BTreeSet<String> = unused.difference(&removed).cloned().collect();
        let tombstones: BTreeSet<String> = state
            .files
            .iter()
            .filter(|(_, known)| !known.entry.live())
            .map(|(path, _)| path.clone())
            .collect();
        if state.gc.is_none() && (!left.is_empty() || !tombstones.is_empty()) {
            state.gc = Some(GcMark {
                at: now,
                generations: newest,
                chunks: left,
                tombstones,
                own: state.generation,
            });
        }
        self.save_state(&state)?;
        Ok(removed.len())
    }

    /// Drops the tombstones marked a grace period ago that every other device has taken in: its newest head merged
    /// this device's head from the mark or later, and either holds the delete too or dropped it already. A device
    /// that might still hold the file live, having not seen the delete, keeps the tombstone here. Without this,
    /// every deleted path stays in every head forever.
    fn prune_tombstones(
        &self,
        state: &mut LocalState,
        mark: &GcMark,
        heads: &BTreeMap<String, Head>,
        listed: &BTreeSet<String>,
    ) {
        for path in &mark.tombstones {
            let Some(known) = state.files.get(path).filter(|k| !k.entry.live()) else {
                continue;
            };
            let everyone = heads
                .iter()
                .filter(|(device, _)| **device != self.device && listed.contains(*device))
                .all(|(_, head)| {
                    head.seen.get(&self.device).is_some_and(|g| *g >= mark.own)
                        && head
                            .entries
                            .get(path)
                            .is_none_or(|e| e.deleted && manifest::dominates(&e.vv, &known.entry.vv))
                });
            if everyone {
                let vv = known.entry.vv.clone();
                state.files.remove(path);
                state.deferred.remove(path);
                state.pruned.insert(path.clone(), vv);
            }
        }
    }
}

/// The size in storage of chunk `index` of a file of `size` bytes, as OpenNote seals it.
fn sealed_chunk_size(size: u64, index: usize) -> u64 {
    let start = (index as u64).saturating_mul(local::CHUNK as u64);
    let len = size.saturating_sub(start).min(local::CHUNK as u64);
    (padded_len(len as usize) + OVERHEAD) as u64
}
