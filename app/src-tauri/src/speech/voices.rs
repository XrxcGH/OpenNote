//! Reading the voice lists the speech programs print, and choosing a voice from them. Pure text work, so it is
//! tested on every system.

use super::Voice;

/// `say -v ?` prints one voice a line: the name, its locale, and `# a sample sentence`. A name can hold spaces and
/// brackets (`Eddy (English (US))`), so the locale is the last word before the `#`.
pub fn parse_say(output: &str) -> Vec<Voice> {
    output
        .lines()
        .filter_map(|line| {
            let head = line.split('#').next()?.trim_end();
            let split = head.rfind(char::is_whitespace)?;
            let (name, locale) = (head[..split].trim(), head[split..].trim());
            let valid = !name.is_empty()
                && locale.len() >= 2
                && locale
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
            valid.then(|| Voice {
                id: name.to_owned(),
                name: name.to_owned(),
                language: locale.replace('_', "-"),
            })
        })
        .collect()
}

/// `espeak-ng --voices` prints a header, then `Pty Language Age/Gender VoiceName File [Other languages]`.
pub fn parse_espeak(output: &str) -> Vec<Voice> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let [priority, language, _, name, ..] = parts.as_slice() else {
                return None;
            };
            priority.parse::<u8>().ok()?;
            Some(Voice {
                id: (*language).to_owned(),
                name: name.replace('_', " "),
                language: (*language).to_owned(),
            })
        })
        .collect()
}

/// The voice to pass to the program: the chosen id when the system lists it, and `None`, the system default, for
/// an empty id or one that isn't installed here (a saved voice from another computer must not stop reading). An id
/// that isn't listed never reaches the program, so it can never become a program option.
pub fn choose(known: &[Voice], id: &str) -> Option<String> {
    known.iter().find(|voice| voice.id == id).map(|voice| voice.id.clone())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_mac_voice_list() {
        let out = "Alex                en_US    # Most people recognize me by my voice.\n\
                   Eddy (English (US)) en_US    # Hello! My name is Eddy.\n\
                   Amélie              fr_CA    # Bonjour, je m'appelle Amélie.\n\
                   \n";
        let voices = parse_say(out);
        assert_eq!(voices.len(), 3);
        assert_eq!((voices[0].id.as_str(), voices[0].language.as_str()), ("Alex", "en-US"));
        assert_eq!(voices[1].name, "Eddy (English (US))");
        assert_eq!(voices[2].language, "fr-CA");
    }

    #[test]
    fn reads_the_espeak_voice_list() {
        let out = "Pty Language       Age/Gender VoiceName          File                 Other Languages\n\
                   5  af              --/M      Afrikaans          gmw/af\n\
                   2  en-us           --/M      English_(America)  gmw/en-US           (en 3)\n";
        let voices = parse_espeak(out);
        assert_eq!(voices.len(), 2);
        assert_eq!(
            (voices[1].id.as_str(), voices[1].name.as_str()),
            ("en-us", "English (America)")
        );
    }

    #[test]
    fn only_a_listed_voice_reaches_the_program() {
        let known = parse_say("Alex en_US # hi\n");
        assert_eq!(choose(&known, ""), None);
        assert_eq!(choose(&known, "Alex"), Some("Alex".to_owned()));
        assert_eq!(choose(&known, "-o /etc/passwd"), None);
        assert_eq!(choose(&known, "Zed"), None);
    }
}
