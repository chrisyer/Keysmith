use std::collections::HashMap;
use std::io::{Cursor, Write};
use std::sync::{Arc, Mutex};

use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chrono::{Duration, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use image::{ImageFormat, Luma};
use keysmith_core::crypto::{
    build_send_share_url, decrypt_bytes, derive_master_key, derive_master_password_hash,
    derive_send_key, encrypt_bytes, encrypt_send_buffer, generate_send_seed, hash_send_password,
    protect_user_symmetric_key, stretch_master_key, unprotect_user_symmetric_key, KdfConfig,
    UserSymmetricKey,
};
use keysmith_core::domain::codec::{
    cipher_to_item, draft_to_cipher, encode_vault_name, folder_to_vault,
};
use keysmith_core::domain::{
    AppSettingsPatch, AuthStatus, FieldPurpose, FieldType, GeneratorMode, GeneratorOptions,
    ItemCategory, ItemDraft, ItemField, ItemFilter, ItemSection, ItemUrl, PasskeyCredential,
    SendCreateTextInput, SendType, SendUpdateInput, SessionPreferencesPatch, UrlMatchRule, Vault,
    WatchtowerFlags, WatchtowerIssueType, DEFAULT_PERSONAL_VAULT_ID,
};
use keysmith_core::generator::{evaluate_password_strength, generate_secret};
use keysmith_core::importers::decrypt_keysmith_export;
use keysmith_core::protocol::signalr::{parse_signalr_frames, SignalREvent};
use keysmith_core::protocol::{
    CipherCardDto, CipherDto, CipherFido2CredentialDto, CipherFieldDto, CipherIdentityDto,
    CipherLoginDto, CipherLoginUriDto, CipherPasswordHistoryDto, FolderDto, SyncResponse,
};
use keysmith_core::search::{matches_search_query, score_search_query};
use keysmith_core::storage::{Storage, StoredAccount};
use keysmith_core::totp::compute_totp_at;
use keysmith_core::traits::{BiometricKeyStore, NoopClipboardManager};
use keysmith_core::watchtower::run_watchtower_audit;
use keysmith_core::{AppCore, CoreError};
use qrcode::QrCode;
use ssh_key::PublicKey;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use zeroize::Zeroizing;
use zip::write::SimpleFileOptions;

#[derive(Default)]
struct MockBiometricStore {
    available: bool,
    keys: Mutex<HashMap<String, Vec<u8>>>,
}

impl BiometricKeyStore for MockBiometricStore {
    fn is_available(&self) -> bool {
        self.available
    }

    fn save_unlock_key(&self, account_id: &str, key: &[u8]) -> Result<(), CoreError> {
        self.keys
            .lock()
            .unwrap()
            .insert(account_id.to_string(), key.to_vec());
        Ok(())
    }

    fn load_unlock_key(
        &self,
        account_id: &str,
        _reason: &str,
    ) -> Result<Zeroizing<Vec<u8>>, CoreError> {
        self.keys
            .lock()
            .unwrap()
            .get(account_id)
            .cloned()
            .map(Zeroizing::new)
            .ok_or_else(|| CoreError::Biometric("未找到密钥".to_string()))
    }

    fn delete_unlock_key(&self, account_id: &str) -> Result<(), CoreError> {
        self.keys.lock().unwrap().remove(account_id);
        Ok(())
    }

    fn verify_user(&self, _reason: &str) -> Result<(), CoreError> {
        if self.available {
            Ok(())
        } else {
            Err(CoreError::Biometric("Biometric unavailable".to_string()))
        }
    }
}

fn make_test_account(
    id: &str,
    email: &str,
    server_url: &str,
    kdf: &KdfConfig,
    protected: String,
) -> StoredAccount {
    let mut acc = StoredAccount::default_prefs(
        id.to_string(),
        server_url.to_string(),
        email.to_string(),
        email.split('@').next().unwrap_or("User").to_string(),
        kdf.kdf,
        kdf.kdf_iterations,
        kdf.kdf_memory,
        kdf.kdf_parallelism,
        protected,
        format!("dev-{id}"),
    );
    acc.biometric_enabled = true;
    acc.last_master_password_unlock_at = Some(Utc::now().to_rfc3339());
    acc
}

#[test]
fn crypto_kdf_hkdf_and_encstring_roundtrip_and_tamper_detection() {
    let argon_cfg = KdfConfig {
        kdf: 1,
        kdf_iterations: 2,
        kdf_memory: Some(16),
        kdf_parallelism: Some(1),
    };
    let mk1 = derive_master_key("SuperSecret#2026", "  Cherry@Example.COM ", &argon_cfg).unwrap();
    let mk2 = derive_master_key("SuperSecret#2026", "cherry@example.com", &argon_cfg).unwrap();
    assert_eq!(mk1.as_bytes(), mk2.as_bytes());

    let pbkdf_cfg = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk_pb = derive_master_key("SuperSecret#2026", "cherry@example.com", &pbkdf_cfg).unwrap();
    let mph = derive_master_password_hash(&mk_pb, "SuperSecret#2026");
    assert!(!mph.is_empty());

    let smk = stretch_master_key(&mk1).unwrap();
    let usk = UserSymmetricKey::generate();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();
    assert!(protected.starts_with("2."));

    let restored = unprotect_user_symmetric_key(&protected, &smk).unwrap();
    assert_eq!(&*usk.to_bytes(), &*restored.to_bytes());

    // Tamper MAC byte -> must fail verify-then-decrypt
    let parts: Vec<&str> = protected.strip_prefix("2.").unwrap().split('|').collect();
    let mut mac_bytes = B64.decode(parts[2]).unwrap();
    mac_bytes[0] ^= 0xff;
    let tampered = format!("2.{}|{}|{}", parts[0], parts[1], B64.encode(mac_bytes));
    assert!(unprotect_user_symmetric_key(&tampered, &smk).is_err());

    // Wrong password -> must fail
    let mk_wrong = derive_master_key("WrongPassword", "cherry@example.com", &argon_cfg).unwrap();
    let smk_wrong = stretch_master_key(&mk_wrong).unwrap();
    assert!(unprotect_user_symmetric_key(&protected, &smk_wrong).is_err());

    // Legacy Type 0 EncString read support
    let iv = [7u8; 16];
    let ct = cbc::Encryptor::<aes::Aes256>::new_from_slices(usk.enc_key(), &iv)
        .unwrap()
        .encrypt_padded_vec_mut::<Pkcs7>(b"legacy-note");
    let type0 = format!("0.{}|{}", B64.encode(iv), B64.encode(ct));
    let dec0 = decrypt_bytes(&type0, usk.enc_key(), usk.mac_key()).unwrap();
    assert_eq!(&*dec0, b"legacy-note");

    // Type 2 roundtrip
    let type2 = encrypt_bytes(b"hello keysmith", usk.enc_key(), usk.mac_key()).unwrap();
    let dec2 = decrypt_bytes(&type2, usk.enc_key(), usk.mac_key()).unwrap();
    assert_eq!(&*dec2, b"hello keysmith");
}

#[test]
fn domain_decodes_bitwarden_native_ciphers_and_preserves_fields_on_update() {
    let usk = UserSymmetricKey::generate();

    let mut bw_login = CipherDto {
        id: "c-login-1".to_string(),
        organization_id: None,
        folder_id: Some("f-work".to_string()),
        collection_ids: Vec::new(),
        cipher_type: 1,
        name: Some(usk.encrypt_string("GitHub").unwrap()),
        notes: Some(usk.encrypt_string("Main dev account").unwrap()),
        favorite: true,
        login: Some(CipherLoginDto {
            username: Some(usk.encrypt_string("cherry").unwrap()),
            password: Some(usk.encrypt_string("OldPass!999").unwrap()),
            totp: Some(usk.encrypt_string("JBSWY3DPEHPK3PXP").unwrap()),
            uris: vec![CipherLoginUriDto {
                uri: Some(usk.encrypt_string("https://github.com/login").unwrap()),
                uri_match: Some(0),
                extra: Default::default(),
            }],
            fido2_credentials: vec![CipherFido2CredentialDto {
                credential_id: Some("abc".to_string()),
                rp_id: Some("github.com".to_string()),
                ..Default::default()
            }],
            extra: Default::default(),
        }),
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![CipherFieldDto {
            name: Some(usk.encrypt_string("Recovery Hint").unwrap()),
            value: Some(usk.encrypt_string("YubiKey").unwrap()),
            field_type: 1,
            linked_id: None,
            extra: Default::default(),
        }],
        password_history: vec![CipherPasswordHistoryDto {
            password: Some(usk.encrypt_string("OlderPass!111").unwrap()),
            last_used_date: Some("2025-01-01T00:00:00Z".to_string()),
        }],
        attachments: Vec::new(),
        reprompt: Some(0),
        revision_date: Some("2026-01-01T00:00:00Z".to_string()),
        creation_date: Some("2025-01-01T00:00:00Z".to_string()),
        deleted_date: None,
        extra: Default::default(),
    };

    let item = cipher_to_item(&bw_login, &usk).unwrap();
    assert_eq!(item.title, "GitHub");
    assert_eq!(item.payload.category, ItemCategory::Login);
    assert_eq!(item.payload.notes, "Main dev account");
    assert_eq!(item.payload.urls.len(), 1);
    assert_eq!(item.payload.password_history.len(), 1);

    let mut updated_sections = item.payload.sections.clone();
    for field in &mut updated_sections[0].fields {
        if field.purpose == Some(FieldPurpose::Password) {
            field.value = "NewStrongPass#2026".to_string();
        }
    }
    let draft = ItemDraft {
        id: Some(item.id.clone()),
        vault_id: item.vault_id.clone(),
        title: "GitHub Enterprise".to_string(),
        favorite: true,
        category: ItemCategory::Login,
        subtitle: None,
        icon: item.payload.icon.clone(),
        tags: vec![],
        urls: item.payload.urls.clone(),
        sections: updated_sections,
        passkeys: item.payload.passkeys.clone(),
        notes: "Updated note".to_string(),
        password_history: item.payload.password_history.clone(),
        watchtower: item.payload.watchtower,
        archived: false,
        reprompt: false,
        ..Default::default()
    };
    let (next_cipher, next_item) =
        draft_to_cipher(&item.id, &draft, Some(&bw_login), Some(&item), &usk).unwrap();
    assert_eq!(next_cipher.cipher_type, 1);
    assert_eq!(
        next_cipher
            .login
            .as_ref()
            .unwrap()
            .fido2_credentials
            .len(),
        1
    );
    assert_eq!(next_item.payload.password_history.len(), 2);
    assert_eq!(next_item.payload.password_history[0].value, "OldPass!999");

    bw_login.cipher_type = 3;
    bw_login.login = None;
    bw_login.card = Some(CipherCardDto {
        cardholder_name: Some(usk.encrypt_string("Cherry Wang").unwrap()),
        brand: Some(usk.encrypt_string("Visa").unwrap()),
        number: Some(usk.encrypt_string("4111111111114242").unwrap()),
        exp_month: Some(usk.encrypt_string("12").unwrap()),
        exp_year: Some(usk.encrypt_string("2028").unwrap()),
        code: Some(usk.encrypt_string("123").unwrap()),
        extra: Default::default(),
    });
    let card_item = cipher_to_item(&bw_login, &usk).unwrap();
    assert_eq!(card_item.payload.category, ItemCategory::CreditCard);

    bw_login.cipher_type = 4;
    bw_login.card = None;
    bw_login.identity = Some(CipherIdentityDto {
        first_name: Some(usk.encrypt_string("Cherry").unwrap()),
        last_name: Some(usk.encrypt_string("Wang").unwrap()),
        email: Some(usk.encrypt_string("cherry@example.com").unwrap()),
        ..Default::default()
    });
    let id_item = cipher_to_item(&bw_login, &usk).unwrap();
    assert_eq!(id_item.payload.category, ItemCategory::Identity);

    let plain_folder = FolderDto {
        id: "f1".to_string(),
        name: usk.encrypt_string("Work").unwrap(),
        revision_date: None,
    };
    let v1 = folder_to_vault(&plain_folder, &usk, 3).unwrap();
    assert_eq!(v1.name, "Work");
    assert_eq!(v1.item_count, 3);

    let meta_folder = FolderDto {
        id: "f2".to_string(),
        name: encode_vault_name("基础设施", "server", "#10B981", &usk).unwrap(),
        revision_date: None,
    };
    let v2 = folder_to_vault(&meta_folder, &usk, 5).unwrap();
    assert_eq!(v2.name, "基础设施");
    assert_eq!(v2.icon, "server");
    assert_eq!(v2.color, "#10B981");
}

#[test]
fn totp_rfc6238_test_vector() {
    let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    let res = compute_totp_at(
        &format!("otpauth://totp/Test?secret={secret}&digits=8&period=30"),
        59,
    );
    assert_eq!(res.code, "94287082");
    assert_eq!(res.formatted_code, "9428 7082");
    assert_eq!(res.remaining_seconds, 1);
}

#[test]
fn generator_and_watchtower_and_search() {
    let gen = generate_secret(&GeneratorOptions {
        mode: GeneratorMode::Password,
        length: 20,
        include_digits: true,
        include_symbols: true,
        exclude_ambiguous: true,
        ..Default::default()
    });
    assert_eq!(gen.value.len(), 20);
    assert!(gen.strength.score >= 3);

    let weak = evaluate_password_strength("123456");
    assert!(weak.score < 3);

    let vault = Vault {
        id: "v-work".to_string(),
        name: "工作".to_string(),
        icon: "briefcase".to_string(),
        color: "#0572EC".to_string(),
        is_default: false,
        is_organization: false,
        travel_safe: false,
        item_count: 2,
    };

    let usk = UserSymmetricKey::generate();
    let draft1 = ItemDraft {
        id: None,
        vault_id: "v-work".to_string(),
        title: "生产数据库".to_string(),
        favorite: true,
        category: ItemCategory::Login,
        subtitle: None,
        icon: None,
        tags: vec!["开发".to_string()],
        urls: vec![ItemUrl {
            id: "u1".to_string(),
            uri: "http://example.com/login".to_string(),
            label: None,
            match_rule: UrlMatchRule::Domain,
        }],
        sections: vec![ItemSection {
            id: "s1".to_string(),
            title: String::new(),
            fields: vec![ItemField {
                id: "f1".to_string(),
                label: "密码".to_string(),
                field_type: FieldType::Password,
                value: "123456".to_string(),
                sensitive: true,
                copyable: true,
                purpose: Some(FieldPurpose::Password),
            }],
        }],
        passkeys: vec![],
        notes: String::new(),
        password_history: vec![],
        watchtower: WatchtowerFlags::default(),
        archived: false,
        reprompt: false,
        ..Default::default()
    };
    let (_, item1) = draft_to_cipher("i1", &draft1, None, None, &usk).unwrap();

    let mut draft2 = draft1.clone();
    draft2.title = "本地服务".to_string();
    draft2.urls = vec![ItemUrl {
        id: "u2".to_string(),
        uri: "http://127.0.0.1:8080".to_string(),
        label: None,
        match_rule: UrlMatchRule::Host,
    }];
    draft2.passkeys = vec![PasskeyCredential {
        credential_id: "cred1".to_string(),
        rp_id: "localhost".to_string(),
        rp_name: "Local".to_string(),
        user_handle: "dXNlcg".to_string(),
        user_name: "dev".to_string(),
        user_display_name: "Dev".to_string(),
        algorithm: -7,
        private_key_pkcs8: "pk".to_string(),
        public_key_spki: "pub".to_string(),
        sign_count: 1,
        discoverable: true,
        aaguid: "00000000-0000-0000-0000-000000000000".to_string(),
        transports: vec!["internal".to_string()],
        backed_up: true,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        last_used_at: None,
    }];
    let (_, item2) = draft_to_cipher("i2", &draft2, None, None, &usk).unwrap();

    assert!(matches_search_query(
        &item1,
        &[vault.clone()],
        "tag:开发 vault:gz is:fav scsjk"
    ));
    assert!(!matches_search_query(&item1, &[vault.clone()], "is:passkey"));
    assert!(matches_search_query(&item2, &[vault], "is:passkey"));

    let report = run_watchtower_audit(&[item1, item2], None, None);
    assert_eq!(report.counts[&WatchtowerIssueType::Weak], 2);
    assert_eq!(report.counts[&WatchtowerIssueType::Reused], 2);
    assert_eq!(report.counts[&WatchtowerIssueType::Missing2fa], 1);
    assert_eq!(report.counts[&WatchtowerIssueType::UnsecuredUrl], 1);
}

#[tokio::test]
async fn app_core_offline_unlock_lock_zeroize_and_crud() {
    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("MasterPass#2026", "cherry@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();

    let acc = make_test_account(
        "acc-1",
        "cherry@example.com",
        "https://vault.example.com",
        &kdf,
        protected,
    );
    storage.upsert_account(&acc).unwrap();

    let bio = Arc::new(MockBiometricStore {
        available: true,
        ..Default::default()
    });
    let clip = Arc::new(NoopClipboardManager);
    let bio_trait: Arc<dyn BiometricKeyStore> = bio.clone();
    let core = AppCore::with_storage(storage, bio_trait, clip).unwrap();

    assert_eq!(core.session_get_state().status, AuthStatus::Locked);
    assert!(core.vault_list().is_err());

    assert!(core.session_unlock_password("wrong").await.is_err());
    assert_eq!(core.session_get_state().status, AuthStatus::Locked);

    let state = core
        .session_unlock_password("MasterPass#2026")
        .await
        .unwrap();
    assert_eq!(state.status, AuthStatus::Unlocked);
    assert!(state.biometric_enabled);

    let created = core
        .item_create(ItemDraft {
            id: None,
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "My Secret Bank".to_string(),
            favorite: true,
            category: ItemCategory::Login,
            subtitle: None,
            icon: None,
            tags: vec!["finance".to_string()],
            urls: vec![],
            sections: vec![ItemSection {
                id: "s1".to_string(),
                title: String::new(),
                fields: vec![ItemField {
                    id: "f1".to_string(),
                    label: "密码".to_string(),
                    field_type: FieldType::Password,
                    value: "UltraSecretPlaintext99!".to_string(),
                    sensitive: true,
                    copyable: true,
                    purpose: Some(FieldPurpose::Password),
                }],
            }],
            passkeys: vec![],
            notes: "Private note".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(core.sync_get_status().pending_count, 1);
    let list = core.item_list(ItemFilter::default()).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].title, "My Secret Bank");

    core.session_lock("manual").unwrap();
    assert_eq!(core.session_get_state().status, AuthStatus::Locked);
    assert!(core.item_get(&created.id).is_err());

    let unlocked_bio = core.session_unlock_biometric().await.unwrap();
    assert_eq!(unlocked_bio.status, AuthStatus::Unlocked);
    let loaded = core.item_get(&created.id).unwrap().unwrap();
    assert_eq!(loaded.title, "My Secret Bank");

    let updated_prefs = core
        .session_update_preferences(SessionPreferencesPatch {
            auto_lock_minutes: Some(5),
            clipboard_clear_seconds: Some(45),
            biometric_enabled: Some(false),
            close_to_tray: Some(false),
            biometric_max_days: Some(3),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(updated_prefs.auto_lock_minutes, 5);
    assert_eq!(updated_prefs.clipboard_clear_seconds, 45);
    assert!(!updated_prefs.biometric_enabled);
    assert!(!updated_prefs.close_to_tray);
    assert_eq!(updated_prefs.biometric_max_days, 3);
}

#[tokio::test]
async fn app_core_vaults_trash_passkeys_and_disk_zero_plaintext() {
    let tmp_dir = std::env::temp_dir().join(format!("keysmith_test_{}", uuid::Uuid::new_v4()));
    let db_path = tmp_dir.join("keysmith.db");
    let storage = Storage::open(&db_path).unwrap();

    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("VaultPass#2026", "disk@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();

    let acc = make_test_account(
        "acc-disk",
        "disk@example.com",
        "https://vault.example.com",
        &kdf,
        protected,
    );
    storage.upsert_account(&acc).unwrap();

    let bio = Arc::new(MockBiometricStore {
        available: true,
        ..Default::default()
    });
    let clip = Arc::new(NoopClipboardManager);
    let bio_trait: Arc<dyn BiometricKeyStore> = bio.clone();
    let core = AppCore::with_storage(storage, bio_trait, clip).unwrap();
    core.session_unlock_password("VaultPass#2026")
        .await
        .unwrap();

    let v = core
        .vault_create("WorkOps", Some("#10B981"), Some("server"))
        .await
        .unwrap();
    assert_eq!(v.name, "WorkOps");
    let v_renamed = core.vault_rename(&v.id, "ProdOps").await.unwrap();
    assert_eq!(v_renamed.name, "ProdOps");

    let item = core
        .item_create(ItemDraft {
            id: None,
            vault_id: v.id.clone(),
            title: "TOP_SECRET_TITLE_XYZ".to_string(),
            favorite: false,
            category: ItemCategory::Login,
            subtitle: None,
            icon: None,
            tags: vec!["prod".to_string()],
            urls: vec![],
            sections: vec![ItemSection {
                id: "s1".to_string(),
                title: String::new(),
                fields: vec![ItemField {
                    id: "f1".to_string(),
                    label: "密码".to_string(),
                    field_type: FieldType::Password,
                    value: "TOP_SECRET_PASSWORD_98765".to_string(),
                    sensitive: true,
                    copyable: true,
                    purpose: Some(FieldPurpose::Password),
                }],
            }],
            passkeys: vec![],
            notes: "TOP_SECRET_NOTES_ABC".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        })
        .await
        .unwrap();

    // Encrypted generator history & local attachment must also leave zero plaintext on disk
    let hist = core
        .generator_history_record("GEN_SECRET_PWD_777", "password", 88, Some("GitHub注册"))
        .unwrap();
    assert_eq!(hist.value, "GEN_SECRET_PWD_777");
    let hist_list = core.generator_history_list().unwrap();
    assert_eq!(hist_list.len(), 1);
    assert_eq!(hist_list[0].source.as_deref(), Some("GitHub注册"));

    let att = core
        .attachment_upload(&item.id, "id_rsa_secret.pem", &B64.encode(b"ATT_PLAINTEXT_SECRET_888"))
        .await
        .unwrap();
    assert!(att.has_local_data);
    let dl = core.attachment_download(&item.id, &att.id).await.unwrap();
    assert_eq!(B64.decode(&dl.data_base64).unwrap(), b"ATT_PLAINTEXT_SECRET_888");

    let db_bytes = std::fs::read(&db_path).unwrap();
    let db_lossy = String::from_utf8_lossy(&db_bytes);
    assert!(!db_lossy.contains("TOP_SECRET_TITLE_XYZ"));
    assert!(!db_lossy.contains("TOP_SECRET_PASSWORD_98765"));
    assert!(!db_lossy.contains("TOP_SECRET_NOTES_ABC"));
    assert!(!db_lossy.contains("GEN_SECRET_PWD_777"));
    assert!(!db_lossy.contains("ATT_PLAINTEXT_SECRET_888"));
    assert!(!db_lossy.contains("VaultPass#2026"));

    core.attachment_delete(&item.id, &att.id).await.unwrap();
    core.generator_history_clear().unwrap();
    assert!(core.generator_history_list().unwrap().is_empty());

    core.item_toggle_favorite(&item.id, true).await.unwrap();
    assert_eq!(core.item_get_all_stats().unwrap().favorite_count, 1);
    core.item_trash(&item.id).await.unwrap();
    assert_eq!(core.item_get_all_stats().unwrap().trash_count, 1);
    assert_eq!(core.item_get_all_stats().unwrap().total_count, 0);
    core.item_restore(&item.id).await.unwrap();
    assert_eq!(core.item_get_all_stats().unwrap().total_count, 1);

    core.vault_delete(&v.id).await.unwrap();
    let moved = core.item_get(&item.id).unwrap().unwrap();
    assert_eq!(moved.vault_id, DEFAULT_PERSONAL_VAULT_ID);

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[test]
fn protocol_sync_response_handles_explicit_null_arrays() {
    let raw = r#"{
        "profile": {
            "id": "u-1",
            "email": "user@example.com",
            "name": null,
            "key": "2.abc|def|ghi"
        },
        "folders": null,
        "collections": null,
        "organizations": null,
        "ciphers": [
            {
                "id": "c-1",
                "type": 1,
                "name": "2.a|b|c",
                "favorite": null,
                "login": {
                    "username": "2.a|b|c",
                    "password": "2.a|b|c",
                    "uris": null
                },
                "fields": null,
                "passwordHistory": null,
                "attachments": null
            }
        ]
    }"#;

    let parsed: SyncResponse = serde_json::from_str(raw).unwrap();
    assert!(parsed.folders.is_empty());
    assert!(parsed.collections.is_empty());
    assert_eq!(parsed.ciphers.len(), 1);
    assert!(!parsed.ciphers[0].favorite);
    assert!(parsed.ciphers[0].fields.is_empty());
    assert!(parsed.ciphers[0].password_history.is_empty());
    assert!(parsed.ciphers[0].login.as_ref().unwrap().uris.is_empty());

    let raw_null_ciphers = r#"{
        "profile": { "id": "u-1" },
        "folders": [],
        "ciphers": null
    }"#;
    let parsed2: SyncResponse = serde_json::from_str(raw_null_ciphers).unwrap();
    assert!(parsed2.ciphers.is_empty());
}

#[tokio::test]
async fn token_refresh_automatically_retries_after_401() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base_url = format!("http://{addr}");

    let server_task = tokio::spawn(async move {
        let mut sync_calls = 0usize;
        for _ in 0..3 {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = sock.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let req_lower = req.to_ascii_lowercase();

            let (status, body) = if req.starts_with("GET /api/sync") {
                sync_calls += 1;
                if sync_calls == 1 {
                    assert!(req_lower.contains("authorization: bearer expired-tok"));
                    ("401 Unauthorized", r#"{"error":"expired"}"#.to_string())
                } else {
                    assert!(req_lower.contains("authorization: bearer fresh-tok"));
                    (
                        "200 OK",
                        r#"{"profile":{"id":"acc-refresh","email":"r@example.com"},"folders":[],"collections":[],"ciphers":[]}"#.to_string(),
                    )
                }
            } else if req.starts_with("POST /identity/connect/token") {
                if !req.contains("refresh_token=rt-old") {
                    let mut extra = vec![0u8; 1024];
                    if let Ok(Ok(m)) = tokio::time::timeout(
                        std::time::Duration::from_millis(200),
                        sock.read(&mut extra),
                    )
                    .await
                    {
                        let combined = format!("{req}{}", String::from_utf8_lossy(&extra[..m]));
                        assert!(combined.contains("refresh_token=rt-old"));
                    }
                }
                (
                    "200 OK",
                    r#"{"access_token":"fresh-tok","expires_in":3600,"token_type":"Bearer","refresh_token":"rt-new"}"#.to_string(),
                )
            } else {
                ("404 Not Found", "{}".to_string())
            };

            let resp = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            sock.write_all(resp.as_bytes()).await.unwrap();
        }
    });

    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("RefreshPass#1", "r@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();

    let mut acc = make_test_account("acc-refresh", "r@example.com", &base_url, &kdf, protected);
    acc.access_token = Some("expired-tok".to_string());
    acc.refresh_token = Some("rt-old".to_string());
    storage.upsert_account(&acc).unwrap();

    let core = AppCore::with_storage(
        storage.clone(),
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("RefreshPass#1").await.unwrap();
    let sync_status = core.sync_now().await.unwrap();
    assert_eq!(sync_status.pending_count, 0);

    let saved = storage.load_account_by_id("acc-refresh").unwrap().unwrap();
    let enc_access = saved.access_token.as_deref().unwrap();
    let enc_refresh = saved.refresh_token.as_deref().unwrap();
    assert!(enc_access.starts_with("2."));
    assert!(enc_refresh.starts_with("2."));
    assert_ne!(enc_access, "fresh-tok");
    assert_ne!(enc_refresh, "rt-new");
    assert_eq!(usk.decrypt_string(enc_access).unwrap().as_str(), "fresh-tok");
    assert_eq!(usk.decrypt_string(enc_refresh).unwrap().as_str(), "rt-new");

    server_task.await.unwrap();
}

#[tokio::test]
async fn phase2_categories_archive_duplicate_batch_and_multi_account() {
    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk1 = derive_master_key("PassOne#1", "one@example.com", &kdf).unwrap();
    let smk1 = stretch_master_key(&mk1).unwrap();
    let usk1 = UserSymmetricKey::generate();
    let mut acc1 = make_test_account(
        "acc-1",
        "one@example.com",
        "https://vault.one",
        &kdf,
        protect_user_symmetric_key(&usk1, &smk1).unwrap(),
    );
    acc1.biometric_max_days = 7;
    storage.upsert_account(&acc1).unwrap();

    let mk2 = derive_master_key("PassTwo#2", "two@example.com", &kdf).unwrap();
    let smk2 = stretch_master_key(&mk2).unwrap();
    let usk2 = UserSymmetricKey::generate();
    let mut acc2 = make_test_account(
        "acc-2",
        "two@example.com",
        "https://vault.two",
        &kdf,
        protect_user_symmetric_key(&usk2, &smk2).unwrap(),
    );
    acc2.is_active = false;
    // Expired biometric timestamp (10 days ago > max 7 days)
    acc2.last_master_password_unlock_at = Some((Utc::now() - Duration::days(10)).to_rfc3339());
    storage.upsert_account(&acc2).unwrap();

    let bio = Arc::new(MockBiometricStore {
        available: true,
        ..Default::default()
    });
    let core = AppCore::with_storage(storage, bio, Arc::new(NoopClipboardManager)).unwrap();
    core.session_unlock_password("PassOne#1").await.unwrap();

    // Create Phase 2 categories
    let bank = core
        .item_create(ItemDraft {
            id: None,
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "招商银行储蓄卡".to_string(),
            favorite: false,
            category: ItemCategory::BankAccount,
            subtitle: None,
            icon: None,
            tags: vec![],
            urls: vec![],
            sections: vec![],
            passkeys: vec![],
            notes: "Bank".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        })
        .await
        .unwrap();
    let passport = core
        .item_create(ItemDraft {
            id: None,
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "中国护照".to_string(),
            favorite: false,
            category: ItemCategory::Passport,
            subtitle: None,
            icon: None,
            tags: vec![],
            urls: vec![],
            sections: vec![],
            passkeys: vec![],
            notes: "Passport".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        })
        .await
        .unwrap();

    // Duplicate + Archive + Batch move/tag/trash
    let dup = core.item_duplicate(&bank.id).await.unwrap();
    assert_eq!(dup.title, "招商银行储蓄卡 (副本)");

    core.item_set_archived(&passport.id, true).await.unwrap();
    let stats = core.item_get_all_stats().unwrap();
    assert_eq!(stats.total_count, 2); // bank + dup
    assert_eq!(stats.archived_count, 1);

    let archived_list = core
        .item_list(ItemFilter {
            archived: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(archived_list.len(), 1);
    assert_eq!(archived_list[0].id, passport.id);

    let target_vault = core.vault_create("ArchiveVault", None, None).await.unwrap();
    let moved = core
        .item_move_vault(&[bank.id.clone(), dup.id.clone()], &target_vault.id)
        .await
        .unwrap();
    assert_eq!(moved, 2);
    let tagged = core
        .item_batch_add_tag(&[bank.id.clone()], "vip")
        .await
        .unwrap();
    assert_eq!(tagged, 1);
    assert_eq!(
        core.item_get(&bank.id).unwrap().unwrap().payload.tags,
        vec!["vip"]
    );
    let trashed = core.item_batch_trash(&[dup.id.clone()]).await.unwrap();
    assert_eq!(trashed, 1);
    assert_eq!(core.item_get_all_stats().unwrap().trash_count, 1);

    // Multi-account list & switch + biometric expiry check
    let accounts = core.account_list().unwrap();
    assert_eq!(accounts.len(), 2);
    let switched = core.account_switch("acc-2").unwrap();
    assert_eq!(switched.status, AuthStatus::Locked);
    assert_eq!(switched.email, "two@example.com");

    // Biometric must fail because acc-2 last master password unlock was 10 days ago (>7)
    let bio_err = core.session_unlock_biometric().await;
    assert!(matches!(bio_err, Err(CoreError::Biometric(_))));

    // Password unlock resets the timestamp
    let unlocked2 = core.session_unlock_password("PassTwo#2").await.unwrap();
    assert_eq!(unlocked2.status, AuthStatus::Unlocked);
}

#[tokio::test]
async fn ssh_keygen_sign_qr_decode_and_import_export() {
    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("ImpExp#2026", "imp@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let acc = make_test_account(
        "acc-imp",
        "imp@example.com",
        "https://vault.imp",
        &kdf,
        protect_user_symmetric_key(&usk, &smk).unwrap(),
    );
    storage.upsert_account(&acc).unwrap();

    let core = AppCore::with_storage(
        storage,
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("ImpExp#2026").await.unwrap();

    // 1. SSH Ed25519 keygen + sign + verify + ssh_list_identities
    let kp = core.ssh_generate_ed25519(Some("cherry@mbp")).unwrap();
    assert!(kp.public_key.starts_with("ssh-ed25519 "));
    assert!(kp.fingerprint_sha256.starts_with("SHA256:"));
    let msg = b"git-commit-payload";
    let sig_bytes = core.ssh_sign_ed25519(&kp.private_key_openssh, msg).unwrap();
    assert_eq!(sig_bytes.len(), 64);

    let pub_parsed = PublicKey::from_openssh(&kp.public_key).unwrap();
    let ed_pub = pub_parsed.key_data().ed25519().unwrap();
    let vk = VerifyingKey::from_bytes(&ed_pub.0).unwrap();
    let sig = Signature::from_slice(&sig_bytes).unwrap();
    vk.verify(msg, &sig).unwrap();

    core.item_create(ItemDraft {
        id: None,
        vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
        title: "GitHub Signing Key".to_string(),
        favorite: false,
        category: ItemCategory::SshKey,
        subtitle: None,
        icon: None,
        tags: vec![],
        urls: vec![],
        sections: vec![ItemSection {
            id: "s1".to_string(),
            title: String::new(),
            fields: vec![
                ItemField {
                    id: "f1".to_string(),
                    label: "公钥".to_string(),
                    field_type: FieldType::SshPublicKey,
                    value: kp.public_key.clone(),
                    sensitive: false,
                    copyable: true,
                    purpose: None,
                },
                ItemField {
                    id: "f2".to_string(),
                    label: "私钥".to_string(),
                    field_type: FieldType::SshPrivateKey,
                    value: kp.private_key_openssh.clone(),
                    sensitive: true,
                    copyable: true,
                    purpose: None,
                },
            ],
        }],
        passkeys: vec![],
        notes: String::new(),
        password_history: vec![],
        watchtower: WatchtowerFlags::default(),
        archived: false,
        reprompt: false,
        ..Default::default()
    })
    .await
    .unwrap();
    let ids = core.ssh_list_identities().unwrap();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0].fingerprint_sha256, kp.fingerprint_sha256);

    // 2. QR image decoding (generate QR PNG in memory and decode via totp_parse_qr_image)
    let otp_uri = "otpauth://totp/Keysmith:cherry@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Keysmith";
    let qr = QrCode::new(otp_uri.as_bytes()).unwrap();
    let qr_img = qr
        .render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(240, 240)
        .build();
    let mut png_bytes = Vec::new();
    qr_img
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .unwrap();
    let decoded_uri = core
        .totp_parse_qr_image(&format!("data:image/png;base64,{}", B64.encode(&png_bytes)))
        .unwrap();
    assert_eq!(decoded_uri, otp_uri);

    // 2b. Multi-QR large canvas prefers otpauth:// over arbitrary URLs and supports downscaling
    let noise_qr = QrCode::new(b"https://example.com/not-a-totp-secret").unwrap();
    let noise_img = noise_qr
        .render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(240, 240)
        .build();
    let mut canvas = image::GrayImage::from_pixel(2400, 1400, Luma([255u8]));
    image::imageops::overlay(&mut canvas, &noise_img, 120, 120);
    image::imageops::overlay(&mut canvas, &qr_img, 1600, 820);
    let mut canvas_png = Vec::new();
    canvas
        .write_to(&mut Cursor::new(&mut canvas_png), ImageFormat::Png)
        .unwrap();
    assert_eq!(
        keysmith_core::totp::parse_totp_qr_bytes(&canvas_png).unwrap(),
        otp_uri
    );

    // 3. .1pux zip import
    let export_data = r#"{
        "accounts": [{
            "vaults": [{
                "attrs": { "name": "1P Vault" },
                "items": [{
                    "categoryUuid": "001",
                    "overview": { "title": "1P GitLab", "url": "https://gitlab.com", "tags": ["dev"] },
                    "details": {
                        "loginFields": [
                            { "designation": "username", "value": "alice" },
                            { "designation": "password", "value": "1P_Secret#99" }
                        ],
                        "notesPlain": "Imported from 1P"
                    }
                }]
            }]
        }]
    }"#;
    let mut zip_buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(Cursor::new(&mut zip_buf));
        zip.start_file("export.data", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(export_data.as_bytes()).unwrap();
        zip.finish().unwrap();
    }
    let sum_1p = core
        .vault_import("1pux", &B64.encode(&zip_buf), true, None)
        .await
        .unwrap();
    assert_eq!(sum_1p.imported_vaults, 1);
    assert_eq!(sum_1p.imported_items, 1);

    // 4. Bitwarden JSON + Chrome CSV import
    let bw_json = r#"{"encrypted":false,"folders":[],"items":[{"type":1,"name":"BW Site","login":{"username":"bob","password":"BwPass#1"}}]}"#;
    let sum_bw = core
        .vault_import("bitwarden_json", bw_json, false, None)
        .await
        .unwrap();
    assert_eq!(sum_bw.imported_items, 1);

    let chrome_csv = "name,url,username,password,note\nChrome Site,https://example.org,carl,CarlPass#2,from chrome\n";
    let sum_csv = core
        .vault_import("chrome_csv", chrome_csv, false, None)
        .await
        .unwrap();
    assert_eq!(sum_csv.imported_items, 1);

    // 5. Export (wrong master password fails; encrypted export hides plaintext; CSV/BW JSON exports work)
    assert!(core
        .vault_export("csv", "WrongMaster", None)
        .await
        .is_err());

    let enc_exp = core
        .vault_export("keysmith_encrypted_json", "ImpExp#2026", Some("ExportPhrase#1"))
        .await
        .unwrap();
    assert!(!enc_exp.content.contains("1P_Secret#99"));
    assert!(!enc_exp.content.contains("CarlPass#2"));
    let dec_bundle =
        decrypt_keysmith_export(&enc_exp.content, Some("ExportPhrase#1"), None).unwrap();
    assert!(dec_bundle.contains("1P_Secret#99"));

    let csv_exp = core.vault_export("csv", "ImpExp#2026", None).await.unwrap();
    assert!(csv_exp.content.contains("1P GitLab"));
    assert!(csv_exp.content.contains("Chrome Site"));

    // 6. SignalR frame parser smoke test
    let raw_frames = "{}\x1e{\"type\":6}\x1e{\"type\":1,\"target\":\"ReceiveMessage\",\"arguments\":[{\"Type\":0,\"Payload\":{\"Id\":\"c-99\"}}]}\x1e";
    let events = parse_signalr_frames(raw_frames);
    assert_eq!(
        events,
        vec![SignalREvent::SyncCipher {
            action: "SyncCipherUpdate".to_string(),
            cipher_id: Some("c-99".to_string())
        }]
    );
}

#[test]
fn watchtower_missing_2fa_serde_contract() {
    assert_eq!(
        serde_json::to_string(&WatchtowerIssueType::Missing2fa).unwrap(),
        "\"missing_2fa\""
    );
    assert_eq!(
        serde_json::from_str::<WatchtowerIssueType>("\"missing_2fa\"").unwrap(),
        WatchtowerIssueType::Missing2fa
    );
    assert_eq!(
        serde_json::from_str::<WatchtowerIssueType>("\"missing2fa\"").unwrap(),
        WatchtowerIssueType::Missing2fa
    );

    let flags = WatchtowerFlags {
        ignore_missing_2fa: true,
        ..Default::default()
    };
    let json = serde_json::to_value(flags).unwrap();
    assert_eq!(json["ignoreMissing2fa"], serde_json::json!(true));
}

#[test]
fn fido2_credentials_decode_and_preserve() {
    let usk = UserSymmetricKey::generate();
    let cipher = CipherDto {
        id: "cipher-passkey-1".to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: Vec::new(),
        cipher_type: 1,
        name: Some(usk.encrypt_string("GitHub").unwrap()),
        notes: None,
        favorite: false,
        login: Some(CipherLoginDto {
            username: Some(usk.encrypt_string("octocat").unwrap()),
            password: Some(usk.encrypt_string("Pass#1234").unwrap()),
            totp: None,
            uris: vec![CipherLoginUriDto {
                uri: Some(usk.encrypt_string("https://github.com").unwrap()),
                uri_match: Some(0),
                extra: Default::default(),
            }],
            fido2_credentials: vec![CipherFido2CredentialDto {
                credential_id: Some(usk.encrypt_string("cred-abc-123").unwrap()),
                key_type: Some(usk.encrypt_string("public-key").unwrap()),
                key_algorithm: Some(usk.encrypt_string("ECDSA").unwrap()),
                key_curve: Some(usk.encrypt_string("P-256").unwrap()),
                key_value: Some(usk.encrypt_string("MIGHAgEAMBMGByqGSM49...").unwrap()),
                rp_id: Some(usk.encrypt_string("github.com").unwrap()),
                rp_name: Some(usk.encrypt_string("GitHub").unwrap()),
                counter: Some(usk.encrypt_string("4").unwrap()),
                user_handle: Some(usk.encrypt_string("uh-1").unwrap()),
                user_name: Some(usk.encrypt_string("octocat").unwrap()),
                user_display_name: Some(usk.encrypt_string("The Octocat").unwrap()),
                discoverable: Some(usk.encrypt_string("true").unwrap()),
                creation_date: Some("2026-01-15T10:00:00.000Z".to_string()),
                extra: Default::default(),
            }],
            extra: Default::default(),
        }),
        secure_note: None,
        card: None,
        identity: None,
        fields: Vec::new(),
        password_history: Vec::new(),
        attachments: Vec::new(),
        reprompt: Some(0),
        revision_date: None,
        creation_date: None,
        deleted_date: None,
        extra: Default::default(),
    };

    let decoded = cipher_to_item(&cipher, &usk).unwrap();
    assert_eq!(decoded.payload.passkeys.len(), 1);
    let pk = &decoded.payload.passkeys[0];
    assert_eq!(pk.credential_id, "cred-abc-123");
    assert_eq!(pk.rp_id, "github.com");
    assert_eq!(pk.rp_name, "GitHub");
    assert_eq!(pk.user_name, "octocat");
    assert_eq!(pk.user_display_name, "The Octocat");
    assert_eq!(pk.sign_count, 4);
    assert!(pk.discoverable);
    assert_eq!(pk.algorithm, -7);
    assert_eq!(pk.created_at, "2026-01-15T10:00:00.000Z");

    // Updating a password preserves encrypted fido2Credentials when passkey stays attached
    let mut draft = ItemDraft {
        id: Some(decoded.id.clone()),
        vault_id: decoded.vault_id.clone(),
        title: decoded.title.clone(),
        favorite: decoded.favorite,
        category: decoded.payload.category,
        subtitle: decoded.payload.subtitle.clone(),
        icon: decoded.payload.icon.clone(),
        tags: decoded.payload.tags.clone(),
        urls: decoded.payload.urls.clone(),
        sections: decoded.payload.sections.clone(),
        passkeys: decoded.payload.passkeys.clone(),
        notes: decoded.payload.notes.clone(),
        password_history: decoded.payload.password_history.clone(),
        watchtower: decoded.payload.watchtower,
        archived: decoded.payload.archived,
        reprompt: decoded.payload.reprompt,
        ..Default::default()
    };
    let (updated_cipher, _) = draft_to_cipher(&decoded.id, &draft, Some(&cipher), Some(&decoded), &usk).unwrap();
    assert_eq!(
        updated_cipher.login.as_ref().unwrap().fido2_credentials.len(),
        1
    );

    // Unbinding passkey removes it from fido2_credentials
    draft.passkeys.clear();
    let (unbound_cipher, _) = draft_to_cipher(&decoded.id, &draft, Some(&cipher), Some(&decoded), &usk).unwrap();
    assert!(unbound_cipher.login.as_ref().unwrap().fido2_credentials.is_empty());
}

#[tokio::test]
async fn app_settings_and_account_persist_across_reopen() {
    let tmp_dir = std::env::temp_dir().join(format!("keysmith_persist_{}", uuid::Uuid::new_v4()));
    let db_path = tmp_dir.join("keysmith.db");

    {
        let storage = Storage::open(&db_path).unwrap();
        let kdf = KdfConfig {
            kdf: 0,
            kdf_iterations: 5_000,
            kdf_memory: None,
            kdf_parallelism: None,
        };
        let mk = derive_master_key("PersistPass#1", "persist@example.com", &kdf).unwrap();
        let smk = stretch_master_key(&mk).unwrap();
        let usk = UserSymmetricKey::generate();
        let protected = protect_user_symmetric_key(&usk, &smk).unwrap();
        let acc = make_test_account(
            "acc-persist",
            "persist@example.com",
            "https://vault.example.com",
            &kdf,
            protected,
        );
        storage.upsert_account(&acc).unwrap();

        let core = AppCore::with_storage(
            storage,
            Arc::new(MockBiometricStore::default()),
            Arc::new(NoopClipboardManager),
        )
        .unwrap();

        let mut shortcuts = HashMap::new();
        shortcuts.insert("search".to_string(), "CommandOrControl+K".to_string());
        let saved = core
            .app_settings_update(AppSettingsPatch {
                language: Some("en".to_string()),
                theme: Some("dark".to_string()),
                custom_shortcuts: Some(shortcuts),
                last_server_url: Some("https://vault.example.com".to_string()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(saved.language, "en");
        assert_eq!(saved.theme, "dark");
        core.checkpoint_storage().unwrap();
    }

    // Reopen fresh from disk (simulates quit & relaunch)
    let storage2 = Storage::open(&db_path).unwrap();
    let core2 = AppCore::with_storage(
        storage2,
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    let session = core2.session_get_state();
    assert_eq!(session.status, AuthStatus::Locked);
    assert_eq!(session.email, "persist@example.com");

    let settings2 = core2.app_settings_get().unwrap();
    assert_eq!(settings2.language, "en");
    assert_eq!(settings2.theme, "dark");
    assert_eq!(
        settings2.custom_shortcuts.get("search").map(String::as_str),
        Some("CommandOrControl+K")
    );
    assert_eq!(
        settings2.last_server_url.as_deref(),
        Some("https://vault.example.com")
    );

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[test]
fn search_excludes_email_domain_noise_and_ranks_relevance() {
    let usk = UserSymmetricKey::generate();
    let vault = Vault {
        id: "v1".to_string(),
        name: "个人".to_string(),
        icon: "folder".to_string(),
        color: "#007AFF".to_string(),
        is_default: true,
        is_organization: false,
        travel_safe: true,
        item_count: 3,
    };

    let (_, google_item) = draft_to_cipher(
        "item-google",
        &ItemDraft {
            id: None,
            vault_id: "v1".to_string(),
            title: "Google".to_string(),
            favorite: false,
            category: ItemCategory::Login,
            subtitle: None,
            icon: None,
            tags: vec![],
            urls: vec![ItemUrl {
                id: "u1".to_string(),
                uri: "https://accounts.google.com".to_string(),
                label: None,
                match_rule: UrlMatchRule::Domain,
            }],
            sections: vec![ItemSection {
                id: "s1".to_string(),
                title: String::new(),
                fields: vec![ItemField {
                    id: "f1".to_string(),
                    label: "用户名".to_string(),
                    field_type: FieldType::Text,
                    value: "alice@gmail.com".to_string(),
                    sensitive: false,
                    copyable: true,
                    purpose: Some(FieldPurpose::Username),
                }],
            }],
            passkeys: vec![],
            notes: String::new(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        },
        None,
        None,
        &usk,
    )
    .unwrap();

    let (_, bybit_item) = draft_to_cipher(
        "item-bybit",
        &ItemDraft {
            id: None,
            vault_id: "v1".to_string(),
            title: "Bybit".to_string(),
            favorite: false,
            category: ItemCategory::Login,
            subtitle: None,
            icon: None,
            tags: vec![],
            urls: vec![ItemUrl {
                id: "u2".to_string(),
                uri: "https://www.bybit.com".to_string(),
                label: None,
                match_rule: UrlMatchRule::Domain,
            }],
            sections: vec![ItemSection {
                id: "s2".to_string(),
                title: String::new(),
                fields: vec![ItemField {
                    id: "f2".to_string(),
                    label: "用户名".to_string(),
                    field_type: FieldType::Text,
                    value: "user123@googlemail.com".to_string(),
                    sensitive: false,
                    copyable: true,
                    purpose: Some(FieldPurpose::Username),
                }],
            }],
            passkeys: vec![],
            notes: "backup: recover@google.com".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        },
        None,
        None,
        &usk,
    )
    .unwrap();

    let (_, notes_github_item) = draft_to_cipher(
        "item-other",
        &ItemDraft {
            id: None,
            vault_id: "v1".to_string(),
            title: "Build Server".to_string(),
            favorite: false,
            category: ItemCategory::Login,
            subtitle: None,
            icon: None,
            tags: vec![],
            urls: vec![ItemUrl {
                id: "u3".to_string(),
                uri: "https://ci.example.org".to_string(),
                label: None,
                match_rule: UrlMatchRule::Domain,
            }],
            sections: vec![ItemSection {
                id: "s3".to_string(),
                title: String::new(),
                fields: vec![ItemField {
                    id: "f3".to_string(),
                    label: "用户名".to_string(),
                    field_type: FieldType::Text,
                    value: "ops@example.com".to_string(),
                    sensitive: false,
                    copyable: true,
                    purpose: Some(FieldPurpose::Username),
                }],
            }],
            passkeys: vec![],
            notes: "Connected to google cloud and github deploy key".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        },
        None,
        None,
        &usk,
    )
    .unwrap();

    let vaults = vec![vault];
    assert!(matches_search_query(&google_item, &vaults, "google"));
    assert!(!matches_search_query(&bybit_item, &vaults, "google"));
    assert!(matches_search_query(&bybit_item, &vaults, "@googlemail"));

    let score_google = score_search_query(&google_item, &vaults, "google").unwrap();
    let score_notes = score_search_query(&notes_github_item, &vaults, "google").unwrap();
    assert!(score_google > score_notes);
}

#[test]
fn send_crypto_hkdf_password_hash_and_url() {
    let seed = generate_send_seed();
    let send_key1 = derive_send_key(&seed).unwrap();
    let send_key2 = derive_send_key(&seed).unwrap();
    assert_eq!(send_key1.to_bytes(), send_key2.to_bytes());

    let enc = send_key1.encrypt_string("机密分享文本").unwrap();
    let dec = send_key2.decrypt_string(&enc).unwrap();
    assert_eq!(&*dec, "机密分享文本");

    let enc_buf = encrypt_send_buffer(b"hello-binary", send_key1.enc_key(), send_key1.mac_key()).unwrap();
    assert_eq!(enc_buf[0], 2u8);
    assert!(enc_buf.len() > 49);

    let hash_a = hash_send_password("s3cr3t", &seed);
    let hash_b = hash_send_password("s3cr3t", &seed);
    assert_eq!(hash_a, hash_b);
    assert_ne!(hash_a, hash_send_password("other", &seed));

    let url = build_send_share_url("https://vault.example.com/", "acc-123", &seed);
    assert!(url.starts_with("https://vault.example.com/#/send/acc-123/"));
}

#[tokio::test]
async fn send_crud_persistence_and_lock_zeroize() {
    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig::default();
    let usk = UserSymmetricKey::generate();
    let mk = derive_master_key("pw-send-test", "send@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();

    let mut acc = StoredAccount::default_prefs(
        "acc-send".to_string(),
        "https://vault.example.com".to_string(),
        "send@example.com".to_string(),
        "Send Tester".to_string(),
        kdf.kdf,
        kdf.kdf_iterations,
        kdf.kdf_memory,
        kdf.kdf_parallelism,
        protected,
        "dev-send".to_string(),
    );
    acc.access_token = None;
    storage.upsert_account(&acc).unwrap();

    let core = AppCore::with_storage(
        storage,
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("pw-send-test").await.unwrap();

    let created = core
        .send_create_text(SendCreateTextInput {
            name: "一次分享密钥".to_string(),
            text: "TOKEN-999".to_string(),
            hidden: true,
            notes: Some("内部备注".to_string()),
            max_access_count: Some(1),
            expiration_date: None,
            deletion_date: (Utc::now() + Duration::days(3)).to_rfc3339(),
            password: Some("open123".to_string()),
            disabled: false,
            hide_email: true,
        })
        .await
        .unwrap();

    assert_eq!(created.send_type, SendType::Text);
    assert!(created.has_password);
    assert!(created.hide_email);
    assert!(created.share_url.contains("/#/send/"));
    let orig_url = created.share_url.clone();

    let updated = core
        .send_update(
            &created.id,
            SendUpdateInput {
                name: "已更新密钥分享".to_string(),
                text: Some("TOKEN-888".to_string()),
                hidden: Some(false),
                notes: None,
                max_access_count: Some(5),
                expiration_date: None,
                deletion_date: created.deletion_date.clone(),
                password: None,
                disabled: true,
                hide_email: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.name, "已更新密钥分享");
    assert_eq!(updated.text.as_deref(), Some("TOKEN-888"));
    assert_eq!(updated.share_url, orig_url);
    assert!(updated.disabled);

    let cleared = core.send_remove_password(&created.id).await.unwrap();
    assert!(!cleared.has_password);

    core.session_lock("test").unwrap();
    assert!(core.send_list().await.is_err());

    core.session_unlock_password("pw-send-test").await.unwrap();
    let list = core.send_list().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "已更新密钥分享");

    core.send_delete(&created.id).await.unwrap();
    assert!(core.send_list().await.unwrap().is_empty());
}

#[tokio::test]
async fn reprompt_roundtrip_and_empty_trash() {
    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig::default();
    let usk = UserSymmetricKey::generate();
    let mk = derive_master_key("pw-trash-test", "trash@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();

    let mut acc = StoredAccount::default_prefs(
        "acc-trash".to_string(),
        "https://vault.example.com".to_string(),
        "trash@example.com".to_string(),
        "Trash Tester".to_string(),
        kdf.kdf,
        kdf.kdf_iterations,
        kdf.kdf_memory,
        kdf.kdf_parallelism,
        protected,
        "dev-trash".to_string(),
    );
    acc.access_token = None;
    storage.upsert_account(&acc).unwrap();

    let core = AppCore::with_storage(
        storage,
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("pw-trash-test").await.unwrap();

    let guarded = core
        .item_create(ItemDraft {
            id: None,
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "核心银行凭据".to_string(),
            favorite: false,
            category: ItemCategory::Login,
            subtitle: None,
            icon: None,
            tags: vec![],
            urls: vec![],
            sections: vec![],
            passkeys: vec![],
            notes: "Protected".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(guarded.payload.reprompt);

    let trashed = core
        .item_create(ItemDraft {
            id: None,
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "待清空条目".to_string(),
            favorite: false,
            category: ItemCategory::SecureNote,
            subtitle: None,
            icon: None,
            tags: vec![],
            urls: vec![],
            sections: vec![],
            passkeys: vec![],
            notes: "Discard".to_string(),
            password_history: vec![],
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        })
        .await
        .unwrap();

    core.item_trash(&trashed.id).await.unwrap();
    assert_eq!(core.item_get_all_stats().unwrap().trash_count, 1);

    let purged = core.item_empty_trash().await.unwrap();
    assert_eq!(purged, 1);
    assert_eq!(core.item_get_all_stats().unwrap().trash_count, 0);
    assert!(core.item_get(&guarded.id).unwrap().unwrap().payload.reprompt);
}

#[test]
fn passkey_create_and_assert_es256_webauthn_valid() {
    use keysmith_core::passkey::{
        assert_passkey_credential, create_passkey_credential, decode_b64u_or_b64, encode_b64u,
        passkey_matches_credential_list, rp_id_matches_origin, PasskeyAssertParams,
        PasskeyCreateParams, KEYSMITH_AAGUID,
    };
    use p256::ecdsa::{signature::Verifier as _, DerSignature, VerifyingKey};
    use p256::pkcs8::DecodePublicKey;
    use sha2::{Digest, Sha256};

    assert!(rp_id_matches_origin("github.com", "https://github.com"));
    assert!(rp_id_matches_origin("github.com", "https://gist.github.com"));
    assert!(rp_id_matches_origin("localhost", "http://localhost:5173"));
    assert!(!rp_id_matches_origin("github.com", "https://notgithub.com"));
    assert!(!rp_id_matches_origin("github.com", "http://github.com"));

    let create_out = create_passkey_credential(&PasskeyCreateParams {
        origin: "https://app.example.com".to_string(),
        rp_id: "example.com".to_string(),
        rp_name: "Example".to_string(),
        user_id_b64u: encode_b64u(b"user-42"),
        user_name: "alice@example.com".to_string(),
        user_display_name: "Alice".to_string(),
        challenge_b64u: encode_b64u(b"create-challenge-123"),
        pub_key_cred_params: vec![-7, -257],
        discoverable: true,
        cross_origin: false,
        authenticator_attachment: None,
        ..Default::default()
    })
    .unwrap();

    assert_eq!(create_out.credential.rp_id, "example.com");
    assert_eq!(create_out.credential.algorithm, -7);
    assert_eq!(create_out.credential.sign_count, 0);
    assert!(create_out.credential.discoverable);

    let client_json_b64 = create_out.response_json["response"]["clientDataJSON"]
        .as_str()
        .unwrap();
    let client_json: serde_json::Value =
        serde_json::from_slice(&decode_b64u_or_b64(client_json_b64).unwrap()).unwrap();
    assert_eq!(client_json["type"], "webauthn.create");
    assert_eq!(client_json["origin"], "https://app.example.com");
    assert_eq!(client_json["crossOrigin"], false);

    let auth_data = decode_b64u_or_b64(
        create_out.response_json["response"]["authenticatorData"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(&auth_data[..32], Sha256::digest(b"example.com").as_slice());
    assert_eq!(auth_data[32], 0x5d);
    assert_eq!(&auth_data[37..53], &KEYSMITH_AAGUID);

    let spki_der = decode_b64u_or_b64(&create_out.credential.public_key_spki).unwrap();
    let verifying_key = VerifyingKey::from_public_key_der(&spki_der).unwrap();

    let id_b64u = create_out.response_json["id"].as_str().unwrap().to_string();
    assert!(passkey_matches_credential_list(
        &create_out.credential,
        std::slice::from_ref(&id_b64u)
    ));

    let (next_count, assert_json) = assert_passkey_credential(
        &create_out.credential,
        &PasskeyAssertParams {
            origin: "https://app.example.com".to_string(),
            rp_id: "example.com".to_string(),
            challenge_b64u: encode_b64u(b"assert-challenge-999"),
            cross_origin: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(next_count, 1);

    let assert_auth_data = decode_b64u_or_b64(
        assert_json["response"]["authenticatorData"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(assert_auth_data.len(), 37);
    assert_eq!(assert_auth_data[32], 0x1d);
    assert_eq!(
        u32::from_be_bytes(assert_auth_data[33..37].try_into().unwrap()),
        1
    );

    let assert_client_data = decode_b64u_or_b64(
        assert_json["response"]["clientDataJSON"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let mut signed_msg = Vec::new();
    signed_msg.extend_from_slice(&assert_auth_data);
    signed_msg.extend_from_slice(&Sha256::digest(&assert_client_data));
    let sig_bytes =
        decode_b64u_or_b64(assert_json["response"]["signature"].as_str().unwrap()).unwrap();
    let sig = DerSignature::from_bytes(&sig_bytes).unwrap();
    verifying_key.verify(&signed_msg, &sig).unwrap();
}

#[test]
fn bitwarden_login_fido2_credentials_roundtrip_and_assert() {
    use keysmith_core::passkey::{
        assert_passkey_credential, create_passkey_credential, encode_b64u, PasskeyAssertParams,
        PasskeyCreateParams,
    };

    let usk = UserSymmetricKey::from_bytes(&[17u8; 64]).unwrap();
    let base_cipher = CipherDto {
        id: "cipher-login-fido2".to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: vec![],
        cipher_type: 1,
        name: Some(usk.encrypt_string("Example Login").unwrap()),
        notes: None,
        favorite: false,
        login: Some(CipherLoginDto {
            username: Some(usk.encrypt_string("alice@example.com").unwrap()),
            password: Some(usk.encrypt_string("s3cret").unwrap()),
            totp: None,
            uris: vec![CipherLoginUriDto {
                uri: Some(usk.encrypt_string("https://example.com").unwrap()),
                uri_match: Some(0),
                extra: Default::default(),
            }],
            fido2_credentials: vec![],
            extra: Default::default(),
        }),
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![],
        password_history: vec![],
        attachments: vec![],
        reprompt: Some(0),
        revision_date: None,
        creation_date: None,
        deleted_date: None,
        extra: Default::default(),
    };

    let created = create_passkey_credential(&PasskeyCreateParams {
        origin: "https://example.com".to_string(),
        rp_id: "example.com".to_string(),
        rp_name: "Example".to_string(),
        user_id_b64u: encode_b64u(b"uid-1"),
        user_name: "alice@example.com".to_string(),
        user_display_name: "Alice".to_string(),
        challenge_b64u: encode_b64u(b"chal-1"),
        pub_key_cred_params: vec![-7],
        discoverable: true,
        cross_origin: false,
        authenticator_attachment: None,
        ..Default::default()
    })
    .unwrap();

    let item = cipher_to_item(&base_cipher, &usk).unwrap();
    let mut draft = item.to_draft();
    draft.passkeys.push(created.credential.clone());

    let (encoded_cipher, _) =
        draft_to_cipher(&item.id, &draft, Some(&base_cipher), Some(&item), &usk).unwrap();
    assert_eq!(
        encoded_cipher.login.as_ref().unwrap().fido2_credentials.len(),
        1
    );

    let decoded_item = cipher_to_item(&encoded_cipher, &usk).unwrap();
    assert_eq!(decoded_item.payload.passkeys.len(), 1);
    let restored_pk = &decoded_item.payload.passkeys[0];
    assert_eq!(restored_pk.credential_id, created.credential.credential_id);
    let (count, _) = assert_passkey_credential(
        restored_pk,
        &PasskeyAssertParams {
            origin: "https://example.com".to_string(),
            rp_id: "example.com".to_string(),
            challenge_b64u: encode_b64u(b"chal-2"),
            cross_origin: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn passkey_normalization_credential_id_variants_and_cross_origin_assert() {
    use keysmith_core::domain::PasskeyCredential;
    use keysmith_core::passkey::{
        assert_passkey_credential, create_passkey_credential, decode_b64u_or_b64,
        decode_credential_id_bytes, encode_b64u, normalize_rp_id, passkey_matches_credential_list,
        rp_id_matches_origin, PasskeyAssertParams, PasskeyCreateParams,
    };
    use sha2::{Digest, Sha256};

    assert_eq!(normalize_rp_id(" PayPal.COM. "), "paypal.com");
    assert!(rp_id_matches_origin(" PayPal.COM. ", "https://www.paypal.com"));

    let created = create_passkey_credential(&PasskeyCreateParams {
        origin: "https://www.paypal.com".to_string(),
        rp_id: "paypal.com".to_string(),
        rp_name: "PayPal".to_string(),
        user_id_b64u: encode_b64u(b"paypal-user"),
        user_name: "buyer@example.com".to_string(),
        user_display_name: "Buyer".to_string(),
        challenge_b64u: encode_b64u(b"paypal-create-chal"),
        pub_key_cred_params: vec![-7],
        discoverable: true,
        cross_origin: false,
        authenticator_attachment: None,
        ..Default::default()
    })
    .unwrap();

    // Hyphenated UUID credential_id matches Base64URL and padded standard Base64 allowCredentials
    let raw_id_bytes = decode_credential_id_bytes(&created.credential.credential_id).unwrap();
    assert_eq!(raw_id_bytes.len(), 16);
    let b64_std_padded = B64.encode(&raw_id_bytes);
    let b64u = encode_b64u(&raw_id_bytes);
    assert!(passkey_matches_credential_list(
        &created.credential,
        std::slice::from_ref(&b64_std_padded)
    ));
    assert!(passkey_matches_credential_list(
        &created.credential,
        std::slice::from_ref(&b64u)
    ));

    // A 32-char hex-looking Base64URL string (without hyphens) must NOT be misparsed as UUID bytes
    let hex_like_b64u = "0123456789abcdef0123456789abcdef";
    let decoded_hex_like = decode_credential_id_bytes(hex_like_b64u).unwrap();
    assert_eq!(decoded_hex_like.len(), 24);
    let hex_like_pk = PasskeyCredential {
        credential_id: hex_like_b64u.to_string(),
        rp_id: "PayPal.COM.".to_string(),
        ..created.credential.clone()
    };
    assert!(passkey_matches_credential_list(
        &hex_like_pk,
        &[hex_like_b64u.to_string()]
    ));

    // Cross-origin assertion sets crossOrigin: true in clientDataJSON and normalizes stored rp_id
    let mut stored_upper_rp = created.credential;
    stored_upper_rp.rp_id = " PayPal.COM. ".to_string();
    let (next_count, assert_json) = assert_passkey_credential(
        &stored_upper_rp,
        &PasskeyAssertParams {
            origin: "https://www.paypal.com".to_string(),
            rp_id: "paypal.com".to_string(),
            challenge_b64u: encode_b64u(b"paypal-assert-chal"),
            cross_origin: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(next_count, 1);

    let client_json_b64 = assert_json["response"]["clientDataJSON"]
        .as_str()
        .unwrap();
    let client_json: serde_json::Value =
        serde_json::from_slice(&decode_b64u_or_b64(client_json_b64).unwrap()).unwrap();
    assert_eq!(client_json["type"], "webauthn.get");
    assert_eq!(client_json["origin"], "https://www.paypal.com");
    assert_eq!(client_json["crossOrigin"], true);

    let auth_data = decode_b64u_or_b64(
        assert_json["response"]["authenticatorData"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(&auth_data[..32], Sha256::digest(b"paypal.com").as_slice());
}

#[tokio::test]
async fn semver_compare_rsa_org_key_and_offline_revision_preservation() {
    use keysmith_core::crypto::{
        decrypt_org_symmetric_key, decrypt_rsa_oaep, encrypt_bytes, UserSymmetricKey,
    };
    use keysmith_core::protocol::is_newer_semver;
    use rsa::pkcs8::EncodePrivateKey;
    use rsa::{Oaep, RsaPrivateKey};
    use sha1::Sha1;

    // 1. Semver checker
    assert!(is_newer_semver("0.1.3", "v0.1.4"));
    assert!(is_newer_semver("0.1.3", "0.2.0"));
    assert!(is_newer_semver("0.1.3", "1.0.0"));
    assert!(!is_newer_semver("0.1.3", "v0.1.3"));
    assert!(!is_newer_semver("0.1.3", "0.1.2"));

    // 2. RSA-2048 OAEP-SHA1 org symmetric key decryption
    let mut rng = rand::rngs::OsRng;
    let rsa_priv = RsaPrivateKey::new(&mut rng, 2048).unwrap();
    let priv_der = rsa_priv.to_pkcs8_der().unwrap();
    let user_usk = UserSymmetricKey::from_bytes(&[42u8; 64]).unwrap();
    let encrypted_priv_key =
        encrypt_bytes(priv_der.as_bytes(), user_usk.enc_key(), user_usk.mac_key()).unwrap();

    let org_key_raw = [77u8; 64];
    let org_cipher = rsa_priv
        .to_public_key()
        .encrypt(&mut rng, Oaep::new::<Sha1>(), &org_key_raw)
        .unwrap();
    let org_key_enc = format!("4.{}", B64.encode(&org_cipher));

    let direct_decrypted = decrypt_rsa_oaep(&org_key_enc, priv_der.as_bytes()).unwrap();
    assert_eq!(direct_decrypted.as_slice(), &org_key_raw);

    let org_usk =
        decrypt_org_symmetric_key(&org_key_enc, &encrypted_priv_key, &user_usk).unwrap();
    let enc_secret = org_usk.encrypt_string("Org Shared Secret").unwrap();
    assert_eq!(org_usk.decrypt_string(&enc_secret).unwrap().as_str(), "Org Shared Secret");

    // 3. Offline-first revisionDate preservation + all-8-locale language persistence
    let storage = Storage::open_in_memory().unwrap();
    let kdf = keysmith_core::crypto::KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("master-pw-123", "offline@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();
    let acc = make_test_account(
        "acc-offline-1",
        "offline@example.com",
        "https://vault.example.com",
        &kdf,
        protected,
    );
    storage.upsert_account(&acc).unwrap();

    let synced_cipher = CipherDto {
        id: "cipher-offline-1".to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: vec![],
        cipher_type: 1,
        name: Some(usk.encrypt_string("Original Site").unwrap()),
        notes: Some(usk.encrypt_string("v1").unwrap()),
        favorite: false,
        login: Some(CipherLoginDto {
            username: Some(usk.encrypt_string("alice").unwrap()),
            password: Some(usk.encrypt_string("old-pw").unwrap()),
            totp: None,
            uris: vec![],
            fido2_credentials: vec![],
            extra: Default::default(),
        }),
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![],
        password_history: vec![],
        attachments: vec![],
        reprompt: Some(0),
        revision_date: Some("2026-01-01T00:00:00Z".to_string()),
        creation_date: Some("2026-01-01T00:00:00Z".to_string()),
        deleted_date: None,
        extra: Default::default(),
    };
    storage
        .replace_synced_ciphers_clean(&acc.id, std::slice::from_ref(&synced_cipher))
        .unwrap();

    let core = AppCore::with_storage(
        storage.clone(),
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("master-pw-123").await.unwrap();

    let loaded = core.item_get("cipher-offline-1").unwrap().unwrap();
    let mut update_draft = loaded.to_draft();
    update_draft.notes = "v2-offline".to_string();
    let updated = core.item_update(&loaded.id, update_draft).await.unwrap();
    assert_eq!(updated.payload.notes, "v2-offline");

    let stored_rows = storage.list_ciphers(&acc.id).unwrap();
    let stored_row = stored_rows.iter().find(|r| r.id == "cipher-offline-1").unwrap();
    assert_eq!(stored_row.dirty_op.as_deref(), Some("update"));
    assert_eq!(stored_row.revision_date, "2026-01-01T00:00:00Z");

    // Language setting supports all 8 locales
    let updated_settings = core
        .app_settings_update(keysmith_core::domain::AppSettingsPatch {
            language: Some("ja".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(updated_settings.language, "ja");
}

#[test]
fn passkey_prefixed_b64_and_hex_credential_ids_decode_and_assert() {
    use keysmith_core::passkey::{
        assert_passkey_credential, create_passkey_credential, decode_credential_id_bytes,
        passkey_matches_credential_list, PasskeyAssertParams, PasskeyCreateParams,
    };

    let created = create_passkey_credential(&PasskeyCreateParams {
        origin: "https://example.com".to_string(),
        rp_id: "example.com".to_string(),
        rp_name: "Example".to_string(),
        user_id_b64u: "b64.dXNlci0x".to_string(),
        user_name: "alice@example.com".to_string(),
        user_display_name: "Alice".to_string(),
        challenge_b64u: encode_b64u_test(b"test-challenge-123"),
        pub_key_cred_params: vec![-7],
        discoverable: true,
        cross_origin: false,
        authenticator_attachment: None,
        ..Default::default()
    })
    .unwrap();

    let raw_cred_id = decode_credential_id_bytes(&created.credential.credential_id).unwrap();
    let b64_prefixed = format!("b64.{}", B64.encode(&raw_cred_id));
    let hex_prefixed = format!(
        "hex.{}",
        raw_cred_id
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let b64u = created.response_json["id"].as_str().unwrap().to_string();

    assert_eq!(decode_credential_id_bytes(&b64_prefixed).unwrap(), raw_cred_id);
    assert_eq!(decode_credential_id_bytes(&hex_prefixed).unwrap(), raw_cred_id);

    let mut prefixed_cred = created.credential.clone();
    prefixed_cred.credential_id = b64_prefixed;
    prefixed_cred.user_handle = "b64.dXNlci0x".to_string();
    assert!(passkey_matches_credential_list(&prefixed_cred, &[b64u.clone()]));

    let (next_cnt, assertion) = assert_passkey_credential(
        &prefixed_cred,
        &PasskeyAssertParams {
            origin: "https://example.com".to_string(),
            rp_id: "example.com".to_string(),
            challenge_b64u: encode_b64u_test(b"assert-challenge-456"),
            cross_origin: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(next_cnt, 1);
    assert_eq!(assertion["id"].as_str().unwrap(), b64u);
}

#[test]
fn passkey_fido2_creation_date_plain_and_rp_id_scheme_port_normalization() {
    use keysmith_core::passkey::{create_passkey_credential, normalize_rp_id, PasskeyCreateParams};

    assert_eq!(normalize_rp_id("https://id.binance.com:8443/"), "id.binance.com");
    assert_eq!(normalize_rp_id("Example.COM:443."), "example.com");

    let usk = UserSymmetricKey::from_bytes(&[23u8; 64]).unwrap();
    let created = create_passkey_credential(&PasskeyCreateParams {
        origin: "https://id.binance.com".to_string(),
        rp_id: "binance.com".to_string(),
        rp_name: "Binance".to_string(),
        user_id_b64u: encode_b64u_test(b"binance-uid-1"),
        user_name: "trader@example.com".to_string(),
        user_display_name: "Trader".to_string(),
        challenge_b64u: encode_b64u_test(b"chal-binance-1"),
        pub_key_cred_params: vec![-7],
        discoverable: true,
        cross_origin: false,
        authenticator_attachment: Some("cross-platform".to_string()),
        ..Default::default()
    })
    .unwrap();

    assert_eq!(created.response_json["authenticatorAttachment"], "cross-platform");

    // 1. New Login cipher with Passkey emits plain RFC3339 creationDate (never "2." encrypted)
    let new_draft = ItemDraft {
        id: None,
        vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
        title: "Binance".to_string(),
        favorite: false,
        category: ItemCategory::Login,
        subtitle: None,
        icon: None,
        tags: Vec::new(),
        urls: vec![ItemUrl {
            id: "u-1".to_string(),
            uri: "https://id.binance.com".to_string(),
            label: None,
            match_rule: UrlMatchRule::Domain,
        }],
        sections: vec![ItemSection {
            id: "sec-1".to_string(),
            title: "登录信息".to_string(),
            fields: vec![ItemField {
                id: "f-1".to_string(),
                label: "用户名".to_string(),
                field_type: FieldType::Text,
                value: "trader@example.com".to_string(),
                sensitive: false,
                copyable: true,
                purpose: Some(FieldPurpose::Username),
            }],
        }],
        passkeys: vec![created.credential.clone()],
        notes: String::new(),
        password_history: Vec::new(),
        watchtower: Default::default(),
        archived: false,
        reprompt: false,
        ..Default::default()
    };

    let (new_cipher, _) = draft_to_cipher("cipher-new-pk", &new_draft, None, None, &usk).unwrap();
    let f2 = &new_cipher.login.as_ref().unwrap().fido2_credentials[0];
    let cdate = f2.creation_date.as_deref().unwrap();
    assert!(!cdate.starts_with("2.") && !cdate.starts_with("0."), "creationDate must be plaintext ISO, got {cdate}");
    assert!(chrono::DateTime::parse_from_rfc3339(cdate).is_ok());

    let decoded = cipher_to_item(&new_cipher, &usk).unwrap();
    assert_eq!(decoded.payload.passkeys.len(), 1);
    assert_eq!(decoded.payload.passkeys[0].rp_id, "binance.com");

    // 2. Updating an existing cipher with legacy encrypted creationDate heals it back to plaintext RFC3339
    let mut legacy_cipher = new_cipher.clone();
    legacy_cipher.login.as_mut().unwrap().fido2_credentials[0].creation_date =
        Some(usk.encrypt_string(cdate).unwrap());
    let mut upd_draft = decoded.to_draft();
    upd_draft.passkeys[0].sign_count = 3;
    let (healed_cipher, _) = draft_to_cipher(
        &decoded.id,
        &upd_draft,
        Some(&legacy_cipher),
        Some(&decoded),
        &usk,
    )
    .unwrap();
    let healed_cdate = healed_cipher.login.as_ref().unwrap().fido2_credentials[0]
        .creation_date
        .as_deref()
        .unwrap();
    assert_eq!(healed_cdate, cdate);
}

fn encode_b64u_test(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;
    URL_SAFE_NO_PAD.encode(bytes)
}

#[test]
fn ed25519_passkey_prf_extension_and_related_origins() {
    use keysmith_core::domain::domains_are_equivalent;
    use keysmith_core::passkey::{
        assert_passkey_credential, create_passkey_credential, decode_b64u_or_b64, encode_b64u,
        rp_id_matches_origin_ext, PasskeyAssertParams, PasskeyCreateParams,
    };
    use sha2::{Digest, Sha256};

    assert!(domains_are_equivalent("youtube.com", "google.com", &[]));
    assert!(rp_id_matches_origin_ext(
        "google.com",
        "https://accounts.youtube.com",
        &[]
    ));

    let salt1 = encode_b64u(b"vault-encryption-salt-v1");
    let salt2 = encode_b64u(b"vault-encryption-salt-v2");

    let created = create_passkey_credential(&PasskeyCreateParams {
        origin: "https://accounts.google.com".to_string(),
        rp_id: "google.com".to_string(),
        rp_name: "Google".to_string(),
        user_id_b64u: encode_b64u(b"g-user-1"),
        user_name: "alice@gmail.com".to_string(),
        user_display_name: "Alice".to_string(),
        challenge_b64u: encode_b64u(b"ed25519-create-chal"),
        pub_key_cred_params: vec![-8, -7],
        discoverable: true,
        cross_origin: false,
        authenticator_attachment: Some("platform".to_string()),
        prf_requested: true,
        prf_eval_first_b64u: Some(salt1.clone()),
        prf_eval_second_b64u: Some(salt2.clone()),
        custom_equivalent_domains: Vec::new(),
    })
    .unwrap();

    assert_eq!(created.credential.algorithm, -8);
    assert_eq!(
        created.response_json["response"]["publicKeyAlgorithm"],
        serde_json::json!(-8)
    );
    assert_eq!(
        created.response_json["clientExtensionResults"]["prf"]["enabled"],
        serde_json::json!(true)
    );
    let create_prf_first = created.response_json["clientExtensionResults"]["prf"]["results"]
        ["first"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(decode_b64u_or_b64(&create_prf_first).unwrap().len(), 32);

    // Verify Bitwarden FIDO2 EdDSA round-trip
    let usk = UserSymmetricKey::from_bytes(&[31u8; 64]).unwrap();
    let draft = ItemDraft {
        vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
        title: "Google Ed25519".to_string(),
        category: ItemCategory::Login,
        passkeys: vec![created.credential.clone()],
        ..Default::default()
    };
    let (cipher, _) = draft_to_cipher("cipher-ed-pk", &draft, None, None, &usk).unwrap();
    let decoded_item = cipher_to_item(&cipher, &usk).unwrap();
    assert_eq!(decoded_item.payload.passkeys[0].algorithm, -8);

    // Assert from Related Origin (youtube.com -> rpId google.com) with PRF evaluation
    let (sign_cnt, assert_json) = assert_passkey_credential(
        &decoded_item.payload.passkeys[0],
        &PasskeyAssertParams {
            origin: "https://www.youtube.com".to_string(),
            rp_id: "google.com".to_string(),
            challenge_b64u: encode_b64u(b"ed25519-assert-chal"),
            cross_origin: false,
            prf_eval_first_b64u: Some(salt1),
            prf_eval_second_b64u: None,
            custom_equivalent_domains: Vec::new(),
        },
    )
    .unwrap();
    assert_eq!(sign_cnt, 1);

    // PRF output for identical salt must be deterministic
    let assert_prf_first = assert_json["clientExtensionResults"]["prf"]["results"]["first"]
        .as_str()
        .unwrap();
    assert_eq!(assert_prf_first, create_prf_first);

    // Verify 64-byte Ed25519 signature over authData || SHA256(clientDataJSON)
    let auth_data =
        decode_b64u_or_b64(assert_json["response"]["authenticatorData"].as_str().unwrap()).unwrap();
    let client_data =
        decode_b64u_or_b64(assert_json["response"]["clientDataJSON"].as_str().unwrap()).unwrap();
    let sig_bytes =
        decode_b64u_or_b64(assert_json["response"]["signature"].as_str().unwrap()).unwrap();
    assert_eq!(sig_bytes.len(), 64);

    let spki_bytes = decode_b64u_or_b64(&created.credential.public_key_spki).unwrap();
    assert_eq!(spki_bytes.len(), 44);
    let vk_bytes: [u8; 32] = spki_bytes[12..44].try_into().unwrap();
    let vk = VerifyingKey::from_bytes(&vk_bytes).unwrap();
    let mut signed = Vec::new();
    signed.extend_from_slice(&auth_data);
    signed.extend_from_slice(&Sha256::digest(&client_data));
    let sig = Signature::from_slice(&sig_bytes).unwrap();
    vk.verify(&signed, &sig).unwrap();
}

#[tokio::test]
async fn roadmap_watchtower_emergency_kit_snapshots_travel_mode_secret_ref_and_sso() {
    use keysmith_core::domain::{
        domains_are_equivalent, is_domain_autofill_disabled, MaskedEmailConfig,
        MaskedEmailProvider, WatchtowerFlagsPatch,
    };

    // 1. Equivalent domains & site disable rules
    let custom_groups = vec![vec!["corp-a.internal".to_string(), "corp-b.io".to_string()]];
    assert!(domains_are_equivalent(
        "login.corp-a.internal",
        "app.corp-b.io",
        &custom_groups
    ));
    assert!(domains_are_equivalent("taobao.com", "alipay.com", &[]));
    assert!(is_domain_autofill_disabled(
        "admin.intranet.local",
        &["intranet.local".to_string()]
    ));
    assert!(!is_domain_autofill_disabled(
        "github.com",
        &["intranet.local".to_string()]
    ));

    // Setup unlocked AppCore
    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("Roadmap#2026!", "pilot@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let acc = make_test_account(
        "acc-roadmap",
        "pilot@example.com",
        "https://vault.example.com",
        &kdf,
        protect_user_symmetric_key(&usk, &smk).unwrap(),
    );
    storage.upsert_account(&acc).unwrap();

    let core = AppCore::with_storage(
        storage.clone(),
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("Roadmap#2026!").await.unwrap();

    // 2. Masked Email (Catch-All) + encrypted API key storage
    core.app_settings_update(AppSettingsPatch {
        masked_email: Some(MaskedEmailConfig {
            provider: MaskedEmailProvider::CatchAll,
            domain: "alias.example.com".to_string(),
            api_key: "sl_secret_token_123".to_string(),
            api_base_url: None,
        }),
        ..Default::default()
    })
    .unwrap();
    let loaded_settings = core.app_settings_get().unwrap();
    assert_eq!(loaded_settings.masked_email.api_key, "sl_secret_token_123");
    let raw_me_json = storage.get_all_app_settings().unwrap()["masked_email"].clone();
    assert!(
        !raw_me_json.contains("sl_secret_token_123"),
        "API key must be encrypted at rest in SQLite"
    );
    let alias = core
        .generator_generate_masked_email(Some("https://github.com/signup"))
        .await
        .unwrap();
    assert!(alias.starts_with("github.") && alias.ends_with("@alias.example.com"));

    // 3. Create items for Secret Ref, Watchtower PasskeyAvailable, Expiring MM/YY, SSO & Linked Items
    let db_item = core
        .item_create(ItemDraft {
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "Prod DB".to_string(),
            category: ItemCategory::Database,
            sections: vec![ItemSection {
                id: "s1".to_string(),
                title: "Credentials".to_string(),
                fields: vec![
                    ItemField {
                        id: "f-user".to_string(),
                        label: "Username".to_string(),
                        field_type: FieldType::Text,
                        value: "db_admin".to_string(),
                        sensitive: false,
                        copyable: true,
                        purpose: Some(FieldPurpose::Username),
                    },
                    ItemField {
                        id: "f-pw".to_string(),
                        label: "Password".to_string(),
                        field_type: FieldType::Password,
                        value: "Sup3rS3cret!Db#99".to_string(),
                        sensitive: true,
                        copyable: true,
                        purpose: Some(FieldPurpose::Password),
                    },
                    ItemField {
                        id: "f-tok".to_string(),
                        label: "API_TOKEN".to_string(),
                        field_type: FieldType::Password,
                        value: "tok_live_abc123".to_string(),
                        sensitive: true,
                        copyable: true,
                        purpose: None,
                    },
                ],
            }],
            ..Default::default()
        })
        .await
        .unwrap();

    let gh_login = core
        .item_create(ItemDraft {
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "GitHub Legacy".to_string(),
            category: ItemCategory::Login,
            urls: vec![ItemUrl {
                id: "u1".to_string(),
                uri: "https://github.com".to_string(),
                label: None,
                match_rule: UrlMatchRule::Domain,
            }],
            sections: vec![ItemSection {
                id: "s1".to_string(),
                title: String::new(),
                fields: vec![ItemField {
                    id: "f1".to_string(),
                    label: "Password".to_string(),
                    field_type: FieldType::Password,
                    value: "V3ryStr0ng!Unique#Pass2026".to_string(),
                    sensitive: true,
                    copyable: true,
                    purpose: Some(FieldPurpose::Password),
                }],
            }],
            linked_item_ids: vec![db_item.id.clone()],
            ..Default::default()
        })
        .await
        .unwrap();

    let sso_login = core
        .item_create(ItemDraft {
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "Notion SSO".to_string(),
            category: ItemCategory::Login,
            sso_provider: Some("Google".to_string()),
            urls: vec![ItemUrl {
                id: "u2".to_string(),
                uri: "https://www.notion.so".to_string(),
                label: None,
                match_rule: UrlMatchRule::Domain,
            }],
            ..Default::default()
        })
        .await
        .unwrap();

    let exp_card = core
        .item_create(ItemDraft {
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "Expiring Visa".to_string(),
            category: ItemCategory::CreditCard,
            sections: vec![ItemSection {
                id: "sc".to_string(),
                title: String::new(),
                fields: vec![ItemField {
                    id: "fe".to_string(),
                    label: "Expiry".to_string(),
                    field_type: FieldType::Text,
                    value: "01/22".to_string(),
                    sensitive: false,
                    copyable: true,
                    purpose: Some(FieldPurpose::CardExpiry),
                }],
            }],
            ..Default::default()
        })
        .await
        .unwrap();

    // Verify SSO & linkedItemIds round-trip and search syntax
    let vaults = core.vault_list().unwrap();
    assert!(matches_search_query(&sso_login, &vaults, "is:sso sso:google"));
    assert!(!matches_search_query(&gh_login, &vaults, "is:sso"));
    assert!(matches_search_query(&gh_login, &vaults, "is:linked"));

    // Verify ks:// secret references
    let (_, resolved_pw) = core
        .resolve_secret_reference("ks://personal/Prod DB/password")
        .unwrap();
    assert_eq!(resolved_pw, "Sup3rS3cret!Db#99");
    let (_, resolved_tok) = core
        .resolve_secret_reference("ks://Prod DB/API_TOKEN")
        .unwrap();
    assert_eq!(resolved_tok, "tok_live_abc123");

    // Verify Watchtower PasskeyAvailable, SSO exemption, and MM/YY expiring
    let wt = core.watchtower_scan(false).await.unwrap();
    assert!(wt.item_issues[&gh_login.id].contains(&WatchtowerIssueType::PasskeyAvailable));
    assert!(!wt.item_issues.contains_key(&sso_login.id));
    assert!(wt.item_issues[&exp_card.id].contains(&WatchtowerIssueType::Expiring));

    // Ignore PasskeyAvailable & Expiring flags
    core.item_update_watchtower_flags(
        &gh_login.id,
        WatchtowerFlagsPatch {
            ignore_missing_2fa: Some(true),
            ignore_passkey_available: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    core.item_update_watchtower_flags(
        &exp_card.id,
        WatchtowerFlagsPatch {
            ignore_expiring: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let wt_after = core.watchtower_scan(false).await.unwrap();
    assert!(!wt_after.item_issues.contains_key(&gh_login.id));
    assert!(!wt_after.item_issues.contains_key(&exp_card.id));

    // 4. Emergency Kit PDF export
    let kit = core.vault_export_emergency_kit().unwrap();
    assert!(kit.file_name.ends_with(".pdf"));
    let pdf_bytes = B64.decode(&kit.content).unwrap();
    let pdf_str = String::from_utf8_lossy(&pdf_bytes);
    assert!(pdf_str.starts_with("%PDF-1.4"));
    assert!(pdf_str.contains("%%EOF"));
    assert!(pdf_str.contains("pilot@example.com"));
    assert!(pdf_str.contains("https://vault.example.com"));

    // 5. Encrypted JSON export + lossless re-import with passphrase
    let enc_export = core
        .vault_export(
            "keysmith_encrypted_json",
            "Roadmap#2026!",
            Some("BackupPass#77"),
        )
        .await
        .unwrap();
    let storage2 = Storage::open_in_memory().unwrap();
    let mk2 = derive_master_key("Roadmap#2026!", "restore@example.com", &kdf).unwrap();
    let smk2 = stretch_master_key(&mk2).unwrap();
    let usk2 = UserSymmetricKey::generate();
    let acc2 = make_test_account(
        "acc-restore",
        "restore@example.com",
        "https://vault.example.com",
        &kdf,
        protect_user_symmetric_key(&usk2, &smk2).unwrap(),
    );
    storage2.upsert_account(&acc2).unwrap();
    let core2 = AppCore::with_storage(
        storage2,
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core2.session_unlock_password("Roadmap#2026!").await.unwrap();
    let imp_summary = core2
        .vault_import_with_passphrase(
            "keysmith_encrypted_json",
            &enc_export.content,
            false,
            None,
            Some("BackupPass#77"),
        )
        .await
        .unwrap();
    assert_eq!(imp_summary.imported_items, 4);
    let restored_list = core2.item_list(ItemFilter::default()).unwrap();
    assert!(restored_list
        .iter()
        .any(|i| i.title == "Notion SSO" && i.sso_provider.as_deref() == Some("Google")));

    // 6. Local Encrypted Snapshots (create, delete item, restore, delete snapshot)
    let snap = core.snapshot_create().unwrap();
    assert_eq!(snap.item_count, 4);
    assert_eq!(core.snapshot_list().unwrap().len(), 1);
    core.item_delete_permanent(&sso_login.id).await.unwrap();
    assert_eq!(core.item_list(ItemFilter::default()).unwrap().len(), 3);
    let snap_res = core.snapshot_restore(&snap.id).await.unwrap();
    assert!(snap_res.imported_items >= 4);
    assert_eq!(core.item_list(ItemFilter::default()).unwrap().len(), 4);
    core.snapshot_delete(&snap.id).unwrap();
    assert!(core.snapshot_list().unwrap().is_empty());

    // 7. Travel Mode (purges non-safe vaults & ciphers locally, restores when disabled)
    core.vault_set_travel_safe(DEFAULT_PERSONAL_VAULT_ID, false)
        .await
        .unwrap();
    let safe_vault = core.vault_create("Border Safe", None, None).await.unwrap();
    core.vault_set_travel_safe(&safe_vault.id, true).await.unwrap();
    let safe_item = core
        .item_create(ItemDraft {
            vault_id: safe_vault.id.clone(),
            title: "Airline Booking".to_string(),
            category: ItemCategory::Login,
            ..Default::default()
        })
        .await
        .unwrap();

    // Activate Travel Mode: default personal vault is NOT travel_safe, so its 4 items must vanish locally
    let st_travel = core
        .session_update_preferences(SessionPreferencesPatch {
            travel_mode: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert!(st_travel.travel_mode);
    let during_travel = core.item_list(ItemFilter::default()).unwrap();
    assert_eq!(during_travel.len(), 1);
    assert_eq!(during_travel[0].id, safe_item.id);
    assert_eq!(storage.list_ciphers(&acc.id).unwrap().len(), 1);

    // Disable Travel Mode: stashed vaults & items are restored cleanly
    let st_back = core
        .session_update_preferences(SessionPreferencesPatch {
            travel_mode: Some(false),
            ..Default::default()
        })
        .unwrap();
    assert!(!st_back.travel_mode);
    let after_travel = core.item_list(ItemFilter::default()).unwrap();
    assert_eq!(after_travel.len(), 5);

    // 8. Auto-purge expired trash
    core.item_trash(&safe_item.id).await.unwrap();
    // Backdate deleted_date in storage & reload via lock+unlock to verify automatic purge on unlock
    let raw_row = storage
        .list_ciphers(&acc.id)
        .unwrap()
        .into_iter()
        .find(|r| r.id == safe_item.id)
        .unwrap();
    let mut backdated_cipher: CipherDto = serde_json::from_str(&raw_row.raw_json).unwrap();
    backdated_cipher.deleted_date = Some((Utc::now() - Duration::days(45)).to_rfc3339());
    storage
        .upsert_cipher(&acc.id, &backdated_cipher, Some("trash"))
        .unwrap();
    core.session_lock("test").unwrap();
    core.session_unlock_password("Roadmap#2026!").await.unwrap();
    let trashed_after = core
        .item_list(ItemFilter {
            trashed: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert!(
        trashed_after.is_empty(),
        "Expired trashed item (>30 days) must be auto-purged on unlock"
    );
}

#[tokio::test]
async fn auto_sync_revision_detection_manual_mode_and_offline_flush() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base_url = format!("http://{addr}");

    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("SyncPass#2026", "sync@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();

    let initial_cipher = CipherDto {
        id: "remote-1".to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: vec![],
        cipher_type: 1,
        name: Some(usk.encrypt_string("Initial Remote").unwrap()),
        notes: None,
        favorite: false,
        login: None,
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![],
        password_history: vec![],
        attachments: vec![],
        reprompt: Some(0),
        revision_date: Some("2026-11-27T00:00:00Z".to_string()),
        creation_date: Some("2026-11-27T00:00:00Z".to_string()),
        deleted_date: None,
        extra: Default::default(),
    };
    let bumped_cipher = CipherDto {
        id: "remote-2".to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: vec![],
        cipher_type: 1,
        name: Some(usk.encrypt_string("Added Remotely").unwrap()),
        notes: None,
        favorite: false,
        login: None,
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![],
        password_history: vec![],
        attachments: vec![],
        reprompt: Some(0),
        revision_date: Some("2026-11-27T00:01:00Z".to_string()),
        creation_date: Some("2026-11-27T00:01:00Z".to_string()),
        deleted_date: None,
        extra: Default::default(),
    };

    let rev_value = Arc::new(Mutex::new("1000".to_string()));
    let remote_ciphers = Arc::new(Mutex::new(vec![initial_cipher]));
    let sync_calls = Arc::new(AtomicUsize::new(0));
    let create_calls = Arc::new(AtomicUsize::new(0));

    let rev_srv = Arc::clone(&rev_value);
    let ciphers_srv = Arc::clone(&remote_ciphers);
    let sync_calls_srv = Arc::clone(&sync_calls);
    let create_calls_srv = Arc::clone(&create_calls);

    let server_task = tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            let rev_c = Arc::clone(&rev_srv);
            let ciphers_c = Arc::clone(&ciphers_srv);
            let sync_c = Arc::clone(&sync_calls_srv);
            let create_c = Arc::clone(&create_calls_srv);
            tokio::spawn(async move {
                let mut raw = Vec::new();
                let mut chunk = [0u8; 4096];
                let mut header_end: Option<usize> = None;
                let mut expected_total: Option<usize> = None;
                loop {
                    let Ok(n) = sock.read(&mut chunk).await else {
                        return;
                    };
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&chunk[..n]);
                    if header_end.is_none() {
                        if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                            let h_end = pos + 4;
                            header_end = Some(h_end);
                            let headers = String::from_utf8_lossy(&raw[..h_end]);
                            let clen = headers
                                .lines()
                                .find_map(|l| {
                                    let (k, v) = l.split_once(':')?;
                                    if k.trim().eq_ignore_ascii_case("content-length") {
                                        v.trim().parse::<usize>().ok()
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or(0);
                            expected_total = Some(h_end + clen);
                        }
                    }
                    if let Some(total) = expected_total {
                        if raw.len() >= total {
                            break;
                        }
                    }
                }
                if raw.is_empty() {
                    return;
                }
                let req = String::from_utf8_lossy(&raw).to_string();
                let first_line = req.lines().next().unwrap_or("");
                let (status, body) = if first_line.starts_with("GET /api/accounts/revision-date") {
                    ("200 OK", rev_c.lock().unwrap().clone())
                } else if first_line.starts_with("GET /api/sync") {
                    sync_c.fetch_add(1, Ordering::SeqCst);
                    let list = ciphers_c.lock().unwrap().clone();
                    let payload = serde_json::json!({
                        "profile": { "id": "acc-auto-sync", "email": "sync@example.com" },
                        "folders": [],
                        "collections": [],
                        "ciphers": list,
                    });
                    ("200 OK", payload.to_string())
                } else if first_line.starts_with("POST /api/ciphers") {
                    let count = create_c.fetch_add(1, Ordering::SeqCst) + 1;
                    let body_str = header_end
                        .and_then(|h| std::str::from_utf8(&raw[h..]).ok())
                        .unwrap_or("{}");
                    let mut val: serde_json::Value = serde_json::from_str(body_str).unwrap();
                    assert_eq!(
                        val.get("encryptedFor").and_then(|v| v.as_str()),
                        Some("acc-auto-sync")
                    );
                    val["id"] = serde_json::json!(format!("srv-{count}"));
                    val["revisionDate"] = serde_json::json!("2026-11-27T00:02:00Z");
                    let dto: CipherDto = serde_json::from_value(val).unwrap();
                    ciphers_c.lock().unwrap().push(dto.clone());
                    *rev_c.lock().unwrap() = "3000".to_string();
                    ("200 OK", serde_json::to_string(&dto).unwrap())
                } else {
                    ("404 Not Found", "{}".to_string())
                };

                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });

    let storage = Storage::open_in_memory().unwrap();
    let mut acc = make_test_account("acc-auto-sync", "sync@example.com", &base_url, &kdf, protected);
    acc.access_token = Some("tok-sync-ok".to_string());
    storage.upsert_account(&acc).unwrap();

    let core = AppCore::with_storage(
        storage.clone(),
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("SyncPass#2026").await.unwrap();

    // 1. First sync records revision "1000"
    let st1 = core.sync_now().await.unwrap();
    assert_eq!(st1.pending_count, 0);
    assert_eq!(sync_calls.load(Ordering::SeqCst), 1);
    assert_eq!(core.item_list(ItemFilter::default()).unwrap().len(), 1);

    // 2. When server revision is unchanged ("1000"), check_and_sync_if_changed returns Ok(false) without calling /api/sync
    assert!(!core.check_and_sync_if_changed(false).await.unwrap());
    assert_eq!(sync_calls.load(Ordering::SeqCst), 1);

    // 3. When server revision changes ("2000"), check_and_sync_if_changed triggers sync and pulls "Added Remotely"
    remote_ciphers.lock().unwrap().push(bumped_cipher);
    *rev_value.lock().unwrap() = "2000".to_string();
    assert!(core.check_and_sync_if_changed(false).await.unwrap());
    assert_eq!(sync_calls.load(Ordering::SeqCst), 2);
    assert_eq!(core.item_list(ItemFilter::default()).unwrap().len(), 2);

    // 4. Manual mode queues local edits without pushing, and auto mode + check_and_sync_if_changed flushes them
    core.app_settings_update(AppSettingsPatch {
        sync_mode: Some("manual".to_string()),
        ..Default::default()
    })
    .unwrap();
    assert!(!core.is_auto_sync_enabled());

    let manual_item = core
        .item_create(ItemDraft {
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "Queued Offline".to_string(),
            category: ItemCategory::Login,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(create_calls.load(Ordering::SeqCst), 0);
    assert_eq!(core.sync_get_status().pending_count, 1);

    // Permanently deleting an offline-only created item clears its pending create cleanly
    let discard_item = core
        .item_create(ItemDraft {
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title: "Discarded Offline".to_string(),
            category: ItemCategory::Login,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(core.sync_get_status().pending_count, 2);
    core.item_delete_permanent(&discard_item.id).await.unwrap();
    assert_eq!(core.sync_get_status().pending_count, 1);

    // Re-enable auto mode and flush via check_and_sync_if_changed
    core.app_settings_update(AppSettingsPatch {
        sync_mode: Some("auto".to_string()),
        ..Default::default()
    })
    .unwrap();
    assert!(core.is_auto_sync_enabled());
    assert!(core.check_and_sync_if_changed(false).await.unwrap());
    assert_eq!(create_calls.load(Ordering::SeqCst), 1);
    assert_eq!(core.sync_get_status().pending_count, 0);
    assert!(core
        .item_list(ItemFilter::default())
        .unwrap()
        .iter()
        .any(|i| i.title == "Queued Offline" && i.id != manual_item.id));

    server_task.abort();
}

#[tokio::test]
async fn sync_heals_missing_remote_delete_and_update_and_surfaces_push_error() {
    use keysmith_core::domain::SyncStateKind;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base_url = format!("http://{addr}");

    let kdf = KdfConfig {
        kdf: 0,
        kdf_iterations: 5_000,
        kdf_memory: None,
        kdf_parallelism: None,
    };
    let mk = derive_master_key("SyncPass#2026", "heal@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let protected = protect_user_symmetric_key(&usk, &smk).unwrap();

    let remote_existing = CipherDto {
        id: "remote-fail".to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: vec![],
        cipher_type: 1,
        name: Some(usk.encrypt_string("Remote Existing").unwrap()),
        notes: None,
        favorite: false,
        login: None,
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![],
        password_history: vec![],
        attachments: vec![],
        reprompt: Some(0),
        revision_date: Some("2026-11-27T00:00:00Z".to_string()),
        creation_date: Some("2026-11-27T00:00:00Z".to_string()),
        deleted_date: None,
        extra: Default::default(),
    };
    let mut remote_html_fail_1 = remote_existing.clone();
    remote_html_fail_1.id = "remote-html-1".to_string();
    let mut remote_html_fail_2 = remote_existing.clone();
    remote_html_fail_2.id = "remote-html-2".to_string();

    let remote_ciphers = Arc::new(Mutex::new(vec![
        remote_existing.clone(),
        remote_html_fail_1.clone(),
        remote_html_fail_2.clone(),
    ]));
    let delete_calls = Arc::new(AtomicUsize::new(0));
    let posted_payloads: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));

    let ciphers_srv = Arc::clone(&remote_ciphers);
    let delete_srv = Arc::clone(&delete_calls);
    let posted_srv = Arc::clone(&posted_payloads);

    let server_task = tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            let ciphers_c = Arc::clone(&ciphers_srv);
            let delete_c = Arc::clone(&delete_srv);
            let posted_c = Arc::clone(&posted_srv);
            tokio::spawn(async move {
                let mut raw = Vec::new();
                let mut chunk = [0u8; 4096];
                let mut header_end: Option<usize> = None;
                let mut expected_total: Option<usize> = None;
                loop {
                    let Ok(n) = sock.read(&mut chunk).await else {
                        return;
                    };
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&chunk[..n]);
                    if header_end.is_none() {
                        if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                            let h_end = pos + 4;
                            header_end = Some(h_end);
                            let headers = String::from_utf8_lossy(&raw[..h_end]);
                            let clen = headers
                                .lines()
                                .find_map(|l| {
                                    let (k, v) = l.split_once(':')?;
                                    if k.trim().eq_ignore_ascii_case("content-length") {
                                        v.trim().parse::<usize>().ok()
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or(0);
                            expected_total = Some(h_end + clen);
                        }
                    }
                    if let Some(total) = expected_total {
                        if raw.len() >= total {
                            break;
                        }
                    }
                }
                if raw.is_empty() {
                    return;
                }
                let req = String::from_utf8_lossy(&raw).to_string();
                let first_line = req.lines().next().unwrap_or("");
                let body_str = header_end
                    .and_then(|h| std::str::from_utf8(&raw[h..]).ok())
                    .unwrap_or("{}");

                let rocket_422 = "<!DOCTYPE html><html lang=\"en\"><head><title>422 Unprocessable Entity</title></head><body><h1>422: Unprocessable Entity</h1><p>The request was well-formed but was unable to be followed due to semantic errors.</p><small>Rocket</small></body></html>";
                let (status, body) = if first_line.starts_with("GET /api/accounts/revision-date") {
                    ("200 OK", "2000".to_string())
                } else if first_line.starts_with("GET /api/sync") {
                    let list = ciphers_c.lock().unwrap().clone();
                    let payload = serde_json::json!({
                        "profile": { "id": "acc-heal", "email": "heal@example.com" },
                        "folders": [],
                        "collections": [],
                        "ciphers": list,
                    });
                    ("200 OK", payload.to_string())
                } else if first_line.starts_with("POST /api/ciphers") {
                    let mut val: serde_json::Value = serde_json::from_str(body_str).unwrap();
                    if val.get("encryptedFor").and_then(|v| v.as_str()) != Some("acc-heal") {
                        ("422 Unprocessable Entity", rocket_422.to_string())
                    } else {
                        posted_c.lock().unwrap().push(val.clone());
                        val["id"] = serde_json::json!("recreated-1");
                        val["revisionDate"] = serde_json::json!("2026-11-27T01:00:00Z");
                        let dto: CipherDto = serde_json::from_value(val).unwrap();
                        ciphers_c.lock().unwrap().push(dto.clone());
                        ("200 OK", serde_json::to_string(&dto).unwrap())
                    }
                } else if first_line.starts_with("PUT /api/ciphers/remote-fail") {
                    let val: serde_json::Value = serde_json::from_str(body_str).unwrap();
                    if val.get("encryptedFor").and_then(|v| v.as_str()) != Some("acc-heal") {
                        ("422 Unprocessable Entity", rocket_422.to_string())
                    } else {
                        (
                            "400 Bad Request",
                            serde_json::json!({ "message": "Simulated validation error" })
                                .to_string(),
                        )
                    }
                } else if first_line.starts_with("PUT /api/ciphers/remote-html-") {
                    ("422 Unprocessable Entity", rocket_422.to_string())
                } else if first_line.starts_with("DELETE /api/ciphers/") {
                    delete_c.fetch_add(1, Ordering::SeqCst);
                    ("404 Not Found", "{}".to_string())
                } else {
                    ("404 Not Found", "{}".to_string())
                };

                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });

    let storage = Storage::open_in_memory().unwrap();
    let mut acc = make_test_account("acc-heal", "heal@example.com", &base_url, &kdf, protected);
    acc.access_token = Some("tok-heal".to_string());
    storage.upsert_account(&acc).unwrap();

    // Seed stuck dirty delete (missing remotely) and dirty update (missing remotely, stale folder, passkey + key)
    let missing_delete = CipherDto {
        id: "stale-del-1".to_string(),
        organization_id: None,
        folder_id: None,
        collection_ids: vec![],
        cipher_type: 2,
        name: Some(usk.encrypt_string("Stale Trashed Note").unwrap()),
        notes: None,
        favorite: false,
        login: None,
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![],
        password_history: vec![],
        attachments: vec![],
        reprompt: Some(0),
        revision_date: Some("2026-11-15T00:00:00Z".to_string()),
        creation_date: Some("2026-11-15T00:00:00Z".to_string()),
        deleted_date: Some("2026-11-15T00:00:00Z".to_string()),
        extra: Default::default(),
    };
    let mut extra_with_key = serde_json::Map::new();
    extra_with_key.insert(
        "key".to_string(),
        serde_json::Value::String("2.cipherkey|iv|mac".to_string()),
    );
    let missing_update = CipherDto {
        id: "stale-upd-1".to_string(),
        organization_id: None,
        folder_id: Some("missing-folder-uuid".to_string()),
        collection_ids: vec![],
        cipher_type: 1,
        name: Some(usk.encrypt_string("Passkey Item").unwrap()),
        notes: None,
        favorite: false,
        login: Some(CipherLoginDto {
            username: Some(usk.encrypt_string("alice").unwrap()),
            password: None,
            totp: None,
            uris: vec![],
            fido2_credentials: vec![CipherFido2CredentialDto {
                credential_id: Some("cred-1".to_string()),
                key_type: Some("public-key".to_string()),
                key_algorithm: Some("ECDSA".to_string()),
                key_curve: Some("P-256".to_string()),
                key_value: Some("pk-val".to_string()),
                rp_id: Some("example.com".to_string()),
                rp_name: Some("Example".to_string()),
                user_handle: Some("uh".to_string()),
                user_name: Some("alice".to_string()),
                user_display_name: None,
                counter: Some("0".to_string()),
                discoverable: Some("true".to_string()),
                creation_date: Some("2026-11-26T15:29:35.940147+00:00".to_string()),
                extra: Default::default(),
            }],
            extra: Default::default(),
        }),
        secure_note: None,
        card: None,
        identity: None,
        fields: vec![],
        password_history: vec![],
        attachments: vec![],
        reprompt: Some(0),
        revision_date: Some("2026-11-26T15:30:00Z".to_string()),
        creation_date: Some("2026-11-26T15:29:00Z".to_string()),
        deleted_date: None,
        extra: extra_with_key,
    };
    storage
        .upsert_cipher(&acc.id, &missing_delete, Some("delete"))
        .unwrap();
    storage
        .upsert_cipher(&acc.id, &missing_update, Some("update"))
        .unwrap();

    let core = AppCore::with_storage(
        storage.clone(),
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core.session_unlock_password("SyncPass#2026").await.unwrap();

    // 1. Heal missing remote delete + recreate missing remote update cleanly
    let st1 = core.sync_now().await.unwrap();
    assert_eq!(st1.state, SyncStateKind::Idle);
    assert_eq!(st1.pending_count, 0);
    assert!(st1.message.is_none());
    assert_eq!(delete_calls.load(Ordering::SeqCst), 0);

    let payloads = posted_payloads.lock().unwrap().clone();
    assert_eq!(payloads.len(), 1);
    assert!(payloads[0].get("folderId").is_none());
    assert_eq!(payloads[0]["encryptedFor"], "acc-heal");
    assert_eq!(payloads[0]["key"], "2.cipherkey|iv|mac");
    assert_eq!(
        payloads[0]["login"]["fido2Credentials"][0]["creationDate"],
        "2026-11-26T15:29:35.940Z"
    );

    // 2. Surface HTTP 400 and sanitized deduplicated HTML 422 push failures as SyncStateKind::Error
    let mut failing_dto = remote_existing;
    failing_dto.name = Some(usk.encrypt_string("Remote Existing Updated").unwrap());
    storage
        .upsert_cipher(&acc.id, &failing_dto, Some("update"))
        .unwrap();
    storage
        .upsert_cipher(&acc.id, &remote_html_fail_1, Some("update"))
        .unwrap();
    storage
        .upsert_cipher(&acc.id, &remote_html_fail_2, Some("update"))
        .unwrap();

    let st2 = core.sync_now().await.unwrap();
    assert_eq!(st2.state, SyncStateKind::Error);
    assert_eq!(st2.pending_count, 3);
    let msg = st2.message.as_deref().unwrap_or("");
    assert!(msg.contains("Simulated validation error"));
    assert!(msg.contains("422: Unprocessable Entity"));
    assert!(msg.contains("（共 2 项）"));
    assert!(!msg.contains("<!DOCTYPE"));
    assert!(!msg.contains("<html>"));
    assert!(!core.check_and_sync_if_changed(false).await.unwrap());

    server_task.abort();
}

#[tokio::test]
async fn security_kdf_bounds_and_registration_password_floor() {
    assert!(KdfConfig {
        kdf: 0,
        kdf_iterations: 4_999,
        kdf_memory: None,
        kdf_parallelism: None,
    }
    .validate()
    .is_err());
    assert!(KdfConfig {
        kdf: 0,
        kdf_iterations: 2_000_001,
        kdf_memory: None,
        kdf_parallelism: None,
    }
    .validate()
    .is_err());
    assert!(KdfConfig {
        kdf: 1,
        kdf_iterations: 1,
        kdf_memory: Some(64),
        kdf_parallelism: Some(1),
    }
    .validate()
    .is_err());
    assert!(KdfConfig {
        kdf: 0,
        kdf_iterations: 100_000,
        kdf_memory: None,
        kdf_parallelism: None,
    }
    .validate_for_registration()
    .is_err());
    assert!(KdfConfig {
        kdf: 0,
        kdf_iterations: 600_000,
        kdf_memory: None,
        kdf_parallelism: None,
    }
    .validate_for_registration()
    .is_ok());

    let core = AppCore::with_storage(
        Storage::open_in_memory().unwrap(),
        Arc::new(MockBiometricStore::default()),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    // Short password and single-class 12-char password both rejected before network call
    assert!(core
        .auth_register_with_policy(
            "https://vault.example.com",
            "user@example.com",
            "User",
            "short123",
            None,
            false,
        )
        .await
        .is_err());
    assert!(core
        .auth_register_with_policy(
            "https://vault.example.com",
            "user@example.com",
            "User",
            "alllowercasepw",
            None,
            false,
        )
        .await
        .is_err());
}

#[test]
fn security_encstring_rejects_unauthenticated_type0_for_critical_secrets() {
    let kdf = KdfConfig::default();
    let mk = derive_master_key("MasterPass#2026!", "user@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let unauth_blob = format!(
        "0.{}|{}",
        B64.encode([7u8; 16]),
        B64.encode([9u8; 80])
    );
    assert!(unprotect_user_symmetric_key(&unauth_blob, &smk).is_err());
    assert!(decrypt_keysmith_export(&unauth_blob, None, Some(&usk)).is_err());
}

#[test]
fn security_remote_http_policy_and_signalr_no_query_token() {
    use keysmith_core::protocol::signalr::build_hub_url;
    use keysmith_core::protocol::VaultwardenClient;

    assert!(VaultwardenClient::normalize_base_url("http://vault.example.com").is_err());
    assert!(VaultwardenClient::normalize_base_url("http://127.0.0.1:8080").is_ok());
    assert!(VaultwardenClient::normalize_base_url("http://localhost:8080").is_ok());
    assert!(VaultwardenClient::normalize_base_url_with_policy("http://vault.example.com", true).is_ok());

    let hub_url = build_hub_url("https://vault.example.com", "secret-token").unwrap();
    assert!(!hub_url.contains("access_token="));
    assert!(hub_url.starts_with("wss://"));
}

#[test]
fn security_favicon_ssrf_validator_blocks_private_and_local_targets() {
    use keysmith_core::protocol::validate_favicon_host;

    for blocked in [
        "",
        "localhost",
        "localhost:8080",
        "127.0.0.1",
        "169.254.169.254",
        "10.0.0.1",
        "192.168.1.50",
        "[::1]",
        "printer.local",
        "user@github.com",
        "https://127.0.0.1/evil",
    ] {
        assert!(
            validate_favicon_host(blocked).is_none(),
            "expected favicon host '{blocked}' to be rejected"
        );
    }
    assert_eq!(
        validate_favicon_host("GitHub.com").as_deref(),
        Some("github.com")
    );
    assert_eq!(
        validate_favicon_host("https://GitHub.com/login").as_deref(),
        Some("github.com")
    );
}

#[tokio::test]
async fn security_ssh_defaults_and_user_presence_fail_closed() {
    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig::default();
    let mk = derive_master_key("MasterPass#2026!", "ssh@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let acc = StoredAccount::default_prefs(
        "acc-ssh-sec".to_string(),
        "https://vault.example.com".to_string(),
        "ssh@example.com".to_string(),
        "ssh".to_string(),
        kdf.kdf,
        kdf.kdf_iterations,
        kdf.kdf_memory,
        kdf.kdf_parallelism,
        protect_user_symmetric_key(&usk, &smk).unwrap(),
        "dev-acc-ssh-sec".to_string(),
    );
    assert!(!acc.biometric_enabled);
    assert!(acc.ssh_biometric_confirm);
    storage.upsert_account(&acc).unwrap();

    // Unavailable biometric hardware must fail closed even after vault unlock
    let core_no_bio = AppCore::with_storage(
        storage.clone(),
        Arc::new(MockBiometricStore {
            available: false,
            ..Default::default()
        }),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    assert!(!core_no_bio.app_settings_get().unwrap().ssh_agent_enabled);
    core_no_bio
        .session_unlock_password("MasterPass#2026!")
        .await
        .unwrap();
    assert!(core_no_bio
        .session_verify_user_presence(Some("SSH sign"))
        .await
        .is_err());

    // Available biometric hardware succeeds after unlock
    let core_with_bio = AppCore::with_storage(
        storage,
        Arc::new(MockBiometricStore {
            available: true,
            ..Default::default()
        }),
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    core_with_bio
        .session_unlock_password("MasterPass#2026!")
        .await
        .unwrap();
    assert!(core_with_bio
        .session_verify_user_presence(Some("SSH sign"))
        .await
        .is_ok());
}

#[tokio::test]
async fn macos_login_keychain_fallback_defaults_off_and_cleans_up_on_disable() {
    use std::sync::atomic::{AtomicBool, Ordering};

    struct AdhocBiometricStore {
        fallback_enabled: AtomicBool,
        legacy_deleted: AtomicBool,
        keys: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl AdhocBiometricStore {
        fn new() -> Self {
            Self {
                fallback_enabled: AtomicBool::new(false),
                legacy_deleted: AtomicBool::new(false),
                keys: Mutex::new(HashMap::new()),
            }
        }
    }

    impl BiometricKeyStore for AdhocBiometricStore {
        fn is_available(&self) -> bool {
            true
        }

        fn set_legacy_keychain_fallback(&self, enabled: bool) {
            self.fallback_enabled.store(enabled, Ordering::SeqCst);
        }

        fn save_unlock_key(&self, account_id: &str, key: &[u8]) -> Result<(), CoreError> {
            if !self.fallback_enabled.load(Ordering::SeqCst) {
                return Err(CoreError::Biometric(
                    "OSStatus=-34018: Data Protection Keychain unavailable".to_string(),
                ));
            }
            self.keys
                .lock()
                .unwrap()
                .insert(account_id.to_string(), key.to_vec());
            Ok(())
        }

        fn load_unlock_key(
            &self,
            account_id: &str,
            _reason: &str,
        ) -> Result<Zeroizing<Vec<u8>>, CoreError> {
            if !self.fallback_enabled.load(Ordering::SeqCst) {
                return Err(CoreError::Biometric(
                    "OSStatus=-34018: Data Protection Keychain unavailable".to_string(),
                ));
            }
            self.keys
                .lock()
                .unwrap()
                .get(account_id)
                .cloned()
                .map(Zeroizing::new)
                .ok_or_else(|| CoreError::Biometric("OSStatus=-25300".to_string()))
        }

        fn delete_unlock_key(&self, account_id: &str) -> Result<(), CoreError> {
            self.keys.lock().unwrap().remove(account_id);
            Ok(())
        }

        fn delete_legacy_unlock_key(&self, account_id: &str) -> Result<(), CoreError> {
            self.legacy_deleted.store(true, Ordering::SeqCst);
            self.keys.lock().unwrap().remove(account_id);
            Ok(())
        }

        fn verify_user(&self, _reason: &str) -> Result<(), CoreError> {
            Ok(())
        }
    }

    let storage = Storage::open_in_memory().unwrap();
    let kdf = KdfConfig::default();
    let mk = derive_master_key("MasterPass#2026!", "bio@example.com", &kdf).unwrap();
    let smk = stretch_master_key(&mk).unwrap();
    let usk = UserSymmetricKey::generate();
    let acc = StoredAccount::default_prefs(
        "acc-adhoc-bio".to_string(),
        "https://vault.example.com".to_string(),
        "bio@example.com".to_string(),
        "bio".to_string(),
        kdf.kdf,
        kdf.kdf_iterations,
        kdf.kdf_memory,
        kdf.kdf_parallelism,
        protect_user_symmetric_key(&usk, &smk).unwrap(),
        "dev-acc-adhoc-bio".to_string(),
    );
    storage.upsert_account(&acc).unwrap();

    let bio = Arc::new(AdhocBiometricStore::new());
    let core = AppCore::with_storage(
        storage.clone(),
        Arc::clone(&bio) as Arc<dyn BiometricKeyStore>,
        Arc::new(NoopClipboardManager),
    )
    .unwrap();

    // Defaults to false (fail-closed)
    assert!(!core.app_settings_get().unwrap().macos_login_keychain_fallback);

    core.session_unlock_password("MasterPass#2026!")
        .await
        .unwrap();

    // Enabling biometric fails when fallback is OFF on ad-hoc builds
    assert!(core
        .session_update_preferences(SessionPreferencesPatch {
            biometric_enabled: Some(true),
            ..Default::default()
        })
        .is_err());
    assert!(!core.session_get_state().biometric_enabled);

    // Turning fallback ON allows enabling biometric and unlocking with it
    let updated = core
        .app_settings_update(AppSettingsPatch {
            macos_login_keychain_fallback: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert!(updated.macos_login_keychain_fallback);

    let session = core
        .session_update_preferences(SessionPreferencesPatch {
            biometric_enabled: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert!(session.biometric_enabled);

    core.session_lock("manual").unwrap();
    core.session_unlock_biometric().await.unwrap();
    assert_eq!(core.session_get_state().status, AuthStatus::Unlocked);

    // Setting persists across reopen
    let bio_reopened = Arc::new(AdhocBiometricStore::new());
    // Seed saved key to simulate persisted macOS Login Keychain across process restart
    bio_reopened
        .keys
        .lock()
        .unwrap()
        .insert("acc-adhoc-bio".to_string(), usk.to_bytes().to_vec());
    let reopened = AppCore::with_storage(
        storage,
        Arc::clone(&bio_reopened) as Arc<dyn BiometricKeyStore>,
        Arc::new(NoopClipboardManager),
    )
    .unwrap();
    assert!(reopened
        .app_settings_get()
        .unwrap()
        .macos_login_keychain_fallback);
    assert!(bio_reopened.fallback_enabled.load(Ordering::SeqCst));
    reopened.session_unlock_biometric().await.unwrap();

    // Turning fallback OFF deletes legacy key and disables biometric on ad-hoc builds
    let disabled = reopened
        .app_settings_update(AppSettingsPatch {
            macos_login_keychain_fallback: Some(false),
            ..Default::default()
        })
        .unwrap();
    assert!(!disabled.macos_login_keychain_fallback);
    assert!(bio_reopened.legacy_deleted.load(Ordering::SeqCst));
    assert!(!reopened.session_get_state().biometric_enabled);
}
