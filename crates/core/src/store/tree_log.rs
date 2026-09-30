//! Rolling unfinished tree intents forward after a crash (spec 18.2). Owned by WP5.
//!
//! Tree code records intents through [`IntentLog`], which the journal's [`TreeJournal`] implements. Every step
//! of every tree change can safely run twice, so rolling forward runs the steps an intent didn't finish.
//! Changes also leave portable marks in the notebook, so the scan heals what no journal describes, such as a
//! change another device started.

use std::sync::{Arc, Mutex, PoisonError};

use crate::error::{CoreError, JournalError};
use crate::id::IntentId;
use crate::session::journal_thread::{TreeIntent, TreeJournal, TreeOp};

/// The steps of each tree change. Every step can safely run twice.
pub trait TreeSteps {
    /// How many steps the change has.
    fn steps(&self, op: &TreeOp) -> u8;
    /// Runs one step.
    fn run_step(&self, intent: &TreeIntent, step: u8) -> Result<(), CoreError>;
}

/// Where tree intents are recorded: a notebook's tree journal, or a log in memory for tests and for
/// notebooks opened without a journal.
pub trait IntentLog: Send + Sync {
    /// Records an intent and makes it durable before returning.
    fn begin(&self, intent: &TreeIntent) -> Result<(), JournalError>;
    /// Records that a step of an intent is done.
    fn step_done(&self, intent: IntentId, step: u8);
    /// Records that an intent is done.
    fn done(&self, intent: IntentId);
    /// Intents without a done record, oldest first.
    fn unfinished(&self) -> Vec<TreeIntent>;
}

impl IntentLog for TreeJournal {
    fn begin(&self, intent: &TreeIntent) -> Result<(), JournalError> {
        TreeJournal::begin(self, intent)
    }

    fn step_done(&self, intent: IntentId, step: u8) {
        TreeJournal::step_done(self, intent, step);
    }

    fn done(&self, intent: IntentId) {
        TreeJournal::done(self, intent);
    }

    fn unfinished(&self) -> Vec<TreeIntent> {
        TreeJournal::unfinished(self)
    }
}

/// An intent log in memory. Clones share the log, so a test can hand the same log to the notebook after a
/// simulated crash, as a durable journal would survive it.
#[derive(Clone, Debug, Default)]
pub struct MemIntentLog {
    intents: Arc<Mutex<Vec<TreeIntent>>>,
}

impl MemIntentLog {
    /// An empty log.
    pub fn new() -> MemIntentLog {
        MemIntentLog::default()
    }
}

impl IntentLog for MemIntentLog {
    fn begin(&self, intent: &TreeIntent) -> Result<(), JournalError> {
        let mut intents = self.intents.lock().unwrap_or_else(PoisonError::into_inner);
        intents.retain(|i| i.id != intent.id);
        intents.push(intent.clone());
        Ok(())
    }

    fn step_done(&self, intent: IntentId, step: u8) {
        let mut intents = self.intents.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(found) = intents.iter_mut().find(|i| i.id == intent) {
            found.steps_done = found.steps_done.max(step);
        }
    }

    fn done(&self, intent: IntentId) {
        let mut intents = self.intents.lock().unwrap_or_else(PoisonError::into_inner);
        intents.retain(|i| i.id != intent);
    }

    fn unfinished(&self) -> Vec<TreeIntent> {
        self.intents.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

/// Runs the remaining steps of every unfinished intent. Returns how many intents it finished.
pub fn roll_forward(journal: &TreeJournal, steps: &dyn TreeSteps) -> Result<u32, CoreError> {
    roll_forward_log(journal, steps)
}

/// [`roll_forward`] over any intent log.
///
/// Each intent resumes after its last done step. An intent whose step fails stays unfinished, so the next
/// start tries it again, and rolling forward goes on with the other intents. The first error is returned
/// after every intent had its turn.
pub fn roll_forward_log(log: &dyn IntentLog, steps: &dyn TreeSteps) -> Result<u32, CoreError> {
    let mut finished: u32 = 0;
    let mut first_error = None;
    for intent in log.unfinished() {
        match run_remaining(log, steps, &intent) {
            Ok(()) => {
                log.done(intent.id);
                finished = finished.saturating_add(1);
            }
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    match first_error {
        Some(e) => Err(e),
        None => Ok(finished),
    }
}

fn run_remaining(log: &dyn IntentLog, steps: &dyn TreeSteps, intent: &TreeIntent) -> Result<(), CoreError> {
    let total = steps.steps(&intent.op);
    let mut step = intent.steps_done.saturating_add(1);
    while step <= total {
        steps.run_step(intent, step)?;
        log.step_done(intent.id, step);
        step = step.saturating_add(1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use std::cell::RefCell;

    use super::*;
    use crate::id::{Id, SectionId, TrashItemId};

    struct Recorder {
        ran: RefCell<Vec<(IntentId, u8)>>,
        fail_on: Option<u8>,
    }

    impl TreeSteps for Recorder {
        fn steps(&self, op: &TreeOp) -> u8 {
            match op {
                TreeOp::CreateSection { .. } => 2,
                _ => 3,
            }
        }

        fn run_step(&self, intent: &TreeIntent, step: u8) -> Result<(), CoreError> {
            if self.fail_on == Some(step) {
                return Err(CoreError::NotFound("step".into()));
            }
            self.ran.borrow_mut().push((intent.id, step));
            Ok(())
        }
    }

    fn intent(n: u64, op: TreeOp) -> TreeIntent {
        TreeIntent {
            id: IntentId(Id::from_parts(n, u128::from(n))),
            op,
            steps_done: 0,
        }
    }

    #[test]
    fn resumes_each_intent_after_its_last_done_step() {
        let log = MemIntentLog::new();
        let a = intent(
            1,
            TreeOp::CreateSection {
                section: SectionId::ZERO,
            },
        );
        let b = intent(
            2,
            TreeOp::Purge {
                item: TrashItemId::ZERO,
            },
        );
        log.begin(&a).unwrap();
        log.begin(&b).unwrap();
        log.step_done(b.id, 2);
        let recorder = Recorder {
            ran: RefCell::new(Vec::new()),
            fail_on: None,
        };
        assert_eq!(roll_forward_log(&log, &recorder).unwrap(), 2);
        assert_eq!(*recorder.ran.borrow(), vec![(a.id, 1), (a.id, 2), (b.id, 3)]);
        assert!(log.unfinished().is_empty());
        assert_eq!(roll_forward_log(&log, &recorder).unwrap(), 0);
    }

    #[test]
    fn a_failing_step_leaves_its_intent_for_next_time() {
        let log = MemIntentLog::new();
        let a = intent(
            1,
            TreeOp::Purge {
                item: TrashItemId::ZERO,
            },
        );
        log.begin(&a).unwrap();
        let recorder = Recorder {
            ran: RefCell::new(Vec::new()),
            fail_on: Some(2),
        };
        assert!(roll_forward_log(&log, &recorder).is_err());
        let left = log.unfinished();
        assert_eq!(left.len(), 1);
        assert_eq!(left.first().map(|i| i.steps_done), Some(1));
    }
}
