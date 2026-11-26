pub mod emergency_kit;

use std::collections::HashMap;
use std::io::{Cursor, Read};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chrono::Utc;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::crypto::{
    decrypt_string, derive_master_key, encrypt_bytes, stretch_master_key, KdfConfig,
    UserSymmetricKey,
};
use crate::domain::{
    extract_domain, FieldPurpose, FieldType, ItemCategory, ItemDetail, ItemDraft, ItemField,
    ItemIcon, ItemSection, ItemUrl, UrlMatchRule, Vault, WatchtowerFlags,
    DEFAULT_PERSONAL_VAULT_ID,
};
use crate::error::CoreError;

pub use emergency_kit::{generate_emergency_kit_pdf, EmergencyKitInput};

pub struct ParsedImportData {
    pub vaults: Vec<String>,
    /// `(optional_vault_name, draft)`
    pub items: Vec<(Option<String>, ItemDraft)>,
    pub skipped_items: usize,
    pub warnings: Vec<String>,
}

fn decode_input_bytes(data: &str, is_base64: bool) -> Result<Vec<u8>, CoreError> {
    if is_base64 {
        let clean = data
            .trim()
            .split_once("base64,")
            .map(|(_, rest)| rest)
            .unwrap_or_else(|| data.trim());
        B64.decode(clean)
            .map_err(|e| CoreError::Validation(format!("Base64 导入数据解码失败: {e}")))
    } else {
        Ok(data.as_bytes().to_vec())
    }
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", &uuid::Uuid::new_v4().to_string()[..8])
}

pub fn parse_import_payload(
    format: &str,
    data: &str,
    is_base64: bool,
) -> Result<ParsedImportData, CoreError> {
    parse_import_payload_with_auth(format, data, is_base64, None, None)
}

pub fn parse_import_payload_with_auth(
    format: &str,
    data: &str,
    is_base64: bool,
    passphrase: Option<&str>,
    usk: Option<&UserSymmetricKey>,
) -> Result<ParsedImportData, CoreError> {
    let fmt = format.trim().to_ascii_lowercase();
    let bytes = decode_input_bytes(data, is_base64)?;

    match fmt.as_str() {
        "keysmith_encrypted_json" => {
            let text = String::from_utf8(bytes)
                .map_err(|_| CoreError::Validation("加密备份文件必须是 UTF-8 JSON".to_string()))?;
            parse_keysmith_encrypted_json(&text, passphrase, usk)
        }
        "1pux" => parse_1pux(&bytes),
        "bitwarden_json" => {
            let text = String::from_utf8(bytes)
                .map_err(|_| CoreError::Validation("JSON 文件必须是 UTF-8 编码".to_string()))?;
            // Auto-detect Keysmith Encrypted JSON if user selected JSON accidentally
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                if val.get("schema").and_then(|s| s.as_str()) == Some("keysmith.export.v1") {
                    return parse_keysmith_encrypted_json(&text, passphrase, usk);
                }
            }
            parse_bitwarden_json(&text)
        }
        "bitwarden_csv" => {
            let text = String::from_utf8(bytes)
                .map_err(|_| CoreError::Validation("CSV 文件必须是 UTF-8 编码".to_string()))?;
            parse_bitwarden_csv(&text)
        }
        "chrome_csv" | "safari_csv" | "csv" => {
            let text = String::from_utf8(bytes)
                .map_err(|_| CoreError::Validation("CSV 文件必须是 UTF-8 编码".to_string()))?;
            parse_browser_csv(&text)
        }
        _ => Err(CoreError::Validation(format!("不支持的导入格式: {format}"))),
    }
}

fn parse_keysmith_encrypted_json(
    raw_json: &str,
    passphrase: Option<&str>,
    usk: Option<&UserSymmetricKey>,
) -> Result<ParsedImportData, CoreError> {
    let bundle = decrypt_and_parse_keysmith_bundle(raw_json, passphrase, usk)?;
    let mut vault_id_to_name: HashMap<String, String> = HashMap::new();
    let mut vaults = Vec::new();
    for v in &bundle.vaults {
        if !v.is_default && v.id != DEFAULT_PERSONAL_VAULT_ID && !v.name.trim().is_empty() {
            let clean = v.name.trim().to_string();
            vault_id_to_name.insert(v.id.clone(), clean.clone());
            if !vaults.contains(&clean) {
                vaults.push(clean);
            }
        }
    }

    let mut items = Vec::with_capacity(bundle.items.len());
    for detail in bundle.items {
        let vault_name = if detail.vault_id == DEFAULT_PERSONAL_VAULT_ID {
            None
        } else {
            vault_id_to_name.get(&detail.vault_id).cloned()
        };
        let mut draft = detail.to_draft();
        draft.id = None;
        items.push((vault_name, draft));
    }

    Ok(ParsedImportData {
        vaults,
        items,
        skipped_items: 0,
        warnings: Vec::new(),
    })
}

fn map_1p_category(uuid: &str) -> ItemCategory {
    match uuid {
        "001" => ItemCategory::Login,
        "002" => ItemCategory::CreditCard,
        "003" => ItemCategory::SecureNote,
        "004" | "108" => ItemCategory::Identity,
        "005" => ItemCategory::Password,
        "100" => ItemCategory::SoftwareLicense,
        "101" => ItemCategory::BankAccount,
        "102" => ItemCategory::Database,
        "103" => ItemCategory::DriverLicense,
        "104" | "105" | "107" => ItemCategory::Membership,
        "106" => ItemCategory::Passport,
        "109" => ItemCategory::WifiRouter,
        "110" => ItemCategory::Server,
        "112" => ItemCategory::ApiCredential,
        "114" => ItemCategory::CryptoWallet,
        "115" => ItemCategory::Document,
        _ => ItemCategory::Login,
    }
}

fn parse_1pux(zip_bytes: &[u8]) -> Result<ParsedImportData, CoreError> {
    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| CoreError::Validation(format!("无法打开 .1pux 压缩包: {e}")))?;

    let mut export_data = String::new();
    let mut found = false;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| CoreError::Validation(e.to_string()))?;
        if file.name() == "export.data" || file.name().ends_with("/export.data") {
            file.read_to_string(&mut export_data)
                .map_err(|e| CoreError::Validation(format!("读取 export.data 失败: {e}")))?;
            found = true;
            break;
        }
    }
    if !found {
        return Err(CoreError::Validation(
            ".1pux 文件中缺少 export.data".to_string(),
        ));
    }

    let root: Value = serde_json::from_str(&export_data)
        .map_err(|e| CoreError::Validation(format!("解析 export.data JSON 失败: {e}")))?;

    let mut vaults = Vec::new();
    let mut items = Vec::new();
    let mut skipped_items = 0;
    let warnings = Vec::new();

    if let Some(accounts) = root.get("accounts").and_then(|v| v.as_array()) {
        for acc in accounts {
            if let Some(v_arr) = acc.get("vaults").and_then(|v| v.as_array()) {
                for v_obj in v_arr {
                    let vault_name = v_obj
                        .get("attrs")
                        .and_then(|a| a.get("name"))
                        .and_then(|n| n.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    if let Some(ref vn) = vault_name {
                        if !vaults.contains(vn) {
                            vaults.push(vn.clone());
                        }
                    }

                    let Some(item_arr) = v_obj.get("items").and_then(|i| i.as_array()) else {
                        continue;
                    };
                    for raw_item in item_arr {
                        let category_uuid = raw_item
                            .get("categoryUuid")
                            .and_then(|v| v.as_str())
                            .unwrap_or("001");
                        let category = map_1p_category(category_uuid);
                        let overview = raw_item.get("overview");
                        let details = raw_item.get("details");

                        let title = overview
                            .and_then(|o| o.get("title"))
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if title.is_empty() && details.is_none() {
                            skipped_items += 1;
                            continue;
                        }

                        let tags: Vec<String> = overview
                            .and_then(|o| o.get("tags"))
                            .and_then(|t| t.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default();

                        let mut urls = Vec::new();
                        if let Some(u_arr) = overview.and_then(|o| o.get("urls")).and_then(|u| u.as_array()) {
                            for u in u_arr {
                                if let Some(uri) = u.get("url").and_then(|x| x.as_str()) {
                                    if !uri.trim().is_empty() {
                                        urls.push(ItemUrl {
                                            id: new_id("u"),
                                            uri: uri.to_string(),
                                            label: u.get("label").and_then(|l| l.as_str()).map(|s| s.to_string()),
                                            match_rule: UrlMatchRule::Domain,
                                        });
                                    }
                                }
                            }
                        } else if let Some(uri) = overview.and_then(|o| o.get("url")).and_then(|u| u.as_str()) {
                            if !uri.trim().is_empty() {
                                urls.push(ItemUrl {
                                    id: new_id("u"),
                                    uri: uri.to_string(),
                                    label: None,
                                    match_rule: UrlMatchRule::Domain,
                                });
                            }
                        }

                        let mut main_fields = Vec::new();
                        if let Some(login_fields) = details
                            .and_then(|d| d.get("loginFields"))
                            .and_then(|f| f.as_array())
                        {
                            for lf in login_fields {
                                let val = lf.get("value").and_then(|v| v.as_str()).unwrap_or("");
                                if val.is_empty() {
                                    continue;
                                }
                                let desig = lf.get("designation").and_then(|d| d.as_str()).unwrap_or("");
                                let label = lf
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or(match desig {
                                        "username" => "用户名",
                                        "password" => "密码",
                                        _ => "字段",
                                    });
                                let (field_type, sensitive, purpose) = match desig {
                                    "username" => (FieldType::Text, false, Some(FieldPurpose::Username)),
                                    "password" => (FieldType::Password, true, Some(FieldPurpose::Password)),
                                    _ => (FieldType::Text, false, None),
                                };
                                main_fields.push(ItemField {
                                    id: new_id("f"),
                                    label: label.to_string(),
                                    field_type,
                                    value: val.to_string(),
                                    sensitive,
                                    copyable: true,
                                    purpose,
                                });
                            }
                        }

                        let mut sections = Vec::new();
                        if !main_fields.is_empty() {
                            sections.push(ItemSection {
                                id: new_id("sec"),
                                title: String::new(),
                                fields: main_fields,
                            });
                        }

                        if let Some(sec_arr) = details.and_then(|d| d.get("sections")).and_then(|s| s.as_array()) {
                            for sec in sec_arr {
                                let sec_title = sec.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
                                let mut fields = Vec::new();
                                if let Some(f_arr) = sec.get("fields").and_then(|f| f.as_array()) {
                                    for f in f_arr {
                                        let label = f.get("title").and_then(|t| t.as_str()).unwrap_or("字段");
                                        let val_obj = f.get("value");
                                        if let Some(totp) = val_obj.and_then(|v| v.get("totp")).and_then(|t| t.as_str()) {
                                            fields.push(ItemField {
                                                id: new_id("f"),
                                                label: label.to_string(),
                                                field_type: FieldType::Totp,
                                                value: totp.to_string(),
                                                sensitive: true,
                                                copyable: true,
                                                purpose: Some(FieldPurpose::Totp),
                                            });
                                        } else if let Some(str_val) = val_obj
                                            .and_then(|v| v.get("concealed").or_else(|| v.get("string")).or_else(|| v.get("email")).or_else(|| v.get("url")))
                                            .and_then(|s| s.as_str())
                                        {
                                            let is_concealed = val_obj.and_then(|v| v.get("concealed")).is_some();
                                            fields.push(ItemField {
                                                id: new_id("f"),
                                                label: label.to_string(),
                                                field_type: if is_concealed {
                                                    FieldType::Password
                                                } else {
                                                    FieldType::Text
                                                },
                                                value: str_val.to_string(),
                                                sensitive: is_concealed,
                                                copyable: true,
                                                purpose: None,
                                            });
                                        }
                                    }
                                }
                                if !fields.is_empty() {
                                    sections.push(ItemSection {
                                        id: new_id("sec"),
                                        title: sec_title,
                                        fields,
                                    });
                                }
                            }
                        }

                        let notes = details
                            .and_then(|d| d.get("notesPlain"))
                            .and_then(|n| n.as_str())
                            .unwrap_or("")
                            .to_string();
                        let favorite = raw_item
                            .get("favIndex")
                            .and_then(|v| v.as_u64())
                            .map(|n| n > 0)
                            .unwrap_or(false);
                        let icon = urls
                            .first()
                            .map(|u| ItemIcon::Domain { host: extract_domain(&u.uri) });

                        items.push((
                            vault_name.clone(),
                            ItemDraft {
                                id: None,
                                vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
                                title: if title.is_empty() { "未命名条目".to_string() } else { title },
                                favorite,
                                category,
                                subtitle: None,
                                icon,
                                tags,
                                urls,
                                sections,
                                passkeys: Vec::new(),
                                notes,
                                password_history: Vec::new(),
                                watchtower: WatchtowerFlags::default(),
                                archived: raw_item
                                    .get("state")
                                    .and_then(|s| s.as_str())
                                    .map(|s| s == "archived")
                                    .unwrap_or(false),
                                reprompt: false,
                                ..Default::default()
                            },
                        ));
                    }
                }
            }
        }
    }

    Ok(ParsedImportData {
        vaults,
        items,
        skipped_items,
        warnings,
    })
}

fn parse_bitwarden_json(text: &str) -> Result<ParsedImportData, CoreError> {
    let root: Value = serde_json::from_str(text)
        .map_err(|e| CoreError::Validation(format!("解析 Bitwarden JSON 失败: {e}")))?;

    if root.get("encrypted").and_then(|v| v.as_bool()) == Some(true) {
        return Err(CoreError::Validation(
            "暂不支持导入加密的 Bitwarden JSON，请导出未加密 JSON 后导入".to_string(),
        ));
    }

    let mut folder_id_to_name: HashMap<String, String> = HashMap::new();
    let mut vaults = Vec::new();
    if let Some(folders) = root.get("folders").and_then(|v| v.as_array()) {
        for f in folders {
            if let (Some(id), Some(name)) = (
                f.get("id").and_then(|v| v.as_str()),
                f.get("name").and_then(|v| v.as_str()),
            ) {
                let clean = name.trim().to_string();
                if !clean.is_empty() {
                    folder_id_to_name.insert(id.to_string(), clean.clone());
                    if !vaults.contains(&clean) {
                        vaults.push(clean);
                    }
                }
            }
        }
    }

    let mut items = Vec::new();
    let mut skipped_items = 0;

    let item_arr = root
        .get("items")
        .and_then(|v| v.as_array())
        .ok_or_else(|| CoreError::Validation("Bitwarden JSON 缺少 items 数组".to_string()))?;

    for raw in item_arr {
        let bw_type = raw.get("type").and_then(|v| v.as_u64()).unwrap_or(1);
        let title = raw
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("未命名条目")
            .trim()
            .to_string();
        let notes = raw
            .get("notes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let favorite = raw
            .get("favorite")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let vault_name = raw
            .get("folderId")
            .and_then(|v| v.as_str())
            .and_then(|fid| folder_id_to_name.get(fid).cloned());

        let mut urls = Vec::new();
        let mut fields = Vec::new();
        let category = match bw_type {
            1 => {
                if let Some(login) = raw.get("login") {
                    if let Some(u) = login.get("username").and_then(|v| v.as_str()) {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "用户名".to_string(),
                            field_type: FieldType::Text,
                            value: u.to_string(),
                            sensitive: false,
                            copyable: true,
                            purpose: Some(FieldPurpose::Username),
                        });
                    }
                    if let Some(p) = login.get("password").and_then(|v| v.as_str()) {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "密码".to_string(),
                            field_type: FieldType::Password,
                            value: p.to_string(),
                            sensitive: true,
                            copyable: true,
                            purpose: Some(FieldPurpose::Password),
                        });
                    }
                    if let Some(t) = login.get("totp").and_then(|v| v.as_str()) {
                        if !t.is_empty() {
                            fields.push(ItemField {
                                id: new_id("f"),
                                label: "一次性密码".to_string(),
                                field_type: FieldType::Totp,
                                value: t.to_string(),
                                sensitive: true,
                                copyable: true,
                                purpose: Some(FieldPurpose::Totp),
                            });
                        }
                    }
                    if let Some(u_arr) = login.get("uris").and_then(|v| v.as_array()) {
                        for u in u_arr {
                            if let Some(uri) = u.get("uri").and_then(|v| v.as_str()) {
                                if !uri.trim().is_empty() {
                                    urls.push(ItemUrl {
                                        id: new_id("u"),
                                        uri: uri.to_string(),
                                        label: None,
                                        match_rule: UrlMatchRule::Domain,
                                    });
                                }
                            }
                        }
                    }
                }
                ItemCategory::Login
            }
            3 => {
                if let Some(card) = raw.get("card") {
                    if let Some(h) = card.get("cardholderName").and_then(|v| v.as_str()) {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "持卡人".to_string(),
                            field_type: FieldType::Text,
                            value: h.to_string(),
                            sensitive: false,
                            copyable: true,
                            purpose: None,
                        });
                    }
                    if let Some(n) = card.get("number").and_then(|v| v.as_str()) {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "卡号".to_string(),
                            field_type: FieldType::Number,
                            value: n.to_string(),
                            sensitive: true,
                            copyable: true,
                            purpose: Some(FieldPurpose::CardNumber),
                        });
                    }
                    if let Some(c) = card.get("code").and_then(|v| v.as_str()) {
                        fields.push(ItemField {
                            id: new_id("f"),
                            label: "安全码 CVV".to_string(),
                            field_type: FieldType::Password,
                            value: c.to_string(),
                            sensitive: true,
                            copyable: true,
                            purpose: Some(FieldPurpose::CardCvv),
                        });
                    }
                }
                ItemCategory::CreditCard
            }
            4 => ItemCategory::Identity,
            2 => ItemCategory::SecureNote,
            _ => {
                skipped_items += 1;
                continue;
            }
        };

        let mut sections = Vec::new();
        if !fields.is_empty() {
            sections.push(ItemSection {
                id: new_id("sec"),
                title: String::new(),
                fields,
            });
        }
        if let Some(cf_arr) = raw.get("fields").and_then(|v| v.as_array()) {
            let custom: Vec<ItemField> = cf_arr
                .iter()
                .map(|cf| {
                    let sensitive = cf.get("type").and_then(|t| t.as_u64()).unwrap_or(0) == 1;
                    ItemField {
                        id: new_id("f"),
                        label: cf
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("自定义字段")
                            .to_string(),
                        field_type: if sensitive {
                            FieldType::Password
                        } else {
                            FieldType::Text
                        },
                        value: cf
                            .get("value")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        sensitive,
                        copyable: true,
                        purpose: None,
                    }
                })
                .collect();
            if !custom.is_empty() {
                sections.push(ItemSection {
                    id: new_id("sec"),
                    title: "自定义字段".to_string(),
                    fields: custom,
                });
            }
        }

        let icon = urls
            .first()
            .map(|u| ItemIcon::Domain { host: extract_domain(&u.uri) });

        items.push((
            vault_name,
            ItemDraft {
                id: None,
                vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
                title,
                favorite,
                category,
                subtitle: None,
                icon,
                tags: Vec::new(),
                urls,
                sections,
                passkeys: Vec::new(),
                notes,
                password_history: Vec::new(),
                watchtower: WatchtowerFlags::default(),
                archived: false,
                reprompt: false,
                ..Default::default()
            },
        ));
    }

    Ok(ParsedImportData {
        vaults,
        items,
        skipped_items,
        warnings: Vec::new(),
    })
}

fn parse_bitwarden_csv(text: &str) -> Result<ParsedImportData, CoreError> {
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(text.as_bytes());
    let headers = rdr
        .headers()
        .map_err(|e| CoreError::Validation(format!("读取 CSV 表头失败: {e}")))?
        .iter()
        .map(|h| h.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();

    let col = |name: &str| headers.iter().position(|h| h == name);
    let idx_folder = col("folder");
    let idx_fav = col("favorite");
    let idx_type = col("type");
    let idx_name = col("name");
    let idx_notes = col("notes");
    let idx_uri = col("login_uri");
    let idx_user = col("login_username");
    let idx_pass = col("login_password");
    let idx_totp = col("login_totp");

    let mut vaults = Vec::new();
    let mut items = Vec::new();
    let mut skipped_items = 0;

    for rec in rdr.records() {
        let Ok(row) = rec else {
            skipped_items += 1;
            continue;
        };
        let get = |idx: Option<usize>| idx.and_then(|i| row.get(i)).unwrap_or("").trim().to_string();

        let title = get(idx_name);
        let uri = get(idx_uri);
        let user = get(idx_user);
        let pass = get(idx_pass);
        let totp = get(idx_totp);
        let notes = get(idx_notes);
        let folder = get(idx_folder);
        let type_str = get(idx_type).to_ascii_lowercase();
        let favorite = get(idx_fav) == "1" || get(idx_fav).eq_ignore_ascii_case("true");

        if title.is_empty() && user.is_empty() && pass.is_empty() && notes.is_empty() {
            skipped_items += 1;
            continue;
        }

        if !folder.is_empty() && !vaults.contains(&folder) {
            vaults.push(folder.clone());
        }

        let category = if type_str == "note" {
            ItemCategory::SecureNote
        } else {
            ItemCategory::Login
        };

        let mut fields = Vec::new();
        if !user.is_empty() {
            fields.push(ItemField {
                id: new_id("f"),
                label: "用户名".to_string(),
                field_type: FieldType::Text,
                value: user,
                sensitive: false,
                copyable: true,
                purpose: Some(FieldPurpose::Username),
            });
        }
        if !pass.is_empty() {
            fields.push(ItemField {
                id: new_id("f"),
                label: "密码".to_string(),
                field_type: FieldType::Password,
                value: pass,
                sensitive: true,
                copyable: true,
                purpose: Some(FieldPurpose::Password),
            });
        }
        if !totp.is_empty() {
            fields.push(ItemField {
                id: new_id("f"),
                label: "一次性密码".to_string(),
                field_type: FieldType::Totp,
                value: totp,
                sensitive: true,
                copyable: true,
                purpose: Some(FieldPurpose::Totp),
            });
        }

        let mut urls = Vec::new();
        let mut icon = None;
        if !uri.is_empty() {
            icon = Some(ItemIcon::Domain {
                host: extract_domain(&uri),
            });
            urls.push(ItemUrl {
                id: new_id("u"),
                uri,
                label: None,
                match_rule: UrlMatchRule::Domain,
            });
        }

        let sections = if fields.is_empty() {
            Vec::new()
        } else {
            vec![ItemSection {
                id: new_id("sec"),
                title: String::new(),
                fields,
            }]
        };

        items.push((
            if folder.is_empty() { None } else { Some(folder) },
            ItemDraft {
                id: None,
                vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
                title: if title.is_empty() {
                    "未命名条目".to_string()
                } else {
                    title
                },
                favorite,
                category,
                subtitle: None,
                icon,
                tags: Vec::new(),
                urls,
                sections,
                passkeys: Vec::new(),
                notes,
                password_history: Vec::new(),
                watchtower: WatchtowerFlags::default(),
                archived: false,
                reprompt: false,
                ..Default::default()
            },
        ));
    }

    Ok(ParsedImportData {
        vaults,
        items,
        skipped_items,
        warnings: Vec::new(),
    })
}

fn parse_browser_csv(text: &str) -> Result<ParsedImportData, CoreError> {
    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(text.as_bytes());
    let headers = rdr
        .headers()
        .map_err(|e| CoreError::Validation(format!("读取 CSV 表头失败: {e}")))?
        .iter()
        .map(|h| h.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();

    let find_col = |candidates: &[&str]| -> Option<usize> {
        headers.iter().position(|h| candidates.contains(&h.as_str()))
    };

    let idx_title = find_col(&["name", "title"]);
    let idx_url = find_col(&["url", "uri"]);
    let idx_user = find_col(&["username", "user"]);
    let idx_pass = find_col(&["password"]);
    let idx_notes = find_col(&["note", "notes"]);
    let idx_otp = find_col(&["otpauth", "totp"]);

    let mut items = Vec::new();
    let mut skipped_items = 0;

    for rec in rdr.records() {
        let Ok(row) = rec else {
            skipped_items += 1;
            continue;
        };
        let get = |idx: Option<usize>| idx.and_then(|i| row.get(i)).unwrap_or("").trim().to_string();

        let title = get(idx_title);
        let url = get(idx_url);
        let user = get(idx_user);
        let pass = get(idx_pass);
        let notes = get(idx_notes);
        let otp = get(idx_otp);

        if title.is_empty() && url.is_empty() && user.is_empty() && pass.is_empty() {
            skipped_items += 1;
            continue;
        }

        let mut fields = Vec::new();
        if !user.is_empty() {
            fields.push(ItemField {
                id: new_id("f"),
                label: "用户名".to_string(),
                field_type: FieldType::Text,
                value: user,
                sensitive: false,
                copyable: true,
                purpose: Some(FieldPurpose::Username),
            });
        }
        if !pass.is_empty() {
            fields.push(ItemField {
                id: new_id("f"),
                label: "密码".to_string(),
                field_type: FieldType::Password,
                value: pass,
                sensitive: true,
                copyable: true,
                purpose: Some(FieldPurpose::Password),
            });
        }
        if !otp.is_empty() {
            fields.push(ItemField {
                id: new_id("f"),
                label: "一次性密码".to_string(),
                field_type: FieldType::Totp,
                value: otp,
                sensitive: true,
                copyable: true,
                purpose: Some(FieldPurpose::Totp),
            });
        }

        let mut urls = Vec::new();
        let mut icon = None;
        let derived_title = if !title.is_empty() {
            title
        } else if !url.is_empty() {
            extract_domain(&url)
        } else {
            "未命名登录".to_string()
        };

        if !url.is_empty() {
            icon = Some(ItemIcon::Domain {
                host: extract_domain(&url),
            });
            urls.push(ItemUrl {
                id: new_id("u"),
                uri: url,
                label: None,
                match_rule: UrlMatchRule::Domain,
            });
        }

        items.push((
            None,
            ItemDraft {
                id: None,
                vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
                title: derived_title,
                favorite: false,
                category: ItemCategory::Login,
                subtitle: None,
                icon,
                tags: Vec::new(),
                urls,
                sections: vec![ItemSection {
                    id: new_id("sec"),
                    title: String::new(),
                    fields,
                }],
                passkeys: Vec::new(),
                notes,
                password_history: Vec::new(),
                watchtower: WatchtowerFlags::default(),
                archived: false,
                reprompt: false,
                ..Default::default()
            },
        ));
    }

    Ok(ParsedImportData {
        vaults: Vec::new(),
        items,
        skipped_items,
        warnings: Vec::new(),
    })
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysmithEncryptedExport {
    pub schema: String,
    pub exported_at: String,
    pub kdf: Option<KdfConfig>,
    pub salt_b64: Option<String>,
    pub payload_enc: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundlePayload {
    pub vaults: Vec<Vault>,
    pub items: Vec<ItemDetail>,
}

pub fn decrypt_and_parse_keysmith_bundle(
    raw_json: &str,
    passphrase: Option<&str>,
    usk: Option<&UserSymmetricKey>,
) -> Result<ExportBundlePayload, CoreError> {
    let plaintext = decrypt_keysmith_export(raw_json, passphrase, usk)?;
    serde_json::from_str::<ExportBundlePayload>(&plaintext)
        .map_err(|e| CoreError::Validation(format!("解析加密备份内容失败: {e}")))
}

pub fn build_export_content(
    format: &str,
    vaults: &[Vault],
    items: &[ItemDetail],
    usk: &UserSymmetricKey,
    export_passphrase: Option<&str>,
) -> Result<(String, String), CoreError> {
    let stamp = Utc::now().format("%Y%m%d-%H%M").to_string();
    let active_items: Vec<&ItemDetail> = items.iter().filter(|i| i.deleted_at.is_none()).collect();

    match format.trim().to_ascii_lowercase().as_str() {
        "keysmith_encrypted_json" => {
            let bundle = ExportBundlePayload {
                vaults: vaults.to_vec(),
                items: active_items.into_iter().cloned().collect(),
            };
            let json = serde_json::to_string(&bundle)
                .map_err(|e| CoreError::Internal(format!("序列化导出数据失败: {e}")))?;

            let envelope = if let Some(pass) = export_passphrase.filter(|s| !s.trim().is_empty()) {
                let mut salt = [0u8; 16];
                OsRng.fill_bytes(&mut salt);
                let salt_b64 = B64.encode(salt);
                let kdf = KdfConfig::default();
                let mk = derive_master_key(pass, &salt_b64, &kdf)?;
                let smk = stretch_master_key(&mk)?;
                let payload_enc = encrypt_bytes(json.as_bytes(), smk.enc_key(), smk.mac_key())?;
                KeysmithEncryptedExport {
                    schema: "keysmith.export.v1".to_string(),
                    exported_at: Utc::now().to_rfc3339(),
                    kdf: Some(kdf),
                    salt_b64: Some(salt_b64),
                    payload_enc,
                }
            } else {
                let payload_enc = usk.encrypt_string(&json)?;
                KeysmithEncryptedExport {
                    schema: "keysmith.export.v1".to_string(),
                    exported_at: Utc::now().to_rfc3339(),
                    kdf: None,
                    salt_b64: None,
                    payload_enc,
                }
            };

            let out = serde_json::to_string_pretty(&envelope)
                .map_err(|e| CoreError::Internal(e.to_string()))?;
            Ok((format!("keysmith-backup-{stamp}.json"), out))
        }
        "bitwarden_json" => {
            let folders: Vec<Value> = vaults
                .iter()
                .filter(|v| !v.is_default)
                .map(|v| serde_json::json!({ "id": v.id, "name": v.name }))
                .collect();

            let bw_items: Vec<Value> = active_items
                .iter()
                .map(|it| {
                    let fields_all: Vec<&ItemField> = it
                        .payload
                        .sections
                        .iter()
                        .flat_map(|s| s.fields.iter())
                        .collect();
                    let username = fields_all
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::Username))
                        .map(|f| f.value.clone());
                    let password = fields_all
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::Password))
                        .map(|f| f.value.clone());
                    let totp = fields_all
                        .iter()
                        .find(|f| f.field_type == FieldType::Totp)
                        .map(|f| f.value.clone());
                    let uris: Vec<Value> = it
                        .payload
                        .urls
                        .iter()
                        .map(|u| serde_json::json!({ "uri": u.uri, "match": 0 }))
                        .collect();
                    let folder_id = if it.vault_id == DEFAULT_PERSONAL_VAULT_ID {
                        Value::Null
                    } else {
                        Value::String(it.vault_id.clone())
                    };
                    let bw_type = match it.payload.category {
                        ItemCategory::SecureNote => 2,
                        ItemCategory::CreditCard => 3,
                        ItemCategory::Identity | ItemCategory::Passport | ItemCategory::DriverLicense => 4,
                        _ => 1,
                    };
                    serde_json::json!({
                        "id": it.id,
                        "folderId": folder_id,
                        "type": bw_type,
                        "name": it.title,
                        "notes": it.payload.notes,
                        "favorite": it.favorite,
                        "login": if bw_type == 1 {
                            serde_json::json!({
                                "username": username,
                                "password": password,
                                "totp": totp,
                                "uris": uris
                            })
                        } else {
                            Value::Null
                        }
                    })
                })
                .collect();

            let doc = serde_json::json!({
                "encrypted": false,
                "folders": folders,
                "items": bw_items,
            });
            let out = serde_json::to_string_pretty(&doc)
                .map_err(|e| CoreError::Internal(e.to_string()))?;
            Ok((format!("bitwarden-export-{stamp}.json"), out))
        }
        "csv" => {
            let mut wtr = csv::Writer::from_writer(Vec::new());
            wtr.write_record([
                "folder",
                "favorite",
                "type",
                "name",
                "notes",
                "login_uri",
                "login_username",
                "login_password",
                "login_totp",
            ])
            .map_err(|e| CoreError::Internal(e.to_string()))?;

            let vault_names: HashMap<&str, &str> =
                vaults.iter().map(|v| (v.id.as_str(), v.name.as_str())).collect();

            for it in active_items {
                let folder = if it.vault_id == DEFAULT_PERSONAL_VAULT_ID {
                    ""
                } else {
                    vault_names.get(it.vault_id.as_str()).copied().unwrap_or("")
                };
                let fields_all: Vec<&ItemField> = it
                    .payload
                    .sections
                    .iter()
                    .flat_map(|s| s.fields.iter())
                    .collect();
                let username = fields_all
                    .iter()
                    .find(|f| f.purpose == Some(FieldPurpose::Username))
                    .map(|f| f.value.as_str())
                    .unwrap_or("");
                let password = fields_all
                    .iter()
                    .find(|f| f.purpose == Some(FieldPurpose::Password))
                    .map(|f| f.value.as_str())
                    .unwrap_or("");
                let totp = fields_all
                    .iter()
                    .find(|f| f.field_type == FieldType::Totp)
                    .map(|f| f.value.as_str())
                    .unwrap_or("");
                let uri = it.payload.urls.first().map(|u| u.uri.as_str()).unwrap_or("");
                let bw_type = if it.payload.category == ItemCategory::SecureNote {
                    "note"
                } else {
                    "login"
                };

                wtr.write_record([
                    folder,
                    if it.favorite { "1" } else { "0" },
                    bw_type,
                    &it.title,
                    &it.payload.notes,
                    uri,
                    username,
                    password,
                    totp,
                ])
                .map_err(|e| CoreError::Internal(e.to_string()))?;
            }
            let bytes = wtr
                .into_inner()
                .map_err(|e| CoreError::Internal(e.to_string()))?;
            let content = String::from_utf8(bytes)
                .map_err(|e| CoreError::Internal(e.to_string()))?;
            Ok((format!("keysmith-export-{stamp}.csv"), content))
        }
        _ => Err(CoreError::Validation(format!("不支持的导出格式: {format}"))),
    }
}

/// Helper for decrypting `keysmith_encrypted_json` in tests or future re-import.
pub fn decrypt_keysmith_export(
    raw_json: &str,
    passphrase: Option<&str>,
    usk: Option<&UserSymmetricKey>,
) -> Result<String, CoreError> {
    let env: KeysmithEncryptedExport = serde_json::from_str(raw_json)
        .map_err(|e| CoreError::Validation(format!("解析加密导出文件失败: {e}")))?;
    if let (Some(kdf), Some(salt)) = (env.kdf, env.salt_b64) {
        let pass = passphrase
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| CoreError::Validation("需要导出密码才能解密".to_string()))?;
        let mk = derive_master_key(pass, &salt, &kdf)?;
        let smk = stretch_master_key(&mk)?;
        let pt = decrypt_string(&env.payload_enc, smk.enc_key(), smk.mac_key())?;
        Ok(pt.to_string())
    } else if let Some(u) = usk {
        let pt = u.decrypt_string(&env.payload_enc)?;
        Ok(pt.to_string())
    } else {
        Err(CoreError::InvalidState("缺少解密密钥".to_string()))
    }
}
