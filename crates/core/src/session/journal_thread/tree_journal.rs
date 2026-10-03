//! The handle of a notebook's tree journal: intents, their steps, and their end (spec 18.2 and 20.7).

use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use super::worker::Command;
use super::{TreeIntent, TreeJournal};
use crate::error::JournalError;
use crate::id::IntentId;
use crate::store::journal::encode;
use crate::store::journal::reader::JournalRecord;

/// How long a tree intent waits for its flush.
const INTENT_TIMEOUT: Duration = Duration::from_secs(5);

impl TreeJournal {
    /// Records an intent and flushes it before returning.
    pub fn begin(&self, intent: &TreeIntent) -> Result<(), JournalError> {
        self.shared.intents().insert(intent.id, intent.clone());
        let (reply, answer) = mpsc::channel();
        self.send_record(
            |seq| JournalRecord::TreeIntent {
                seq,
                intent: intent.clone(),
            },
            false,
            Some(reply),
        )?;
        let result = answer.recv_timeout(INTENT_TIMEOUT).map_err(|_| JournalError::Timeout)?;
        if result.is_err() {
            self.shared.intents().remove(&intent.id);
        }
        result
    }

    /// Records that the intent's first `step` steps are done.
    pub fn step_done(&self, intent: IntentId, step: u8) {
        let updated = self.shared.intents().get_mut(&intent).map(|found| {
            found.steps_done = found.steps_done.max(step);
            found.clone()
        });
        if let Some(updated) = updated {
            let _ = self.send_record(|seq| JournalRecord::TreeIntent { seq, intent: updated }, false, None);
        }
    }

    /// Records that an intent is done.
    pub fn done(&self, intent: IntentId) {
        self.shared.intents().remove(&intent);
        let _ = self.send_record(|seq| JournalRecord::TreeDone { seq, intent }, true, None);
    }

    /// Intents without a done record, to roll forward.
    pub fn unfinished(&self) -> Vec<TreeIntent> {
        self.shared.unfinished()
    }

    fn send_record(
        &self,
        record: impl FnOnce(u64) -> JournalRecord,
        done: bool,
        reply: Option<Sender<Result<(), JournalError>>>,
    ) -> Result<(), JournalError> {
        let mut seq = self.shared.seq();
        *seq = seq.saturating_add(1);
        let command = Command::TreeAppend {
            key: self.key.clone(),
            seq: *seq,
            bytes: encode(&record(*seq), &*self.codec),
            done,
            reply,
        };
        self.commands.send(command).map_err(|_| JournalError::Closed)
    }
}
