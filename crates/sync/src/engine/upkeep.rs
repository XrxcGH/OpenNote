//! Recovery and housekeeping: trusting storage after a rollback warning, and garbage collection that is safe
//! across devices (ADR 0049, "Safety").

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{Seek, SeekFrom};

use super::{chunk_name, digest, head_name, request_name, Engine, GcMark, GC_GRACE_MS};
use crate::crypto::{hex, mac, open, pad, seal};
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
        let generation = state.generation.max(own.last().copied().unwrap_or(0)) + 1;
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
        let daily = now - state.checked >= CHECK_MS;
        if daily && state.generation > 0 {
            let stored: BTreeSet<String> = self
                .backend
                .list("c/")?
                .into_iter()
                .filter_map(|name| name.rsplit('/').next().map(str::to_owned))
                .collect();
            // Only what this device's newest head names: other versions it knows may have been collected on purpose.
            match self.read_head(&self.device, state.generation) {
                Ok(head) => {
                    for entry in head.entries.values().filter(|e| e.live()) {
                        let lost = entry.content.chunks.iter().filter(|id| !stored.contains(*id));
                        wanted.extend(lost.cloned());
                    }
                }
                Err(SyncError::Incomplete) => {}
                Err(error) => return Err(error),
            }
        }
        let mut sent = 0;
        let mut buf = Vec::with_capacity(local::CHUNK);
        for id in &wanted {
            let mut back = self.backend.exists(&chunk_name(id))?;
            if !back {
                if let Some((path, index)) = held.get(id.as_str()) {
                    // The file may have changed since: send only bytes that still have this chunk's name.
                    if self.read_held(path, *index, &mut buf)? && hex(&mac(self.keys.chunk.as_ref(), &[&buf])) == *id {
                        sent += usize::from(self.put_chunk(id, &buf)?);
                        back = true;
                    }
                }
            }
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
        for (device, generation) in &newest {
            add(&self.read_head(device, *generation)?.entries);
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
        let mut removed = BTreeSet::new();
        // Two newer heads of every device, not one: a round that was already under way when the chunks were marked
        // may have found one in storage and still be about to write the head that needs it.
        let ready = state.gc.as_ref().is_some_and(|mark| {
            now - mark.at >= GC_GRACE_MS
                && mark.generations.iter().all(|(device, g)| {
                    newest.get(device).is_some_and(|n| *n >= g + 2)
                        || !listed.contains(device)
                        || vault::is_removed(self.backend.as_ref(), &self.keys, device).unwrap_or(false)
                })
        });
        // A head written since this run listed them may need a chunk it found unused: then wait for the next run.
        let ready = ready && self.heads()?.0 == newest;
        if ready {
            let mark = state.gc.take().expect("ready");
            for id in mark.chunks.intersection(&unused) {
                self.backend.delete(&chunk_name(id))?;
                removed.insert(id.clone());
            }
        }
        let left: BTreeSet<String> = unused.difference(&removed).cloned().collect();
        if state.gc.is_none() && !left.is_empty() {
            state.gc = Some(GcMark {
                at: now,
                generations: newest,
                chunks: left,
            });
        }
        self.save_state(&state)?;
        Ok(removed.len())
    }
}
