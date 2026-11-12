//! The shown text of a number under a number format code: the subset a note export needs, which is plain digit
//! patterns (`0`, `0.00`, `#,##0.00`, with `%` and literal text) and date and time codes. Any other code returns `None`,
//! and the caller writes the General text. The rules follow the format-code grammar of ECMA-376 Part 1, 18.8.31.

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const DAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

/// The text of `value` under `code`, or `None` when the code is outside the supported subset.
pub fn shown(value: f64, code: &str) -> Option<String> {
    if !value.is_finite() || code.is_empty() || code.eq_ignore_ascii_case("general") {
        return None;
    }
    let sections: Vec<&str> = code.split(';').collect();
    let (section, magnitude, sign) = if sections.len() >= 3 && value == 0.0 {
        (sections[2], 0.0, "")
    } else if sections.len() >= 2 && value < 0.0 {
        (sections[1], -value, "")
    } else {
        (sections[0], value.abs(), if value < 0.0 { "-" } else { "" })
    };
    let bare = literal_free(&section.to_ascii_lowercase());
    if bare.contains('0') || bare.contains('#') {
        number(magnitude, section, sign)
    } else if bare.chars().any(|c| "ymdhs".contains(c)) {
        date(value, section)
    } else {
        None
    }
}

/// The code without quoted text and escaped characters, so literals do not look like tokens.
fn literal_free(code: &str) -> String {
    let mut out = String::new();
    let mut chars = code.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                for q in chars.by_ref() {
                    if q == '"' {
                        break;
                    }
                }
            }
            '\\' | '_' | '*' => {
                chars.next();
            }
            _ => out.push(c),
        }
    }
    out
}

fn number(magnitude: f64, section: &str, sign: &str) -> Option<String> {
    let (mut head, mut digits, mut tail) = (String::new(), String::new(), String::new());
    let mut percents = 0;
    let mut chars = section.chars();
    while let Some(c) = chars.next() {
        // Text before the first digit pattern is the head, text after the last one is the tail.
        let after = !digits.is_empty() && !tail.is_empty();
        match c {
            '0' | '#' | ',' | '.' if after => return None,
            '0' | '#' | ',' | '.' => digits.push(c),
            _ => {
                let text = match c {
                    '%' => {
                        percents += 1;
                        "%".to_owned()
                    }
                    '"' => chars.by_ref().take_while(|q| *q != '"').collect(),
                    '\\' => chars.next()?.to_string(),
                    '$' | '-' | '+' | '(' | ')' | ' ' | ':' | '/' => c.to_string(),
                    _ => return None,
                };
                if digits.is_empty() {
                    head.push_str(&text);
                } else {
                    tail.push_str(&text);
                }
            }
        }
    }
    let (int_part, frac_part) = digits.split_once('.').unwrap_or((digits.as_str(), ""));
    if frac_part.contains([',', '.']) {
        return None;
    }
    let min_int = int_part.matches('0').count();
    let min_frac = frac_part.matches('0').count();
    if frac_part.len() > 15 {
        return None;
    }
    // Half rounds away from zero, as the format-code rules say; the formatter alone would round half to even.
    let places = 10f64.powi(frac_part.len() as i32);
    let scaled = (magnitude * 100f64.powi(percents) * places).round() / places;
    let text = format!("{scaled:.*}", frac_part.len());
    let (whole, frac) = text.split_once('.').unwrap_or((text.as_str(), ""));
    let mut frac = frac.to_owned();
    while frac.len() > min_frac && frac.ends_with('0') {
        frac.pop();
    }
    let mut whole = if whole == "0" && min_int == 0 {
        String::new()
    } else {
        whole.to_owned()
    };
    while whole.len() < min_int {
        whole.insert(0, '0');
    }
    if int_part.contains(',') {
        let mut grouped = String::new();
        for (i, ch) in whole.chars().enumerate() {
            if i > 0 && (whole.len() - i) % 3 == 0 {
                grouped.push(',');
            }
            grouped.push(ch);
        }
        whole = grouped;
    }
    let point = if frac.is_empty() { "" } else { "." };
    let zero = whole.chars().chain(frac.chars()).all(|c| c == '0' || c == ',');
    let sign = if zero { "" } else { sign };
    Some(format!("{sign}{head}{whole}{point}{frac}{tail}"))
}

/// The civil date of a serial number in the 1900 date system, which counts a day for the nonexistent 1900-02-29.
fn civil(serial: i64) -> Option<(i64, i64, i64, usize)> {
    if !(1..=2_958_465).contains(&serial) || serial == 60 {
        return None;
    }
    let days = if serial < 60 { serial - 25_568 } else { serial - 25_569 };
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let weekday = (days + 4).rem_euclid(7) as usize;
    Some((year, month, day, weekday))
}

fn date(value: f64, section: &str) -> Option<String> {
    let whole = value.floor();
    let (year, month, day, weekday) = civil(whole as i64)?;
    let seconds = ((value - whole) * 86_400.0).round() as i64;
    let (hour, minute, second) = (seconds / 3_600 % 24, seconds / 60 % 60, seconds % 60);
    let chars: Vec<char> = section.chars().collect();
    let mut out = String::new();
    let mut after_hour = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i].to_ascii_lowercase();
        if "ymdhs".contains(c) {
            let mut n = 1;
            while i + n < chars.len() && chars[i + n].to_ascii_lowercase() == c {
                n += 1;
            }
            // An `m` right before a colon and seconds is the minute.
            let before_seconds =
                chars.get(i + n) == Some(&':') && chars.get(i + n + 1).is_some_and(|q| q.eq_ignore_ascii_case(&'s'));
            match (c, n) {
                ('y', 2) => out.push_str(&format!("{:02}", year % 100)),
                ('y', 4) => out.push_str(&format!("{year:04}")),
                ('m', 1 | 2) if after_hour || before_seconds => out.push_str(&format!("{minute:0n$}")),
                ('m', 1) => out.push_str(&month.to_string()),
                ('m', 2) => out.push_str(&format!("{month:02}")),
                ('m', 3) => out.push_str(&MONTHS[month as usize - 1][..3]),
                ('m', 4) => out.push_str(MONTHS[month as usize - 1]),
                ('d', 1) => out.push_str(&day.to_string()),
                ('d', 2) => out.push_str(&format!("{day:02}")),
                ('d', 3) => out.push_str(&DAYS[weekday][..3]),
                ('d', 4) => out.push_str(DAYS[weekday]),
                ('h', 1 | 2) => out.push_str(&format!("{hour:0n$}")),
                ('s', 1 | 2) => out.push_str(&format!("{second:0n$}")),
                _ => return None,
            }
            after_hour = c == 'h';
            i += n;
            continue;
        }
        match chars[i] {
            '"' => {
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    out.push(chars[i]);
                    i += 1;
                }
            }
            '\\' => {
                i += 1;
                out.push(*chars.get(i)?);
            }
            ch if "-/:., ".contains(ch) => out.push(ch),
            _ => return None,
        }
        i += 1;
    }
    Some(out)
}
