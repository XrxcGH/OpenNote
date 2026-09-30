//! Rolling unfinished tree intents forward after a crash (spec 18.2). Owned by WP5.

use crate::error::CoreError;
use crate::session::journal_thread::{TreeIntent, TreeJournal, TreeOp};

/// The steps of each tree change. Every step can safely run twice.
pub trait TreeSteps {
    /// How many steps the change has.
    fn steps(&self, op: &TreeOp) -> u8;
    /// Runs one step.
    fn run_step(&self, intent: &TreeIntent, step: u8) -> Result<(), CoreError>;
}

/// Runs the remaining steps of every unfinished intent. Returns how many intents it finished.
pub fn roll_forward(_journal: &TreeJournal, _steps: &dyn TreeSteps) -> Result<u32, CoreError> {
    unimplemented!("WP5: roll_forward")
}
