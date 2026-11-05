use std::sync::OnceLock;

use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use syntect::parsing::{ParseState, ScopeStack, SyntaxDefinition, SyntaxSet};

const TOML_SYNTAX: &str = r##"%YAML 1.2
---
name: TOML
file_extensions: [toml]
scope: source.toml
contexts:
  main:
    - match: '#.*$'
      scope: comment.line.number-sign.toml
    - match: '^\s*\[\[?[^\]\n]*\]\]?'
      scope: entity.name.type.table.toml
    - match: '"""'
      push: triple
    - match: '"'
      push: dq
    - match: "'[^'\\n]*'"
      scope: string.quoted.single.toml
    - match: '\b(?:true|false)\b'
      scope: constant.language.boolean.toml
    - match: '[+-]?\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b'
      scope: constant.numeric.toml
    - match: '^\s*[A-Za-z0-9_.-]+(?=\s*=)'
      scope: entity.name.function.key.toml
  dq:
    - meta_scope: string.quoted.double.toml
    - match: '\\.'
    - match: '"'
      pop: true
  triple:
    - meta_scope: string.quoted.triple.toml
    - match: '"""'
      pop: true
"##;

fn syntaxes() -> &'static SyntaxSet {
    static SET: OnceLock<SyntaxSet> = OnceLock::new();
    SET.get_or_init(|| {
        let mut builder = SyntaxSet::load_defaults_newlines().into_builder();
        if let Ok(def) = SyntaxDefinition::load_from_str(TOML_SYNTAX, true, None) {
            builder.add(def);
        }
        builder.build()
    })
}

fn token_for(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "rust" | "rs" => "rs".into(),
        "ts" | "tsx" | "typescript" | "js" | "jsx" | "javascript" | "mjs" => "js".into(),
        "py" | "python" => "py".into(),
        "sh" | "bash" | "shell" | "zsh" => "sh".into(),
        "htm" | "html" => "html".into(),
        other => other.to_string(),
    }
}

pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

fn class_for(stack: &ScopeStack) -> Option<&'static str> {
    let names: Vec<String> = stack.as_slice().iter().map(|s| s.build_string()).collect();
    let has = |p: &str| names.iter().any(|n| n.starts_with(p));
    if has("comment") {
        Some("tok-c")
    } else if has("string") {
        Some("tok-s")
    } else if has("constant.numeric") {
        Some("tok-n")
    } else if has("entity.name.function") || has("support.function") || has("variable.function") {
        Some("tok-f")
    } else if has("entity.name.type")
        || has("entity.name.class")
        || has("entity.name.struct")
        || has("entity.other.inherited-class")
        || has("support.type")
        || has("support.class")
        || has("storage.type.primitive")
    {
        Some("tok-t")
    } else if has("keyword.operator") {
        None
    } else if has("keyword") || has("storage") || has("constant.language") {
        Some("tok-k")
    } else {
        None
    }
}

pub fn highlight_lines(lang: &str, code: &str) -> Vec<String> {
    let ps = syntaxes();
    let syntax = if lang.is_empty() {
        None
    } else {
        ps.find_syntax_by_token(&token_for(lang))
    };
    let Some(syntax) = syntax else {
        return code.lines().map(escape).collect();
    };
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut out = Vec::new();
    for raw in code.lines() {
        let line = format!("{raw}\n");
        let ops = match state.parse_line(&line, ps) {
            Ok(ops) => ops,
            Err(_) => {
                out.push(escape(raw));
                continue;
            }
        };
        let mut html = String::new();
        let mut pos = 0;
        let emit = |html: &mut String, text: &str, stack: &ScopeStack| {
            let text = text.trim_end_matches('\n');
            if text.is_empty() {
                return;
            }
            match class_for(stack) {
                Some(c) => html.push_str(&format!("<span class=\"{c}\">{}</span>", escape(text))),
                None => html.push_str(&escape(text)),
            }
        };
        for (i, op) in &ops {
            if *i > pos {
                emit(&mut html, &line[pos..*i], &stack);
                pos = *i;
            }
            let _ = stack.apply(op);
        }
        if pos < line.len() {
            emit(&mut html, &line[pos..], &stack);
        }
        out.push(html);
    }
    out
}

fn code_block_html(info: &str, code: &str) -> String {
    static TITLE: OnceLock<Regex> = OnceLock::new();
    let title_re = TITLE.get_or_init(|| Regex::new(r#"title\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
    let lang = info.split_whitespace().next().unwrap_or("");
    let lang = if lang.contains('=') { "" } else { lang };
    let title = title_re
        .captures(info)
        .and_then(|c| c.get(1).or_else(|| c.get(2)))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let code = code.strip_suffix('\n').unwrap_or(code);
    let lines = highlight_lines(lang, code);
    let nums: String = (1..=lines.len().max(1)).map(|n| format!("<div>{n}</div>")).collect();
    let body: String = if lines.is_empty() {
        "<div></div>".to_string()
    } else {
        lines.iter().map(|l| format!("<div>{l}</div>")).collect()
    };
    let badge = if lang.is_empty() {
        String::new()
    } else {
        format!("<span class=\"md-code-lang\">{}</span>", escape(lang))
    };
    format!(
        "<figure class=\"md-code\"><figcaption class=\"md-code-head\"><span class=\"md-code-meta\">{badge}{}</span>\
         <button type=\"button\" class=\"md-code-copy\" data-copy=\"1\">Copy</button></figcaption>\
         <div class=\"md-code-body\"><div class=\"md-code-nums\" aria-hidden=\"true\">{nums}</div>\
         <code class=\"md-code-text\">{body}</code></div></figure>",
        escape(&title)
    )
}

fn sanitize(html: &str) -> String {
    let mut b = ammonia::Builder::default();
    b.add_tags(["figure", "figcaption", "button", "div", "span", "del"])
        .add_generic_attributes(["class"])
        .add_generic_attribute_prefixes(["data-"])
        .add_tag_attributes("button", ["type", "aria-label", "aria-pressed"])
        .add_tag_attributes("div", ["aria-hidden"]);
    b.clean(html).to_string()
}

pub fn render(md: &str) -> String {
    let opts = Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH;
    let mut events: Vec<Event> = Vec::new();
    let mut code: Option<String> = None;
    let mut buf = String::new();
    let mut check = 0usize;
    for ev in Parser::new_ext(md, opts) {
        match ev {
            Event::Start(Tag::CodeBlock(kind)) => {
                code = Some(match kind {
                    CodeBlockKind::Fenced(i) => i.to_string(),
                    CodeBlockKind::Indented => String::new(),
                });
                buf.clear();
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some(info) = code.take() {
                    events.push(Event::Html(code_block_html(&info, &buf).into()));
                }
            }
            Event::Text(t) if code.is_some() => buf.push_str(&t),
            Event::TaskListMarker(on) => {
                let (cls, pressed, label) = if on {
                    ("md-check is-on", "true", "Mark as not done")
                } else {
                    ("md-check", "false", "Mark as done")
                };
                events.push(Event::Html(
                    format!(
                        "<button type=\"button\" class=\"{cls}\" data-check=\"{check}\" aria-pressed=\"{pressed}\" aria-label=\"{label}\"></button>"
                    )
                    .into(),
                ));
                check += 1;
            }
            other => {
                if code.is_none() {
                    events.push(other);
                }
            }
        }
    }
    let mut out = String::new();
    html::push_html(&mut out, events.into_iter());
    sanitize(&out)
}

#[tauri::command]
pub fn render_markdown(md: String) -> String {
    render(&md)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_basic_gfm() {
        let h = render("# Title\n\n**bold** ~~gone~~ `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |");
        assert!(h.contains("<h1>Title</h1>"));
        assert!(h.contains("<strong>bold</strong>"));
        assert!(h.contains("<del>gone</del>"));
        assert!(h.contains("<code>code</code>"));
        assert!(h.contains("<table>"));
    }

    #[test]
    fn task_lists_become_indexed_buttons() {
        let h = render("- [x] done\n- [ ] open");
        assert!(h.contains("data-check=\"0\""));
        assert!(h.contains("data-check=\"1\""));
        assert!(h.contains("is-on"));
    }

    #[test]
    fn strips_scripts_and_event_handlers() {
        let h = render("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))");
        assert!(!h.contains("<script"));
        assert!(!h.contains("onerror"));
        assert!(!h.contains("javascript:"));
    }

    #[test]
    fn fenced_code_has_badge_title_numbers_and_highlight() {
        let h = render("```rust title=\"bump_version.rs\"\nuse std::fs;\npub fn go() -> i32 {\n    1\n}\n```");
        assert!(h.contains("md-code-lang\">rust"));
        assert!(h.contains("bump_version.rs"));
        assert!(h.contains("data-copy"));
        assert!(h.contains("<div>4</div>"));
        assert!(h.contains("tok-k"));
    }

    #[test]
    fn code_is_html_escaped() {
        let h = render("```html\n<b>hi</b>\n```");
        assert!(!h.contains("<b>hi"));
        assert!(h.contains("&lt;"));
    }

    #[test]
    fn supported_languages_highlight() {
        for (lang, src) in [
            ("rust", "fn main() { let x = 1; }"),
            ("ts", "const a: number = 1;"),
            ("js", "function f() { return \"x\"; }"),
            ("python", "def f():\n    return 1"),
            ("bash", "echo \"hi\" | grep h"),
            ("json", "{\"a\": 1}"),
            ("toml", "[package]\nname = \"x\"\nn = 3"),
            ("sql", "SELECT * FROM t WHERE a = 1;"),
            ("html", "<div class=\"a\">x</div>"),
            ("css", "a { color: red; }"),
        ] {
            let lines = highlight_lines(lang, src);
            assert!(lines.iter().any(|l| l.contains("<span")), "no highlight for {lang}");
        }
    }
}
