//! Text diffs for `setText` (plan 7.2). Owned by WP3.
//!
//! The interface sends a text block's whole Markdown. The core turns it into one splice by trimming the common
//! prefix and suffix. Both ends fall on character boundaries, so a splice never splits a character, and so
//! never splits a surrogate pair in the interface's UTF-16 strings either.

use crate::ops::Splice;

/// One splice that turns `old` into `new`, found by trimming the common prefix and suffix at character
/// boundaries. `None` when the texts are equal. It is also `None` when the change starts past 4 GiB, which the
/// Markdown limit rules out.
pub fn diff(old: &str, new: &str) -> Option<Splice> {
    if old == new {
        return None;
    }
    let prefix = common_prefix(old, new);
    let suffix = common_suffix(old, new, prefix);
    let del = old.get(prefix..old.len() - suffix)?;
    let ins = new.get(prefix..new.len() - suffix)?;
    Some(Splice {
        at: u32::try_from(prefix).ok()?,
        del: del.to_owned(),
        ins: ins.to_owned(),
    })
}

/// The length in bytes of the longest common prefix that ends on a character boundary of both texts.
fn common_prefix(old: &str, new: &str) -> usize {
    let mut len = old.bytes().zip(new.bytes()).take_while(|(a, b)| a == b).count();
    while !(old.is_char_boundary(len) && new.is_char_boundary(len)) {
        len -= 1;
    }
    len
}

/// The length in bytes of the longest common suffix that doesn't overlap `prefix` and starts on a character
/// boundary of both texts.
fn common_suffix(old: &str, new: &str, prefix: usize) -> usize {
    let room = old.len().min(new.len()) - prefix;
    let mut len = old
        .bytes()
        .rev()
        .zip(new.bytes().rev())
        .take(room)
        .take_while(|(a, b)| a == b)
        .count();
    while !(old.is_char_boundary(old.len() - len) && new.is_char_boundary(new.len() - len)) {
        len -= 1;
    }
    len
}

/// Applies splices to `text`, one after another. Fails, naming the splice, when an offset isn't on a character
/// boundary or the text there isn't the deleted text.
pub fn apply_splices(text: &str, splices: &[Splice]) -> Result<String, usize> {
    let mut current = text.to_owned();
    for (index, splice) in splices.iter().enumerate() {
        let at = usize::try_from(splice.at).map_err(|_| index)?;
        let end = at.checked_add(splice.del.len()).ok_or(index)?;
        if current.get(at..end) != Some(splice.del.as_str()) {
            return Err(index);
        }
        current.replace_range(at..end, &splice.ins);
    }
    Ok(current)
}

/// The splices that undo `splices`: reversed, with deleted and inserted text swapped.
pub fn invert_splices(splices: &[Splice]) -> Vec<Splice> {
    splices
        .iter()
        .rev()
        .map(|s| Splice {
            at: s.at,
            del: s.ins.clone(),
            ins: s.del.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests;
