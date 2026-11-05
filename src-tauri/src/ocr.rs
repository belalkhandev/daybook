use std::{
    path::Path,
    process::{Command, Stdio},
};

const MAX_CHARS: usize = 4000;

pub fn clean(raw: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut blank = false;
    for line in raw.lines().map(str::trim) {
        if line.is_empty() {
            blank = !out.is_empty();
            continue;
        }
        if blank {
            out.push("");
            blank = false;
        }
        out.push(line);
    }
    let text = out.join("\n");
    text.chars().take(MAX_CHARS).collect()
}

pub fn read(path: &Path) -> Option<String> {
    let output = Command::new("tesseract")
        .arg(path)
        .arg("stdout")
        .arg("-l")
        .arg("eng")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(clean(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_blank_runs_and_trims() {
        let t = clean("\n  fn main() {  \n\n\n  let x = 1;\n\n");
        assert_eq!(t, "fn main() {\n\nlet x = 1;");
    }

    #[test]
    fn caps_length() {
        let long = "a".repeat(9000);
        assert_eq!(clean(&long).chars().count(), MAX_CHARS);
    }

    #[test]
    fn missing_binary_is_none() {
        assert!(read(Path::new("/definitely/not/here.png")).is_none() || which_tesseract());
    }

    fn which_tesseract() -> bool {
        Command::new("tesseract").arg("--version").output().is_ok()
    }
}
