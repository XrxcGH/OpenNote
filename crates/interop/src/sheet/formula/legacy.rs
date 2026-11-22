//! Formulas of a table without `data.sheet.v` keep their old meaning (format spec `R-SHT-4`, ADR 0058). Such a table
//! was written with the textbook rules, where `-2^2` is -4, `2^3^2` is 2^9, and `E` is the constant e. Before the
//! formula is translated for Excel, this rewrite adds the brackets and the call that keep that meaning: `-x^y` becomes
//! `-(x^y)`, `a^b^c` becomes `a^(b^c)`, and `E` becomes `EXP(1)`. It is the twin of `engine/formula/legacy.ts` in the
//! app. Text it cannot read is left as it is.

use super::{tokenize, Dialect, Tok};

/// A part of the formula: the tokens it spans, and whether it is a power written without brackets around it.
#[derive(Clone, Copy)]
struct Node {
    start: usize,
    end: usize,
    power: bool,
}

struct Parser<'a> {
    toks: &'a [Tok],
    at: usize,
    /// How many `(` go before each token, and how many `)` after it.
    open: Vec<usize>,
    close: Vec<usize>,
    /// The tokens that are the constant `E`.
    constant: Vec<bool>,
}

fn text(tok: &Tok) -> &str {
    match tok {
        Tok::Text(t) | Tok::Num(t) | Tok::Name(t) | Tok::Bracket(t) | Tok::Quoted(t) => t,
    }
}

fn is_space(tok: &Tok) -> bool {
    matches!(tok, Tok::Text(t) if t.chars().all(char::is_whitespace))
}

impl Parser<'_> {
    fn skip(&mut self) {
        while self.toks.get(self.at).is_some_and(is_space) {
            self.at += 1;
        }
    }

    fn peek(&mut self) -> Option<&Tok> {
        self.skip();
        self.toks.get(self.at)
    }

    fn peek_text(&mut self, options: &[&str]) -> bool {
        matches!(self.peek(), Some(Tok::Text(t)) if options.contains(&t.as_str()))
    }

    /// Whether the token right after the last one, with no space between, is one of `options`.
    fn touching(&self, options: &[&str]) -> bool {
        matches!(self.toks.get(self.at), Some(Tok::Text(t)) if options.contains(&t.as_str()))
    }

    /// Takes the next token and returns its place.
    fn bump(&mut self) -> usize {
        self.skip();
        self.at += 1;
        self.at - 1
    }

    fn wrap(&mut self, node: Node) {
        self.open[node.start] += 1;
        self.close[node.end - 1] += 1;
    }

    fn binary(&mut self, ops: &[&str], next: fn(&mut Self) -> Option<Node>) -> Option<Node> {
        let mut left = next(self)?;
        while self.peek_text(ops) {
            self.bump();
            if self.touching(&["=", ">"]) {
                self.at += 1;
            }
            let right = next(self)?;
            left = Node {
                start: left.start,
                end: right.end,
                power: false,
            };
        }
        Some(left)
    }

    fn expr(&mut self) -> Option<Node> {
        self.binary(&["=", "<", ">"], Self::concat)
    }

    fn concat(&mut self) -> Option<Node> {
        self.binary(&["&"], Self::add)
    }

    fn add(&mut self) -> Option<Node> {
        self.binary(&["+", "-"], Self::mul)
    }

    fn mul(&mut self) -> Option<Node> {
        self.binary(&["*", "/"], Self::unary)
    }

    /// Under the textbook rules a leading sign binds looser than `^`.
    fn unary(&mut self) -> Option<Node> {
        if self.peek_text(&["-", "+"]) {
            let start = self.bump();
            let arg = self.unary()?;
            if arg.power {
                self.wrap(arg);
            }
            return Some(Node {
                start,
                end: arg.end,
                power: false,
            });
        }
        self.power()
    }

    /// Under the textbook rules `^` groups right to left.
    fn power(&mut self) -> Option<Node> {
        let base = self.postfix()?;
        if !self.peek_text(&["^"]) {
            return Some(base);
        }
        self.bump();
        let right = self.unary()?;
        if right.power {
            self.wrap(right);
        }
        Some(Node {
            start: base.start,
            end: right.end,
            power: true,
        })
    }

    fn postfix(&mut self) -> Option<Node> {
        let mut node = self.primary()?;
        while self.peek_text(&["%"]) {
            node.end = self.bump() + 1;
            node.power = false;
        }
        Some(node)
    }

    fn primary(&mut self) -> Option<Node> {
        let start = self.at_next()?;
        let tok = self.toks[start].clone();
        match &tok {
            Tok::Text(t) if t == "(" => {
                self.bump();
                self.expr()?;
                self.close_with(")", start)
            }
            Tok::Text(t) if t == "{" => {
                self.bump();
                while !self.peek_text(&["}"]) {
                    self.peek()?;
                    self.bump();
                }
                self.close_with("}", start)
            }
            Tok::Text(t) if t == "√" || t == "@" => {
                self.bump();
                let arg = self.postfix()?;
                Some(Node {
                    start,
                    end: arg.end,
                    power: false,
                })
            }
            Tok::Name(_) if matches!(self.toks.get(start + 1), Some(Tok::Text(t)) if t == "(") => {
                self.at = start + 2;
                if !self.peek_text(&[")"]) {
                    loop {
                        if !self.peek_text(&[",", ";", ")"]) {
                            self.expr()?;
                        }
                        if self.peek_text(&[",", ";"]) {
                            self.bump();
                        } else {
                            break;
                        }
                    }
                }
                self.close_with(")", start)
            }
            Tok::Text(t) if !(t.starts_with('"') || t.starts_with('#')) => None,
            _ => self.reference(start),
        }
    }

    /// A value or a reference: a number, a string, an error, a name, or a chain of them joined by `!` and `:`.
    fn reference(&mut self, start: usize) -> Option<Node> {
        self.at = start + 1;
        let mut chained = false;
        loop {
            if matches!(self.toks.get(self.at), Some(Tok::Bracket(_))) {
                self.at += 1;
                chained = true;
            } else if self.touching(&["!", ":"])
                && matches!(
                    self.toks.get(self.at + 1),
                    Some(Tok::Name(_) | Tok::Num(_) | Tok::Bracket(_) | Tok::Quoted(_))
                )
            {
                self.at += 2;
                chained = true;
            } else if self.touching(&["#"]) {
                self.at += 1;
                chained = true;
            } else {
                break;
            }
        }
        let is_constant = matches!(&self.toks[start], Tok::Name(n) if n == "E" || n == "e");
        if !chained
            && is_constant
            && !(start > 0 && matches!(&self.toks[start - 1], Tok::Text(t) if t == ":" || t == "!"))
        {
            self.constant[start] = true;
        }
        Some(Node {
            start,
            end: self.at,
            power: false,
        })
    }

    /// The place of the next token that is not a space.
    fn at_next(&mut self) -> Option<usize> {
        self.peek()?;
        Some(self.at)
    }

    fn close_with(&mut self, closer: &str, start: usize) -> Option<Node> {
        if !self.peek_text(&[closer]) {
            return None;
        }
        let end = self.bump() + 1;
        Some(Node {
            start,
            end,
            power: false,
        })
    }
}

/// The text of a formula from a table without `data.sheet.v`, rewritten to mean under Excel's rules what it meant
/// under the textbook rules. Text the rewrite cannot read comes back as it is.
pub(super) fn rewrite(formula: &str) -> String {
    let toks = tokenize(formula, Dialect::OpenNote);
    let n = toks.len();
    let mut p = Parser {
        toks: &toks,
        at: 0,
        open: vec![0; n],
        close: vec![0; n],
        constant: vec![false; n],
    };
    if p.expr().is_none() || p.peek().is_some() {
        return formula.to_owned();
    }
    let mut out = String::new();
    for (i, tok) in toks.iter().enumerate() {
        out.push_str(&"(".repeat(p.open[i]));
        out.push_str(if p.constant[i] { "EXP(1)" } else { text(tok) });
        out.push_str(&")".repeat(p.close[i]));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::rewrite;

    #[test]
    fn the_textbook_meaning_gets_its_brackets() {
        // Worked by hand from the textbook rules of R-SHT-4: a sign binds looser than "^", and "^" groups right to left.
        assert_eq!(rewrite("-A1^2"), "-(A1^2)");
        assert_eq!(rewrite("2^3^2"), "2^(3^2)");
        assert_eq!(rewrite("-2^3^2"), "-(2^(3^2))");
        assert_eq!(rewrite("1 - -B2 ^ 2"), "1 - -(B2 ^ 2)");
        assert_eq!(rewrite("E^2+e"), "EXP(1)^2+EXP(1)");
        assert_eq!(rewrite("SUM(A1:A3)^2^0.5"), "SUM(A1:A3)^(2^0.5)");
    }

    #[test]
    fn what_means_the_same_stays_as_it_is() {
        for same in [
            "(-2)^2", "-(2^2)", "(2^3)^2", "2^-3", "A1*-2", "EXP(1)", "\"E\"&E1", "Sales!B2", "SUM(E:E)",
        ] {
            assert_eq!(rewrite(same), same);
        }
        // Text the rewrite cannot read is not touched.
        assert_eq!(rewrite("-E^(2"), "-E^(2");
    }
}
