use super::models::SshDiagnostics;
use std::path::PathBuf;
use std::process::Command;

/// 純核心:由已蒐集好的事實組出診斷結果,方便測試。
/// `config_exists` 為 None 時視為 false。
pub fn diagnose(
    config_exists: Option<bool>,
    agent_socket: Option<&str>,
    key_files: &[String],
    credential_helper: Option<String>,
) -> SshDiagnostics {
    SshDiagnostics {
        agent_running: agent_socket.map(|s| !s.is_empty()).unwrap_or(false),
        ssh_config_exists: config_exists.unwrap_or(false),
        key_files: key_files.to_vec(),
        credential_helper,
    }
}

/// best-effort:對真實環境蒐集事實後丟給 `diagnose`。任何探針失敗都降級為「未偵測」。
pub fn diagnostics() -> SshDiagnostics {
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    let ssh_dir = home.as_ref().map(|h| h.join(".ssh"));

    let config_exists = ssh_dir.as_ref().map(|d| d.join("config").exists());

    // 只有 socket 檔實際存在才算 agent 在運作(避免殘留的 SSH_AUTH_SOCK 誤判)。
    let agent_socket = std::env::var("SSH_AUTH_SOCK")
        .ok()
        .filter(|s| std::path::Path::new(s).exists());

    let key_files = ssh_dir
        .as_ref()
        .and_then(|d| std::fs::read_dir(d).ok())
        .map(|entries| {
            let mut keys: Vec<String> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|name| name.starts_with("id_") && !name.ends_with(".pub"))
                .collect();
            keys.sort();
            keys
        })
        .unwrap_or_default();

    let credential_helper = Command::new("git")
        .args(["config", "--get", "credential.helper"])
        .env("PATH", super::login_env::effective_path())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    diagnose(config_exists, agent_socket.as_deref(), &key_files, credential_helper)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_agent_from_socket_env() {
        let d = diagnose(None, Some("/tmp/agent.sock"), &[], None);
        assert!(d.agent_running);
    }

    #[test]
    fn no_agent_when_socket_absent() {
        let d = diagnose(None, None, &[], None);
        assert!(!d.agent_running);
    }

    #[test]
    fn lists_key_files_and_config() {
        let d = diagnose(
            Some(true),
            None,
            &["id_ed25519".to_string(), "id_rsa".to_string()],
            Some("osxkeychain".to_string()),
        );
        assert!(d.ssh_config_exists);
        assert_eq!(d.key_files, vec!["id_ed25519", "id_rsa"]);
        assert_eq!(d.credential_helper.as_deref(), Some("osxkeychain"));
    }
}
