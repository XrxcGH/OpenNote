use super::*;

fn intent(n: u64) -> TreeIntent {
    TreeIntent {
        id: IntentId(Id::from_parts(1_790_000_000_000 + n, 5)),
        op: TreeOp::CreatePage {
            section: SectionId(Id::from_parts(1_790_000_000_000, 6)),
            page: PageId(Id::from_parts(1_790_000_000_000 + n, 7)),
        },
        steps_done: 0,
    }
}

fn tree_path(n: u64) -> PathBuf {
    PathBuf::from("/data/journal")
        .join(key().0)
        .join(journal_file_name(None, n))
}

#[test]
fn intents_are_flushed_and_unfinished_ones_survive_a_restart() {
    let s = setup(fast());
    let tree = s.thread.open_tree(&key(), meta("boot-1")).unwrap();
    assert!(tree.unfinished().is_empty());
    tree.begin(&intent(1)).unwrap();
    assert!(s.fs.inner.exists(&tree_path(1)));
    tree.begin(&intent(2)).unwrap();
    tree.step_done(intent(1).id, 2);
    tree.step_done(intent(1).id, 1);
    tree.done(intent(2).id);
    assert_eq!(tree.unfinished().len(), 1);
    s.thread.flush_all(WAIT).unwrap();
    let restarted = setup(fast());
    for path in s.fs.inner.files() {
        restarted.fs.inner.put(&path, &s.fs.inner.get(&path).unwrap());
    }
    let reopened = restarted.thread.open_tree(&key(), meta("boot-2")).unwrap();
    let unfinished = reopened.unfinished();
    assert_eq!(unfinished.len(), 1);
    assert_eq!(unfinished[0].id, intent(1).id);
    assert_eq!(unfinished[0].steps_done, 2, "steps never go back");
    let again = restarted.thread.open_tree(&key(), meta("boot-2")).unwrap();
    assert_eq!(again.unfinished().len(), 1, "a second handle shares the state");
    reopened.done(intent(1).id);
    restarted.thread.flush_all(WAIT).unwrap();
    assert!(
        !restarted.fs.inner.exists(&tree_path(1)),
        "older generations go once every intent is done"
    );
    assert!(restarted.fs.inner.exists(&tree_path(2)));
}

#[test]
fn a_full_tree_generation_starts_over_once_every_intent_is_done() {
    let s = setup(Timings {
        tree_rotate_bytes: 10,
        ..fast()
    });
    let tree = s.thread.open_tree(&key(), meta("boot-1")).unwrap();
    tree.begin(&intent(1)).unwrap();
    tree.done(intent(1).id);
    s.thread.flush_all(WAIT).unwrap();
    assert!(!s.fs.inner.exists(&tree_path(1)));
    assert!(s.fs.inner.exists(&tree_path(2)));
    tree.begin(&intent(2)).unwrap();
    let generation = read_generation(&s.fs.inner.get(&tree_path(2)).unwrap(), &s.codec, &Limits::default()).unwrap();
    assert_eq!(generation.header.anchor, 2);
    assert_eq!(generation.records.len(), 1);
}

#[test]
fn a_tree_journal_that_cant_be_written_says_so() {
    let s = setup(fast());
    let tree = s.thread.open_tree(&key(), meta("boot-1")).unwrap();
    s.fs.fail_writes(true);
    assert!(matches!(tree.begin(&intent(1)), Err(JournalError::Degraded(_))));
    s.fs.fail_writes(false);
    tree.begin(&intent(2)).unwrap();
    assert_eq!(tree.unfinished(), [intent(2)], "a failed intent is not recorded");
}
