use super::models::{GitError, GitErrorCode, HunkSelection};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Add,
    Del,
    /// `\ No newline at end of file` 標記行。
    NoNewline,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: LineKind,
    /// 整行原文(含前導 +/-/空白),不含換行字元。
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hunk {
    pub old_start: usize,
    pub new_start: usize,
    /// hunk body 各行(不含 `@@` 標頭行)。
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDiff {
    /// 第一個 `@@` 之前的所有行(diff --git / index / --- / +++ 等)。
    pub header: Vec<String>,
    pub hunks: Vec<Hunk>,
}

/// 解析 `@@ -a[,b] +c[,d] @@ …` 取出 old_start(a)與 new_start(c)。
fn parse_hunk_header(line: &str) -> Option<(usize, usize)> {
    let rest = line.strip_prefix("@@ -")?;
    let mut parts = rest.splitn(2, " +");
    let old_part = parts.next()?;
    let new_rest = parts.next()?;
    let old_start = old_part.split(',').next()?.parse().ok()?;
    let new_part = new_rest.split(" @@").next()?;
    let new_start = new_part.split(',').next()?.parse().ok()?;
    Some((old_start, new_start))
}

pub fn parse_file_diff(diff: &str) -> Result<FileDiff, GitError> {
    let mut header: Vec<String> = Vec::new();
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut iter = diff.lines().peekable();

    // 第一個 @@ 之前都是 header。
    while let Some(line) = iter.peek() {
        if line.starts_with("@@") {
            break;
        }
        header.push((*line).to_string());
        iter.next();
    }

    while let Some(line) = iter.peek() {
        if !line.starts_with("@@") {
            break;
        }
        let header_line = (*line).to_string();
        let (old_start, new_start) = parse_hunk_header(&header_line).ok_or_else(|| GitError {
            code: GitErrorCode::CommandFailed,
            message: "Malformed diff hunk header.".to_string(),
            hint: "Refresh the diff and try again.".to_string(),
            stderr: header_line.clone(),
        })?;
        iter.next();

        let mut lines: Vec<DiffLine> = Vec::new();
        while let Some(body) = iter.peek() {
            if body.starts_with("@@") || body.starts_with("diff --git") {
                break;
            }
            let kind = match body.chars().next() {
                Some('+') => LineKind::Add,
                Some('-') => LineKind::Del,
                Some('\\') => LineKind::NoNewline,
                _ => LineKind::Context,
            };
            lines.push(DiffLine { kind, text: (*body).to_string() });
            iter.next();
        }
        hunks.push(Hunk { old_start, new_start, lines });
    }

    Ok(FileDiff { header, hunks })
}

pub fn build_partial_patch(
    diff: &FileDiff,
    hunks: &[HunkSelection],
) -> Result<String, GitError> {
    let mut out: Vec<String> = diff.header.clone();
    let mut emitted_any = false;

    for sel in hunks {
        let hunk = diff.hunks.get(sel.index).ok_or_else(|| GitError {
            code: GitErrorCode::CommandFailed,
            message: "Selection references a missing hunk.".to_string(),
            hint: "Refresh the diff and try again.".to_string(),
            stderr: String::new(),
        })?;
        let selected: HashSet<usize> = sel.selected_lines.iter().copied().collect();

        // 該 hunk 是否有任何被勾選的變更行;沒有就整段排除。
        let has_change = hunk
            .lines
            .iter()
            .enumerate()
            .any(|(i, line)| {
                matches!(line.kind, LineKind::Add | LineKind::Del) && selected.contains(&i)
            });
        if !has_change {
            continue;
        }

        let mut body: Vec<String> = Vec::new();
        let mut old_count = 0usize;
        let mut new_count = 0usize;
        // 追蹤上一行是否被保留,用來決定 no-newline 標記是否跟著保留。
        let mut last_kept = false;

        for (i, line) in hunk.lines.iter().enumerate() {
            match line.kind {
                LineKind::Context => {
                    body.push(line.text.clone());
                    old_count += 1;
                    new_count += 1;
                    last_kept = true;
                }
                LineKind::Add => {
                    if selected.contains(&i) {
                        body.push(line.text.clone());
                        new_count += 1;
                        last_kept = true;
                    } else {
                        // 未勾選的新增 → 整行刪除(不進 patch)。
                        last_kept = false;
                    }
                }
                LineKind::Del => {
                    if selected.contains(&i) {
                        body.push(line.text.clone());
                        old_count += 1;
                        last_kept = true;
                    } else {
                        // 未勾選的刪除 → 轉成 context(該刪除不被套用)。
                        let converted = format!(" {}", &line.text[1..]);
                        body.push(converted);
                        old_count += 1;
                        new_count += 1;
                        last_kept = true;
                    }
                }
                LineKind::NoNewline => {
                    if last_kept {
                        body.push(line.text.clone());
                    }
                }
            }
        }

        out.push(format!(
            "@@ -{},{} +{},{} @@",
            hunk.old_start, old_count, hunk.new_start, new_count
        ));
        out.extend(body);
        emitted_any = true;
    }

    if !emitted_any {
        return Err(GitError {
            code: GitErrorCode::InvalidInput,
            message: "No changes selected.".to_string(),
            hint: "Select at least one changed line or a hunk to apply.".to_string(),
            stderr: String::new(),
        });
    }

    let mut patch = out.join("\n");
    patch.push('\n');
    Ok(patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "diff --git a/README.md b/README.md\nindex 1234567..89abcde 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,4 @@\n line one\n-line two\n+line two changed\n+line three new\n line four\n";

    #[test]
    fn parses_header_and_single_hunk() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        assert_eq!(parsed.header.len(), 4);
        assert_eq!(parsed.header[0], "diff --git a/README.md b/README.md");
        assert_eq!(parsed.hunks.len(), 1);
        let hunk = &parsed.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.lines.len(), 5);
        assert_eq!(hunk.lines[0].kind, LineKind::Context);
        assert_eq!(hunk.lines[1].kind, LineKind::Del);
        assert_eq!(hunk.lines[2].kind, LineKind::Add);
        assert_eq!(hunk.lines[3].kind, LineKind::Add);
        assert_eq!(hunk.lines[4].kind, LineKind::Context);
        assert_eq!(hunk.lines[1].text, "-line two");
    }

    #[test]
    fn all_selected_equals_original() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        // 選取全部變更行(1=del, 2=add, 3=add)。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![1, 2, 3] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert_eq!(patch, SAMPLE);
    }

    #[test]
    fn selecting_one_add_drops_other_changes() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        // 只選第 2 行(+line two changed),不選刪除與另一個新增。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![2] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        let expected = "diff --git a/README.md b/README.md\nindex 1234567..89abcde 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,4 @@\n line one\n line two\n+line two changed\n line four\n";
        assert_eq!(patch, expected);
    }

    #[test]
    fn selecting_only_deletion_keeps_minus_and_recounts() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        // 只選刪除行(index 1),兩個新增都不選。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![1] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        let expected = "diff --git a/README.md b/README.md\nindex 1234567..89abcde 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,2 @@\n line one\n-line two\n line four\n";
        assert_eq!(patch, expected);
    }

    #[test]
    fn empty_selection_is_rejected() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![] }];
        let error = build_partial_patch(&parsed, &selection).expect_err("empty");
        assert_eq!(error.code, GitErrorCode::InvalidInput);
    }

    #[test]
    fn preserves_no_newline_marker_for_kept_line() {
        let diff = "--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file\n";
        let parsed = parse_file_diff(diff).expect("parse");
        // body: 0=-old, 1=+new, 2=\ No newline
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![0, 1] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert!(patch.contains("\\ No newline at end of file"), "marker kept: {patch}");
        assert!(patch.contains("+new"));
    }

    #[test]
    fn drops_no_newline_marker_when_owner_line_dropped() {
        let diff = "--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file\n";
        let parsed = parse_file_diff(diff).expect("parse");
        // 只選刪除(0),不選新增(1)→ 新增被丟,其後的 no-newline 標記也應被丟。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![0] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert!(!patch.contains("No newline"), "marker dropped with its owner: {patch}");
    }

    #[test]
    fn emits_only_hunks_with_selected_changes() {
        let diff = "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10,2 +10,2 @@\n j\n-k\n+K\n";
        let parsed = parse_file_diff(diff).expect("parse");
        assert_eq!(parsed.hunks.len(), 2);
        // 第一個 hunk body: 0=' a',1='-b',2='+B';只選第二個 hunk(index 1)的變更行。
        let selection = vec![HunkSelection { index: 1, selected_lines: vec![1, 2] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert!(patch.contains("+K"), "second hunk present: {patch}");
        assert!(!patch.contains("+B"), "first hunk excluded: {patch}");
        // 只有一個 @@ 標頭被輸出。
        assert_eq!(patch.matches("@@ -").count(), 1);
    }

    #[test]
    fn binary_diff_parses_with_no_hunks() {
        let diff = "diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n";
        let parsed = parse_file_diff(diff).expect("parse");
        assert!(parsed.hunks.is_empty());
        let error = build_partial_patch(&parsed, &[]).expect_err("no hunks");
        assert_eq!(error.code, GitErrorCode::InvalidInput);
    }
}
