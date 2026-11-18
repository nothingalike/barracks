use crate::ResultBlock;
use slint::StyledText;

pub fn blocks(text: &str, markdown: bool) -> Vec<ResultBlock> {
    if !markdown {
        return vec![block(text, 4)];
    }
    let mut result = Vec::new();
    let mut paragraph = Vec::new();
    let mut code = None::<Vec<String>>;
    let mut code_language = String::new();
    for line in text.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            flush(&mut paragraph, &mut result);
            if let Some(code) = code.take() {
                result.extend(code_blocks(&code.join("\n"), &code_language));
            } else {
                code_language = line
                    .trim()
                    .trim_start_matches(['`', '~'])
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_owned();
                code = Some(Vec::new());
            }
        } else if let Some(code) = code.as_mut() {
            code.push(line.into());
        } else if line.trim().is_empty() {
            flush(&mut paragraph, &mut result);
        } else if let Some((heading, body)) = line
            .split_once(' ')
            .filter(|(heading, _)| heading.chars().all(|c| c == '#') && !heading.is_empty())
        {
            flush(&mut paragraph, &mut result);
            result.push(block(body, heading.len().min(3) as i32));
        } else if let Some(body) = line
            .trim_start()
            .strip_prefix("- ")
            .or_else(|| line.trim_start().strip_prefix("* "))
        {
            flush(&mut paragraph, &mut result);
            result.push(block(&format!("• {body}"), 0));
        } else if line
            .trim_start()
            .split_once(". ")
            .is_some_and(|(number, _)| {
                number.chars().all(|c| c.is_ascii_digit()) && !number.is_empty()
            })
        {
            flush(&mut paragraph, &mut result);
            result.push(block(line, 0));
        } else {
            paragraph.push(line.to_owned());
        }
    }
    flush(&mut paragraph, &mut result);
    if let Some(code) = code {
        result.extend(code_blocks(&code.join("\n"), &code_language));
    }
    result
}

pub fn code_blocks(text: &str, language: &str) -> Vec<ResultBlock> {
    vec![ResultBlock {
        content: crate::syntax::highlight(text, language),
        kind: 4,
    }]
}

fn flush(paragraph: &mut Vec<String>, result: &mut Vec<ResultBlock>) {
    if !paragraph.is_empty() {
        result.push(block(&paragraph.join("\n"), 0));
        paragraph.clear();
    }
}

fn block(text: &str, kind: i32) -> ResultBlock {
    let content = if kind == 4 {
        StyledText::from_plain_text(text)
    } else {
        StyledText::from_markdown(text).unwrap_or_else(|_| StyledText::from_plain_text(text))
    };
    ResultBlock { content, kind }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renders_headings_lists_and_code_without_losing_the_last_block() {
        let rendered = blocks(
            "# Plan\n\nA **small** plan.\n\n- Read files\n1. Build\n\n```rust\nfn main() {}\n```\n## Verify",
            true,
        );
        assert_eq!(
            rendered.iter().map(|b| b.kind).collect::<Vec<_>>(),
            [1, 0, 0, 0, 4, 2]
        );
        assert_eq!(blocks("# literal code", false)[0].kind, 4);
        assert_ne!(
            rendered[4].content,
            StyledText::from_plain_text("fn main() {}"),
            "A labeled Rust fence must receive syntax colors"
        );
    }
}
