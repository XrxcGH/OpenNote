//! Finding `#tags` in the text of a note, as Obsidian and Joplin write them.

use crate::doc::{visit_inlines, Block, Inline};

/// The tags in the text of the blocks, in order and without repeats. A tag starts with `#` at the start of a word
/// and holds letters, digits, `_`, `-`, and `/`, with at least one letter. Code and links are not searched.
pub fn hashtags(blocks: &[Block]) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    visit_inlines(blocks, &mut |inlines| {
        for inline in inlines {
            if let Inline::Text { text, marks } = inline {
                if !marks.code && marks.link.is_none() {
                    scan(text, &mut found);
                }
            }
        }
    });
    found
}

fn scan(text: &str, found: &mut Vec<String>) {
    let chars: Vec<char> = text.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        let starts_word = i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '(';
        if c != '#' || !starts_word {
            continue;
        }
        let tag: String = chars[i + 1..]
            .iter()
            .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '/'))
            .collect();
        let tag = tag.trim_end_matches(['/', '-']).to_owned();
        if tag.chars().any(char::is_alphabetic) && !found.contains(&tag) {
            found.push(tag);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::Marks;

    #[test]
    fn finds_tags_but_not_headings_numbers_or_code() {
        let code = Marks {
            code: true,
            ..Marks::none()
        };
        let blocks = vec![Block::Paragraph(vec![
            Inline::text("Study #biology/cells and #exam-3, issue #12, C# and a#b "),
            Inline::marked("#incode", code),
        ])];
        assert_eq!(hashtags(&blocks), vec!["biology/cells", "exam-3"]);
    }
}
