use chrono::Utc;
use uuid::Uuid;

use zeroize::Zeroizing;

use crate::crypto::{
    build_send_share_url, decrypt_bytes, derive_send_key, encrypt_bytes, hash_send_password,
    UserSymmetricKey,
};
use crate::domain::{
    extract_domain, format_size_bytes, FieldPurpose, FieldType, ItemAttachment, ItemCategory,
    ItemDetail, ItemDraft, ItemField, ItemIcon, ItemPayload, ItemSection, ItemUrl,
    PasskeyCredential, PasswordHistoryEntry, SendItem, SendType, UrlMatchRule, Vault,
    VaultMetaJson, WatchtowerFlags, DEFAULT_PERSONAL_VAULT_ID, ITEM_SCHEMA_V1, VAULT_SCHEMA_V1,
};
use crate::error::CoreError;
use crate::protocol::{
    CipherDto, CipherFido2CredentialDto, CipherFieldDto, CipherIdentityDto, CipherLoginDto,
    CipherLoginUriDto, CipherPasswordHistoryDto, CipherSecureNoteDto, CollectionDto, FolderDto,
    SendCreateUpdatePayload, SendDto, SendFileDto, SendTextDto,
};

fn dec_opt(usk: &UserSymmetricKey, val: Option<&str>) -> String {
    val.and_then(|s| {
        if s.trim().is_empty() {
            None
        } else {
            usk.decrypt_string(s).ok().map(|z| z.to_string())
        }
    })
    .unwrap_or_default()
}

fn dec_opt_or_plain(usk: &UserSymmetricKey, val: Option<&str>) -> String {
    let Some(s) = val else {
        return String::new();
    };
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    match usk.decrypt_string(trimmed) {
        Ok(z) => z.to_string(),
        Err(_) => trimmed.to_string(),
    }
}

fn decode_fido2_credentials(
    usk: &UserSymmetricKey,
    creds: &[CipherFido2CredentialDto],
    fallback_created_at: &str,
) -> Vec<PasskeyCredential> {
    creds
        .iter()
        .enumerate()
        .filter_map(|(idx, c)| {
            let credential_id = dec_opt_or_plain(usk, c.credential_id.as_deref());
            let rp_id = dec_opt_or_plain(usk, c.rp_id.as_deref());
            let rp_name_raw = dec_opt_or_plain(usk, c.rp_name.as_deref());
            let rp_name = if rp_name_raw.is_empty() {
                rp_id.clone()
            } else {
                rp_name_raw
            };
            let user_name = dec_opt_or_plain(usk, c.user_name.as_deref());
            let user_display_raw = dec_opt_or_plain(usk, c.user_display_name.as_deref());
            let user_display_name = if user_display_raw.is_empty() {
                user_name.clone()
            } else {
                user_display_raw
            };
            let user_handle = dec_opt_or_plain(usk, c.user_handle.as_deref());
            let counter_raw = dec_opt_or_plain(usk, c.counter.as_deref());
            let sign_count = counter_raw.trim().parse::<u32>().unwrap_or(0);
            let discoverable_raw = dec_opt_or_plain(usk, c.discoverable.as_deref());
            let discoverable = !matches!(
                discoverable_raw.trim().to_ascii_lowercase().as_str(),
                "false" | "0"
            );

            let alg_str = dec_opt_or_plain(usk, c.key_algorithm.as_deref()).to_ascii_lowercase();
            let curve_str = dec_opt_or_plain(usk, c.key_curve.as_deref()).to_ascii_lowercase();
            let algorithm = if alg_str.contains("eddsa") || curve_str.contains("ed25519") {
                -8
            } else if alg_str.contains("rs256") || alg_str.contains("rsa") {
                -257
            } else {
                -7
            };

            let created_raw = dec_opt_or_plain(usk, c.creation_date.as_deref());
            let created_at = if created_raw.is_empty() {
                fallback_created_at.to_string()
            } else {
                created_raw
            };

            let stable_id = if credential_id.is_empty() {
                format!("fido2-{idx}")
            } else {
                credential_id
            };

            if rp_id.is_empty() && rp_name.is_empty() && user_name.is_empty() {
                return None;
            }

            Some(PasskeyCredential {
                credential_id: stable_id,
                rp_id,
                rp_name,
                user_handle,
                user_name,
                user_display_name,
                algorithm,
                private_key_pkcs8: dec_opt_or_plain(usk, c.key_value.as_deref()),
                public_key_spki: String::new(),
                sign_count,
                discoverable,
                aaguid: String::new(),
                transports: vec!["internal".to_string(), "hybrid".to_string()],
                backed_up: true,
                created_at,
                last_used_at: None,
            })
        })
        .collect()
}

fn enc_opt(usk: &UserSymmetricKey, val: &str) -> Result<Option<String>, CoreError> {
    if val.is_empty() {
        Ok(None)
    } else {
        Ok(Some(usk.encrypt_string(val)?))
    }
}

fn map_bw_uri_match(m: Option<u8>) -> UrlMatchRule {
    match m {
        Some(1) => UrlMatchRule::Host,
        Some(2) => UrlMatchRule::StartsWith,
        Some(3) => UrlMatchRule::Exact,
        Some(4) => UrlMatchRule::Never,
        _ => UrlMatchRule::Domain,
    }
}

fn unmap_bw_uri_match(rule: UrlMatchRule) -> Option<u8> {
    Some(match rule {
        UrlMatchRule::Domain => 0,
        UrlMatchRule::Host => 1,
        UrlMatchRule::StartsWith => 2,
        UrlMatchRule::Exact => 3,
        UrlMatchRule::Never => 4,
    })
}

/// Decode a Vaultwarden Folder into a Keysmith Vault (supports both VaultMetaJson and plain names).
pub fn folder_to_vault(
    folder: &FolderDto,
    usk: &UserSymmetricKey,
    item_count: usize,
) -> Result<Vault, CoreError> {
    let decrypted = usk
        .decrypt_string(&folder.name)
        .map(|z| z.to_string())
        .unwrap_or_else(|_| "未命名保险库".to_string());

    if let Ok(meta) = serde_json::from_str::<VaultMetaJson>(&decrypted) {
        if meta.schema == VAULT_SCHEMA_V1 {
            return Ok(Vault {
                id: folder.id.clone(),
                name: meta.name,
                icon: meta.icon,
                color: meta.color,
                is_default: false,
                is_organization: false,
                travel_safe: meta.travel_safe,
                item_count,
            });
        }
    }

    Ok(Vault {
        id: folder.id.clone(),
        name: if decrypted.trim().is_empty() {
            "未命名保险库".to_string()
        } else {
            decrypted
        },
        icon: "folder".to_string(),
        color: "#0572EC".to_string(),
        is_default: false,
        is_organization: false,
        travel_safe: false,
        item_count,
    })
}

/// Decode an Organization Collection into a read-friendly Vault (`is_organization = true`).
pub fn collection_to_vault(
    col: &CollectionDto,
    usk: &UserSymmetricKey,
    item_count: usize,
) -> Vault {
    let decrypted = usk
        .decrypt_string(&col.name)
        .map(|z| z.to_string())
        .unwrap_or_else(|_| col.name.clone());
    Vault {
        id: col.id.clone(),
        name: if decrypted.trim().is_empty() {
            "组织集合".to_string()
        } else {
            decrypted
        },
        icon: "building".to_string(),
        color: "#6366F1".to_string(),
        is_default: false,
        is_organization: true,
        travel_safe: false,
        item_count,
    }
}

/// Encode Vault metadata as EncString(VaultMetaJson) with explicit `travel_safe`.
pub fn encode_vault_meta(
    name: &str,
    icon: &str,
    color: &str,
    travel_safe: bool,
    usk: &UserSymmetricKey,
) -> Result<String, CoreError> {
    let meta = VaultMetaJson {
        schema: VAULT_SCHEMA_V1.to_string(),
        name: name.trim().to_string(),
        icon: icon.to_string(),
        color: color.to_string(),
        travel_safe,
    };
    let json = serde_json::to_string(&meta)
        .map_err(|e| CoreError::Internal(format!("序列化 Vault 元数据失败: {e}")))?;
    usk.encrypt_string(&json)
}

/// Encode Vault metadata as EncString(VaultMetaJson).
pub fn encode_vault_name(
    name: &str,
    icon: &str,
    color: &str,
    usk: &UserSymmetricKey,
) -> Result<String, CoreError> {
    encode_vault_meta(name, icon, color, false, usk)
}

fn decode_remote_attachments(cipher: &CipherDto, usk: &UserSymmetricKey) -> Vec<ItemAttachment> {
    cipher
        .attachments
        .iter()
        .map(|att| {
            let file_name = att
                .file_name
                .as_deref()
                .and_then(|enc| {
                    if enc.starts_with("2.") || enc.starts_with("0.") {
                        usk.decrypt_string(enc).ok().map(|z| z.to_string())
                    } else {
                        Some(enc.to_string())
                    }
                })
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("attachment-{}", att.id));
            let size = att.size_bytes();
            let size_name = att
                .size_name
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format_size_bytes(size));
            ItemAttachment {
                id: att.id.clone(),
                file_name,
                size,
                size_name,
                has_local_data: false,
            }
        })
        .collect()
}

/// Decode a Bitwarden/Vaultwarden Cipher (either `keysmith.item.v1` or native Bitwarden type 1/2/3/4).
pub fn cipher_to_item(cipher: &CipherDto, usk: &UserSymmetricKey) -> Result<ItemDetail, CoreError> {
    let title = {
        let dec = dec_opt(usk, cipher.name.as_deref());
        if dec.trim().is_empty() {
            "未命名条目".to_string()
        } else {
            dec
        }
    };
    let vault_id = cipher
        .folder_id
        .clone()
        .or_else(|| cipher.collection_ids.first().cloned())
        .unwrap_or_else(|| DEFAULT_PERSONAL_VAULT_ID.to_string());
    let now = Utc::now().to_rfc3339();
    let created_at = cipher
        .creation_date
        .clone()
        .or_else(|| cipher.revision_date.clone())
        .unwrap_or_else(|| now.clone());
    let updated_at = cipher.revision_date.clone().unwrap_or(now);

    let notes_dec = dec_opt(usk, cipher.notes.as_deref());
    let remote_attachments = decode_remote_attachments(cipher, usk);
    let remote_passkeys = cipher
        .login
        .as_ref()
        .map(|l| decode_fido2_credentials(usk, &l.fido2_credentials, &created_at))
        .unwrap_or_default();

    let reprompt = cipher.reprompt.unwrap_or(0) == 1;

    // 1. Try decoding Keysmith Schema v1 JSON envelope from notes
    if let Ok(mut payload) = serde_json::from_str::<ItemPayload>(&notes_dec) {
        if payload.schema == ITEM_SCHEMA_V1 {
            if payload.created_at.is_empty() {
                payload.created_at = created_at;
            }
            if payload.updated_at.is_empty() {
                payload.updated_at = updated_at;
            }
            payload.reprompt = payload.reprompt || reprompt;
            // Merge remote attachments not already tracked
            for ra in remote_attachments {
                if !payload.attachments.iter().any(|a| a.id == ra.id) {
                    payload.attachments.push(ra);
                }
            }
            for rp in remote_passkeys {
                if !payload
                    .passkeys
                    .iter()
                    .any(|p| p.credential_id == rp.credential_id)
                {
                    payload.passkeys.push(rp);
                }
            }
            return Ok(ItemDetail {
                id: cipher.id.clone(),
                vault_id,
                title,
                favorite: cipher.favorite,
                deleted_at: cipher.deleted_date.clone(),
                payload,
            });
        }
    }

    // 2. Fallback: adapt standard Bitwarden/Vaultwarden ciphers (type 1/2/3/4)
    let mut sections: Vec<ItemSection> = Vec::new();
    let mut urls: Vec<ItemUrl> = Vec::new();
    let mut icon: Option<ItemIcon> = None;
    let passkeys = if cipher.cipher_type == 1 {
        remote_passkeys
    } else {
        Vec::new()
    };

    let category = match cipher.cipher_type {
        1 => {
            let mut primary_fields = Vec::new();
            if let Some(login) = &cipher.login {
                let username = dec_opt(usk, login.username.as_deref());
                let password = dec_opt(usk, login.password.as_deref());
                let totp = dec_opt(usk, login.totp.as_deref());

                primary_fields.push(ItemField {
                    id: format!("f-user-{}", cipher.id),
                    label: "用户名".to_string(),
                    field_type: FieldType::Text,
                    value: username,
                    sensitive: false,
                    copyable: true,
                    purpose: Some(FieldPurpose::Username),
                });
                primary_fields.push(ItemField {
                    id: format!("f-pass-{}", cipher.id),
                    label: "密码".to_string(),
                    field_type: FieldType::Password,
                    value: password,
                    sensitive: true,
                    copyable: true,
                    purpose: Some(FieldPurpose::Password),
                });
                if !totp.is_empty() {
                    primary_fields.push(ItemField {
                        id: format!("f-totp-{}", cipher.id),
                        label: "一次性密码".to_string(),
                        field_type: FieldType::Totp,
                        value: totp,
                        sensitive: true,
                        copyable: true,
                        purpose: Some(FieldPurpose::Totp),
                    });
                }

                for (idx, u) in login.uris.iter().enumerate() {
                    let uri = dec_opt(usk, u.uri.as_deref());
                    if !uri.is_empty() {
                        if icon.is_none() {
                            let host = extract_domain(&uri);
                            if !host.is_empty() {
                                icon = Some(ItemIcon::Domain { host });
                            }
                        }
                        urls.push(ItemUrl {
                            id: format!("u-{}-{idx}", cipher.id),
                            uri,
                            label: None,
                            match_rule: map_bw_uri_match(u.uri_match),
                        });
                    }
                }
            }
            sections.push(ItemSection {
                id: format!("sec-main-{}", cipher.id),
                title: String::new(),
                fields: primary_fields,
            });
            ItemCategory::Login
        }
        3 => {
            let mut card_fields = Vec::new();
            let mut billing_fields = Vec::new();
            if let Some(card) = &cipher.card {
                let holder = dec_opt(usk, card.cardholder_name.as_deref());
                let number = dec_opt(usk, card.number.as_deref());
                let exp_month = dec_opt(usk, card.exp_month.as_deref());
                let exp_year = dec_opt(usk, card.exp_year.as_deref());
                let code = dec_opt(usk, card.code.as_deref());
                let brand = dec_opt(usk, card.brand.as_deref());

                let expiry = match (exp_year.trim(), exp_month.trim()) {
                    ("", "") => String::new(),
                    (y, m) if !y.is_empty() && !m.is_empty() => {
                        let mm = if m.len() == 1 {
                            format!("0{m}")
                        } else {
                            m.to_string()
                        };
                        format!("{y}-{mm}")
                    }
                    (y, m) => format!("{y}{m}"),
                };

                card_fields.push(ItemField {
                    id: format!("f-holder-{}", cipher.id),
                    label: "持卡人".to_string(),
                    field_type: FieldType::Text,
                    value: holder,
                    sensitive: false,
                    copyable: true,
                    purpose: None,
                });
                card_fields.push(ItemField {
                    id: format!("f-num-{}", cipher.id),
                    label: "卡号".to_string(),
                    field_type: FieldType::Number,
                    value: number,
                    sensitive: true,
                    copyable: true,
                    purpose: Some(FieldPurpose::CardNumber),
                });
                card_fields.push(ItemField {
                    id: format!("f-exp-{}", cipher.id),
                    label: "有效期".to_string(),
                    field_type: FieldType::MonthYear,
                    value: expiry,
                    sensitive: false,
                    copyable: true,
                    purpose: Some(FieldPurpose::CardExpiry),
                });
                card_fields.push(ItemField {
                    id: format!("f-cvv-{}", cipher.id),
                    label: "安全码 CVV".to_string(),
                    field_type: FieldType::Password,
                    value: code,
                    sensitive: true,
                    copyable: true,
                    purpose: Some(FieldPurpose::CardCvv),
                });
                if !brand.is_empty() {
                    billing_fields.push(ItemField {
                        id: format!("f-brand-{}", cipher.id),
                        label: "卡组织".to_string(),
                        field_type: FieldType::Text,
                        value: brand,
                        sensitive: false,
                        copyable: true,
                        purpose: None,
                    });
                }
            }
            sections.push(ItemSection {
                id: format!("sec-main-{}", cipher.id),
                title: String::new(),
                fields: card_fields,
            });
            if !billing_fields.is_empty() {
                sections.push(ItemSection {
                    id: format!("sec-billing-{}", cipher.id),
                    title: "卡片信息".to_string(),
                    fields: billing_fields,
                });
            }
            ItemCategory::CreditCard
        }
        4 => {
            let mut main_fields = Vec::new();
            let mut contact_fields = Vec::new();
            let mut id_fields = Vec::new();
            if let Some(idn) = &cipher.identity {
                let first = dec_opt(usk, idn.first_name.as_deref());
                let last = dec_opt(usk, idn.last_name.as_deref());
                let company = dec_opt(usk, idn.company.as_deref());
                let email = dec_opt(usk, idn.email.as_deref());
                let phone = dec_opt(usk, idn.phone.as_deref());
                let addr = [
                    dec_opt(usk, idn.address1.as_deref()),
                    dec_opt(usk, idn.address2.as_deref()),
                    dec_opt(usk, idn.city.as_deref()),
                    dec_opt(usk, idn.country.as_deref()),
                ]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", ");
                let ssn = dec_opt(usk, idn.ssn.as_deref());
                let passport = dec_opt(usk, idn.passport_number.as_deref());
                let license = dec_opt(usk, idn.license_number.as_deref());

                if !first.is_empty() {
                    main_fields.push(ItemField {
                        id: format!("f-fn-{}", cipher.id),
                        label: "名".to_string(),
                        field_type: FieldType::Text,
                        value: first,
                        sensitive: false,
                        copyable: true,
                        purpose: None,
                    });
                }
                if !last.is_empty() {
                    main_fields.push(ItemField {
                        id: format!("f-ln-{}", cipher.id),
                        label: "姓".to_string(),
                        field_type: FieldType::Text,
                        value: last,
                        sensitive: false,
                        copyable: true,
                        purpose: None,
                    });
                }
                if !company.is_empty() {
                    main_fields.push(ItemField {
                        id: format!("f-co-{}", cipher.id),
                        label: "公司".to_string(),
                        field_type: FieldType::Text,
                        value: company,
                        sensitive: false,
                        copyable: true,
                        purpose: None,
                    });
                }
                if !email.is_empty() {
                    contact_fields.push(ItemField {
                        id: format!("f-em-{}", cipher.id),
                        label: "邮箱".to_string(),
                        field_type: FieldType::Email,
                        value: email,
                        sensitive: false,
                        copyable: true,
                        purpose: Some(FieldPurpose::Username),
                    });
                }
                if !phone.is_empty() {
                    contact_fields.push(ItemField {
                        id: format!("f-ph-{}", cipher.id),
                        label: "电话".to_string(),
                        field_type: FieldType::Phone,
                        value: phone,
                        sensitive: false,
                        copyable: true,
                        purpose: None,
                    });
                }
                if !addr.is_empty() {
                    contact_fields.push(ItemField {
                        id: format!("f-ad-{}", cipher.id),
                        label: "地址".to_string(),
                        field_type: FieldType::Address,
                        value: addr,
                        sensitive: false,
                        copyable: true,
                        purpose: None,
                    });
                }
                if !ssn.is_empty() {
                    id_fields.push(ItemField {
                        id: format!("f-ssn-{}", cipher.id),
                        label: "身份证/社保号".to_string(),
                        field_type: FieldType::Text,
                        value: ssn,
                        sensitive: true,
                        copyable: true,
                        purpose: None,
                    });
                }
                if !passport.is_empty() {
                    id_fields.push(ItemField {
                        id: format!("f-pp-{}", cipher.id),
                        label: "护照号".to_string(),
                        field_type: FieldType::Text,
                        value: passport,
                        sensitive: true,
                        copyable: true,
                        purpose: None,
                    });
                }
                if !license.is_empty() {
                    id_fields.push(ItemField {
                        id: format!("f-lic-{}", cipher.id),
                        label: "驾照号".to_string(),
                        field_type: FieldType::Text,
                        value: license,
                        sensitive: true,
                        copyable: true,
                        purpose: None,
                    });
                }
            }
            if !main_fields.is_empty() {
                sections.push(ItemSection {
                    id: format!("sec-main-{}", cipher.id),
                    title: String::new(),
                    fields: main_fields,
                });
            }
            if !contact_fields.is_empty() {
                sections.push(ItemSection {
                    id: format!("sec-contact-{}", cipher.id),
                    title: "联系方式".to_string(),
                    fields: contact_fields,
                });
            }
            if !id_fields.is_empty() {
                sections.push(ItemSection {
                    id: format!("sec-id-{}", cipher.id),
                    title: "证件号码".to_string(),
                    fields: id_fields,
                });
            }
            ItemCategory::Identity
        }
        _ => ItemCategory::SecureNote,
    };

    let mut sso_provider: Option<String> = None;
    let mut linked_item_ids: Vec<String> = Vec::new();
    if !cipher.fields.is_empty() {
        let mut custom = Vec::new();
        for (idx, cf) in cipher.fields.iter().enumerate() {
            let label = dec_opt(usk, cf.name.as_deref());
            let value = dec_opt(usk, cf.value.as_deref());
            if label == "_ks_sso_provider" {
                let clean = value.trim().to_string();
                if !clean.is_empty() {
                    sso_provider = Some(clean);
                }
                continue;
            }
            if label == "_ks_linked_items" {
                linked_item_ids = value
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect();
                continue;
            }
            let sensitive = cf.field_type == 1;
            custom.push(ItemField {
                id: format!("f-bw-{}-{idx}", cipher.id),
                label: if label.is_empty() {
                    format!("字段 {}", idx + 1)
                } else {
                    label
                },
                field_type: if sensitive {
                    FieldType::Password
                } else {
                    FieldType::Text
                },
                value,
                sensitive,
                copyable: true,
                purpose: None,
            });
        }
        if !custom.is_empty() {
            sections.push(ItemSection {
                id: format!("sec-bw-fields-{}", cipher.id),
                title: "自定义字段".to_string(),
                fields: custom,
            });
        }
    }

    let password_history = cipher
        .password_history
        .iter()
        .filter_map(|h| {
            let pw = dec_opt(usk, h.password.as_deref());
            if pw.is_empty() {
                None
            } else {
                Some(PasswordHistoryEntry {
                    value: pw,
                    changed_at: h.last_used_date.clone().unwrap_or_else(|| updated_at.clone()),
                })
            }
        })
        .collect();

    Ok(ItemDetail {
        id: cipher.id.clone(),
        vault_id,
        title,
        favorite: cipher.favorite,
        deleted_at: cipher.deleted_date.clone(),
        payload: ItemPayload {
            schema: ITEM_SCHEMA_V1.to_string(),
            category,
            subtitle: None,
            icon,
            tags: Vec::new(),
            urls,
            sections,
            passkeys,
            notes: notes_dec,
            password_history,
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt,
            sso_provider,
            linked_item_ids,
            attachments: remote_attachments,
            created_at,
            updated_at,
        },
    })
}

fn is_keysmith_envelope_cipher(cipher: &CipherDto, usk: &UserSymmetricKey) -> bool {
    let notes_dec = dec_opt(usk, cipher.notes.as_deref());
    serde_json::from_str::<ItemPayload>(&notes_dec)
        .map(|p| p.schema == ITEM_SCHEMA_V1)
        .unwrap_or(false)
}

fn target_bw_cipher_type(category: ItemCategory) -> u8 {
    match category {
        ItemCategory::Passport | ItemCategory::DriverLicense => 4,
        _ => 2,
    }
}

fn build_fido2_credentials_dto(
    usk: &UserSymmetricKey,
    passkeys: &[PasskeyCredential],
    existing: Vec<CipherFido2CredentialDto>,
) -> Result<Vec<CipherFido2CredentialDto>, CoreError> {
    let mut existing_by_id: std::collections::HashMap<String, CipherFido2CredentialDto> =
        std::collections::HashMap::new();
    for (idx, f2) in existing.into_iter().enumerate() {
        let decoded_id = dec_opt_or_plain(usk, f2.credential_id.as_deref());
        let eff_id = if decoded_id.is_empty() {
            format!("fido2-{idx}")
        } else {
            decoded_id
        };
        existing_by_id.insert(eff_id, f2);
    }

    let mut synced_fido2 = Vec::with_capacity(passkeys.len());
    for pk in passkeys {
        let normalized_pk_creation = if pk.created_at.trim().is_empty() {
            Utc::now().to_rfc3339()
        } else {
            pk.created_at.clone()
        };
        if let Some(mut prev) = existing_by_id.remove(&pk.credential_id) {
            prev.counter = enc_opt(usk, &pk.sign_count.to_string())?;
            let repaired_creation = prev
                .creation_date
                .as_deref()
                .map(|s| dec_opt_or_plain(usk, Some(s)))
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(normalized_pk_creation);
            prev.creation_date = Some(repaired_creation);
            synced_fido2.push(prev);
        } else {
            let alg_name = match pk.algorithm {
                -8 => "EdDSA",
                -257 => "RS256",
                _ => "ECDSA",
            };
            let curve_name = match pk.algorithm {
                -8 => "Ed25519",
                -257 => "RSA",
                _ => "P-256",
            };
            synced_fido2.push(CipherFido2CredentialDto {
                credential_id: enc_opt(usk, &pk.credential_id)?,
                key_type: enc_opt(usk, "public-key")?,
                key_algorithm: enc_opt(usk, alg_name)?,
                key_curve: enc_opt(usk, curve_name)?,
                key_value: enc_opt(usk, &pk.private_key_pkcs8)?,
                rp_id: enc_opt(usk, &pk.rp_id)?,
                rp_name: enc_opt(usk, &pk.rp_name)?,
                counter: enc_opt(usk, &pk.sign_count.to_string())?,
                user_handle: enc_opt(usk, &pk.user_handle)?,
                user_name: enc_opt(usk, &pk.user_name)?,
                user_display_name: enc_opt(usk, &pk.user_display_name)?,
                discoverable: enc_opt(
                    usk,
                    if pk.discoverable { "true" } else { "false" },
                )?,
                creation_date: Some(normalized_pk_creation),
                extra: Default::default(),
            });
        }
    }
    Ok(synced_fido2)
}

/// Encode an `ItemDraft` into a `CipherDto` for local storage and Vaultwarden upload.
pub fn draft_to_cipher(
    id: &str,
    draft: &ItemDraft,
    prev_cipher: Option<&CipherDto>,
    prev_item: Option<&ItemDetail>,
    usk: &UserSymmetricKey,
) -> Result<(CipherDto, ItemDetail), CoreError> {
    let now = Utc::now().to_rfc3339();
    let title = if draft.title.trim().is_empty() {
        "未命名条目".to_string()
    } else {
        draft.title.trim().to_string()
    };

    let mut next_history = draft.password_history.clone();
    if let Some(prev) = prev_item {
        let prev_passwords: Vec<(&str, &str)> = prev
            .payload
            .sections
            .iter()
            .flat_map(|s| s.fields.iter())
            .filter(|f| f.purpose == Some(FieldPurpose::Password) && !f.value.trim().is_empty())
            .map(|f| (f.id.as_str(), f.value.as_str()))
            .collect();

        for (fid, old_val) in prev_passwords {
            let new_val = draft
                .sections
                .iter()
                .flat_map(|s| s.fields.iter())
                .find(|f| f.id == fid)
                .map(|f| f.value.as_str());
            if let Some(nv) = new_val {
                if !nv.trim().is_empty()
                    && nv != old_val
                    && !next_history.iter().any(|h| h.value == old_val)
                {
                    next_history.insert(
                        0,
                        PasswordHistoryEntry {
                            value: old_val.to_string(),
                            changed_at: now.clone(),
                        },
                    );
                }
            }
        }
    }
    next_history.truncate(20);

    let created_at = prev_item
        .map(|p| p.payload.created_at.clone())
        .unwrap_or_else(|| now.clone());

    let attachments = prev_item
        .map(|p| p.payload.attachments.clone())
        .unwrap_or_default();

    let folder_id = if draft.vault_id == DEFAULT_PERSONAL_VAULT_ID || draft.vault_id.trim().is_empty()
    {
        None
    } else {
        Some(draft.vault_id.clone())
    };

    let clean_sso = draft
        .sso_provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let clean_linked: Vec<String> = draft
        .linked_item_ids
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != id)
        .collect();

    let payload = ItemPayload {
        schema: ITEM_SCHEMA_V1.to_string(),
        category: draft.category,
        subtitle: draft.subtitle.clone(),
        icon: draft.icon.clone(),
        tags: draft.tags.clone(),
        urls: draft.urls.clone(),
        sections: draft.sections.clone(),
        passkeys: draft.passkeys.clone(),
        notes: draft.notes.clone(),
        password_history: next_history.clone(),
        watchtower: draft.watchtower,
        archived: draft.archived,
        reprompt: draft.reprompt,
        sso_provider: clean_sso.clone(),
        linked_item_ids: clean_linked.clone(),
        attachments,
        created_at: created_at.clone(),
        updated_at: now.clone(),
    };

    let item = ItemDetail {
        id: id.to_string(),
        vault_id: folder_id
            .clone()
            .unwrap_or_else(|| DEFAULT_PERSONAL_VAULT_ID.to_string()),
        title: title.clone(),
        favorite: draft.favorite,
        deleted_at: prev_item.and_then(|p| p.deleted_at.clone()),
        payload: payload.clone(),
    };

    // Preserve native Bitwarden cipher structure when updating an existing non-Keysmith cipher
    // (unless Keysmith-only metadata like `archived` is toggled, or keep native if unchanged)
    if let Some(prev) = prev_cipher {
        if !is_keysmith_envelope_cipher(prev, usk) && prev.cipher_type != 2 && !draft.archived {
            let mut next = prev.clone();
            next.folder_id = folder_id;
            next.favorite = draft.favorite;
            next.reprompt = Some(if draft.reprompt { 1 } else { 0 });
            next.name = Some(usk.encrypt_string(&title)?);
            next.notes = enc_opt(usk, &draft.notes)?;
            next.revision_date = Some(now.clone());

            let all_fields: Vec<&ItemField> = draft
                .sections
                .iter()
                .flat_map(|s| s.fields.iter())
                .collect();

            match next.cipher_type {
                1 => {
                    let mut login = next.login.take().unwrap_or_default();
                    let username = all_fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::Username))
                        .map(|f| f.value.as_str())
                        .unwrap_or("");
                    let password = all_fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::Password))
                        .map(|f| f.value.as_str())
                        .unwrap_or("");
                    let totp = all_fields
                        .iter()
                        .find(|f| {
                            f.field_type == FieldType::Totp || f.purpose == Some(FieldPurpose::Totp)
                        })
                        .map(|f| f.value.as_str())
                        .unwrap_or("");

                    login.username = enc_opt(usk, username)?;
                    login.password = enc_opt(usk, password)?;
                    login.totp = enc_opt(usk, totp)?;
                    login.uris = draft
                        .urls
                        .iter()
                        .filter(|u| !u.uri.trim().is_empty())
                        .map(|u| {
                            Ok(CipherLoginUriDto {
                                uri: Some(usk.encrypt_string(&u.uri)?),
                                uri_match: unmap_bw_uri_match(u.match_rule),
                                extra: Default::default(),
                            })
                        })
                        .collect::<Result<Vec<_>, CoreError>>()?;
                    // Synchronize Fido2Credentials from draft.passkeys, preserving existing entries' extra fields
                    let prev_f2 = std::mem::take(&mut login.fido2_credentials);
                    login.fido2_credentials =
                        build_fido2_credentials_dto(usk, &draft.passkeys, prev_f2)?;
                    next.login = Some(login);
                }
                3 => {
                    let mut card = next.card.take().unwrap_or_default();
                    if let Some(f) = all_fields.iter().find(|f| f.label.contains("持卡人")) {
                        card.cardholder_name = enc_opt(usk, &f.value)?;
                    }
                    if let Some(f) = all_fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::CardNumber))
                    {
                        card.number = enc_opt(usk, &f.value)?;
                    }
                    if let Some(f) = all_fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::CardCvv))
                    {
                        card.code = enc_opt(usk, &f.value)?;
                    }
                    if let Some(f) = all_fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::CardExpiry))
                    {
                        let parts: Vec<&str> = f.value.split('-').collect();
                        if parts.len() == 2 {
                            card.exp_year = enc_opt(usk, parts[0])?;
                            card.exp_month = enc_opt(usk, parts[1])?;
                        }
                    }
                    next.card = Some(card);
                }
                4 => {
                    let mut identity = next.identity.take().unwrap_or_default();
                    if let Some(f) = all_fields.iter().find(|f| f.label == "名") {
                        identity.first_name = enc_opt(usk, &f.value)?;
                    }
                    if let Some(f) = all_fields.iter().find(|f| f.label == "姓") {
                        identity.last_name = enc_opt(usk, &f.value)?;
                    }
                    if let Some(f) = all_fields.iter().find(|f| f.field_type == FieldType::Email) {
                        identity.email = enc_opt(usk, &f.value)?;
                    }
                    if let Some(f) = all_fields.iter().find(|f| f.field_type == FieldType::Phone) {
                        identity.phone = enc_opt(usk, &f.value)?;
                    }
                    next.identity = Some(identity);
                }
                _ => {}
            }

            let mut custom_fields_dto = if let Some(bw_sec) =
                draft.sections.iter().find(|s| s.title == "自定义字段")
            {
                bw_sec
                    .fields
                    .iter()
                    .map(|f| {
                        Ok(CipherFieldDto {
                            name: enc_opt(usk, &f.label)?,
                            value: enc_opt(usk, &f.value)?,
                            field_type: if f.sensitive { 1 } else { 0 },
                            linked_id: None,
                            extra: Default::default(),
                        })
                    })
                    .collect::<Result<Vec<_>, CoreError>>()?
            } else {
                Vec::new()
            };
            if let Some(ref sso) = clean_sso {
                custom_fields_dto.push(CipherFieldDto {
                    name: enc_opt(usk, "_ks_sso_provider")?,
                    value: enc_opt(usk, sso)?,
                    field_type: 0,
                    linked_id: None,
                    extra: Default::default(),
                });
            }
            if !clean_linked.is_empty() {
                custom_fields_dto.push(CipherFieldDto {
                    name: enc_opt(usk, "_ks_linked_items")?,
                    value: enc_opt(usk, &clean_linked.join(","))?,
                    field_type: 0,
                    linked_id: None,
                    extra: Default::default(),
                });
            }
            next.fields = custom_fields_dto;

            next.password_history = next_history
                .iter()
                .map(|h| {
                    Ok(CipherPasswordHistoryDto {
                        password: Some(usk.encrypt_string(&h.value)?),
                        last_used_date: Some(h.changed_at.clone()),
                    })
                })
                .collect::<Result<Vec<_>, CoreError>>()?;

            return Ok((next, item));
        }
    }

    // Emit native Bitwarden Login (type=1) with fido2Credentials when creating a new Login with Passkeys
    if prev_cipher.is_none()
        && draft.category == ItemCategory::Login
        && !draft.passkeys.is_empty()
        && !draft.archived
        && draft.tags.is_empty()
        && draft.sections.len() <= 1
    {
        let all_fields: Vec<&ItemField> = draft
            .sections
            .iter()
            .flat_map(|s| s.fields.iter())
            .collect();
        let username = all_fields
            .iter()
            .find(|f| f.purpose == Some(FieldPurpose::Username))
            .map(|f| f.value.as_str())
            .unwrap_or("");
        let password = all_fields
            .iter()
            .find(|f| f.purpose == Some(FieldPurpose::Password))
            .map(|f| f.value.as_str())
            .unwrap_or("");
        let totp = all_fields
            .iter()
            .find(|f| f.field_type == FieldType::Totp || f.purpose == Some(FieldPurpose::Totp))
            .map(|f| f.value.as_str())
            .unwrap_or("");
        let uris = draft
            .urls
            .iter()
            .filter(|u| !u.uri.trim().is_empty())
            .map(|u| {
                Ok(CipherLoginUriDto {
                    uri: Some(usk.encrypt_string(&u.uri)?),
                    uri_match: unmap_bw_uri_match(u.match_rule),
                    extra: Default::default(),
                })
            })
            .collect::<Result<Vec<_>, CoreError>>()?;
        let fido2_credentials = build_fido2_credentials_dto(usk, &draft.passkeys, Vec::new())?;
        let mut meta_fields = Vec::new();
        if let Some(ref sso) = clean_sso {
            meta_fields.push(CipherFieldDto {
                name: enc_opt(usk, "_ks_sso_provider")?,
                value: enc_opt(usk, sso)?,
                field_type: 0,
                linked_id: None,
                extra: Default::default(),
            });
        }
        if !clean_linked.is_empty() {
            meta_fields.push(CipherFieldDto {
                name: enc_opt(usk, "_ks_linked_items")?,
                value: enc_opt(usk, &clean_linked.join(","))?,
                field_type: 0,
                linked_id: None,
                extra: Default::default(),
            });
        }
        let cipher = CipherDto {
            id: id.to_string(),
            organization_id: None,
            folder_id,
            collection_ids: Vec::new(),
            cipher_type: 1,
            name: Some(usk.encrypt_string(&title)?),
            notes: enc_opt(usk, &draft.notes)?,
            favorite: draft.favorite,
            login: Some(CipherLoginDto {
                username: enc_opt(usk, username)?,
                password: enc_opt(usk, password)?,
                totp: enc_opt(usk, totp)?,
                uris,
                fido2_credentials,
                extra: Default::default(),
            }),
            secure_note: None,
            card: None,
            identity: None,
            fields: meta_fields,
            password_history: Vec::new(),
            attachments: Vec::new(),
            reprompt: Some(if draft.reprompt { 1 } else { 0 }),
            revision_date: Some(now),
            creation_date: Some(created_at),
            deleted_date: None,
            extra: Default::default(),
        };
        return Ok((cipher, item));
    }

    // Keysmith Schema v1 envelope
    let payload_json = serde_json::to_string(&payload)
        .map_err(|e| CoreError::Internal(format!("序列化 ItemPayload 失败: {e}")))?;

    let bw_type = target_bw_cipher_type(draft.category);
    let mut cipher = prev_cipher.cloned().unwrap_or_else(|| CipherDto {
        id: id.to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: Vec::new(),
        cipher_type: bw_type,
        name: None,
        notes: None,
        favorite: false,
        login: None,
        secure_note: None,
        card: None,
        identity: None,
        fields: Vec::new(),
        password_history: Vec::new(),
        attachments: Vec::new(),
        reprompt: Some(0),
        revision_date: None,
        creation_date: Some(created_at.clone()),
        deleted_date: None,
        extra: Default::default(),
    });

    cipher.id = id.to_string();
    cipher.folder_id = folder_id;
    cipher.cipher_type = bw_type;
    cipher.favorite = draft.favorite;
    cipher.reprompt = Some(if draft.reprompt { 1 } else { 0 });
    cipher.name = Some(usk.encrypt_string(&title)?);
    cipher.notes = Some(usk.encrypt_string(&payload_json)?);
    if bw_type == 4 {
        cipher.secure_note = None;
        cipher.identity = Some(CipherIdentityDto::default());
    } else {
        cipher.secure_note = Some(CipherSecureNoteDto { note_type: 0 });
        cipher.identity = None;
    }
    cipher.login = None;
    cipher.card = None;
    cipher.revision_date = Some(now);

    Ok((cipher, item))
}

pub fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

pub fn decode_send_dto(
    dto: &SendDto,
    usk: &UserSymmetricKey,
    server_url: &str,
) -> Result<(SendItem, Zeroizing<[u8; 16]>), CoreError> {
    let key_enc = dto
        .key
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| CoreError::Crypto("Send 缺少密钥字段".to_string()))?;
    let key_raw = decrypt_bytes(key_enc, usk.enc_key(), usk.mac_key())?;
    let seed_arr: [u8; 16] = (*key_raw)
        .clone()
        .try_into()
        .map_err(|_| CoreError::Crypto("Send 密钥长度必须为 16 字节".to_string()))?;
    let seed = Zeroizing::new(seed_arr);
    let send_key = derive_send_key(&seed)?;

    let name = {
        let dec = dec_opt(&send_key, dto.name.as_deref());
        if dec.trim().is_empty() {
            let fallback = dec_opt(usk, dto.name.as_deref());
            if fallback.trim().is_empty() {
                "未命名 Send".to_string()
            } else {
                fallback
            }
        } else {
            dec
        }
    };

    let notes = dto
        .notes
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .and_then(|enc| {
            usk.decrypt_string(enc)
                .or_else(|_| send_key.decrypt_string(enc))
                .ok()
                .map(|z| z.to_string())
        });

    let send_type = if dto.send_type == 1 {
        SendType::File
    } else {
        SendType::Text
    };

    let (text, hidden) = if send_type == SendType::Text {
        let t = dto
            .text
            .as_ref()
            .and_then(|tx| tx.text.as_deref())
            .map(|enc| send_key.decrypt_string(enc).map(|z| z.to_string()).unwrap_or_default());
        let h = dto.text.as_ref().map(|tx| tx.hidden).unwrap_or(false);
        (t, h)
    } else {
        (None, false)
    };

    let (file_name, file_size, file_size_name) = if send_type == SendType::File {
        if let Some(f) = &dto.file {
            let fname = f
                .file_name
                .as_deref()
                .map(|enc| dec_opt_or_plain(&send_key, Some(enc)))
                .filter(|s| !s.is_empty());
            let sz = f.size_bytes();
            let sz_name = f
                .size_name
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format_size_bytes(sz));
            (fname, Some(sz), Some(sz_name))
        } else {
            (None, None, None)
        }
    } else {
        (None, None, None)
    };

    let revision_date = dto
        .revision_date
        .clone()
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let share_url = if dto.access_id.trim().is_empty() {
        String::new()
    } else {
        build_send_share_url(server_url, &dto.access_id, &seed)
    };

    let item = SendItem {
        id: dto.id.clone(),
        access_id: dto.access_id.clone(),
        send_type,
        name,
        notes,
        text,
        hidden,
        file_name,
        file_size,
        file_size_name,
        share_url,
        max_access_count: dto.max_access_count,
        access_count: dto.access_count,
        expiration_date: dto.expiration_date.clone(),
        deletion_date: dto.deletion_date.clone(),
        revision_date,
        disabled: dto.disabled,
        hide_email: dto.hide_email,
        has_password: dto.has_password(),
    };

    Ok((item, seed))
}

#[allow(clippy::too_many_arguments)]
pub fn encode_send_payload(
    send_type: SendType,
    name: &str,
    notes: Option<&str>,
    text: Option<(&str, bool)>,
    file: Option<(&str, u64)>,
    max_access_count: Option<u32>,
    expiration_date: Option<&str>,
    deletion_date: &str,
    password: Option<&str>,
    disabled: bool,
    hide_email: bool,
    seed: &[u8; 16],
    usk: &UserSymmetricKey,
) -> Result<SendCreateUpdatePayload, CoreError> {
    let send_key = derive_send_key(seed)?;
    let key_enc = encrypt_bytes(seed, usk.enc_key(), usk.mac_key())?;
    let name_enc = send_key.encrypt_string(name.trim())?;
    let notes_enc = match notes.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => Some(usk.encrypt_string(n)?),
        None => None,
    };
    let password_hash = password
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|pw| hash_send_password(pw, seed));

    let (text_dto, file_dto, file_length, type_code) = match send_type {
        SendType::Text => {
            let (raw_text, hidden) = text.unwrap_or(("", false));
            let text_enc = send_key.encrypt_string(raw_text)?;
            (
                Some(SendTextDto {
                    text: Some(text_enc),
                    hidden,
                    extra: Default::default(),
                }),
                None,
                None,
                0u8,
            )
        }
        SendType::File => {
            let (fname, size) = file.unwrap_or(("file.bin", 0));
            let fname_enc = send_key.encrypt_string(fname)?;
            (
                None,
                Some(SendFileDto {
                    id: None,
                    file_name: Some(fname_enc),
                    size: None,
                    size_name: None,
                    extra: Default::default(),
                }),
                Some(size),
                1u8,
            )
        }
    };

    Ok(SendCreateUpdatePayload {
        send_type: type_code,
        name: name_enc,
        notes: notes_enc,
        key: key_enc,
        max_access_count,
        expiration_date: expiration_date
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        deletion_date: deletion_date.trim().to_string(),
        password: password_hash,
        disabled,
        hide_email,
        text: text_dto,
        file: file_dto,
        file_length,
    })
}
