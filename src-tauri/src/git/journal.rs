use super::models::{GitError, GitErrorCode};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 同一行程內序列化日誌寫入;檔案本身以「寫暫存檔 + rename」做原子替換。
static JOURNAL_LOCK: Mutex<()> = Mutex::new(());

pub const MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SafetyOpType {
    Merge,
    Pull,
    Discard,
    StashApply,
    StashPop,
    CherryPick,
    DeleteBranch,
    Undo,
    Revert,
    Reset,
    Checkout,
    ResolveConflict,
    Rebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub timestamp: String,
    pub op_type: SafetyOpType,
    pub description: String,
    pub before_head: Option<String>,
    pub before_branch: Option<String>,
    /// 空字串表示該操作以 Skip 模式執行、沒有快照。
    pub snapshot_ref: String,
    pub after_head: Option<String>,
    pub deleted_branch: Option<String>,
    pub deleted_branch_tip: Option<String>,
}

fn journal_path(git_dir: &Path) -> PathBuf {
    git_dir.join("vapor").join("journal.json")
}

fn io_error(action: &str, error: impl std::fmt::Display) -> GitError {
    GitError {
        code: GitErrorCode::CommandFailed,
        message: format!("Could not {action} the safety-net journal."),
        hint: "Check .git directory permissions and try again.".to_string(),
        stderr: error.to_string(),
    }
}

pub fn read_journal(git_dir: &Path) -> Result<Vec<JournalEntry>, GitError> {
    match std::fs::read_to_string(journal_path(git_dir)) {
        Ok(content) => serde_json::from_str(&content).map_err(|error| io_error("parse", error)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(io_error("read", error)),
    }
}

fn write_journal(git_dir: &Path, entries: &[JournalEntry]) -> Result<(), GitError> {
    let path = journal_path(git_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| io_error("prepare", error))?;
    }
    let serialized =
        serde_json::to_string_pretty(entries).map_err(|error| io_error("serialize", error))?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serialized).map_err(|error| io_error("write", error))?;
    std::fs::rename(&temp, &path).map_err(|error| io_error("replace", error))
}

pub fn append_entry(git_dir: &Path, entry: JournalEntry) -> Result<(), GitError> {
    let _guard = JOURNAL_LOCK.lock().expect("journal lock poisoned");
    let mut entries = read_journal(git_dir)?;
    entries.push(entry);
    let overflow = entries.len().saturating_sub(MAX_ENTRIES);
    let trimmed = entries.split_off(overflow);
    write_journal(git_dir, &trimmed)
}

pub fn set_after_head(
    git_dir: &Path,
    id: &str,
    after_head: Option<String>,
) -> Result<(), GitError> {
    let _guard = JOURNAL_LOCK.lock().expect("journal lock poisoned");
    let entries: Vec<JournalEntry> = read_journal(git_dir)?
        .into_iter()
        .map(|entry| {
            if entry.id == id {
                JournalEntry { after_head: after_head.clone(), ..entry }
            } else {
                entry
            }
        })
        .collect();
    write_journal(git_dir, &entries)
}

pub fn remove_entries(git_dir: &Path, ids: &[String]) -> Result<(), GitError> {
    let _guard = JOURNAL_LOCK.lock().expect("journal lock poisoned");
    let entries: Vec<JournalEntry> = read_journal(git_dir)?
        .into_iter()
        .filter(|entry| !ids.contains(&entry.id))
        .collect();
    write_journal(git_dir, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_git_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "vapor-journal-test-{}-{count}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(id: &str) -> JournalEntry {
        JournalEntry {
            id: id.to_string(),
            timestamp: "2026-06-11T00:00:00Z".to_string(),
            op_type: SafetyOpType::Discard,
            description: format!("Discard changes {id}"),
            before_head: Some("abc".to_string()),
            before_branch: Some("main".to_string()),
            snapshot_ref: format!("refs/vapor/snapshots/{id}"),
            after_head: None,
            deleted_branch: None,
            deleted_branch_tip: None,
        }
    }

    #[test]
    fn read_missing_journal_returns_empty() {
        assert_eq!(read_journal(&temp_git_dir()).unwrap(), Vec::<JournalEntry>::new());
    }

    #[test]
    fn append_then_read_round_trips() {
        let dir = temp_git_dir();
        append_entry(&dir, entry("a")).unwrap();
        append_entry(&dir, entry("b")).unwrap();
        let entries = read_journal(&dir).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].id, "b");
    }

    #[test]
    fn set_after_head_updates_matching_entry() {
        let dir = temp_git_dir();
        append_entry(&dir, entry("a")).unwrap();
        set_after_head(&dir, "a", Some("def".to_string())).unwrap();
        assert_eq!(read_journal(&dir).unwrap()[0].after_head, Some("def".to_string()));
    }

    #[test]
    fn set_after_head_noop_on_unknown_id() {
        let dir = temp_git_dir();
        append_entry(&dir, entry("a")).unwrap();
        set_after_head(&dir, "missing", Some("def".to_string())).unwrap();
        let entries = read_journal(&dir).unwrap();
        assert_eq!(entries, vec![entry("a")]);
    }

    #[test]
    fn append_trims_to_max_entries() {
        let dir = temp_git_dir();
        for index in 0..(MAX_ENTRIES + 5) {
            append_entry(&dir, entry(&format!("e{index}"))).unwrap();
        }
        let entries = read_journal(&dir).unwrap();
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries.last().unwrap().id, format!("e{}", MAX_ENTRIES + 4));
    }

    #[test]
    fn remove_entries_deletes_by_id() {
        let dir = temp_git_dir();
        append_entry(&dir, entry("a")).unwrap();
        append_entry(&dir, entry("b")).unwrap();
        remove_entries(&dir, &["a".to_string()]).unwrap();
        let entries = read_journal(&dir).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "b");
    }
}
