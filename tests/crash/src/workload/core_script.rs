//! The core workload's script, drawn from the seed, and the model that replays it: the page as the core should
//! have it after each step. The writer and the verifier both run the model, so they agree on every step.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opennote_core::id::{ClientId, PageId, SectionId};
use opennote_core::model::Page;
use opennote_core::ops::apply::OpsApplier;
use opennote_core::ops::resolve::{resolve, ResolveCtx, TxnRequest};
use opennote_core::ops::undo::UndoStack;
use opennote_core::ops::Txn;
use opennote_core::seams::Applier;
use opennote_core::testing::edits::{arb_edits, to_request, AbstractEdit};
use opennote_core::{Limits, TestClock, Timestamp};
use proptest::strategy::{Strategy, ValueTree};
use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};
use serde::{Deserialize, Serialize};

use crate::rng::Rng;

/// Pages the script edits.
pub const PAGES: usize = 3;
/// Script time between two steps. The writer's clock moves by this much before each step, so the core's
/// timestamps and undo grouping come out the same in the model.
pub const STEP: Duration = Duration::from_millis(10);
/// Steps in one iteration's script. The writer idles after the last one until it is killed.
pub const STEPS: usize = 400;
/// The window or editor the writer edits as.
pub const CLIENT: &str = "crash-1";
/// Undo steps the model keeps, as the core's page sessions do.
pub const UNDO_ENTRIES: usize = 500;

/// The notebook the setup made, which every iteration works on.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    /// The notebook folder.
    pub notebook: PathBuf,
    /// The section of the pages.
    pub section: String,
    /// The pages the script edits.
    pub pages: Vec<String>,
}

impl Manifest {
    /// The manifest's file in the data folder.
    pub fn path(data: &Path) -> PathBuf {
        data.join("crashtest-manifest.json")
    }

    /// Reads the manifest.
    pub fn load(data: &Path) -> Result<Manifest, String> {
        let text = std::fs::read_to_string(Manifest::path(data)).map_err(|e| format!("the manifest: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("the manifest: {e}"))
    }

    /// The section's ID.
    pub fn section_id(&self) -> Result<SectionId, String> {
        SectionId::parse(&self.section).map_err(|e| format!("{e:?}"))
    }

    /// The pages' IDs.
    pub fn page_ids(&self) -> Result<Vec<PageId>, String> {
        self.pages
            .iter()
            .map(|p| PageId::parse(p).map_err(|e| format!("{e:?}")))
            .collect()
    }
}

/// One step of the script.
#[derive(Clone, Debug)]
pub enum Action {
    /// An edit of a page.
    Edit(usize, AbstractEdit),
    /// Undo on a page.
    Undo(usize),
    /// Redo on a page.
    Redo(usize),
    /// Save a page now.
    Save(usize),
    /// A tree change on scratch pages, chosen by a number.
    Tree(u64),
}

/// The script of one iteration.
pub fn script(seed: u64, iteration: u64) -> Result<Vec<Action>, String> {
    let mut rng = Rng::derive(seed, &[iteration, 3]);
    let mut edits: Vec<std::vec::IntoIter<AbstractEdit>> = Vec::new();
    for page in 0..PAGES {
        edits.push(abstract_edits(rng.next() ^ page as u64)?.into_iter());
    }
    let mut actions = Vec::with_capacity(STEPS);
    for _ in 0..STEPS {
        let page = rng.below(PAGES);
        let action = match rng.below(100) {
            0..=79 => match edits.get_mut(page).and_then(Iterator::next) {
                Some(edit) => Action::Edit(page, edit),
                None => Action::Save(page),
            },
            80..=87 => Action::Undo(page),
            88..=91 => Action::Redo(page),
            92..=96 => Action::Save(page),
            _ => Action::Tree(rng.next()),
        };
        actions.push(action);
    }
    Ok(actions)
}

/// Abstract edits from WP3's generator, drawn with a runner seeded from `seed`.
fn abstract_edits(seed: u64) -> Result<Vec<AbstractEdit>, String> {
    let mut bytes = [0u8; 32];
    Rng::new(seed).fill(&mut bytes);
    let rng = TestRng::from_seed(RngAlgorithm::ChaCha, &bytes);
    let mut runner = TestRunner::new_with_rng(Config::default(), rng);
    let tree = arb_edits(STEPS..STEPS + 1)
        .new_tree(&mut runner)
        .map_err(|e| e.to_string())?;
    Ok(tree.current())
}

/// The writer's clock for an iteration: a fixed start, an hour per iteration, so timestamps always grow.
pub fn clock_for(iteration: u64) -> TestClock {
    let start = Timestamp::parse("2026-09-30T14:00:00.000Z").unwrap_or(Timestamp::from_unix_ms(0));
    let hours = i64::try_from(iteration).unwrap_or(0).saturating_mul(3_600_000);
    TestClock::new(Timestamp::from_unix_ms(start.unix_ms().saturating_add(hours)))
}

/// One page as the core should have it: the page, its undo stack, and the client's sequence number.
pub struct Model {
    /// The page.
    pub page: Page,
    undo: UndoStack,
    client_seq: u64,
    /// Transactions applied in this iteration.
    pub steps: Vec<Txn>,
}

impl Model {
    /// A model starting at `page`.
    pub fn new(page: Page) -> Model {
        Model {
            page,
            undo: UndoStack::new(UNDO_ENTRIES),
            client_seq: 0,
            steps: Vec::new(),
        }
    }

    /// The request an edit makes, or `None` when it has no target on this page.
    pub fn request(&mut self, edit: &AbstractEdit, client: &ClientId) -> Option<TxnRequest> {
        let request = to_request(&self.page, edit, client, self.client_seq + 1)?;
        self.client_seq += 1;
        Some(request)
    }

    /// Applies a request as the core does: resolve, apply, and record for undo.
    pub fn apply(&mut self, request: &TxnRequest, clock: &TestClock) -> Result<(), String> {
        let limits = Limits::default();
        let ctx = ResolveCtx {
            clock,
            limits: &limits,
            imported: &|_| None,
        };
        let txn = resolve(&self.page, request, &ctx).map_err(|e| format!("resolve: {e:?}"))?;
        OpsApplier
            .apply(&mut self.page, &txn)
            .map_err(|e| format!("apply: {e:?}"))?;
        self.undo.record(&txn, opennote_core::Clock::monotonic(clock));
        self.steps.push(txn);
        Ok(())
    }

    /// Undoes or redoes as the core does. Returns whether anything changed.
    pub fn undo_or_redo(&mut self, redo: bool, clock: &TestClock, client: &ClientId) -> Result<bool, String> {
        let outcome = if redo {
            self.undo.redo(&mut self.page, &OpsApplier, clock, client)
        } else {
            self.undo.undo(&mut self.page, &OpsApplier, clock, client)
        };
        match outcome.map_err(|e| format!("undo: {e:?}"))? {
            Some(outcome) => {
                self.steps.push(outcome.txn);
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

/// A shared handle to the writer's clock.
pub type SharedClock = Arc<TestClock>;
