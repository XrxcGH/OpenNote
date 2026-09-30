//! What the interface reads from a page session: the page envelope (plan 11.3), and the rest of the ink of a
//! very large page, in chunks for the page's channel.

use std::sync::Arc;

use super::state::{PageSession, PageState};
use crate::error::CoreError;
use crate::id::ClientId;
use crate::model::{InkRecord, Page, ReadOnlyReason, Rect, Stroke};
use crate::wire::envelope::{self, Envelope, EnvelopeParts, SessionInfo};

/// Ink beyond this size doesn't go in the envelope: the strokes that meet the viewport do, and the rest follows
/// on the channel (plan 11.3).
pub const ENVELOPE_INK_BYTES: u64 = 8 * 1024 * 1024;

/// The size of each message of ink on the channel.
pub const CHANNEL_CHUNK_BYTES: u64 = 512 * 1024;

/// A stroke's box in page units, after its transform.
pub fn stroke_rect(stroke: &Stroke) -> Rect {
    let rect = stroke.bbox.to_rect();
    let Some(transform) = stroke.transform else {
        return rect;
    };
    let corners = [
        transform.apply(rect.x, rect.y),
        transform.apply(rect.x + rect.w, rect.y),
        transform.apply(rect.x, rect.y + rect.h),
        transform.apply(rect.x + rect.w, rect.y + rect.h),
    ];
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for (x, y) in corners {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    Rect {
        x: min_x,
        y: min_y,
        w: max_x - min_x,
        h: max_y - min_y,
    }
}

/// The live strokes in envelope order: those that meet the viewport first, each group in drawing order.
fn ordered_strokes(page: &Page, viewport: Option<Rect>) -> (Vec<Arc<Stroke>>, Vec<Arc<Stroke>>) {
    let mut all: Vec<Arc<Stroke>> = page.ink.strokes().cloned().collect();
    all.sort_by_key(|s| (s.start, s.id));
    match viewport {
        Some(view) => all.into_iter().partition(|s| stroke_rect(s).intersects(&view)),
        None => (all, Vec::new()),
    }
}

fn record_bytes(strokes: &[Arc<Stroke>]) -> u64 {
    strokes.iter().map(|s| s.record_len()).fold(0, u64::saturating_add)
}

impl PageSession {
    /// The page envelope for a client, with the strokes that meet `viewport` first.
    pub(crate) fn envelope(&self, client: &ClientId, viewport: Option<Rect>) -> Result<Envelope, CoreError> {
        let st = self.state();
        let (mut front, back) = ordered_strokes(&st.page, viewport);
        let total = u32::try_from(front.len().saturating_add(back.len())).unwrap_or(u32::MAX);
        let more_ink =
            viewport.is_some() && record_bytes(&front).saturating_add(record_bytes(&back)) > ENVELOPE_INK_BYTES;
        if !more_ink {
            front.extend(back);
        }
        let records: Vec<InkRecord> = front.iter().cloned().map(InkRecord::Stroke).collect();
        let ink = if records.is_empty() {
            Vec::new()
        } else {
            self.ctx.codec.encode_records(&records)
        };
        let page_json = self.page_json(&st);
        let session = serde_json::to_vec(&self.session_info(&st, client, total)).unwrap_or_default();
        let parts = EnvelopeParts {
            session: &session,
            page_json: &page_json,
            ink: &ink,
            strokes: u32::try_from(records.len()).unwrap_or(u32::MAX),
            read_only: st.read_only.is_some(),
            more_ink,
        };
        envelope::encode(&parts).map_err(|e| CoreError::Conflict(e.to_string()))
    }

    /// The `page.json` bytes: the file's own bytes while nothing changed since it was read or written.
    fn page_json(&self, st: &PageState) -> Arc<[u8]> {
        if st.dirty.is_none() && st.page.ink.pending().is_empty() {
            st.bytes.clone()
        } else {
            self.ctx.codec.write_page(&st.page).into()
        }
    }

    fn session_info(&self, st: &PageState, client: &ClientId, strokes_total: u32) -> SessionInfo {
        let (can_undo, can_redo) = PageSession::undo_state(st, client);
        SessionInfo {
            page: self.id,
            revision: st.base,
            client_seq: st.clients.get(client).map_or(0, |c| c.seq),
            read_only: st.read_only.clone(),
            can_undo,
            can_redo,
            saved: st.dirty.is_none(),
            conflicts: st.conflicts.clone(),
            damaged_strokes: st.damaged,
            missing_files: st.missing,
            strokes_total,
        }
    }

    /// The strokes that didn't fit in the envelope, as messages of about 512 KB for the page's channel.
    pub(crate) fn ink_chunks(&self, viewport: Rect) -> Vec<Vec<u8>> {
        let st = self.state();
        let (_, back) = ordered_strokes(&st.page, Some(viewport));
        let mut chunks = Vec::new();
        let mut current: Vec<InkRecord> = Vec::new();
        let mut bytes: u64 = 0;
        for stroke in back {
            bytes = bytes.saturating_add(stroke.record_len());
            current.push(InkRecord::Stroke(stroke));
            if bytes >= CHANNEL_CHUNK_BYTES {
                chunks.push(self.ctx.codec.encode_records(&std::mem::take(&mut current)));
                bytes = 0;
            }
        }
        if !current.is_empty() {
            chunks.push(self.ctx.codec.encode_records(&current));
        }
        chunks
    }

    /// Why the page is read-only, if it is.
    pub(crate) fn read_only(&self) -> Option<ReadOnlyReason> {
        self.state().read_only.clone()
    }
}

/// A read-only envelope of a page that isn't the session's own, such as a saved version or the other side of
/// a conflict.
pub(crate) fn detached_envelope(
    codec: &dyn crate::seams::Codec,
    page: &Page,
    page_json: &[u8],
    reason: Option<ReadOnlyReason>,
) -> Result<Envelope, CoreError> {
    let (strokes, _) = ordered_strokes(page, None);
    let records: Vec<InkRecord> = strokes.into_iter().map(InkRecord::Stroke).collect();
    let ink = if records.is_empty() {
        Vec::new()
    } else {
        codec.encode_records(&records)
    };
    let total = u32::try_from(records.len()).unwrap_or(u32::MAX);
    let info = SessionInfo {
        page: page.id,
        revision: page.revision.id,
        client_seq: 0,
        read_only: reason,
        can_undo: false,
        can_redo: false,
        saved: true,
        conflicts: Vec::new(),
        damaged_strokes: 0,
        missing_files: 0,
        strokes_total: total,
    };
    let session = serde_json::to_vec(&info).unwrap_or_default();
    let parts = EnvelopeParts {
        session: &session,
        page_json,
        ink: &ink,
        strokes: total,
        read_only: true,
        more_ink: false,
    };
    envelope::encode(&parts).map_err(|e| CoreError::Conflict(e.to_string()))
}
