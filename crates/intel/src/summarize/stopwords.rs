//! Common words that carry little meaning, for the languages summaries can tell apart.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::text::Word;

const ENGLISH: &str =
    "a about above after again against all also am an and any are aren't as at be because been before \
    being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down \
    during each even few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll \
    he's her here here's hers herself him himself his how how's however i i'd i'll i'm i've if in into is isn't \
    it it's its itself just let's like may me might more most much must mustn't my myself no nor not now of off \
    on once one only onto or other ought our ours ourselves out over own per same shall shan't she she'd she'll \
    she's should shouldn't so some such than that that's the their theirs them themselves then there there's \
    these they they'd they'll they're they've this those through thus to too under until up upon us use used \
    using very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's whether \
    which while who who's whom whose why why's will with within without won't would wouldn't yet you you'd \
    you'll you're you've your yours yourself yourselves every many several various another always never often \
    among around along since whether either neither rather quite already still ever else";

const SPANISH: &str =
    "a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el \
    ella ellas ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estado estar este \
    esto estos fue fueron ha han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros \
    o os otra otras otro otros para pero poco por porque que quien quienes se sea sean ser si sin sobre su sus \
    tambien tan te tiene tienen todo todos tu tus un una uno unos y ya yo";

const FRENCH: &str =
    "a ai au aux avec ce ces cet cette dans de des du elle elles en es est et étaient était été être eu \
    il ils je la le les leur leurs lui ma mais me même mes moi mon ne nos notre nous on ont ou où par pas pour \
    qu que quel quelle qui sa sans se ses si son sont sur ta te tes toi ton tous tout tu un une vos votre vous \
    y à";

const GERMAN: &str =
    "aber alle als also am an auch auf aus bei bin bis bist da dass dein dem den der des die dies diese \
    dieser dieses doch dort du durch ein eine einem einen einer eines er es für hat hatte hier ich ihr im in \
    ist ja kein mehr mein mit nach nicht noch nun nur oder ohne sein seine sich sie sind so über um und uns \
    unter von vor war waren was weil wenn wer wie wir wird wo zu zum zur";

/// The languages with a word list, as primary language tags, with the list for each.
const LISTS: [(&str, &str); 4] = [("en", ENGLISH), ("es", SPANISH), ("fr", FRENCH), ("de", GERMAN)];

fn sets() -> &'static HashMap<&'static str, HashSet<&'static str>> {
    static SETS: OnceLock<HashMap<&'static str, HashSet<&'static str>>> = OnceLock::new();
    SETS.get_or_init(|| {
        LISTS
            .iter()
            .map(|&(tag, list)| (tag, list.split_whitespace().collect()))
            .collect()
    })
}

/// The stop words for a primary language tag such as `en`, or `None` when there is no list.
pub fn for_language(tag: &str) -> Option<&'static HashSet<&'static str>> {
    sets().get(tag)
}

/// Guesses the language among those with a list, by which list matches most of the first words.
/// Returns `en` when no list matches at least one word in twenty.
pub fn detect(words: &[Word]) -> &'static str {
    let sample = &words[..words.len().min(2000)];
    let mut best = ("en", 0_usize);
    for &(tag, _) in &LISTS {
        let set = &sets()[tag];
        let hits = sample.iter().filter(|w| set.contains(w.lower.as_str())).count();
        if hits > best.1 {
            best = (tag, hits);
        }
    }
    if best.1 * 20 >= sample.len() {
        best.0
    } else {
        "en"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::words;

    #[test]
    fn detects_each_language_with_a_list() {
        let sample = |text: &str| detect(&words(text));
        assert_eq!(sample("The cat sat on the mat and it was happy with the day."), "en");
        assert_eq!(
            sample("El gato se sentó en la alfombra y estaba muy feliz con el día."),
            "es"
        );
        assert_eq!(
            sample("Le chat est assis sur le tapis et il était très content de la journée."),
            "fr"
        );
        assert_eq!(
            sample("Die Katze saß auf dem Teppich und war mit dem Tag sehr zufrieden."),
            "de"
        );
        assert_eq!(sample("12345 67890"), "en", "no match falls back to English");
        assert_eq!(sample(""), "en");
    }

    #[test]
    fn lists_hold_the_common_words() {
        assert!(for_language("en").unwrap().contains("the"));
        assert!(for_language("de").unwrap().contains("und"));
        assert!(for_language("zz").is_none());
    }
}
