//! Steps 2 to 6 of a round: stage, upload, publish, move into place, and save (see the module above).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::Path;

use super::{head_name, Action, Engine, Known, LocalState, Plan, Report};
use crate::crypto::{hex, mac, pad, seal};
use crate::error::{Result, SyncError};
use crate::local::{self, Fingerprint, Staged};
use crate::manifest::{self, Content, Head, Manifest};

fn discard_all(staged: &mut HashMap<String, Staged>) {
    for (_, file) in staged.drain() {
        file.discard();
    }
}

/// What moving files into place left: the paths now on disk, those deferred, and the error that stopped it.
struct Moved {
    files: BTreeMap<String, Known>,
    deferred: Manifest,
    failure: Option<SyncError>,
}

impl Engine {
    /// Plans and carries out a round.
    pub fn sync(&self) -> Result<Report> {
        let plan = self.plan()?;
        self.apply(plan)
    }

    /// Carries out a plan.
    pub fn apply(&self, plan: Plan) -> Result<Report> {
        let mut state = self.state()?;
        let mut staged: HashMap<String, Staged> = HashMap::new();
        // Steps 2 to 4: nothing is published until every download is staged and every chunk is up.
        let prepared = self
            .stage_all(&plan, &mut staged)
            .and_then(|()| self.upload_all(&plan))
            .and_then(|(sent, reused)| {
                let generation = self.publish(&plan, &state)?;
                // A chunk this round found already in storage may have been removed by another device's garbage
                // collection before the head that needs it was written. Once the head is there, no collection
                // removes it, so checking now and sending what went missing closes that gap.
                let mut resent = 0;
                if plan.publish && self.any_missing(&reused)? {
                    resent = self.upload_all(&plan)?.0;
                }
                Ok((sent + resent, generation))
            });
        let (chunks_sent, generation) = match prepared {
            Ok(done) => done,
            Err(error) => {
                discard_all(&mut staged);
                return Err(error);
            }
        };
        let mut report = Report {
            summary: plan.summary.clone(),
            chunks_sent,
            generation: plan.publish.then_some(generation),
            ..Report::default()
        };
        // Steps 5 and 6.
        let moved = self.move_into_place(&plan, &mut staged, &mut report);
        if let Some(error) = self.save_round(&plan, &mut state, moved, generation)? {
            return Err(error);
        }
        if plan.publish {
            self.prune_heads(generation);
        }
        Ok(report)
    }

    /// Writes the new head, if the plan has one. Returns the generation this device is at.
    fn publish(&self, plan: &Plan, state: &LocalState) -> Result<u64> {
        let generation = state.generation.max(plan.own_max);
        if !plan.publish {
            return Ok(generation);
        }
        let generation = generation + 1;
        let head = Head {
            v: 1,
            device: self.device.clone(),
            generation,
            seen: plan.seen.clone(),
            at: super::now_ms(),
            entries: plan.merged.clone(),
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
        Ok(generation)
    }

    /// Moves staged files into place, each only if its target still holds what the plan saw.
    fn move_into_place(&self, plan: &Plan, staged: &mut HashMap<String, Staged>, report: &mut Report) -> Moved {
        let mut moved = Moved {
            files: BTreeMap::new(),
            deferred: Manifest::new(),
            failure: None,
        };
        for action in &plan.actions {
            let path = action.path().to_owned();
            if moved.failure.is_some() {
                if let Some(file) = staged.remove(&path) {
                    file.discard();
                }
                continue;
            }
            match self.carry_out(action, plan, staged.remove(&path)) {
                Ok(Some(print)) => {
                    let entry = plan.merged[&path].clone();
                    moved.files.insert(path, Known { entry, print });
                }
                Ok(None) => {
                    moved.deferred.insert(path.clone(), plan.merged[&path].clone());
                    report.deferred.push(path);
                }
                Err(error) => moved.failure = Some(error),
            }
        }
        moved
    }

    /// Saves the state. A path whose disk already agrees takes the merged version; one that couldn't be written
    /// keeps the local version, and its merged version waits as deferred for the next round.
    fn save_round(
        &self,
        plan: &Plan,
        state: &mut LocalState,
        moved: Moved,
        generation: u64,
    ) -> Result<Option<SyncError>> {
        let Moved {
            mut files,
            mut deferred,
            failure,
        } = moved;
        let acted: BTreeSet<&str> = plan.actions.iter().map(Action::path).collect();
        for (path, entry) in &plan.merged {
            if files.contains_key(path) || deferred.contains_key(path) {
                continue;
            }
            let agrees = !acted.contains(path.as_str()) && (entry.deleted || plan.prints.contains_key(path));
            if agrees {
                let print = plan.prints.get(path).copied().filter(|_| entry.live());
                files.insert(
                    path.clone(),
                    Known {
                        entry: entry.clone(),
                        print,
                    },
                );
                continue;
            }
            if let Some(local_entry) = plan.local.get(path) {
                let print = plan.prints.get(path).copied();
                files.insert(
                    path.clone(),
                    Known {
                        entry: local_entry.clone(),
                        print,
                    },
                );
            }
            deferred.insert(path.clone(), entry.clone());
        }
        state.files = files;
        state.deferred = deferred;
        state.generation = generation;
        state.seen = plan.seen.clone();
        state.vault = state.vault.max(plan.vault);
        if plan.publish {
            state.published = super::digest(&plan.merged);
        }
        self.save_state(state)?;
        Ok(failure)
    }

    /// Removes older heads of this device; the one before the newest stays for slow readers.
    fn prune_heads(&self, generation: u64) {
        if let Ok((_, own)) = self.heads() {
            for old in own.into_iter().filter(|g| *g + 1 < generation) {
                let _ = self.backend.delete(&head_name(&self.device, old));
            }
        }
    }

    fn stage_all(&self, plan: &Plan, staged: &mut HashMap<String, Staged>) -> Result<()> {
        let local_by_id: HashMap<&str, &str> = plan
            .local
            .iter()
            .filter(|(_, e)| e.live())
            .map(|(p, e)| (e.content.id.as_str(), p.as_str()))
            .collect();
        for action in &plan.actions {
            let Action::Write { path, content, .. } = action else {
                continue;
            };
            self.point()?;
            let (dir, _) = path.rsplit_once('/').unwrap_or(("", path));
            let dir = match local::safe_dir(&self.root, dir) {
                Ok(dir) => dir,
                Err(_) => continue,
            };
            let mut file = Staged::new(&dir)?;
            let filled = self.fill(&mut file, content, plan, &local_by_id);
            match filled.and_then(|()| file.finish()) {
                Ok(()) => {
                    staged.insert(path.clone(), file);
                }
                Err(error) => {
                    file.discard();
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    fn fill(&self, file: &mut Staged, content: &Content, plan: &Plan, local_by_id: &HashMap<&str, &str>) -> Result<()> {
        if let Some(bytes) = plan.pending.get(&content.id) {
            return file.write(bytes);
        }
        if let Some(rel) = local_by_id.get(content.id.as_str()) {
            if self.copy_local(file, rel, content)? {
                return Ok(());
            }
            file.rewind()?;
        }
        let mut hasher = local::Hasher::new(&self.keys.chunk, &self.keys.content);
        for id in &content.chunks {
            let bytes = self.fetch_chunk(id)?;
            hasher.chunk(&bytes);
            file.write(&bytes)?;
        }
        if hasher.finish() != *content {
            return Err(SyncError::Tampered("A file's pieces don't add up.".into()));
        }
        Ok(())
    }

    /// Copies a local file that has the same content (a moved or renamed asset) into the staged file one chunk at
    /// a time, so memory stays bounded however large it is. `false` if it changed or went away meanwhile.
    fn copy_local(&self, file: &mut Staged, rel: &str, content: &Content) -> Result<bool> {
        let Ok(mut source) = fs::File::open(local::join(&self.root, rel)) else {
            return Ok(false);
        };
        let mut buf = Vec::with_capacity(local::CHUNK);
        let mut hasher = local::Hasher::new(&self.keys.chunk, &self.keys.content);
        let mut size = 0u64;
        while local::read_chunk(&mut source, &mut buf)? > 0 {
            size += buf.len() as u64;
            if size > content.size {
                return Ok(false);
            }
            hasher.chunk(&buf);
            file.write(&buf)?;
        }
        Ok(hasher.finish() == *content)
    }

    fn any_missing(&self, ids: &[String]) -> Result<bool> {
        for id in ids {
            if !self.backend.exists(&super::chunk_name(id))? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Sends the chunks storage lacks. Returns how many it sent, and the ones storage already had.
    fn upload_all(&self, plan: &Plan) -> Result<(usize, Vec<String>)> {
        let mut sent = 0;
        let mut reused = Vec::new();
        let mut buf = Vec::with_capacity(local::CHUNK);
        for path in &plan.uploads {
            let entry = &plan.local[path];
            let mut file = fs::File::open(local::join(&self.root, path)).map_err(SyncError::local)?;
            let mut hasher = local::Hasher::new(&self.keys.chunk, &self.keys.content);
            while local::read_chunk(&mut file, &mut buf)? > 0 {
                let id = hasher.chunk(&buf);
                if !entry.content.chunks.contains(&id) {
                    // The file changed since the scan: try again next round with what is there then.
                    return Err(SyncError::Interrupted);
                }
                if self.put_chunk(&id, &buf)? {
                    sent += 1;
                } else {
                    reused.push(id);
                }
            }
            if hasher.finish() != entry.content {
                return Err(SyncError::Interrupted);
            }
        }
        for bytes in plan.pending.values() {
            for part in bytes.chunks(local::CHUNK) {
                let id = hex(&mac(self.keys.chunk.as_ref(), &[part]));
                if self.put_chunk(&id, part)? {
                    sent += 1;
                } else {
                    reused.push(id);
                }
            }
        }
        Ok((sent, reused))
    }

    /// Moves a staged file into place or deletes one. `None` when the local file changed since the plan.
    fn carry_out(&self, action: &Action, plan: &Plan, staged: Option<Staged>) -> Result<Option<Option<Fingerprint>>> {
        let path = action.path();
        let target = local::join(&self.root, path);
        let expect = match action {
            Action::Write { expect, .. } => expect.clone(),
            Action::Delete { expect, .. } => Some(expect.clone()),
        };
        if !self.still(&target, path, expect.as_deref(), plan) {
            if let Some(file) = staged {
                file.discard();
            }
            return Ok(None);
        }
        if let Err(error) = self.point() {
            if let Some(file) = staged {
                file.discard();
            }
            return Err(error);
        }
        match action {
            Action::Write { .. } => {
                let Some(file) = staged else { return Ok(None) };
                if let Err(error) = fs::rename(&file.path, &target) {
                    file.discard();
                    return match error.kind() {
                        std::io::ErrorKind::PermissionDenied => Ok(None),
                        _ => Err(SyncError::local(error)),
                    };
                }
                Ok(Some(local::fingerprint(&target)))
            }
            Action::Delete { .. } => {
                match fs::remove_file(&target) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return Ok(None),
                    Err(error) => return Err(SyncError::local(error)),
                }
                local::prune_dirs(&self.root, path.rsplit_once('/').map(|(d, _)| d).unwrap_or(""));
                Ok(Some(None))
            }
        }
    }

    /// Whether the file at `target` still holds `expect` (or is absent, for `None`).
    fn still(&self, target: &Path, path: &str, expect: Option<&str>, plan: &Plan) -> bool {
        let now = local::fingerprint(target);
        match (expect, now) {
            (None, None) => true,
            (None, Some(_)) | (Some(_), None) => false,
            (Some(id), Some(print)) => {
                if plan.prints.get(path) == Some(&print) {
                    return true;
                }
                local::hash_file(target, &self.keys.chunk, &self.keys.content)
                    .map(|c| c.id == id)
                    .unwrap_or(false)
            }
        }
    }
}
