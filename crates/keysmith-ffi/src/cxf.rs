use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use keysmith_core::domain::{
    FieldPurpose, FieldType, ItemCategory, ItemDetail, ItemDraft, ItemField, ItemSection, ItemUrl,
    PasskeyCredential, UrlMatchRule, DEFAULT_PERSONAL_VAULT_ID,
};
use keysmith_core::passkey::{decode_credential_id_bytes, encode_b64u, normalize_rp_id};

use crate::mapper::FfiError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CxfVersion {
    major: u32,
    minor: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CxfBundle {
    #[serde(default = "default_cxf_version")]
    version: CxfVersion,
    #[serde(default)]
    exporter: String,
    #[serde(default)]
    timestamp: i64,
    #[serde(default)]
    accounts: Vec<CxfAccount>,
    #[serde(default)]
    credentials: Vec<Value>,
}

fn default_cxf_version() -> CxfVersion {
    CxfVersion { major: 1, minor: 0 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CxfAccount {
    #[serde(default)]
    id: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    credentials: Vec<Value>,
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", &Uuid::new_v4().to_string()[..8])
}

/// Export active non-trashed vault items into a FIDO Credential Exchange Format (CXF) JSON bundle.
/// Only invoked after explicit user authentication; never includes master keys or OAuth tokens.
pub fn export_cxf_bundle_json(
    items: &[ItemDetail],
    account_id: &str,
    account_email: &str,
    display_name: &str,
) -> Result<String, FfiError> {
    let mut credentials: Vec<Value> = Vec::new();

    for item in items {
        if item.deleted_at.is_some() {
            continue;
        }
        let all_fields: Vec<&ItemField> = item
            .payload
            .sections
            .iter()
            .flat_map(|s| s.fields.iter())
            .collect();
        let urls: Vec<String> = item
            .payload
            .urls
            .iter()
            .map(|u| u.uri.clone())
            .filter(|u| !u.trim().is_empty())
            .collect();

        let mut creds_for_item: Vec<Value> = Vec::new();

        let username = all_fields
            .iter()
            .find(|f| f.purpose == Some(FieldPurpose::Username))
            .map(|f| f.value.clone())
            .unwrap_or_default();
        let password = all_fields
            .iter()
            .find(|f| f.purpose == Some(FieldPurpose::Password))
            .map(|f| f.value.clone())
            .unwrap_or_default();
        let totp = all_fields
            .iter()
            .find(|f| f.field_type == FieldType::Totp || f.purpose == Some(FieldPurpose::Totp))
            .map(|f| f.value.clone());

        if !username.is_empty() || !password.is_empty() {
            creds_for_item.push(json!({
                "type": "basic-auth",
                "username": { "fieldType": "string", "value": username },
                "password": { "fieldType": "concealed-string", "value": password },
            }));
        }

        if let Some(secret) = totp.filter(|s| !s.trim().is_empty()) {
            creds_for_item.push(json!({
                "type": "totp",
                "secret": secret,
                "period": 30,
                "digits": 6,
                "algorithm": "sha1",
            }));
        }

        for pk in &item.payload.passkeys {
            let cred_id_b64u = decode_credential_id_bytes(&pk.credential_id)
                .map(|b| encode_b64u(&b))
                .unwrap_or_else(|_| pk.credential_id.clone());
            let uh_b64u = keysmith_core::passkey::decode_b64u_or_b64(&pk.user_handle)
                .map(|b| encode_b64u(&b))
                .unwrap_or_else(|_| pk.user_handle.clone());
            creds_for_item.push(json!({
                "type": "passkey",
                "credentialId": cred_id_b64u,
                "rpId": pk.rp_id,
                "userName": pk.user_name,
                "userDisplayName": pk.user_display_name,
                "userHandle": uh_b64u,
                "key": pk.private_key_pkcs8,
                "algorithm": pk.algorithm,
                "aaguid": pk.aaguid,
            }));
        }

        if creds_for_item.is_empty() && !item.payload.notes.trim().is_empty() {
            creds_for_item.push(json!({
                "type": "note",
                "content": { "fieldType": "concealed-string", "value": item.payload.notes },
            }));
        }

        if creds_for_item.is_empty() {
            continue;
        }

        credentials.push(json!({
            "id": item.id,
            "title": item.title,
            "subtitle": item.payload.subtitle,
            "notes": item.payload.notes,
            "scope": {
                "urls": urls,
            },
            "credentials": creds_for_item,
            "tags": item.payload.tags,
            "favorite": item.favorite,
        }));
    }

    let bundle = json!({
        "version": { "major": 1, "minor": 0 },
        "exporter": "Keysmith",
        "timestamp": Utc::now().timestamp(),
        "accounts": [{
            "id": URL_SAFE_NO_PAD.encode(account_id.as_bytes()),
            "username": account_email,
            "fullName": display_name,
            "credentials": credentials,
        }],
    });

    serde_json::to_string(&bundle).map_err(|e| FfiError::Internal {
        msg: format!("序列化 CXF 导出包失败: {e}"),
    })
}

fn extract_cxf_field_str(val: Option<&Value>) -> String {
    let Some(v) = val else {
        return String::new();
    };
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(s) = v.get("value").and_then(|x| x.as_str()) {
        return s.to_string();
    }
    String::new()
}

/// Parse a FIDO CXF JSON bundle into `ItemDraft` records ready for `AppCore::item_create`.
pub fn parse_cxf_bundle_to_drafts(
    bundle_json: &str,
) -> Result<(Vec<ItemDraft>, usize, Vec<String>), FfiError> {
    let bundle: CxfBundle = serde_json::from_str(bundle_json).map_err(|e| FfiError::Validation {
        msg: format!("CXF 数据格式无效: {e}"),
    })?;

    let mut raw_entries: Vec<Value> = Vec::new();
    for acc in bundle.accounts {
        raw_entries.extend(acc.credentials);
    }
    raw_entries.extend(bundle.credentials);

    let mut drafts = Vec::new();
    let mut skipped = 0usize;
    let mut warnings = Vec::new();

    for entry in raw_entries {
        let title = entry
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Imported Credential")
            .to_string();

        let notes = entry
            .get("notes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let favorite = entry
            .get("favorite")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let tags: Vec<String> = entry
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let mut urls = Vec::new();
        if let Some(url_arr) = entry
            .get("scope")
            .and_then(|s| s.get("urls"))
            .and_then(|u| u.as_array())
        {
            for u in url_arr {
                if let Some(s) = u.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                    urls.push(ItemUrl {
                        id: new_id("u"),
                        uri: s.to_string(),
                        label: None,
                        match_rule: UrlMatchRule::Domain,
                    });
                }
            }
        }

        let mut fields = Vec::new();
        let mut passkeys = Vec::new();
        let mut category = ItemCategory::Login;
        let mut resolved_notes = notes;

        let sub_creds: Vec<Value> = entry
            .get("credentials")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(|| vec![entry.clone()]);

        for cred in sub_creds {
            let ctype = cred
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            match ctype.as_str() {
                "basic-auth" | "password" => {
                    let username = extract_cxf_field_str(cred.get("username"));
                    let password = extract_cxf_field_str(cred.get("password"));
                    if !username.is_empty() {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "用户名".to_string(),
                            field_type: FieldType::Text,
                            value: username,
                            sensitive: false,
                            copyable: true,
                            purpose: Some(FieldPurpose::Username),
                        });
                    }
                    if !password.is_empty() {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "密码".to_string(),
                            field_type: FieldType::Password,
                            value: password,
                            sensitive: true,
                            copyable: true,
                            purpose: Some(FieldPurpose::Password),
                        });
                    }
                }
                "totp" => {
                    let secret = extract_cxf_field_str(cred.get("secret"));
                    if !secret.is_empty() {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "一次性验证码".to_string(),
                            field_type: FieldType::Totp,
                            value: secret,
                            sensitive: true,
                            copyable: true,
                            purpose: Some(FieldPurpose::Totp),
                        });
                    }
                }
                "passkey" => {
                    let rp_id = cred
                        .get("rpId")
                        .and_then(|v| v.as_str())
                        .map(normalize_rp_id)
                        .unwrap_or_default();
                    let credential_id = cred
                        .get("credentialId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let private_key_pkcs8 = cred
                        .get("key")
                        .or_else(|| cred.get("privateKey"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if rp_id.is_empty() || credential_id.is_empty() || private_key_pkcs8.is_empty()
                    {
                        warnings.push(format!("条目「{title}」包含不完整的 Passkey 凭据，已跳过该密钥"));
                        continue;
                    }
                    let user_name = cred
                        .get("userName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let user_display_name = cred
                        .get("userDisplayName")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&user_name)
                        .to_string();
                    let user_handle = cred
                        .get("userHandle")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let algorithm = cred
                        .get("algorithm")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(-7) as i32;
                    let aaguid = cred
                        .get("aaguid")
                        .and_then(|v| v.as_str())
                        .unwrap_or(keysmith_core::passkey::KEYSMITH_AAGUID_STR)
                        .to_string();
                    passkeys.push(PasskeyCredential {
                        credential_id,
                        rp_id: rp_id.clone(),
                        rp_name: rp_id,
                        user_handle,
                        user_name,
                        user_display_name,
                        algorithm,
                        private_key_pkcs8,
                        public_key_spki: String::new(),
                        sign_count: 0,
                        discoverable: true,
                        aaguid,
                        transports: vec!["internal".to_string(), "hybrid".to_string()],
                        backed_up: true,
                        created_at: Utc::now().to_rfc3339(),
                        last_used_at: None,
                    });
                }
                "note" => {
                    let content = extract_cxf_field_str(cred.get("content"));
                    if !content.is_empty() {
                        if resolved_notes.is_empty() {
                            resolved_notes = content;
                        } else {
                            resolved_notes = format!("{resolved_notes}\n{content}");
                        }
                        if fields.is_empty() && passkeys.is_empty() {
                            category = ItemCategory::SecureNote;
                        }
                    }
                }
                _ => {}
            }
        }

        if fields.is_empty() && passkeys.is_empty() && resolved_notes.trim().is_empty() {
            skipped += 1;
            continue;
        }

        let sections = if fields.is_empty() {
            Vec::new()
        } else {
            vec![ItemSection {
                id: new_id("sec"),
                title: "登录信息".to_string(),
                fields,
            }]
        };

        drafts.push(ItemDraft {
            id: None,
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title,
            favorite,
            category,
            urls,
            sections,
            passkeys,
            notes: resolved_notes,
            tags,
            ..Default::default()
        });
    }

    Ok((drafts, skipped, warnings))
}
