//! Recovery and housekeeping: trusting storage after a rollback warning, and garbage collection that is safe
//! across devices (ADR 0049, "Safety").

use std::collections::BTreeSet;

use super::{chunk_name, digest, head_name, Engine, GcMark, GC_GRACE_MS};
use crate::crypto::{pad, seal};
use crate::error::Result;
use crate::manifest::{self, Head, Manifest};
use crate::vault;

impl Engine {
    /// Accepts the storage as it is after a rollback warning, such as after restoring it from a backup on purpose.
    /// This device then writes a new head, newer than any it wrote before, so the others see its files again.
    pub fn trust_storage(&self) -> Result<()> {
        let mut state = self.state()?;
        let (newest, own) = self.heads()?;
        state.seen = newest.into_iter().filter(|(d, _)| *d != self.device).collect();
        let generation = state.generation.max(own.last().copied().unwrap_or(0)) + 1;
        let mut entries: Manifest = state.files.iter().map(|(p, k)| (p.clone(), k.entry.clone())).collect();
        entries.extend(state.deferred.iter().map(|(p, e)| (p.clone(), e.clone())));
        let head = Head {
            v: 1,
            device: self.device.clone(),
            generation,
            seen: state.seen.clone(),
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

    /// Removes chunks that nothing refers to, safely across devices: a chunk is first marked, and removed only on a
    /// later run at least [`GC_GRACE_MS`] later, after every device has written a newer head, and if still unused.
    /// Returns how many chunks were removed.
    pub fn collect_garbage(&self, now: i64) -> Result<usize> {
        let mut state = self.state()?;
        let (newest, _) = self.heads()?;
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
        let ready = state.gc.as_ref().is_some_and(|mark| {
            now - mark.at >= GC_GRACE_MS
                && mark.generations.iter().all(|(device, g)| {
                    newest.get(device).is_some_and(|n| n > g)
                        || vault::is_removed(self.backend.as_ref(), &self.keys, device).unwrap_or(false)
                })
        });
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
