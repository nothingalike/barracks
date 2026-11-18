use slint::StyledText;
use std::fmt::Write;

/// Lightweight lexical colors; unknown languages keep their literal plain text.
pub fn highlight(text: &str, language: &str) -> StyledText {
    markup(text, language)
        .and_then(|markup| StyledText::from_markdown(&markup).ok())
        .unwrap_or_else(|| StyledText::from_plain_text(text))
}

fn markup(text: &str, language: &str) -> Option<String> {
    let language = language.to_ascii_lowercase();
    let slash_comments = matches!(
        language.as_str(),
        "rs" | "rust"
            | "js"
            | "javascript"
            | "ts"
            | "typescript"
            | "jsx"
            | "tsx"
            | "cs"
            | "csharp"
            | "c"
            | "cpp"
            | "h"
            | "jsonc"
            | "slint"
    );
    let hash_comments = matches!(
        language.as_str(),
        "py" | "python" | "sh" | "bash" | "ps1" | "powershell" | "toml" | "yaml" | "yml"
    );
    let sql = language == "sql";
    if !slash_comments && !hash_comments && !sql && language != "json" {
        return None;
    }
    let mut result = String::with_capacity(text.len() * 2);
    let mut position = 0;
    while position < text.len() {
        let rest = &text[position..];
        let ch = rest.chars().next()?;
        let (length, color) = if (slash_comments && rest.starts_with("//"))
            || (hash_comments && ch == '#')
            || (sql && rest.starts_with("--"))
        {
            (rest.find('\n').unwrap_or(rest.len()), Some("#7da877"))
        } else if (slash_comments || sql) && rest.starts_with("/*") {
            (
                rest.find("*/").map_or(rest.len(), |end| end + 2),
                Some("#7da877"),
            )
        } else if matches!(ch, '"' | '\'' | '`') && !is_rust_lifetime(rest, &language) {
            (quoted_length(rest, ch, sql), Some("#dba984"))
        } else if ch.is_ascii_digit() {
            (
                rest.find(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '_')
                    .unwrap_or(rest.len()),
                Some("#b5cea8"),
            )
        } else if ch.is_alphabetic() || ch == '_' || ch == '$' {
            let length = rest
                .find(|c: char| !c.is_alphanumeric() && c != '_' && c != '$')
                .unwrap_or(rest.len());
            let word = &rest[..length];
            let lower = word.to_ascii_lowercase();
            let color = if KEYWORDS.contains(&lower.as_str()) {
                Some("#c5a5df")
            } else if ["true", "false", "null", "none", "nil"].contains(&lower.as_str()) {
                Some("#69b7ed")
            } else if rest[length..].trim_start().starts_with('(') {
                Some("#e2d997")
            } else if ch.is_uppercase() {
                Some("#65c9b5")
            } else {
                None
            };
            (length, color)
        } else {
            (ch.len_utf8(), None)
        };
        if let Some(color) = color {
            let _ = write!(result, "<font color=\"{color}\">");
        }
        escape_literal(&rest[..length], &mut result);
        if color.is_some() {
            result.push_str("</font>");
        }
        position += length;
    }
    Some(result)
}

fn is_rust_lifetime(text: &str, language: &str) -> bool {
    if !matches!(language, "rs" | "rust") || !text.starts_with('\'') {
        return false;
    }
    let mut chars = text[1..].chars();
    chars.next().is_some_and(|c| c.is_alphabetic() || c == '_') && chars.next() != Some('\'')
}

fn quoted_length(text: &str, quote: char, sql: bool) -> usize {
    let triple = text.starts_with(&quote.to_string().repeat(3));
    let delimiter = if triple {
        quote.to_string().repeat(3)
    } else {
        quote.to_string()
    };
    let doubled = quote.to_string().repeat(2);
    let mut position = delimiter.len();
    while position < text.len() {
        let rest = &text[position..];
        if rest.starts_with('\\') {
            position += 1;
            if let Some(ch) = text[position..].chars().next() {
                position += ch.len_utf8();
            }
        } else if sql && rest.starts_with(&doubled) {
            position += 2;
        } else if rest.starts_with(&delimiter) {
            return position + delimiter.len();
        } else {
            position += rest.chars().next().unwrap().len_utf8();
        }
    }
    text.len()
}

fn escape_literal(text: &str, out: &mut String) {
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            out.push(ch);
        } else {
            let _ = write!(out, "&#{};", ch as u32);
        }
    }
}

const KEYWORDS: &[&str] = &[
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "crate",
    "def",
    "default",
    "delete",
    "do",
    "dyn",
    "elif",
    "else",
    "enum",
    "except",
    "export",
    "extends",
    "finally",
    "fn",
    "for",
    "from",
    "function",
    "if",
    "impl",
    "import",
    "in",
    "interface",
    "is",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "namespace",
    "new",
    "of",
    "override",
    "pass",
    "private",
    "protected",
    "pub",
    "public",
    "raise",
    "readonly",
    "ref",
    "return",
    "self",
    "static",
    "struct",
    "super",
    "switch",
    "throw",
    "trait",
    "try",
    "type",
    "typeof",
    "unsafe",
    "use",
    "using",
    "var",
    "virtual",
    "void",
    "where",
    "while",
    "with",
    "yield",
    "select",
    "insert",
    "update",
    "into",
    "values",
    "join",
    "on",
    "and",
    "or",
    "not",
    "set",
    "order",
    "by",
    "group",
    "having",
    "limit",
    "component",
    "inherits",
    "property",
    "callback",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_code_and_preserves_literal_markup_whitespace_and_unicode() {
        let source = "fn main() {\n    let café = \"<script>& *hi*\"; // note\n}\n";
        let markup = markup(source, "rust").unwrap();
        assert!(markup.contains("#c5a5df"));
        assert!(markup.contains("#dba984"));
        assert!(markup.contains("#7da877"));
        assert!(!markup.contains("<script>"));
        let parsed = StyledText::from_markdown(&markup).unwrap();
        let debug = format!("{parsed:?}");
        assert!(debug.contains("    let café"));
        assert!(debug.contains("<script>& *hi*"));
        assert!(debug.contains("Color("));
        assert_eq!(
            highlight(source, "txt"),
            StyledText::from_plain_text(source)
        );
    }

    #[test]
    fn language_comments_and_quoted_values_remain_separate() {
        for (text, language) in [
            ("let x: &'a str = \"https://example.com\"; // note", "rs"),
            ("def f():\n    return '#literal' # note", "py"),
            ("SELECT 'it''s fine' -- note", "sql"),
            ("{\"name\": \"value\", \"count\": 42}", "json"),
        ] {
            let markup = markup(text, language).unwrap();
            assert!(
                StyledText::from_markdown(&markup).is_ok(),
                "{language}: {markup}"
            );
            assert!(markup.contains("#dba984"));
        }
    }
}
