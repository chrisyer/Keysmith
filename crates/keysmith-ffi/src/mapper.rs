use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

use keysmith_core::domain::{
    FieldPurpose, FieldType, ItemCategory, ItemDetail, ItemDraft, PasskeyCredential,
};
use keysmith_core::passkey::{decode_credential_id_bytes, encode_b64u, normalize_rp_id};
use keysmith_core::search::score_search_query;
use keysmith_core::CoreError;

#[derive(Debug, Clone, thiserror::Error, uniffi::Error)]
pub enum FfiError {
    #[error("{msg}")]
    Authentication { msg: String },
    #[error("{msg}")]
    InvalidMasterPassword { msg: String },
    #[error("{msg}")]
    TwoFactorRequired { msg: String },
    #[error("{msg}")]
    Biometric { msg: String },
    #[error("{msg}")]
    Validation { msg: String },
    #[error("{msg}")]
    Network { msg: String },
    #[error("{msg}")]
    Locked { msg: String },
    #[error("{msg}")]
    InvalidState { msg: String },
    #[error("{msg}")]
    Crypto { msg: String },
    #[error("{msg}")]
    Storage { msg: String },
    #[error("{msg}")]
    Internal { msg: String },
}

impl From<CoreError> for FfiError {
    fn from(err: CoreError) -> Self {
        match err {
            CoreError::Auth {
                message,
                two_factor_required: true,
                two_factor_providers,
            } => {
                let msg = if two_factor_providers.is_empty() {
                    message
                } else {
                    let list: Vec<String> =
                        two_factor_providers.iter().map(|p| p.to_string()).collect();
                    format!("{message} [providers:{}]", list.join(","))
                };
                FfiError::TwoFactorRequired { msg }
            }
            CoreError::Auth { message, .. } => {
                let lower = message.to_ascii_lowercase();
                if message.contains("主密码校验失败") || lower.contains("invalid master password")
                {
                    FfiError::InvalidMasterPassword { msg: message }
                } else {
                    FfiError::Authentication { msg: message }
                }
            }
            CoreError::Unauthorized(msg) => FfiError::Authentication { msg },
            CoreError::Biometric(msg) => FfiError::Biometric { msg },
            CoreError::Validation(msg) | CoreError::NotFound(msg) => FfiError::Validation { msg },
            CoreError::Network(msg) => FfiError::Network { msg },
            CoreError::InvalidState(msg) => {
                let lower = msg.to_ascii_lowercase();
                if msg.contains("锁定") || lower.contains("locked") {
                    FfiError::Locked { msg }
                } else {
                    FfiError::InvalidState { msg }
                }
            }
            CoreError::Conflict(msg) => FfiError::InvalidState { msg },
            CoreError::Crypto(msg) => FfiError::Crypto { msg },
            CoreError::Storage(msg) => FfiError::Storage { msg },
            CoreError::Clipboard(msg) | CoreError::Internal(msg) => FfiError::Internal { msg },
        }
    }
}

impl From<FfiError> for CoreError {
    fn from(err: FfiError) -> Self {
        match err {
            FfiError::Authentication { msg } | FfiError::InvalidMasterPassword { msg } => {
                CoreError::auth(msg)
            }
            FfiError::TwoFactorRequired { msg } => CoreError::two_factor_required(msg, Vec::new()),
            FfiError::Biometric { msg } => CoreError::Biometric(msg),
            FfiError::Validation { msg } => CoreError::Validation(msg),
            FfiError::Network { msg } => CoreError::Network(msg),
            FfiError::Locked { msg } | FfiError::InvalidState { msg } => {
                CoreError::InvalidState(msg)
            }
            FfiError::Crypto { msg } => CoreError::Crypto(msg),
            FfiError::Storage { msg } => CoreError::Storage(msg),
            FfiError::Internal { msg } => CoreError::Internal(msg),
        }
    }
}

pub fn to_json_string<T: Serialize>(value: &T) -> Result<String, FfiError> {
    serde_json::to_string(value).map_err(|e| FfiError::Internal {
        msg: format!("JSON 序列化失败: {e}"),
    })
}

pub fn parse_json<T: DeserializeOwned>(raw: &str) -> Result<T, FfiError> {
    serde_json::from_str(raw).map_err(|e| FfiError::Validation {
        msg: format!("JSON 解析失败: {e}"),
    })
}

/// Scrub `privateKeyPkcs8` from serialized `ItemDetail` JSON so Passkey private keys
/// never cross the FFI boundary to Swift/UI layers.
pub fn serialize_redacted_item_detail(item: &ItemDetail) -> Result<String, FfiError> {
    let mut val = serde_json::to_value(item).map_err(|e| FfiError::Internal {
        msg: format!("序列化条目详情失败: {e}"),
    })?;
    if let Some(arr) = val.get_mut("passkeys").and_then(|v| v.as_array_mut()) {
        for pk in arr {
            if let Some(obj) = pk.as_object_mut() {
                obj.remove("privateKeyPkcs8");
            }
        }
    }
    serde_json::to_string(&val).map_err(|e| FfiError::Internal {
        msg: format!("编码条目详情 JSON 失败: {e}"),
    })
}

/// Parse an `ItemDraft` JSON payload where `passkeys[].privateKeyPkcs8` may be omitted
/// (because `item_get_json` scrubs it), and preserve existing private keys on update.
pub fn parse_item_draft_preserving_passkeys(
    draft_json: &str,
    existing: Option<&ItemDetail>,
) -> Result<ItemDraft, FfiError> {
    let mut val: Value = parse_json(draft_json)?;
    if let Some(arr) = val.get_mut("passkeys").and_then(|v| v.as_array_mut()) {
        for pk in arr {
            if let Some(obj) = pk.as_object_mut() {
                obj.entry("privateKeyPkcs8")
                    .or_insert_with(|| Value::String(String::new()));
                obj.entry("publicKeySpki")
                    .or_insert_with(|| Value::String(String::new()));
                obj.entry("aaguid")
                    .or_insert_with(|| Value::String(String::new()));
                obj.entry("transports")
                    .or_insert_with(|| Value::Array(Vec::new()));
                obj.entry("backedUp").or_insert_with(|| Value::Bool(true));
                obj.entry("discoverable").or_insert_with(|| Value::Bool(true));
                obj.entry("signCount")
                    .or_insert_with(|| Value::Number(0.into()));
                obj.entry("algorithm")
                    .or_insert_with(|| Value::Number((-7).into()));
                obj.entry("createdAt")
                    .or_insert_with(|| Value::String(chrono::Utc::now().to_rfc3339()));
            }
        }
    }
    let mut draft: ItemDraft = serde_json::from_value(val).map_err(|e| FfiError::Validation {
        msg: format!("解析 ItemDraft 失败: {e}"),
    })?;

    if let Some(prev) = existing {
        for pk in &mut draft.passkeys {
            if pk.private_key_pkcs8.trim().is_empty() {
                if let Some(orig) = prev
                    .payload
                    .passkeys
                    .iter()
                    .find(|op| op.credential_id == pk.credential_id)
                {
                    pk.private_key_pkcs8 = orig.private_key_pkcs8.clone();
                    if pk.public_key_spki.trim().is_empty() {
                        pk.public_key_spki = orig.public_key_spki.clone();
                    }
                    if pk.aaguid.trim().is_empty() {
                        pk.aaguid = orig.aaguid.clone();
                    }
                }
            }
        }
    }
    Ok(draft)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCandidateDto {
    pub item_id: String,
    pub title: String,
    pub vault_id: String,
    pub credential_id: String,
    pub credential_id_b64u: String,
    pub rp_id: String,
    pub rp_name: String,
    pub user_handle: String,
    pub user_handle_b64u: String,
    pub user_name: String,
    pub user_display_name: String,
    pub algorithm: i32,
    pub sign_count: u32,
    pub discoverable: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    pub reprompt: bool,
}

pub fn build_passkey_candidate(
    item: &ItemDetail,
    pk: &PasskeyCredential,
) -> PasskeyCandidateDto {
    let cred_b64u = decode_credential_id_bytes(&pk.credential_id)
        .map(|b| encode_b64u(&b))
        .unwrap_or_else(|_| pk.credential_id.clone());
    let uh_b64u = keysmith_core::passkey::decode_b64u_or_b64(&pk.user_handle)
        .map(|b| encode_b64u(&b))
        .unwrap_or_else(|_| pk.user_handle.clone());
    PasskeyCandidateDto {
        item_id: item.id.clone(),
        title: item.title.clone(),
        vault_id: item.vault_id.clone(),
        credential_id: pk.credential_id.clone(),
        credential_id_b64u: cred_b64u,
        rp_id: normalize_rp_id(&pk.rp_id),
        rp_name: pk.rp_name.clone(),
        user_handle: pk.user_handle.clone(),
        user_handle_b64u: uh_b64u,
        user_name: pk.user_name.clone(),
        user_display_name: pk.user_display_name.clone(),
        algorithm: pk.algorithm,
        sign_count: pk.sign_count,
        discoverable: pk.discoverable,
        created_at: pk.created_at.clone(),
        last_used_at: pk.last_used_at.clone(),
        reprompt: item.payload.reprompt,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextInsertCandidateDto {
    pub id: String,
    pub item_id: String,
    pub item_title: String,
    pub category: ItemCategory,
    pub label: String,
    pub value: String,
    pub is_sensitive: bool,
    pub field_type: FieldType,
}

pub fn collect_text_insert_candidates(
    items: &[ItemDetail],
    vaults: &[keysmith_core::domain::Vault],
    query: &str,
) -> Vec<TextInsertCandidateDto> {
    let trimmed_q = query.trim();
    let mut scored_items: Vec<(&ItemDetail, u32)> = items
        .iter()
        .filter(|it| it.deleted_at.is_none() && !it.payload.archived)
        .filter_map(|it| {
            if trimmed_q.is_empty() {
                Some((it, 0))
            } else {
                score_search_query(it, vaults, trimmed_q).map(|s| (it, s))
            }
        })
        .collect();

    if !trimmed_q.is_empty() {
        scored_items.sort_by(|(a, sa), (b, sb)| {
            sb.cmp(sa)
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
    } else {
        scored_items.sort_by(|(a, _), (b, _)| {
            let prio = |cat: ItemCategory| match cat {
                ItemCategory::CreditCard => 0,
                ItemCategory::Identity => 1,
                ItemCategory::BankAccount => 2,
                ItemCategory::DriverLicense | ItemCategory::Passport => 3,
                ItemCategory::SecureNote => 4,
                ItemCategory::ApiCredential => 5,
                _ => 6,
            };
            prio(a.payload.category)
                .cmp(&prio(b.payload.category))
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
    }

    let mut out = Vec::new();
    for (item, _) in scored_items {
        for sec in &item.payload.sections {
            for field in &sec.fields {
                if field.value.trim().is_empty() || field.field_type == FieldType::Totp {
                    continue;
                }
                let is_sensitive = field.sensitive
                    || matches!(
                        field.purpose,
                        Some(FieldPurpose::Password)
                            | Some(FieldPurpose::CardCvv)
                            | Some(FieldPurpose::Pin)
                    );
                out.push(TextInsertCandidateDto {
                    id: format!("{}:{}", item.id, field.id),
                    item_id: item.id.clone(),
                    item_title: item.title.clone(),
                    category: item.payload.category,
                    label: field.label.clone(),
                    value: field.value.clone(),
                    is_sensitive,
                    field_type: field.field_type,
                });
            }
        }
        if !item.payload.notes.trim().is_empty() {
            out.push(TextInsertCandidateDto {
                id: format!("{}:notes", item.id),
                item_id: item.id.clone(),
                item_title: item.title.clone(),
                category: item.payload.category,
                label: "安全备注".to_string(),
                value: item.payload.notes.clone(),
                is_sensitive: item.payload.category == ItemCategory::SecureNote,
                field_type: FieldType::Multiline,
            });
        }
    }
    out
}
