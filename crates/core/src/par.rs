//! CPU-bound work split over threads, for decoding large segments and journals.
//!
//! The pieces of a segment or journal decode independently of each other. Opening a large page or recovering a
//! long journal spends most of its time there, so a file with enough records is split into chunks, one per
//! thread. Results come back in order, so the outcome is the same as one thread's.

use std::num::NonZeroUsize;
use std::sync::OnceLock;
use std::thread;

/// The most threads one call uses. More buy little for files of the sizes the limits allow.
const MAX_THREADS: usize = 8;

/// How many threads a call may use: the processor's parallelism, up to [`MAX_THREADS`].
fn threads() -> usize {
    static THREADS: OnceLock<usize> = OnceLock::new();
    *THREADS.get_or_init(|| {
        thread::available_parallelism()
            .map_or(1, NonZeroUsize::get)
            .min(MAX_THREADS)
    })
}

/// Runs `work` over consecutive chunks of `items`, and returns each chunk's result in order.
///
/// Each chunk holds at least `min_chunk` items, so small inputs run on the calling thread alone. The last
/// chunk always runs on the calling thread. A chunk whose thread can't start runs on the calling thread
/// too, and a panic in any chunk resumes on the calling thread.
pub(crate) fn chunked<T, R, F>(items: &[T], min_chunk: usize, work: F) -> Vec<R>
where
    T: Sync,
    R: Send,
    F: Fn(&[T]) -> R + Sync,
{
    chunked_on(threads(), items, min_chunk, work)
}

fn chunked_on<T, R, F>(threads: usize, items: &[T], min_chunk: usize, work: F) -> Vec<R>
where
    T: Sync,
    R: Send,
    F: Fn(&[T]) -> R + Sync,
{
    let per = items.len().div_ceil(threads.max(1)).max(min_chunk.max(1));
    if per >= items.len() {
        return vec![work(items)];
    }
    let work = &work;
    let chunks: Vec<&[T]> = items.chunks(per).collect();
    let Some((last, rest)) = chunks.split_last() else {
        return Vec::new();
    };
    thread::scope(|scope| {
        let started: Vec<_> = rest
            .iter()
            .map(|&chunk| {
                (
                    chunk,
                    thread::Builder::new().spawn_scoped(scope, move || work(chunk)).ok(),
                )
            })
            .collect();
        let tail = work(last);
        let mut out: Vec<R> = started
            .into_iter()
            .map(|(chunk, handle)| match handle {
                Some(handle) => handle.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic)),
                None => work(chunk),
            })
            .collect();
        out.push(tail);
        out
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

    use super::*;

    /// Each chunk's first item and sum.
    fn sums(threads: usize, items: &[u64], min_chunk: usize) -> Vec<(u64, u64)> {
        chunked_on(threads, items, min_chunk, |chunk| {
            (chunk.first().copied().unwrap_or(0), chunk.iter().sum())
        })
    }

    #[test]
    fn chunks_come_back_in_order_and_cover_every_item() {
        let items: Vec<u64> = (0..1_000).collect();
        for threads in [1, 2, 3, 8] {
            for min_chunk in [0, 1, 7, 100, 999, 1_000, 5_000] {
                let parts = sums(threads, &items, min_chunk);
                let total: u64 = parts.iter().map(|(_, sum)| sum).sum();
                assert_eq!(total, items.iter().sum::<u64>());
                let starts: Vec<u64> = parts.iter().map(|(start, _)| *start).collect();
                let mut sorted = starts.clone();
                sorted.sort_unstable();
                assert_eq!(starts, sorted);
                assert_eq!(starts[0], 0);
                assert!(parts.len() <= threads.max(1));
            }
        }
    }

    #[test]
    fn small_inputs_run_as_one_chunk() {
        assert_eq!(sums(8, &[1, 2, 3], 512), vec![(1, 6)]);
        assert_eq!(sums(8, &[], 512), vec![(0, 0)]);
        assert_eq!(sums(4, &[1; 8], 2).len(), 4);
    }

    #[test]
    #[should_panic(expected = "chunk failed")]
    fn a_panic_in_a_chunk_reaches_the_caller() {
        let items: Vec<u64> = (0..100).collect();
        chunked_on(4, &items, 1, |chunk| {
            assert!(chunk.first() != Some(&0), "chunk failed");
        });
    }
}
