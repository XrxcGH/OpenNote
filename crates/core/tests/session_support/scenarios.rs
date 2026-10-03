//! The tree changes of plan 13.4, each crashed before every file system call it makes.
//!
//! After each crash, every page and section must show exactly once, in a tree or in Trash. Every shown page
//! must load and no change may stay pending. Recovering again must change no file.

use std::sync::Arc;

use opennote_core::error::CoreError;
use opennote_core::id::{PageId, SectionId, TrashItemId};
use opennote_core::model::TrashReason;
use opennote_core::session::notebook::{NodePlacement, NodeRef, ParentRef};
use opennote_core::store::notebook_store::NotebookStore;

use super::disk::Disk;
use super::{Census, World};

/// What every scenario starts from.
///
/// Notebook 0 has section A with page `p0`, its subpage `p1`, and page `p2`, which is in Trash as `item`.
/// It also has section B with page `p3`. Notebook 1, when there is one, has section C with page `p4`.
#[derive(Clone, Debug)]
pub struct Facts {
    /// Every section: A, B, then C.
    pub sections: Vec<SectionId>,
    /// Every page, `p0` to `p4`.
    pub pages: Vec<PageId>,
    /// The Trash item that holds `p2`.
    pub item: TrashItemId,
}

impl Facts {
    fn section(&self, i: usize) -> SectionId {
        self.sections.get(i).copied().unwrap_or(SectionId::ZERO)
    }

    fn page(&self, i: usize) -> PageId {
        self.pages.get(i).copied().unwrap_or(PageId::ZERO)
    }
}

/// A tree change to crash.
pub struct Scenario {
    /// Its name, for failure messages.
    pub name: &'static str,
    /// How many notebooks it needs.
    pub notebooks: usize,
    /// The change.
    pub op: fn(&World, &mut [NotebookStore], &Facts) -> Result<(), CoreError>,
    /// Pages that may be gone after it, such as purged ones.
    pub may_go: fn(&Facts) -> Vec<PageId>,
    /// How many new pages and sections it may add.
    pub adds: (u32, u32),
}

fn nothing(_: &Facts) -> Vec<PageId> {
    Vec::new()
}

fn to_section(section: SectionId) -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Section(section),
        before: None,
    }
}

/// Every scenario of plan 13.4 that WP5 owns.
pub fn all() -> Vec<Scenario> {
    let mut all = creations();
    all.extend(page_moves());
    all.extend(notebook_moves());
    all.extend(deletions());
    all.extend(restores());
    all
}

/// Creating pages and sections, and duplicating a page.
fn creations() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "create a section",
            notebooks: 1,
            op: |_, s, _| first(s)?.create_section("Genetics", None, None).map(drop),
            may_go: nothing,
            adds: (0, 1),
        },
        Scenario {
            name: "create a page",
            notebooks: 1,
            op: |_, s, f| {
                first(s)?
                    .create_page(f.section(0), Some(f.page(0)), None, "Mitosis")
                    .map(drop)
            },
            may_go: nothing,
            adds: (1, 0),
        },
        Scenario {
            name: "duplicate a page",
            notebooks: 1,
            op: |_, s, f| first(s)?.duplicate(f.page(3)).map(drop),
            may_go: nothing,
            adds: (1, 0),
        },
    ]
}

/// Moving pages between sections.
fn page_moves() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "move a page between sections",
            notebooks: 1,
            op: |_, s, f| first(s)?.move_node(NodeRef::Page(f.page(0)), &to_section(f.section(1))),
            may_go: nothing,
            adds: (0, 0),
        },
        Scenario {
            name: "move a page whose folder is held open",
            notebooks: 1,
            op: |w, s, f| {
                let store = first(s)?;
                hold_page(w, store, f.page(0));
                store.move_node(NodeRef::Page(f.page(0)), &to_section(f.section(1)))
            },
            may_go: nothing,
            adds: (0, 0),
        },
    ]
}

/// Moving pages and sections to another notebook.
fn notebook_moves() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "move a page to another notebook",
            notebooks: 2,
            op: |_, s, f| match s {
                [source, target, ..] => source
                    .move_page_to(f.page(0), target, &to_section(f.section(2)))
                    .map(drop),
                _ => Err(CoreError::NotFound("a second notebook".into())),
            },
            may_go: nothing,
            adds: (0, 0),
        },
        Scenario {
            name: "move a section to another notebook",
            notebooks: 2,
            op: |_, s, f| match s {
                [source, target, ..] => {
                    let top = NodePlacement {
                        parent: ParentRef::Notebook,
                        before: None,
                    };
                    source
                        .move_section_to(NodeRef::Section(f.section(1)), target, &top)
                        .map(drop)
                }
                _ => Err(CoreError::NotFound("a second notebook".into())),
            },
            may_go: nothing,
            adds: (0, 0),
        },
    ]
}

/// Deleting to Trash.
fn deletions() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "delete a page with a file held open inside",
            notebooks: 1,
            op: |w, s, f| {
                let store = first(s)?;
                hold_page(w, store, f.page(0));
                store
                    .delete(&[NodeRef::Page(f.page(0))], TrashReason::Deleted)
                    .map(drop)
            },
            may_go: nothing,
            adds: (0, 0),
        },
        Scenario {
            name: "delete a section",
            notebooks: 1,
            op: |_, s, f| {
                first(s)?
                    .delete(&[NodeRef::Section(f.section(1))], TrashReason::Deleted)
                    .map(drop)
            },
            may_go: nothing,
            adds: (0, 0),
        },
    ]
}

/// Restoring from Trash, and purging.
fn restores() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "restore from Trash",
            notebooks: 1,
            op: |_, s, f| first(s)?.restore(f.item, None).map(drop),
            may_go: nothing,
            adds: (0, 0),
        },
        Scenario {
            name: "restore from Trash with a file held open inside",
            notebooks: 1,
            op: |w, s, f| {
                let store = first(s)?;
                w.disk.hold(&store.layout.trash_item_dir(f.item));
                store.restore(f.item, None).map(drop)
            },
            may_go: nothing,
            adds: (0, 0),
        },
        Scenario {
            name: "purge from Trash",
            notebooks: 1,
            op: |_, s, f| first(s)?.purge(f.item),
            may_go: |f| vec![f.page(2)],
            adds: (0, 0),
        },
    ]
}

fn first(stores: &mut [NotebookStore]) -> Result<&mut NotebookStore, CoreError> {
    stores
        .first_mut()
        .ok_or_else(|| CoreError::NotFound("a notebook".into()))
}

fn hold_page(world: &World, store: &NotebookStore, page: PageId) {
    if let Some(dir) = store.page_dir(page) {
        world.disk.hold(&dir);
    }
}

/// Builds the notebooks every scenario starts from.
fn prepare(scenario: &Scenario, disk: Arc<dyn Disk>) -> Result<(World, Vec<NotebookStore>, Facts), String> {
    let world = World::new(disk, scenario.notebooks).map_err(|e| format!("setup: {e}"))?;
    let mut stores = world.open().map_err(|e| format!("setup: {e}"))?;
    let facts = build(&mut stores).map_err(|e| format!("setup: {e}"))?;
    Ok((world, stores, facts))
}

fn build(stores: &mut [NotebookStore]) -> Result<Facts, CoreError> {
    let mut sections = Vec::new();
    let mut pages = Vec::new();
    let item = {
        let store = first(stores)?;
        let a = store.create_section("Cells", None, None)?;
        let b = store.create_section("Plants", None, None)?;
        let p0 = store.create_page(a, None, None, "Membranes")?;
        let p1 = store.create_page(a, Some(p0), None, "Channels")?;
        let p2 = store.create_page(a, None, None, "Old notes")?;
        let p3 = store.create_page(b, None, None, "Leaves")?;
        let items = store.delete(&[NodeRef::Page(p2)], TrashReason::Deleted)?;
        sections.extend([a, b]);
        pages.extend([p0, p1, p2, p3]);
        items.first().copied().unwrap_or(TrashItemId::ZERO)
    };
    if let Some(store) = stores.get_mut(1) {
        let c = store.create_section("Acids", None, None)?;
        pages.push(store.create_page(c, None, None, "Buffers")?);
        sections.push(c);
    }
    Ok(Facts { sections, pages, item })
}

/// How a crash point went.
pub struct Outcome {
    /// How many file system calls the change makes without a crash.
    pub calls: u64,
}

/// Runs a scenario once without a crash to count its calls, then once crashed before each call. Returns how
/// many calls the change makes.
pub fn crash_everywhere(scenario: &Scenario, disk: &dyn Fn() -> Arc<dyn Disk>) -> Result<Outcome, String> {
    let calls = count_calls(scenario, disk())?;
    for n in 0..=calls {
        crash_at(scenario, disk(), n).map_err(|e| format!("{}, crash before call {n}: {e}", scenario.name))?;
    }
    Ok(Outcome { calls })
}

/// Runs a scenario once without a crash, and returns how many file system calls the change makes.
pub fn count_calls(scenario: &Scenario, disk: Arc<dyn Disk>) -> Result<u64, String> {
    let (world, mut stores, facts) = prepare(scenario, disk)?;
    let start = world.disk.calls();
    (scenario.op)(&world, &mut stores, &facts).map_err(|e| format!("{} fails without a crash: {e}", scenario.name))?;
    Ok(world.disk.calls().saturating_sub(start))
}

/// Crashes the change before its call number `n`, recovers, and checks the result.
pub fn crash_at(scenario: &Scenario, disk: Arc<dyn Disk>, n: u64) -> Result<(), String> {
    let (world, mut stores, facts) = prepare(scenario, disk)?;
    world.disk.crash_at(world.disk.calls().saturating_add(n));
    let _ = (scenario.op)(&world, &mut stores, &facts);
    drop(stores);
    recover_and_check(scenario, &world.reboot(), &facts)
}

/// Crashes the change before its call `n`, then crashes recovery itself before each of its calls, and checks
/// that the recovery after that still holds. This is how rolling tree intents forward is tested.
pub fn crash_recovery(scenario: &Scenario, disk: &dyn Fn() -> Arc<dyn Disk>, n: u64) -> Result<u64, String> {
    let (world, mut stores, facts) = prepare(scenario, disk())?;
    world.disk.crash_at(world.disk.calls().saturating_add(n));
    let _ = (scenario.op)(&world, &mut stores, &facts);
    drop(stores);
    let crashed = world.reboot();
    let start = crashed.disk.calls();
    let _ = crashed.recover();
    let calls = crashed.disk.calls().saturating_sub(start);
    for m in 0..calls {
        let (world, mut stores, facts) = prepare(scenario, disk())?;
        world.disk.crash_at(world.disk.calls().saturating_add(n));
        let _ = (scenario.op)(&world, &mut stores, &facts);
        drop(stores);
        let first = world.reboot();
        first.disk.crash_at(first.disk.calls().saturating_add(m));
        let _ = first.recover();
        recover_and_check(scenario, &first.reboot(), &facts).map_err(|e| {
            format!(
                "{}, crash before call {n}, recovery crash before {m}: {e}",
                scenario.name
            )
        })?;
    }
    Ok(calls)
}

fn recover_and_check(scenario: &Scenario, world: &World, facts: &Facts) -> Result<(), String> {
    let stores = world.recover().map_err(|e| format!("recovery failed: {e}"))?;
    let census = Census::take(&stores);
    if let Some(problem) = census.problems.first() {
        return Err(problem.clone());
    }
    let may_go = (scenario.may_go)(facts);
    let once: Vec<PageId> = facts.pages.iter().copied().filter(|p| !may_go.contains(p)).collect();
    census.check_pages(&once, &may_go, scenario.adds.0)?;
    census.check_sections(&facts.sections, &[], scenario.adds.1)?;
    drop(stores);
    let before = world.snapshot();
    world.recover().map_err(|e| format!("a second recovery failed: {e}"))?;
    if world.snapshot() != before {
        return Err("a second recovery changed files".into());
    }
    Ok(())
}
