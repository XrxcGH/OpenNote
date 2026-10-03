use proptest::prelude::*;

use super::*;

fn splice(at: u32, del: &str, ins: &str) -> Splice {
    Splice {
        at,
        del: del.to_owned(),
        ins: ins.to_owned(),
    }
}

#[test]
fn equal_texts_give_no_splice() {
    assert_eq!(diff("", ""), None);
    assert_eq!(diff("abc", "abc"), None);
}

#[test]
fn finds_one_splice_between_prefix_and_suffix() {
    assert_eq!(diff("", "a"), Some(splice(0, "", "a")));
    assert_eq!(diff("hello world", "hello brave world"), Some(splice(6, "", "brave ")));
    assert_eq!(diff("hello world", "hello"), Some(splice(5, " world", "")));
    assert_eq!(diff("abcdef", "abXYef"), Some(splice(2, "cd", "XY")));
    assert_eq!(diff("aaa", "aaaa"), Some(splice(3, "", "a")), "typing at the end");
    assert_eq!(diff("aaa", "aa"), Some(splice(2, "a", "")), "a backspace at the end");
}

#[test]
fn splices_never_split_a_character() {
    // é and ê share their first byte.
    assert_eq!(diff("café", "cafê"), Some(splice(3, "é", "ê")));
    // Emoji outside the Basic Multilingual Plane are surrogate pairs in UTF-16.
    assert_eq!(diff("a🙂b", "a🙃b"), Some(splice(1, "🙂", "🙃")));
    assert_eq!(diff("🙂", "🙂🙂"), Some(splice(4, "", "🙂")));
    // A combining mark is a character of its own.
    assert_eq!(diff("e", "e\u{301}"), Some(splice(1, "", "\u{301}")));
    assert_eq!(diff("e\u{301}x", "e\u{300}x"), Some(splice(1, "\u{301}", "\u{300}")));
}

#[test]
fn right_to_left_text_is_just_characters() {
    let old = "שלום עולם";
    let new = "שלום רב עולם";
    let s = diff(old, new).unwrap();
    assert_eq!(apply_splices(old, std::slice::from_ref(&s)).unwrap(), new);
    assert!(old.is_char_boundary(s.at as usize));
}

#[test]
fn splices_apply_and_invert() {
    let splices = [splice(0, "", "Hi "), splice(3, "there", "you")];
    let text = apply_splices("there", &splices).unwrap();
    assert_eq!(text, "Hi you");
    assert_eq!(apply_splices(&text, &invert_splices(&splices)).unwrap(), "there");
}

#[test]
fn bad_splices_name_the_one_that_failed() {
    assert_eq!(apply_splices("abc", &[splice(1, "c", "")]), Err(0));
    assert_eq!(apply_splices("abc", &[splice(0, "a", ""), splice(9, "", "x")]), Err(1));
    assert_eq!(apply_splices("é", &[splice(1, "", "x")]), Err(0), "inside a character");
    assert_eq!(apply_splices("abc", &[splice(u32::MAX, "abc", "")]), Err(0));
}

fn arb_text() -> impl Strategy<Value = String> {
    let chars = vec!['a', 'b', ' ', '\n', 'é', '\u{301}', 'א', '🙂', '\u{200d}'];
    proptest::collection::vec(proptest::sample::select(chars), 0..24).prop_map(String::from_iter)
}

proptest! {
    /// The splice turns the old text into the new one, falls on character boundaries, and is minimal: its
    /// deleted and inserted texts don't start or end with the same character.
    #[test]
    fn diffs_are_exact_and_minimal(old in arb_text(), new in arb_text()) {
        match diff(&old, &new) {
            None => prop_assert_eq!(&old, &new),
            Some(s) => {
                prop_assert_eq!(apply_splices(&old, std::slice::from_ref(&s)).unwrap(), new.clone());
                prop_assert_eq!(apply_splices(&new, &invert_splices(std::slice::from_ref(&s))).unwrap(), old.clone());
                prop_assert!(s.del.chars().next().is_none() || s.del.chars().next() != s.ins.chars().next());
                prop_assert!(s.del.chars().last().is_none() || s.del.chars().last() != s.ins.chars().last());
            }
        }
    }
}
