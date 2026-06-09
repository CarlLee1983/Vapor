use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckId {
    GitAvailable,
    LoginPath,
    VaporCli,
    HuskyInit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

/// 修正方式。`Auto` 表示 `doctor_fix(id)` 可自動處理;`Manual` 提供可複製指引。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Fix {
    Auto { label: String },
    Manual { instructions: String },
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: CheckId,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    pub fix: Fix,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub checks: Vec<Check>,
}

/// 所有檢查所需的事實(僅後端內部用,不對外序列化)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts {
    pub git_version: Option<String>,
    pub login_resolved: bool,
    pub found_tool_dirs: Vec<String>,
    pub missing_tool_dirs: Vec<String>,
    pub cli_installed: bool,
    pub husky_init_present: bool,
    pub husky_init_has_path: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_fix_with_kind_tag() {
        let json = serde_json::to_string(&Fix::Auto { label: "x".to_string() }).expect("json");
        assert_eq!(json, r#"{"kind":"auto","label":"x"}"#);
    }

    #[test]
    fn serializes_none_fix_as_kind_only() {
        let json = serde_json::to_string(&Fix::None).expect("json");
        assert_eq!(json, r#"{"kind":"none"}"#);
    }

    #[test]
    fn serializes_check_id_as_camel_case() {
        let json = serde_json::to_string(&CheckId::VaporCli).expect("json");
        assert_eq!(json, r#""vaporCli""#);
    }
}
