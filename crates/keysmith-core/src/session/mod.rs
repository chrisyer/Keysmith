use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, RwLock};
use std::time::Instant;

use base64::{
    engine::general_purpose::STANDARD as B64, engine::general_purpose::URL_SAFE_NO_PAD, Engine as _,
};
use chrono::{DateTime, Duration, Utc};
use rand::{rngs::OsRng, RngCore};
use rsa::pkcs8::{EncodePrivateKey, EncodePublicKey};
use rsa::RsaPrivateKey;
use tokio::sync::Mutex as AsyncMutex;
use zeroize::{Zeroize, Zeroizing};

use crate::crypto::{
    decrypt_bytes, decrypt_org_symmetric_key, derive_master_key, derive_master_password_hash,
    derive_send_key, encrypt_bytes, encrypt_send_buffer, generate_rsa_keypair, generate_send_seed,
    normalize_email, protect_user_symmetric_key, stretch_master_key, unprotect_user_symmetric_key,
    KdfConfig, UserSymmetricKey,
};
use crate::domain::codec::{
    cipher_to_item, collection_to_vault, decode_send_dto, draft_to_cipher, encode_send_payload,
    encode_vault_name, folder_to_vault, new_uuid,
};
use crate::domain::{
    format_size_bytes, item_to_summary, AccountPasskey, AccountPasskeyListResponse,
    AccountProfileResponse, AccountSummary, AppSettings, AppSettingsPatch,
    AttachmentDownloadResult, AuthStatus, CollectionInfo, ExportResult, FieldType,
    GeneratorHistoryEntry, GeneratorOptions, GeneratorResult, ImportSummary, ItemAttachment,
    ItemCategory, ItemDetail, ItemDraft, ItemFilter, ItemStats, ItemSummary, OrganizationInfo,
    SendCreateFileInput, SendCreateTextInput, SendItem, SendType, SendUpdateInput,
    ServerCheckResult, SessionPreferencesPatch, SessionState, SortBy, SshIdentity, SshKeyPair,
    SyncStateKind, SyncStatus, TagCount, TotpCode, Vault, WatchtowerFlagsPatch, WatchtowerReport,
    DEFAULT_PERSONAL_VAULT_ID, DEFAULT_QUICK_ACCESS_SHORTCUT,
};
use crate::error::CoreError;
use crate::generator::generate_secret;
use crate::importers::{build_export_content, parse_import_payload};
use crate::protocol::{
    CipherDto, CollectionDto, FolderDto, OrganizationDto, RegisterKeysRequest, RegisterRequest,
    SendDto, SendFileDto, VaultwardenClient,
};
use crate::search::score_search_query;
use crate::ssh::{ssh_fingerprint_from_public, ssh_generate_ed25519, ssh_sign_ed25519};
use crate::storage::{
    new_device_identifier, Storage, StoredAccount, StoredCipher, StoredGeneratorHistory,
    StoredLocalAttachment, StoredVault,
};
use crate::totp::{compute_totp, parse_totp_qr_image};
use crate::traits::{BiometricKeyStore, ClipboardManager};
use crate::watchtower::{check_hibp_breached_sha1_hashes, run_watchtower_audit};

const KEYSMITH_ACCOUNT_RP_ID: &str = "keysmith.local";
const APPLE_TOUCH_ID_AAGUID: &str = "adce0002-35bc-c60a-648b-0b25f1f05503";
const YUBIKEY_5_AAGUID: &str = "ee882879-721c-4913-9775-3dfcce97072a";

pub fn localized_biometric_reason(lang: &str, kind: &str) -> &'static str {
    let norm = lang.trim();
    if kind == "reprompt" {
        return match norm {
            "zh-CN" | "zh" => "验证身份以访问受主密码重验证保护的条目",
            "zh-TW" | "zh-HK" => "驗證身分以存取受主密碼重驗證保護的項目",
            "ja" => "マスターパスワード再確認項目へアクセスするため認証してください",
            "ko" => "마스터 비밀번호 재확인 보호 항목에 접근하려면 인증하세요",
            "de" => "Authentifizieren Sie sich für diesen geschützten Eintrag",
            "fr" => "Authentifiez-vous pour accéder à cet élément protégé",
            "es" => "Autentíquese para acceder a este elemento protegido",
            _ => "Authenticate to access this protected Keysmith item",
        };
    }
    match norm {
        "zh-CN" | "zh" => "解锁 Keysmith 保险库",
        "zh-TW" | "zh-HK" => "解鎖 Keysmith 保險庫",
        "ja" => "Keysmith 保管庫のロックを解除",
        "ko" => "Keysmith 금고 잠금 해제",
        "de" => "Keysmith-Tresor entsperren",
        "fr" => "Déverrouiller le coffre Keysmith",
        "es" => "Desbloquear el almacén de Keysmith",
        _ => "Unlock Keysmith Vault",
    }
}

struct UnlockedMemory {
    usk: UserSymmetricKey,
    org_keys: HashMap<String, UserSymmetricKey>,
    ciphers: HashMap<String, CipherDto>,
    items: HashMap<String, ItemDetail>,
    vaults: Vec<Vault>,
    organizations: Vec<OrganizationInfo>,
    sends: HashMap<String, SendItem>,
    send_dtos: HashMap<String, SendDto>,
    send_seeds: HashMap<String, Zeroizing<[u8; 16]>>,
    hibp_breached: Option<HashSet<String>>,
    hibp_checked_at: Option<String>,
}

impl Drop for UnlockedMemory {
    fn drop(&mut self) {
        for item in self.items.values_mut() {
            item.title.zeroize();
            item.payload.notes.zeroize();
            for sec in &mut item.payload.sections {
                for field in &mut sec.fields {
                    field.value.zeroize();
                }
            }
            for hist in &mut item.payload.password_history {
                hist.value.zeroize();
            }
            for pk in &mut item.payload.passkeys {
                pk.private_key_pkcs8.zeroize();
            }
        }
        for send in self.sends.values_mut() {
            send.name.zeroize();
            if let Some(ref mut t) = send.text {
                t.zeroize();
            }
            if let Some(ref mut n) = send.notes {
                n.zeroize();
            }
            send.share_url.zeroize();
        }
        self.items.clear();
        self.ciphers.clear();
        self.org_keys.clear();
        self.vaults.clear();
        self.organizations.clear();
        self.sends.clear();
        self.send_dtos.clear();
        self.send_seeds.clear();
    }
}

struct CoreState {
    account: Option<StoredAccount>,
    unlocked: Option<UnlockedMemory>,
    sync_status: SyncStatus,
    last_activity: Instant,
}

/// Primary zero-knowledge engine facade exposed to desktop/mobile/CLI shells.
pub struct AppCore {
    storage: Storage,
    client: VaultwardenClient,
    biometric: Arc<dyn BiometricKeyStore>,
    clipboard: Arc<dyn ClipboardManager>,
    state: RwLock<CoreState>,
    sync_lock: AsyncMutex<()>,
}

impl AppCore {
    pub fn new(
        biometric: Arc<dyn BiometricKeyStore>,
        clipboard: Arc<dyn ClipboardManager>,
    ) -> Result<Self, CoreError> {
        let storage = Storage::open_default()?;
        Self::with_storage(storage, biometric, clipboard)
    }

    pub fn with_storage(
        storage: Storage,
        biometric: Arc<dyn BiometricKeyStore>,
        clipboard: Arc<dyn ClipboardManager>,
    ) -> Result<Self, CoreError> {
        let account = storage.load_primary_account()?;
        let pending_count = match &account {
            Some(acc) => storage.count_pending_dirty(&acc.id)?,
            None => 0,
        };
        let last_sync_at = account
            .as_ref()
            .and_then(|a| a.last_sync_at.clone())
            .unwrap_or_default();

        Ok(Self {
            storage,
            client: VaultwardenClient::new(),
            biometric,
            clipboard,
            state: RwLock::new(CoreState {
                account,
                unlocked: None,
                sync_status: SyncStatus {
                    state: SyncStateKind::Idle,
                    pending_count,
                    last_sync_at,
                    message: None,
                    signalr_connected: false,
                },
                last_activity: Instant::now(),
            }),
            sync_lock: AsyncMutex::new(()),
        })
    }

    fn read_state(&self) -> Result<std::sync::RwLockReadGuard<'_, CoreState>, CoreError> {
        self.state
            .read()
            .map_err(|_| CoreError::Internal("核心状态读锁损坏".to_string()))
    }

    fn write_state(&self) -> Result<std::sync::RwLockWriteGuard<'_, CoreState>, CoreError> {
        self.state
            .write()
            .map_err(|_| CoreError::Internal("核心状态写锁损坏".to_string()))
    }

    fn build_session_state(guard: &CoreState, biometric_available: bool) -> SessionState {
        let status = match (&guard.account, &guard.unlocked) {
            (None, _) => AuthStatus::Unauthenticated,
            (Some(_), None) => AuthStatus::Locked,
            (Some(_), Some(_)) => AuthStatus::Unlocked,
        };
        match &guard.account {
            Some(acc) => SessionState {
                account_id: acc.id.clone(),
                status,
                email: acc.email.clone(),
                display_name: if acc.display_name.is_empty() {
                    acc.email
                        .split('@')
                        .next()
                        .unwrap_or("Keysmith User")
                        .to_string()
                } else {
                    acc.display_name.clone()
                },
                server_url: acc.server_url.clone(),
                biometric_enabled: acc.biometric_enabled && biometric_available,
                auto_lock_minutes: acc.auto_lock_minutes,
                clipboard_clear_seconds: acc.clipboard_clear_seconds,
                last_sync_at: acc.last_sync_at.clone().unwrap_or_default(),
                kdf_type: KdfConfig {
                    kdf: acc.kdf_type,
                    kdf_iterations: acc.kdf_iterations,
                    kdf_memory: acc.kdf_memory,
                    kdf_parallelism: acc.kdf_parallelism,
                }
                .label()
                .to_string(),
                close_to_tray: acc.close_to_tray,
                lock_on_sleep: acc.lock_on_sleep,
                screen_capture_protected: acc.screen_capture_protected,
                vibrancy_enabled: acc.vibrancy_enabled,
                favicon_enabled: acc.favicon_enabled,
                quick_access_shortcut: acc.quick_access_shortcut.clone(),
                biometric_max_days: acc.biometric_max_days,
                launch_at_login: acc.launch_at_login,
            },
            None => SessionState {
                account_id: String::new(),
                status: AuthStatus::Unauthenticated,
                email: String::new(),
                display_name: String::new(),
                server_url: String::new(),
                biometric_enabled: false,
                auto_lock_minutes: 15,
                clipboard_clear_seconds: 30,
                last_sync_at: String::new(),
                kdf_type: "Argon2id".to_string(),
                close_to_tray: true,
                lock_on_sleep: true,
                screen_capture_protected: false,
                vibrancy_enabled: true,
                favicon_enabled: true,
                quick_access_shortcut: DEFAULT_QUICK_ACCESS_SHORTCUT.to_string(),
                biometric_max_days: 7,
                launch_at_login: false,
            },
        }
    }

    fn load_unlocked_from_storage_sync(
        storage: &Storage,
        account_id: &str,
        server_url: &str,
        usk: UserSymmetricKey,
    ) -> Result<UnlockedMemory, CoreError> {
        let stored_vaults = storage.list_vaults(account_id)?;
        let stored_ciphers = storage.list_ciphers(account_id)?;
        let stored_sends = storage.list_sends(account_id)?;
        let stored_orgs = storage.list_organizations(account_id)?;
        let enc_priv_opt = storage
            .load_account_by_id(account_id)?
            .and_then(|a| a.encrypted_private_key);

        let mut org_keys: HashMap<String, UserSymmetricKey> = HashMap::new();
        if let Some(enc_priv) = enc_priv_opt.as_deref() {
            for org in &stored_orgs {
                if let Some(key_enc) = org.key_enc.as_deref().filter(|s| !s.trim().is_empty()) {
                    if let Ok(org_usk) = decrypt_org_symmetric_key(key_enc, enc_priv, &usk) {
                        org_keys.insert(org.id.clone(), org_usk);
                    }
                }
            }
        }

        let mut ciphers = HashMap::new();
        let mut items = HashMap::new();
        let mut counts_by_vault: HashMap<String, usize> = HashMap::new();

        for sc in stored_ciphers {
            if sc.dirty_op.as_deref() == Some("delete") {
                continue;
            }
            let dto: CipherDto = serde_json::from_str(&sc.raw_json)
                .map_err(|e| CoreError::Storage(format!("解析本地密文 JSON 失败: {e}")))?;
            let eff_usk = dto
                .organization_id
                .as_ref()
                .and_then(|oid| org_keys.get(oid))
                .unwrap_or(&usk);
            let item = cipher_to_item(&dto, eff_usk)?;
            if item.deleted_at.is_none() && !item.payload.archived {
                *counts_by_vault.entry(item.vault_id.clone()).or_insert(0) += 1;
            }
            ciphers.insert(dto.id.clone(), dto);
            items.insert(item.id.clone(), item);
        }

        let mut vaults = vec![Vault {
            id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            name: "个人".to_string(),
            icon: "user".to_string(),
            color: "#0572EC".to_string(),
            is_default: true,
            is_organization: false,
            item_count: *counts_by_vault.get(DEFAULT_PERSONAL_VAULT_ID).unwrap_or(&0),
        }];

        let mut collections_by_org: HashMap<String, Vec<CollectionInfo>> = HashMap::new();
        for sv in stored_vaults {
            if sv.dirty_op.as_deref() == Some("delete") {
                continue;
            }
            let count = *counts_by_vault.get(&sv.id).unwrap_or(&0);
            if sv.is_organization {
                let eff_usk = sv
                    .organization_id
                    .as_ref()
                    .and_then(|oid| org_keys.get(oid))
                    .unwrap_or(&usk);
                let col = CollectionDto {
                    id: sv.id.clone(),
                    organization_id: sv.organization_id.clone(),
                    name: sv.name_enc,
                    read_only: false,
                    extra: Default::default(),
                };
                let vault = collection_to_vault(&col, eff_usk, count);
                if let Some(oid) = sv.organization_id.clone() {
                    collections_by_org.entry(oid.clone()).or_default().push(CollectionInfo {
                        id: col.id.clone(),
                        organization_id: oid,
                        name: vault.name.clone(),
                        read_only: false,
                    });
                }
                vaults.push(vault);
            } else {
                let dto = FolderDto {
                    id: sv.id.clone(),
                    name: sv.name_enc,
                    revision_date: Some(sv.revision_date),
                };
                vaults.push(folder_to_vault(&dto, &usk, count)?);
            }
        }

        let organizations: Vec<OrganizationInfo> = stored_orgs
            .into_iter()
            .map(|o| OrganizationInfo {
                has_key: org_keys.contains_key(&o.id),
                collections: collections_by_org.remove(&o.id).unwrap_or_default(),
                id: o.id.clone(),
                name: if o.name.trim().is_empty() {
                    o.id
                } else {
                    o.name
                },
            })
            .collect();

        let mut sends = HashMap::new();
        let mut send_dtos = HashMap::new();
        let mut send_seeds = HashMap::new();
        for ss in stored_sends {
            if let Ok(dto) = serde_json::from_str::<SendDto>(&ss.raw_json) {
                if let Ok((item, seed)) = decode_send_dto(&dto, &usk, server_url) {
                    send_dtos.insert(dto.id.clone(), dto);
                    send_seeds.insert(item.id.clone(), seed);
                    sends.insert(item.id.clone(), item);
                }
            }
        }

        Ok(UnlockedMemory {
            usk,
            org_keys,
            ciphers,
            items,
            vaults,
            organizations,
            sends,
            send_dtos,
            send_seeds,
            hibp_breached: None,
            hibp_checked_at: None,
        })
    }

    fn recompute_vault_counts(unlocked: &mut UnlockedMemory) {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for item in unlocked.items.values() {
            if item.deleted_at.is_none() && !item.payload.archived {
                *counts.entry(item.vault_id.clone()).or_insert(0) += 1;
            }
        }
        for v in &mut unlocked.vaults {
            v.item_count = *counts.get(&v.id).unwrap_or(&0);
        }
    }

    /// Execute an authenticated Vaultwarden request; on HTTP 401 automatically refresh the token,
    /// persist updated tokens, update `CoreState::account`, and retry once.
    async fn with_fresh_token<T, F, Fut>(
        &self,
        account: &mut StoredAccount,
        op: F,
    ) -> Result<T, CoreError>
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = Result<T, CoreError>>,
    {
        let token = account
            .access_token
            .clone()
            .ok_or_else(|| CoreError::Unauthorized("缺少访问令牌".to_string()))?;

        match op(token).await {
            Ok(val) => Ok(val),
            Err(CoreError::Unauthorized(msg)) => {
                let Some(rt) = account.refresh_token.clone() else {
                    return Err(CoreError::Unauthorized(msg));
                };
                let refreshed = self
                    .client
                    .refresh_token(&account.server_url, &rt)
                    .await?;
                account.access_token = Some(refreshed.access_token.clone());
                if let Some(new_rt) = refreshed.refresh_token {
                    account.refresh_token = Some(new_rt);
                }
                self.storage.upsert_account(account)?;
                if let Ok(mut guard) = self.write_state() {
                    if let Some(cur) = &mut guard.account {
                        if cur.id == account.id {
                            cur.access_token = account.access_token.clone();
                            cur.refresh_token = account.refresh_token.clone();
                        }
                    }
                }
                op(refreshed.access_token).await
            }
            Err(e) => Err(e),
        }
    }

    pub fn signalr_credentials(&self) -> Option<(String, String)> {
        let guard = self.read_state().ok()?;
        let acc = guard.account.as_ref()?;
        let token = acc.access_token.as_ref()?.clone();
        if token.trim().is_empty() {
            return None;
        }
        Some((acc.server_url.clone(), token))
    }

    pub fn set_signalr_connected(&self, connected: bool) {
        if let Ok(mut guard) = self.write_state() {
            guard.sync_status.signalr_connected = connected;
        }
    }

    // --- Auth & Server ---

    pub async fn auth_check_server(&self, server_url: &str) -> Result<ServerCheckResult, CoreError> {
        let (version, disable_user_registration) = self.client.check_server(server_url).await?;
        Ok(ServerCheckResult {
            ok: true,
            version,
            disable_user_registration,
        })
    }

    pub async fn auth_prelogin(&self, server_url: &str, email: &str) -> Result<KdfConfig, CoreError> {
        if email.trim().is_empty() {
            return Err(CoreError::Validation("请输入邮箱地址".to_string()));
        }
        self.client.prelogin(server_url, email).await
    }

    pub async fn auth_login(
        &self,
        server_url: &str,
        email: &str,
        master_password: &str,
        two_factor_code: Option<&str>,
    ) -> Result<SessionState, CoreError> {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() || master_password.is_empty() {
            return Err(CoreError::Validation("请输入邮箱与主密码".to_string()));
        }
        let clean_url = VaultwardenClient::normalize_base_url(server_url)?;
        let device_id = new_device_identifier();

        let kdf = self.client.prelogin(&clean_url, &normalized_email).await?;

        let pw_owned = master_password.to_string();
        let email_owned = normalized_email.clone();
        let (mph, smk) = tokio::task::spawn_blocking(move || {
            let mk = derive_master_key(&pw_owned, &email_owned, &kdf)?;
            let mph = derive_master_password_hash(&mk, &pw_owned);
            let smk = stretch_master_key(&mk)?;
            Ok::<_, CoreError>((mph, smk))
        })
        .await
        .map_err(|e| CoreError::Internal(format!("KDF 后台任务失败: {e}")))??;

        let token = self
            .client
            .login_password(
                &clean_url,
                &normalized_email,
                &mph,
                &device_id,
                two_factor_code,
            )
            .await?;

        let sync_resp = self.client.sync(&clean_url, &token.access_token).await?;

        let protected_key = token
            .key
            .or_else(|| sync_resp.profile.key.clone())
            .ok_or_else(|| CoreError::Crypto("服务端未返回受保护的对称密钥".to_string()))?;

        let now = Utc::now().to_rfc3339();
        let display_name = sync_resp
            .profile
            .name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                normalized_email
                    .split('@')
                    .next()
                    .unwrap_or("Keysmith User")
                    .to_string()
            });

        let mut account = StoredAccount::default_prefs(
            sync_resp.profile.id.clone(),
            clean_url,
            normalized_email,
            display_name,
            kdf.kdf,
            kdf.kdf_iterations,
            kdf.kdf_memory,
            kdf.kdf_parallelism,
            protected_key.clone(),
            device_id,
        );
        account.encrypted_private_key =
            token.private_key.or_else(|| sync_resp.profile.private_key.clone());
        account.access_token = Some(token.access_token);
        account.refresh_token = token.refresh_token;
        account.last_sync_at = Some(now.clone());
        account.biometric_enabled = self.biometric.is_available();
        account.last_master_password_unlock_at = Some(now.clone());

        let storage = self.storage.clone();
        let account_clone = account.clone();
        let folders = sync_resp.folders;
        let collections = sync_resp.collections;
        let ciphers = sync_resp.ciphers;
        let sends = sync_resp.sends;
        let orgs: Vec<OrganizationDto> = if !sync_resp.organizations.is_empty() {
            sync_resp.organizations
        } else {
            sync_resp.profile.organizations
        };

        let (usk, unlocked) = tokio::task::spawn_blocking(move || {
            let usk = unprotect_user_symmetric_key(&protected_key, &smk)?;
            storage.clear_account_data(&account_clone.id, true)?;
            storage.upsert_account(&account_clone)?;
            storage.replace_synced_organizations(&account_clone.id, &orgs)?;
            storage.replace_synced_vaults_clean(&account_clone.id, &folders, &collections)?;
            storage.replace_synced_ciphers_clean(&account_clone.id, &ciphers)?;
            storage.replace_synced_sends(&account_clone.id, &sends)?;
            let unlocked = Self::load_unlocked_from_storage_sync(
                &storage,
                &account_clone.id,
                &account_clone.server_url,
                usk.clone(),
            )?;
            Ok::<_, CoreError>((usk, unlocked))
        })
        .await
        .map_err(|e| CoreError::Internal(format!("登录后解密同步失败: {e}")))??;

        if account.biometric_enabled {
            let _ = self.biometric.save_unlock_key(&account.id, &*usk.to_bytes());
        }
        let _ = self.storage.set_app_setting("last_server_url", &account.server_url);

        let mut guard = self.write_state()?;
        guard.account = Some(account);
        guard.unlocked = Some(unlocked);
        guard.last_activity = Instant::now();
        guard.sync_status = SyncStatus {
            state: SyncStateKind::Idle,
            pending_count: 0,
            last_sync_at: now,
            message: None,
            signalr_connected: false,
        };
        Ok(Self::build_session_state(&guard, self.biometric.is_available()))
    }

    pub async fn auth_register(
        &self,
        server_url: &str,
        email: &str,
        name: &str,
        master_password: &str,
        kdf_config: Option<KdfConfig>,
    ) -> Result<SessionState, CoreError> {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() || master_password.chars().count() < 6 {
            return Err(CoreError::Validation(
                "请填写有效邮箱与至少 6 位主密码".to_string(),
            ));
        }
        let clean_url = VaultwardenClient::normalize_base_url(server_url)?;
        let kdf = kdf_config.unwrap_or_default();
        kdf.validate()?;

        let display_name = if name.trim().is_empty() {
            normalized_email
                .split('@')
                .next()
                .unwrap_or("Keysmith User")
                .to_string()
        } else {
            name.trim().to_string()
        };

        let pw_owned = master_password.to_string();
        let email_owned = normalized_email.clone();
        let name_owned = display_name.clone();

        let req = tokio::task::spawn_blocking(move || {
            let mk = derive_master_key(&pw_owned, &email_owned, &kdf)?;
            let mph = derive_master_password_hash(&mk, &pw_owned);
            let smk = stretch_master_key(&mk)?;
            let usk = UserSymmetricKey::generate();
            let protected_key = protect_user_symmetric_key(&usk, &smk)?;
            let (public_key, encrypted_private_key) = generate_rsa_keypair(&usk)?;

            Ok::<_, CoreError>(RegisterRequest {
                email: email_owned,
                name: name_owned,
                master_password_hash: mph,
                master_password_hint: None,
                user_symmetric_key: protected_key.clone(),
                key: protected_key,
                keys: RegisterKeysRequest {
                    public_key,
                    encrypted_private_key,
                },
                kdf: kdf.kdf,
                kdf_iterations: kdf.kdf_iterations,
                kdf_memory: kdf.kdf_memory,
                kdf_parallelism: kdf.kdf_parallelism,
                token: None,
            })
        })
        .await
        .map_err(|e| CoreError::Internal(format!("注册密钥生成失败: {e}")))??;

        self.client.register(&clean_url, req).await?;

        self.auth_login(&clean_url, &normalized_email, master_password, None)
            .await
    }

    pub async fn auth_logout(&self, clear_local_cache: bool) -> Result<(), CoreError> {
        let account_id = {
            let mut guard = self.write_state()?;
            let id = guard.account.as_ref().map(|a| a.id.clone());
            guard.unlocked = None;
            guard.account = None;
            guard.sync_status = SyncStatus {
                state: SyncStateKind::Idle,
                pending_count: 0,
                last_sync_at: String::new(),
                message: None,
                signalr_connected: false,
            };
            id
        };

        if let Some(id) = account_id {
            let _ = self.biometric.delete_unlock_key(&id);
            self.storage.clear_account_data(&id, clear_local_cache)?;
        }

        // If another account remains saved locally, switch to it in Locked state
        if let Some(next_acc) = self.storage.load_primary_account()? {
            let next_active = self.storage.set_active_account(&next_acc.id)?;
            let pending = self.storage.count_pending_dirty(&next_active.id)?;
            let mut guard = self.write_state()?;
            guard.sync_status.last_sync_at = next_active.last_sync_at.clone().unwrap_or_default();
            guard.sync_status.pending_count = pending;
            guard.account = Some(next_active);
        }
        Ok(())
    }

    pub async fn auth_passkey_login(
        &self,
        credential_id: Option<&str>,
    ) -> Result<SessionState, CoreError> {
        let account = {
            let guard = self.read_state()?;
            guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("尚未登录账户，请先使用主密码登录".to_string()))?
        };

        let mut passkeys = self.storage.list_account_passkeys(&account.id)?;
        let target = if let Some(cid) = credential_id {
            passkeys.iter_mut().find(|p| p.id == cid)
        } else {
            passkeys.first_mut()
        }
        .ok_or_else(|| {
            CoreError::NotFound("未找到可用的账户通行密钥，请使用主密码登录".to_string())
        })?;

        target.counter = target.counter.saturating_add(1);
        target.last_used_at = Some(Utc::now().timestamp_millis());
        let updated = target.clone();
        self.storage.upsert_account_passkey(&account.id, &updated)?;

        self.session_unlock_biometric().await
    }

    // --- Multi-account ---

    pub fn account_list(&self) -> Result<Vec<AccountSummary>, CoreError> {
        let accounts = self.storage.list_accounts()?;
        Ok(accounts
            .into_iter()
            .map(|a| AccountSummary {
                id: a.id,
                email: a.email.clone(),
                display_name: if a.display_name.is_empty() {
                    a.email.split('@').next().unwrap_or("Keysmith User").to_string()
                } else {
                    a.display_name
                },
                server_url: a.server_url,
                is_active: a.is_active,
                kdf_type: KdfConfig {
                    kdf: a.kdf_type,
                    kdf_iterations: a.kdf_iterations,
                    kdf_memory: a.kdf_memory,
                    kdf_parallelism: a.kdf_parallelism,
                }
                .label()
                .to_string(),
                last_sync_at: a.last_sync_at.unwrap_or_default(),
            })
            .collect())
    }

    pub fn account_switch(&self, account_id: &str) -> Result<SessionState, CoreError> {
        let target = self.storage.set_active_account(account_id)?;
        let pending = self.storage.count_pending_dirty(&target.id)?;
        let mut guard = self.write_state()?;
        // Lock & zeroize current account's unlocked memory
        guard.unlocked = None;
        guard.account = Some(target.clone());
        guard.last_activity = Instant::now();
        guard.sync_status = SyncStatus {
            state: SyncStateKind::Idle,
            pending_count: pending,
            last_sync_at: target.last_sync_at.unwrap_or_default(),
            message: None,
            signalr_connected: false,
        };
        Ok(Self::build_session_state(&guard, self.biometric.is_available()))
    }

    // --- Session & Lock State Machine ---

    pub fn session_get_state(&self) -> SessionState {
        match self.read_state() {
            Ok(guard) => Self::build_session_state(&guard, self.biometric.is_available()),
            Err(_) => SessionState {
                account_id: String::new(),
                status: AuthStatus::Unauthenticated,
                email: String::new(),
                display_name: String::new(),
                server_url: String::new(),
                biometric_enabled: false,
                auto_lock_minutes: 15,
                clipboard_clear_seconds: 30,
                last_sync_at: String::new(),
                kdf_type: "Argon2id".to_string(),
                close_to_tray: true,
                lock_on_sleep: true,
                screen_capture_protected: false,
                vibrancy_enabled: true,
                favicon_enabled: true,
                quick_access_shortcut: DEFAULT_QUICK_ACCESS_SHORTCUT.to_string(),
                biometric_max_days: 7,
                launch_at_login: false,
            },
        }
    }

    pub fn session_update_preferences(
        &self,
        patch: SessionPreferencesPatch,
    ) -> Result<SessionState, CoreError> {
        let mut guard = self.write_state()?;
        let mut account = guard
            .account
            .clone()
            .ok_or_else(|| CoreError::InvalidState("请先登录账户".to_string()))?;

        if let Some(bio) = patch.biometric_enabled {
            account.biometric_enabled = bio;
            if bio {
                if let Some(unlocked) = &guard.unlocked {
                    self.biometric
                        .save_unlock_key(&account.id, &*unlocked.usk.to_bytes())?;
                }
            } else {
                let _ = self.biometric.delete_unlock_key(&account.id);
            }
        }
        if let Some(mins) = patch.auto_lock_minutes {
            account.auto_lock_minutes = mins;
        }
        if let Some(secs) = patch.clipboard_clear_seconds {
            account.clipboard_clear_seconds = secs;
        }
        if let Some(v) = patch.close_to_tray {
            account.close_to_tray = v;
        }
        if let Some(v) = patch.lock_on_sleep {
            account.lock_on_sleep = v;
        }
        if let Some(v) = patch.screen_capture_protected {
            account.screen_capture_protected = v;
        }
        if let Some(v) = patch.vibrancy_enabled {
            account.vibrancy_enabled = v;
        }
        if let Some(v) = patch.favicon_enabled {
            account.favicon_enabled = v;
        }
        if let Some(shortcut) = patch.quick_access_shortcut {
            if !shortcut.trim().is_empty() {
                account.quick_access_shortcut = shortcut.trim().to_string();
            }
        }
        if let Some(days) = patch.biometric_max_days {
            account.biometric_max_days = days;
        }
        if let Some(v) = patch.launch_at_login {
            account.launch_at_login = v;
        }

        self.storage.upsert_account(&account)?;
        guard.account = Some(account);
        guard.last_activity = Instant::now();
        Ok(Self::build_session_state(&guard, self.biometric.is_available()))
    }

    pub async fn session_unlock_password(
        &self,
        master_password: &str,
    ) -> Result<SessionState, CoreError> {
        if master_password.is_empty() {
            return Err(CoreError::Validation("请输入主密码".to_string()));
        }

        let mut account = {
            let guard = self.read_state()?;
            guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("本地无已保存账户，请先登录".to_string()))?
        };

        let kdf = KdfConfig {
            kdf: account.kdf_type,
            kdf_iterations: account.kdf_iterations,
            kdf_memory: account.kdf_memory,
            kdf_parallelism: account.kdf_parallelism,
        };
        let pw_owned = master_password.to_string();
        let email_owned = account.email.clone();
        let protected_key = account.protected_symmetric_key.clone();
        let account_id = account.id.clone();
        let server_url = account.server_url.clone();
        let storage = self.storage.clone();

        let (usk, unlocked) = tokio::task::spawn_blocking(move || {
            let mk = derive_master_key(&pw_owned, &email_owned, &kdf)?;
            let smk = stretch_master_key(&mk)?;
            let usk = unprotect_user_symmetric_key(&protected_key, &smk)
                .map_err(|_| CoreError::auth("主密码校验失败，请重试"))?;
            let unlocked = Self::load_unlocked_from_storage_sync(
                &storage,
                &account_id,
                &server_url,
                usk.clone(),
            )?;
            Ok::<_, CoreError>((usk, unlocked))
        })
        .await
        .map_err(|e| CoreError::Internal(format!("解锁任务执行失败: {e}")))??;

        let now = Utc::now().to_rfc3339();
        account.last_master_password_unlock_at = Some(now);
        self.storage.upsert_account(&account)?;

        if account.biometric_enabled && self.biometric.is_available() {
            let _ = self.biometric.save_unlock_key(&account.id, &*usk.to_bytes());
        }

        let mut guard = self.write_state()?;
        guard.account = Some(account);
        guard.unlocked = Some(unlocked);
        guard.last_activity = Instant::now();
        Ok(Self::build_session_state(&guard, self.biometric.is_available()))
    }

    pub async fn session_unlock_biometric(&self) -> Result<SessionState, CoreError> {
        let account = {
            let guard = self.read_state()?;
            guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("本地无已保存账户，请先登录".to_string()))?
        };

        if !account.biometric_enabled {
            return Err(CoreError::Biometric(
                "未开启生物识别解锁，请使用主密码".to_string(),
            ));
        }

        if account.biometric_max_days > 0 {
            let expired = match &account.last_master_password_unlock_at {
                None => true,
                Some(ts) => match DateTime::parse_from_rfc3339(ts) {
                    Ok(dt) => {
                        let elapsed = Utc::now().signed_duration_since(dt.with_timezone(&Utc));
                        elapsed > Duration::days(account.biometric_max_days as i64)
                    }
                    Err(_) => true,
                },
            };
            if expired {
                return Err(CoreError::Biometric(
                    "已超过生物识别免密期限，请使用主密码重新验证".to_string(),
                ));
            }
        }

        let biometric = Arc::clone(&self.biometric);
        let storage = self.storage.clone();
        let account_id = account.id.clone();
        let server_url = account.server_url.clone();
        let prompt_lang = self
            .app_settings_get()
            .map(|s| s.language)
            .unwrap_or_else(|_| "en".to_string());
        let prompt_reason = localized_biometric_reason(&prompt_lang, "unlock");

        let unlocked = tokio::task::spawn_blocking(move || {
            let key_bytes = biometric.load_unlock_key(&account_id, prompt_reason)?;
            let usk = UserSymmetricKey::from_bytes(&key_bytes)?;
            Self::load_unlocked_from_storage_sync(&storage, &account_id, &server_url, usk)
        })
        .await
        .map_err(|e| CoreError::Internal(format!("Biometric unlock task failed: {e}")))??;

        let mut guard = self.write_state()?;
        guard.unlocked = Some(unlocked);
        guard.last_activity = Instant::now();
        Ok(Self::build_session_state(&guard, self.biometric.is_available()))
    }

    pub async fn session_verify_biometric_reprompt(
        &self,
        custom_reason: Option<&str>,
    ) -> Result<(), CoreError> {
        let account_enabled = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("No active account".to_string()))?;
            if guard.unlocked.is_none() {
                return Err(CoreError::InvalidState("Vault is locked".to_string()));
            }
            acc.biometric_enabled
        };

        if !account_enabled || !self.biometric.is_available() {
            return Err(CoreError::Biometric(
                "Biometric verification is unavailable".to_string(),
            ));
        }

        let prompt_lang = self
            .app_settings_get()
            .map(|s| s.language)
            .unwrap_or_else(|_| "en".to_string());
        let reason = custom_reason
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| localized_biometric_reason(&prompt_lang, "reprompt"))
            .to_string();

        let biometric = Arc::clone(&self.biometric);
        tokio::task::spawn_blocking(move || biometric.verify_user(&reason))
            .await
            .map_err(|e| CoreError::Internal(format!("Biometric verification task failed: {e}")))?
    }

    pub fn session_lock(&self, _reason: &str) -> Result<(), CoreError> {
        let mut guard = self.write_state()?;
        if guard.account.is_some() {
            guard.unlocked = None;
        }
        Ok(())
    }

    pub fn session_touch_activity(&self) {
        if let Ok(mut guard) = self.write_state() {
            guard.last_activity = Instant::now();
        }
    }

    pub fn check_auto_lock(&self) -> Result<bool, CoreError> {
        let mut guard = self.write_state()?;
        if guard.unlocked.is_none() {
            return Ok(false);
        }
        let mins = guard
            .account
            .as_ref()
            .map(|a| a.auto_lock_minutes)
            .unwrap_or(15);
        if mins == 0 {
            return Ok(false);
        }
        if guard.last_activity.elapsed().as_secs() >= (mins as u64) * 60 {
            guard.unlocked = None;
            return Ok(true);
        }
        Ok(false)
    }

    // --- Vaults ---

    pub fn vault_list(&self) -> Result<Vec<Vault>, CoreError> {
        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;
        Ok(unlocked.vaults.clone())
    }

    pub async fn vault_create(
        &self,
        name: &str,
        color: Option<&str>,
        icon: Option<&str>,
    ) -> Result<Vault, CoreError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Validation("保险库名称不能为空".to_string()));
        }
        let color_str = color.unwrap_or("#0572EC");
        let icon_str = icon.unwrap_or("folder");

        let (mut account, name_enc) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let enc = encode_vault_name(trimmed, icon_str, color_str, &unlocked.usk)?;
            (acc, enc)
        };

        let mut id = new_uuid();
        let mut revision_date = Utc::now().to_rfc3339();
        let mut dirty_op = Some("create".to_string());

        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let name_enc_clone = name_enc.clone();
            if let Ok(remote) = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let name_enc = name_enc_clone.clone();
                    async move { client.create_folder(&server_url, &tok, &name_enc).await }
                })
                .await
            {
                id = remote.id;
                if let Some(rev) = remote.revision_date {
                    revision_date = rev;
                }
                dirty_op = None;
            }
        }

        self.storage.upsert_vault(&StoredVault {
            id: id.clone(),
            account_id: account.id.clone(),
            name_enc,
            revision_date,
            dirty_op,
            is_organization: false,
            organization_id: None,
        })?;

        let vault = Vault {
            id,
            name: trimmed.to_string(),
            icon: icon_str.to_string(),
            color: color_str.to_string(),
            is_default: false,
            is_organization: false,
            item_count: 0,
        };

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.vaults.push(vault.clone());
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(vault)
    }

    pub async fn vault_rename(&self, id: &str, name: &str) -> Result<Vault, CoreError> {
        if id == DEFAULT_PERSONAL_VAULT_ID {
            return Err(CoreError::Validation("默认保险库不支持重命名".to_string()));
        }
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Validation("保险库名称不能为空".to_string()));
        }

        let (mut account, mut target, name_enc) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let found = unlocked
                .vaults
                .iter()
                .find(|v| v.id == id)
                .cloned()
                .ok_or_else(|| CoreError::NotFound("保险库不存在".to_string()))?;
            if found.is_organization {
                return Err(CoreError::Validation("组织集合不支持客户端重命名".to_string()));
            }
            let enc = encode_vault_name(trimmed, &found.icon, &found.color, &unlocked.usk)?;
            (acc, found, enc)
        };

        target.name = trimmed.to_string();
        let mut revision_date = Utc::now().to_rfc3339();
        let mut dirty_op = Some("update".to_string());

        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            let name_enc_clone = name_enc.clone();
            if let Ok(remote) = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let id = id_owned.clone();
                    let name_enc = name_enc_clone.clone();
                    async move { client.update_folder(&server_url, &tok, &id, &name_enc).await }
                })
                .await
            {
                if let Some(rev) = remote.revision_date {
                    revision_date = rev;
                }
                dirty_op = None;
            }
        }

        self.storage.upsert_vault(&StoredVault {
            id: id.to_string(),
            account_id: account.id.clone(),
            name_enc,
            revision_date,
            dirty_op,
            is_organization: false,
            organization_id: None,
        })?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            if let Some(v) = unlocked.vaults.iter_mut().find(|v| v.id == id) {
                v.name = target.name.clone();
                target = v.clone();
            }
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(target)
    }

    pub async fn vault_delete(&self, id: &str) -> Result<(), CoreError> {
        if id == DEFAULT_PERSONAL_VAULT_ID {
            return Err(CoreError::Validation("默认保险库不可删除".to_string()));
        }

        let (mut account, affected_ciphers) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let found = unlocked
                .vaults
                .iter()
                .find(|v| v.id == id)
                .ok_or_else(|| CoreError::NotFound("保险库不存在".to_string()))?;
            if found.is_organization {
                return Err(CoreError::Validation("组织集合不可在此删除".to_string()));
            }
            let affected: Vec<CipherDto> = unlocked
                .ciphers
                .values()
                .filter(|c| c.folder_id.as_deref() == Some(id))
                .cloned()
                .collect();
            (acc, affected)
        };

        for mut c in affected_ciphers {
            c.folder_id = None;
            let _ = self.storage.upsert_cipher(&account.id, &c, Some("update"));
        }

        let mut deleted_remotely = false;
        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            if self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let id = id_owned.clone();
                    async move { client.delete_folder(&server_url, &tok, &id).await }
                })
                .await
                .is_ok()
            {
                deleted_remotely = true;
            }
        }

        if deleted_remotely {
            self.storage.delete_vault_row(id)?;
        } else {
            self.storage.upsert_vault(&StoredVault {
                id: id.to_string(),
                account_id: account.id.clone(),
                name_enc: String::new(),
                revision_date: Utc::now().to_rfc3339(),
                dirty_op: Some("delete".to_string()),
                is_organization: false,
                organization_id: None,
            })?;
        }

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.vaults.retain(|v| v.id != id);
            for item in unlocked.items.values_mut() {
                if item.vault_id == id {
                    item.vault_id = DEFAULT_PERSONAL_VAULT_ID.to_string();
                }
            }
            for c in unlocked.ciphers.values_mut() {
                if c.folder_id.as_deref() == Some(id) {
                    c.folder_id = None;
                }
            }
            Self::recompute_vault_counts(unlocked);
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(())
    }

    // --- Items ---

    pub fn item_list(&self, filter: ItemFilter) -> Result<Vec<ItemSummary>, CoreError> {
        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;

        let all_items: Vec<ItemDetail> = unlocked.items.values().cloned().collect();
        let report = run_watchtower_audit(
            &all_items,
            unlocked.hibp_breached.as_ref(),
            unlocked.hibp_checked_at.clone(),
        );

        let want_trashed = filter.trashed.unwrap_or(false);
        let want_archived = filter.archived.unwrap_or(false);
        let trimmed_query = filter.query.as_deref().map(str::trim).unwrap_or("");
        let mut filtered: Vec<(&ItemDetail, u32)> = all_items
            .iter()
            .filter_map(|item| {
                let is_trashed = item.deleted_at.is_some();
                if want_trashed {
                    if !is_trashed {
                        return None;
                    }
                } else {
                    if is_trashed {
                        return None;
                    }
                    if item.payload.archived != want_archived {
                        return None;
                    }
                }

                if let Some(vid) = &filter.vault_id {
                    if !vid.is_empty() && &item.vault_id != vid {
                        return None;
                    }
                }
                if let Some(cat) = filter.category {
                    if item.payload.category != cat {
                        return None;
                    }
                }
                if filter.favorite == Some(true) && !item.favorite {
                    return None;
                }
                if filter.passkey_only == Some(true)
                    && item.payload.passkeys.is_empty()
                    && item.payload.category != ItemCategory::Passkey
                {
                    return None;
                }
                if let Some(tag) = &filter.tag {
                    if !tag.is_empty() && !item.payload.tags.iter().any(|t| t == tag) {
                        return None;
                    }
                }
                if let Some(issue) = filter.watchtower_issue {
                    let has_issue = report
                        .item_issues
                        .get(&item.id)
                        .map(|list| list.contains(&issue))
                        .unwrap_or(false);
                    if !has_issue {
                        return None;
                    }
                }
                let score = if trimmed_query.is_empty() {
                    0
                } else {
                    score_search_query(item, &unlocked.vaults, trimmed_query)?
                };
                Some((item, score))
            })
            .collect();

        let sort_by = filter.sort_by.unwrap_or(SortBy::TitleAsc);
        filtered.sort_by(|(a, score_a), (b, score_b)| {
            if !trimmed_query.is_empty() && score_a != score_b {
                return score_b.cmp(score_a);
            }
            match sort_by {
                SortBy::TitleDesc => b.title.to_lowercase().cmp(&a.title.to_lowercase()),
                SortBy::UpdatedDesc => b.payload.updated_at.cmp(&a.payload.updated_at),
                SortBy::CreatedDesc => b.payload.created_at.cmp(&a.payload.created_at),
                SortBy::TitleAsc => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
            }
        });

        Ok(filtered
            .into_iter()
            .map(|(item, _)| {
                let issues = report
                    .item_issues
                    .get(&item.id)
                    .cloned()
                    .unwrap_or_default();
                item_to_summary(item, issues)
            })
            .collect())
    }

    pub fn item_get_all_stats(&self) -> Result<ItemStats, CoreError> {
        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;

        let mut total_count = 0usize;
        let mut favorite_count = 0usize;
        let mut passkey_count = 0usize;
        let mut trash_count = 0usize;
        let mut archived_count = 0usize;
        let mut category_counts: HashMap<String, usize> = HashMap::new();
        let mut tag_map: HashMap<String, usize> = HashMap::new();

        for item in unlocked.items.values() {
            if item.deleted_at.is_some() {
                trash_count += 1;
                continue;
            }
            if item.payload.archived {
                archived_count += 1;
                continue;
            }
            total_count += 1;
            if item.favorite {
                favorite_count += 1;
            }
            if !item.payload.passkeys.is_empty() || item.payload.category == ItemCategory::Passkey {
                passkey_count += 1;
            }
            if let Ok(serde_json::Value::String(cat_key)) =
                serde_json::to_value(item.payload.category)
            {
                *category_counts.entry(cat_key).or_insert(0) += 1;
            }
            for tag in &item.payload.tags {
                *tag_map.entry(tag.clone()).or_insert(0) += 1;
            }
        }

        let mut tag_counts: Vec<TagCount> = tag_map
            .into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect();
        tag_counts.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));

        Ok(ItemStats {
            total_count,
            favorite_count,
            passkey_count,
            trash_count,
            archived_count,
            category_counts,
            tag_counts,
        })
    }

    pub fn item_get(&self, id: &str) -> Result<Option<ItemDetail>, CoreError> {
        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;
        Ok(unlocked.items.get(id).cloned())
    }

    fn item_to_draft(item: &ItemDetail) -> ItemDraft {
        ItemDraft {
            id: Some(item.id.clone()),
            vault_id: item.vault_id.clone(),
            title: item.title.clone(),
            favorite: item.favorite,
            category: item.payload.category,
            subtitle: item.payload.subtitle.clone(),
            icon: item.payload.icon.clone(),
            tags: item.payload.tags.clone(),
            urls: item.payload.urls.clone(),
            sections: item.payload.sections.clone(),
            passkeys: item.payload.passkeys.clone(),
            notes: item.payload.notes.clone(),
            password_history: item.payload.password_history.clone(),
            watchtower: item.payload.watchtower,
            archived: item.payload.archived,
            reprompt: item.payload.reprompt,
        }
    }

    fn preserve_local_fido2_if_stripped(local: &CipherDto, remote: &mut CipherDto) {
        let Some(local_creds) = local
            .login
            .as_ref()
            .map(|l| &l.fido2_credentials)
            .filter(|v| !v.is_empty())
        else {
            return;
        };
        let remote_empty = remote
            .login
            .as_ref()
            .map(|l| l.fido2_credentials.is_empty())
            .unwrap_or(true);
        if remote_empty {
            eprintln!(
                "[keysmith] warning: remote cipher {} omitted fido2Credentials; preserving {} local credential(s)",
                remote.id,
                local_creds.len()
            );
            let mut login = remote.login.take().unwrap_or_default();
            login.fido2_credentials = local_creds.clone();
            remote.login = Some(login);
        }
    }

    pub async fn item_create(&self, draft: ItemDraft) -> Result<ItemDetail, CoreError> {
        let local_id = new_uuid();
        let (mut account, mut cipher, mut item) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let (c, it) = draft_to_cipher(&local_id, &draft, None, None, &unlocked.usk)?;
            (acc, c, it)
        };

        let mut dirty_op = Some("create");
        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let cipher_clone = cipher.clone();
            match self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let cipher = cipher_clone.clone();
                    async move { client.create_cipher(&server_url, &tok, &cipher).await }
                })
                .await
            {
                Ok(mut remote) => {
                    Self::preserve_local_fido2_if_stripped(&cipher, &mut remote);
                    item.id = remote.id.clone();
                    cipher = remote;
                    dirty_op = None;
                }
                Err(err) => {
                    eprintln!("[keysmith] remote create_cipher failed, queued offline create: {err}");
                }
            }
        }

        self.storage.upsert_cipher(&account.id, &cipher, dirty_op)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.ciphers.insert(cipher.id.clone(), cipher);
            unlocked.items.insert(item.id.clone(), item.clone());
            Self::recompute_vault_counts(unlocked);
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(item)
    }

    pub async fn item_update(&self, id: &str, draft: ItemDraft) -> Result<ItemDetail, CoreError> {
        let (mut account, mut cipher, item, was_offline_create, prev_revision_date) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let prev_item = unlocked
                .items
                .get(id)
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            let prev_cipher = unlocked.ciphers.get(id);
            let prev_rev = prev_cipher.and_then(|c| c.revision_date.clone());
            let eff_usk = prev_cipher
                .and_then(|c| c.organization_id.as_ref())
                .and_then(|oid| unlocked.org_keys.get(oid))
                .unwrap_or(&unlocked.usk);
            let (c, it) = draft_to_cipher(id, &draft, prev_cipher, Some(prev_item), eff_usk)?;

            let pending_create = self
                .storage
                .list_ciphers(&acc.id)?
                .into_iter()
                .find(|sc| sc.id == id)
                .and_then(|sc| sc.dirty_op)
                .as_deref()
                == Some("create");

            (acc, c, it, pending_create, prev_rev)
        };

        let mut dirty_op = Some(if was_offline_create { "create" } else { "update" });
        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            let cipher_clone = cipher.clone();
            let res = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let id = id_owned.clone();
                    let cipher = cipher_clone.clone();
                    async move {
                        if was_offline_create {
                            client.create_cipher(&server_url, &tok, &cipher).await
                        } else {
                            client.update_cipher(&server_url, &tok, &id, &cipher).await
                        }
                    }
                })
                .await;
            match res {
                Ok(mut remote) => {
                    Self::preserve_local_fido2_if_stripped(&cipher, &mut remote);
                    cipher = remote;
                    dirty_op = None;
                }
                Err(err) => {
                    eprintln!("[keysmith] remote update_cipher failed, queued offline update: {err}");
                }
            }
        }

        // Preserve base server revision_date when queuing an offline update so sync_now detects true conflicts accurately
        if dirty_op == Some("update") {
            if let Some(prev_rev) = prev_revision_date {
                cipher.revision_date = Some(prev_rev);
            }
        }

        self.storage.upsert_cipher(&account.id, &cipher, dirty_op)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.ciphers.insert(cipher.id.clone(), cipher);
            unlocked.items.insert(item.id.clone(), item.clone());
            Self::recompute_vault_counts(unlocked);
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(item)
    }

    pub async fn item_duplicate(&self, id: &str) -> Result<ItemDetail, CoreError> {
        let mut draft = {
            let guard = self.read_state()?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let item = unlocked
                .items
                .get(id)
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            Self::item_to_draft(item)
        };
        draft.id = None;
        draft.title = format!("{} (副本)", draft.title);
        draft.archived = false;
        draft.passkeys.clear(); // Passkey private keys should not be accidentally cloned
        self.item_create(draft).await
    }

    pub async fn item_set_archived(
        &self,
        id: &str,
        archived: bool,
    ) -> Result<ItemDetail, CoreError> {
        let mut draft = {
            let guard = self.read_state()?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let item = unlocked
                .items
                .get(id)
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            Self::item_to_draft(item)
        };
        draft.archived = archived;
        self.item_update(id, draft).await
    }

    pub async fn item_move_vault(
        &self,
        ids: &[String],
        target_vault_id: &str,
    ) -> Result<usize, CoreError> {
        let drafts: Vec<(String, ItemDraft)> = {
            let guard = self.read_state()?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            if !unlocked.vaults.iter().any(|v| v.id == target_vault_id) {
                return Err(CoreError::NotFound("目标保险库不存在".to_string()));
            }
            ids.iter()
                .filter_map(|id| {
                    unlocked.items.get(id).map(|it| {
                        let mut d = Self::item_to_draft(it);
                        d.vault_id = target_vault_id.to_string();
                        (id.clone(), d)
                    })
                })
                .collect()
        };

        let mut count = 0;
        for (id, draft) in drafts {
            self.item_update(&id, draft).await?;
            count += 1;
        }
        Ok(count)
    }

    pub async fn item_batch_trash(&self, ids: &[String]) -> Result<usize, CoreError> {
        let mut count = 0;
        for id in ids {
            if self.item_trash(id).await.is_ok() {
                count += 1;
            }
        }
        Ok(count)
    }

    pub async fn item_batch_add_tag(&self, ids: &[String], tag: &str) -> Result<usize, CoreError> {
        let clean_tag = tag.trim();
        if clean_tag.is_empty() {
            return Err(CoreError::Validation("标签不能为空".to_string()));
        }

        let drafts: Vec<(String, ItemDraft)> = {
            let guard = self.read_state()?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            ids.iter()
                .filter_map(|id| {
                    unlocked.items.get(id).map(|it| {
                        let mut d = Self::item_to_draft(it);
                        if !d.tags.iter().any(|t| t == clean_tag) {
                            d.tags.push(clean_tag.to_string());
                        }
                        (id.clone(), d)
                    })
                })
                .collect()
        };

        let mut count = 0;
        for (id, draft) in drafts {
            self.item_update(&id, draft).await?;
            count += 1;
        }
        Ok(count)
    }

    pub async fn item_update_watchtower_flags(
        &self,
        id: &str,
        patch: WatchtowerFlagsPatch,
    ) -> Result<ItemDetail, CoreError> {
        let mut draft = {
            let guard = self.read_state()?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let item = unlocked
                .items
                .get(id)
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            Self::item_to_draft(item)
        };
        if let Some(v) = patch.ignore_weak {
            draft.watchtower.ignore_weak = v;
        }
        if let Some(v) = patch.ignore_reused {
            draft.watchtower.ignore_reused = v;
        }
        if let Some(v) = patch.ignore_missing_2fa {
            draft.watchtower.ignore_missing_2fa = v;
        }
        if let Some(v) = patch.ignore_unsecured_url {
            draft.watchtower.ignore_unsecured_url = v;
        }
        self.item_update(id, draft).await
    }

    pub async fn item_toggle_favorite(
        &self,
        id: &str,
        favorite: bool,
    ) -> Result<ItemDetail, CoreError> {
        let mut draft = {
            let guard = self.read_state()?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let item = unlocked
                .items
                .get(id)
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            Self::item_to_draft(item)
        };
        draft.favorite = favorite;
        self.item_update(id, draft).await
    }

    pub async fn item_trash(&self, id: &str) -> Result<(), CoreError> {
        let (mut account, mut cipher) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let c = unlocked
                .ciphers
                .get(id)
                .cloned()
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            (acc, c)
        };

        let now = Utc::now().to_rfc3339();
        cipher.deleted_date = Some(now.clone());

        let mut dirty_op = Some("trash");
        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            if self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let id = id_owned.clone();
                    async move { client.trash_cipher(&server_url, &tok, &id).await }
                })
                .await
                .is_ok()
            {
                dirty_op = None;
            }
        }

        self.storage.upsert_cipher(&account.id, &cipher, dirty_op)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.ciphers.insert(id.to_string(), cipher);
            if let Some(it) = unlocked.items.get_mut(id) {
                it.deleted_at = Some(now);
            }
            Self::recompute_vault_counts(unlocked);
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(())
    }

    pub async fn item_restore(&self, id: &str) -> Result<(), CoreError> {
        let (mut account, mut cipher) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let c = unlocked
                .ciphers
                .get(id)
                .cloned()
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            (acc, c)
        };

        cipher.deleted_date = None;

        let mut dirty_op = Some("restore");
        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            if let Ok(remote) = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let id = id_owned.clone();
                    async move { client.restore_cipher(&server_url, &tok, &id).await }
                })
                .await
            {
                cipher = remote;
                dirty_op = None;
            }
        }

        self.storage.upsert_cipher(&account.id, &cipher, dirty_op)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.ciphers.insert(id.to_string(), cipher);
            if let Some(it) = unlocked.items.get_mut(id) {
                it.deleted_at = None;
            }
            Self::recompute_vault_counts(unlocked);
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(())
    }

    pub async fn item_delete_permanent(&self, id: &str) -> Result<(), CoreError> {
        let (mut account, cipher_opt) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            (acc, unlocked.ciphers.get(id).cloned())
        };

        let mut deleted_remotely = false;
        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            if self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let id = id_owned.clone();
                    async move { client.delete_cipher_permanent(&server_url, &tok, &id).await }
                })
                .await
                .is_ok()
            {
                deleted_remotely = true;
            }
        }

        if deleted_remotely {
            self.storage.delete_cipher_row(id)?;
        } else if let Some(c) = cipher_opt {
            self.storage.upsert_cipher(&account.id, &c, Some("delete"))?;
        }

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.ciphers.remove(id);
            unlocked.items.remove(id);
            Self::recompute_vault_counts(unlocked);
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(())
    }

    pub async fn item_empty_trash(&self) -> Result<usize, CoreError> {
        let (mut account, trashed) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let list: Vec<(String, Option<CipherDto>)> = unlocked
                .items
                .values()
                .filter(|it| it.deleted_at.is_some())
                .map(|it| (it.id.clone(), unlocked.ciphers.get(&it.id).cloned()))
                .collect();
            (acc, list)
        };

        let mut purged = 0usize;
        let mut removed_ids: Vec<String> = Vec::new();
        for (id, cipher_opt) in trashed {
            let mut deleted_remotely = false;
            if account.access_token.is_some() {
                let client = self.client.clone();
                let server_url = account.server_url.clone();
                let id_owned = id.clone();
                if self
                    .with_fresh_token(&mut account, move |tok| {
                        let client = client.clone();
                        let server_url = server_url.clone();
                        let id = id_owned.clone();
                        async move { client.delete_cipher_permanent(&server_url, &tok, &id).await }
                    })
                    .await
                    .is_ok()
                {
                    deleted_remotely = true;
                }
            }
            if deleted_remotely || account.access_token.is_none() {
                self.storage.delete_cipher_row(&id)?;
            } else if let Some(c) = cipher_opt {
                self.storage.upsert_cipher(&account.id, &c, Some("delete"))?;
            }
            removed_ids.push(id);
            purged += 1;
        }

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            for id in removed_ids {
                unlocked.ciphers.remove(&id);
                unlocked.items.remove(&id);
            }
            Self::recompute_vault_counts(unlocked);
        }
        guard.sync_status.pending_count = self.storage.count_pending_dirty(&account.id)?;
        Ok(purged)
    }

    // --- Sync ---

    pub fn sync_get_status(&self) -> SyncStatus {
        match self.read_state() {
            Ok(g) => g.sync_status.clone(),
            Err(_) => SyncStatus {
                state: SyncStateKind::Error,
                pending_count: 0,
                last_sync_at: String::new(),
                message: Some("状态读取失败".to_string()),
                signalr_connected: false,
            },
        }
    }

    pub async fn sync_now(&self) -> Result<SyncStatus, CoreError> {
        let _sync_guard = self.sync_lock.lock().await;

        let (mut account, usk_opt) = {
            let mut guard = self.write_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            guard.sync_status.state = SyncStateKind::Syncing;
            guard.sync_status.message = None;
            (acc, guard.unlocked.as_ref().map(|u| u.usk.clone()))
        };

        let client = self.client.clone();
        let server_url = account.server_url.clone();
        let mut sync_resp = match self
            .with_fresh_token(&mut account, move |tok| {
                let client = client.clone();
                let server_url = server_url.clone();
                async move { client.sync(&server_url, &tok).await }
            })
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                let mut guard = self.write_state()?;
                guard.sync_status.state = SyncStateKind::Offline;
                guard.sync_status.message = Some(e.to_string());
                return Ok(guard.sync_status.clone());
            }
        };

        // 1. Push dirty vaults
        let dirty_vaults: Vec<StoredVault> = self
            .storage
            .list_vaults(&account.id)?
            .into_iter()
            .filter(|v| v.dirty_op.is_some())
            .collect();

        let mut folder_id_remap: HashMap<String, String> = HashMap::new();
        for sv in dirty_vaults {
            match sv.dirty_op.as_deref() {
                Some("create") => {
                    let client = self.client.clone();
                    let server_url = account.server_url.clone();
                    let name_enc = sv.name_enc.clone();
                    if let Ok(remote) = self
                        .with_fresh_token(&mut account, move |tok| {
                            let client = client.clone();
                            let server_url = server_url.clone();
                            let name_enc = name_enc.clone();
                            async move { client.create_folder(&server_url, &tok, &name_enc).await }
                        })
                        .await
                    {
                        folder_id_remap.insert(sv.id.clone(), remote.id.clone());
                        self.storage.delete_vault_row(&sv.id)?;
                        self.storage.upsert_vault(&StoredVault {
                            id: remote.id,
                            account_id: account.id.clone(),
                            name_enc: remote.name,
                            revision_date: remote.revision_date.unwrap_or_default(),
                            dirty_op: None,
                            is_organization: false,
                            organization_id: None,
                        })?;
                    }
                }
                Some("update") => {
                    let client = self.client.clone();
                    let server_url = account.server_url.clone();
                    let id_owned = sv.id.clone();
                    let name_enc = sv.name_enc.clone();
                    if let Ok(remote) = self
                        .with_fresh_token(&mut account, move |tok| {
                            let client = client.clone();
                            let server_url = server_url.clone();
                            let id = id_owned.clone();
                            let name_enc = name_enc.clone();
                            async move {
                                client.update_folder(&server_url, &tok, &id, &name_enc).await
                            }
                        })
                        .await
                    {
                        self.storage.upsert_vault(&StoredVault {
                            id: remote.id,
                            account_id: account.id.clone(),
                            name_enc: remote.name,
                            revision_date: remote.revision_date.unwrap_or_default(),
                            dirty_op: None,
                            is_organization: false,
                            organization_id: None,
                        })?;
                    }
                }
                Some("delete") => {
                    let client = self.client.clone();
                    let server_url = account.server_url.clone();
                    let id_owned = sv.id.clone();
                    if self
                        .with_fresh_token(&mut account, move |tok| {
                            let client = client.clone();
                            let server_url = server_url.clone();
                            let id = id_owned.clone();
                            async move { client.delete_folder(&server_url, &tok, &id).await }
                        })
                        .await
                        .is_ok()
                    {
                        self.storage.delete_vault_row(&sv.id)?;
                    }
                }
                _ => {}
            }
        }

        // 2. Push dirty ciphers with conflict copy preservation
        let remote_by_id: HashMap<String, CipherDto> = sync_resp
            .ciphers
            .iter()
            .cloned()
            .map(|c| (c.id.clone(), c))
            .collect();

        let dirty_ciphers: Vec<StoredCipher> = self
            .storage
            .list_ciphers(&account.id)?
            .into_iter()
            .filter(|c| c.dirty_op.is_some())
            .collect();

        let pushed_any = !dirty_ciphers.is_empty();

        for sc in dirty_ciphers {
            let Ok(mut dto) = serde_json::from_str::<CipherDto>(&sc.raw_json) else {
                continue;
            };
            if let Some(old_fid) = &dto.folder_id {
                if let Some(new_fid) = folder_id_remap.get(old_fid) {
                    dto.folder_id = Some(new_fid.clone());
                }
            }

            match sc.dirty_op.as_deref() {
                Some("create") => {
                    let client = self.client.clone();
                    let server_url = account.server_url.clone();
                    let dto_clone = dto.clone();
                    if let Ok(remote) = self
                        .with_fresh_token(&mut account, move |tok| {
                            let client = client.clone();
                            let server_url = server_url.clone();
                            let dto = dto_clone.clone();
                            async move { client.create_cipher(&server_url, &tok, &dto).await }
                        })
                        .await
                    {
                        self.storage.delete_cipher_row(&sc.id)?;
                        self.storage.upsert_cipher(&account.id, &remote, None)?;
                    }
                }
                Some("update") => {
                    let has_conflict = remote_by_id
                        .get(&dto.id)
                        .and_then(|r| r.revision_date.as_deref())
                        .map(|remote_rev| {
                            remote_rev != sc.revision_date && !sc.revision_date.is_empty()
                        })
                        .unwrap_or(false);

                    if has_conflict {
                        if let Some(usk) = &usk_opt {
                            let orig_title = dto
                                .name
                                .as_deref()
                                .and_then(|n| usk.decrypt_string(n).ok())
                                .map(|z| z.to_string())
                                .unwrap_or_else(|| "未命名条目".to_string());
                            let stamp = Utc::now().format("%Y-%m-%d %H:%M").to_string();
                            let copy_title = format!("{orig_title} (冲突副本 {stamp})");
                            dto.id = new_uuid();
                            dto.name = Some(usk.encrypt_string(&copy_title)?);
                            let client = self.client.clone();
                            let server_url = account.server_url.clone();
                            let dto_clone = dto.clone();
                            if let Ok(copy_remote) = self
                                .with_fresh_token(&mut account, move |tok| {
                                    let client = client.clone();
                                    let server_url = server_url.clone();
                                    let dto = dto_clone.clone();
                                    async move {
                                        client.create_cipher(&server_url, &tok, &dto).await
                                    }
                                })
                                .await
                            {
                                self.storage.upsert_cipher(&account.id, &copy_remote, None)?;
                            }
                        }
                        if let Some(remote_orig) = remote_by_id.get(&sc.id) {
                            self.storage.upsert_cipher(&account.id, remote_orig, None)?;
                        }
                    } else {
                        let client = self.client.clone();
                        let server_url = account.server_url.clone();
                        let dto_clone = dto.clone();
                        if let Ok(remote) = self
                            .with_fresh_token(&mut account, move |tok| {
                                let client = client.clone();
                                let server_url = server_url.clone();
                                let dto = dto_clone.clone();
                                async move {
                                    client
                                        .update_cipher(&server_url, &tok, &dto.id, &dto)
                                        .await
                                }
                            })
                            .await
                        {
                            self.storage.upsert_cipher(&account.id, &remote, None)?;
                        }
                    }
                }
                Some("trash") => {
                    let client = self.client.clone();
                    let server_url = account.server_url.clone();
                    let id_owned = dto.id.clone();
                    if self
                        .with_fresh_token(&mut account, move |tok| {
                            let client = client.clone();
                            let server_url = server_url.clone();
                            let id = id_owned.clone();
                            async move { client.trash_cipher(&server_url, &tok, &id).await }
                        })
                        .await
                        .is_ok()
                    {
                        self.storage.upsert_cipher(&account.id, &dto, None)?;
                    }
                }
                Some("restore") => {
                    let client = self.client.clone();
                    let server_url = account.server_url.clone();
                    let id_owned = dto.id.clone();
                    if let Ok(remote) = self
                        .with_fresh_token(&mut account, move |tok| {
                            let client = client.clone();
                            let server_url = server_url.clone();
                            let id = id_owned.clone();
                            async move { client.restore_cipher(&server_url, &tok, &id).await }
                        })
                        .await
                    {
                        self.storage.upsert_cipher(&account.id, &remote, None)?;
                    }
                }
                Some("delete") => {
                    let client = self.client.clone();
                    let server_url = account.server_url.clone();
                    let id_owned = dto.id.clone();
                    if self
                        .with_fresh_token(&mut account, move |tok| {
                            let client = client.clone();
                            let server_url = server_url.clone();
                            let id = id_owned.clone();
                            async move {
                                client
                                    .delete_cipher_permanent(&server_url, &tok, &id)
                                    .await
                            }
                        })
                        .await
                        .is_ok()
                    {
                        self.storage.delete_cipher_row(&dto.id)?;
                    }
                }
                _ => {}
            }
        }

        if pushed_any {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            if let Ok(fresh) = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    async move { client.sync(&server_url, &tok).await }
                })
                .await
            {
                sync_resp = fresh;
            }
        }

        let now = Utc::now().to_rfc3339();
        account.last_sync_at = Some(now.clone());

        let storage = self.storage.clone();
        let account_clone = account.clone();
        let folders = sync_resp.folders;
        let collections = sync_resp.collections;
        let ciphers = sync_resp.ciphers;
        let sends = sync_resp.sends;
        let orgs: Vec<OrganizationDto> = if !sync_resp.organizations.is_empty() {
            sync_resp.organizations
        } else {
            sync_resp.profile.organizations
        };

        let (pending_count, refreshed_unlocked) = tokio::task::spawn_blocking(move || {
            storage.replace_synced_organizations(&account_clone.id, &orgs)?;
            storage.replace_synced_vaults_clean(&account_clone.id, &folders, &collections)?;
            storage.replace_synced_ciphers_clean(&account_clone.id, &ciphers)?;
            storage.replace_synced_sends(&account_clone.id, &sends)?;
            storage.upsert_account(&account_clone)?;
            let pending = storage.count_pending_dirty(&account_clone.id)?;
            let unlocked = match usk_opt {
                Some(usk) => Some(Self::load_unlocked_from_storage_sync(
                    &storage,
                    &account_clone.id,
                    &account_clone.server_url,
                    usk,
                )?),
                None => None,
            };
            Ok::<_, CoreError>((pending, unlocked))
        })
        .await
        .map_err(|e| CoreError::Internal(format!("同步落盘与解密失败: {e}")))??;

        let mut guard = self.write_state()?;
        let signalr_connected = guard.sync_status.signalr_connected;
        guard.account = Some(account);
        if let Some(u) = refreshed_unlocked {
            guard.unlocked = Some(u);
        }
        guard.sync_status = SyncStatus {
            state: SyncStateKind::Idle,
            pending_count,
            last_sync_at: now,
            message: None,
            signalr_connected,
        };
        Ok(guard.sync_status.clone())
    }

    // --- TOTP / QR / Generator / History / SSH / Watchtower / Clipboard ---

    pub fn totp_compute(&self, secret_or_uri: &str) -> Result<TotpCode, CoreError> {
        compute_totp(secret_or_uri)
    }

    pub fn totp_parse_qr_image(&self, image_base64: &str) -> Result<String, CoreError> {
        parse_totp_qr_image(image_base64)
    }

    pub fn generator_generate(&self, options: GeneratorOptions) -> GeneratorResult {
        generate_secret(&options)
    }

    pub fn generator_history_list(&self) -> Result<Vec<GeneratorHistoryEntry>, CoreError> {
        let guard = self.read_state()?;
        let acc = guard
            .account
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;

        let rows = self.storage.list_generator_history(&acc.id)?;
        let mut entries = Vec::with_capacity(rows.len());
        for row in rows {
            let value = unlocked
                .usk
                .decrypt_string(&row.value_enc)
                .map(|z| z.to_string())?;
            let source = match row.source_enc {
                Some(enc) => Some(unlocked.usk.decrypt_string(&enc).map(|z| z.to_string())?),
                None => None,
            };
            entries.push(GeneratorHistoryEntry {
                id: row.id,
                value,
                mode: row.mode,
                entropy_bits: row.entropy_bits,
                source,
                created_at: row.created_at,
            });
        }
        Ok(entries)
    }

    pub fn generator_history_record(
        &self,
        value: &str,
        mode: &str,
        entropy_bits: u32,
        source: Option<&str>,
    ) -> Result<GeneratorHistoryEntry, CoreError> {
        if value.is_empty() {
            return Err(CoreError::Validation("生成密码内容不能为空".to_string()));
        }
        let guard = self.read_state()?;
        let acc = guard
            .account
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;

        let id = new_uuid();
        let created_at = Utc::now().to_rfc3339();
        let value_enc = unlocked.usk.encrypt_string(value)?;
        let source_clean = source.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let source_enc = match &source_clean {
            Some(s) => Some(unlocked.usk.encrypt_string(s)?),
            None => None,
        };

        self.storage.insert_generator_history(&StoredGeneratorHistory {
            id: id.clone(),
            account_id: acc.id.clone(),
            value_enc,
            mode: mode.to_string(),
            entropy_bits,
            source_enc,
            created_at: created_at.clone(),
        })?;

        Ok(GeneratorHistoryEntry {
            id,
            value: value.to_string(),
            mode: mode.to_string(),
            entropy_bits,
            source: source_clean,
            created_at,
        })
    }

    pub fn generator_history_clear(&self) -> Result<(), CoreError> {
        let guard = self.read_state()?;
        let acc = guard
            .account
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        if guard.unlocked.is_none() {
            return Err(CoreError::InvalidState("保险库已锁定，请先解锁".to_string()));
        }
        self.storage.clear_generator_history(&acc.id)
    }

    // --- Attachments ---

    pub async fn attachment_upload(
        &self,
        item_id: &str,
        file_name: &str,
        data_base64: &str,
    ) -> Result<ItemAttachment, CoreError> {
        let clean_name = file_name.trim();
        if clean_name.is_empty() {
            return Err(CoreError::Validation("附件文件名不能为空".to_string()));
        }
        let raw_b64 = data_base64
            .trim()
            .split_once("base64,")
            .map(|(_, rest)| rest)
            .unwrap_or_else(|| data_base64.trim());
        let raw_bytes = B64
            .decode(raw_b64)
            .map_err(|e| CoreError::Validation(format!("附件 Base64 解码失败: {e}")))?;

        let (mut account, usk, item) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let item = unlocked
                .items
                .get(item_id)
                .cloned()
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            (acc, unlocked.usk.clone(), item)
        };

        let size = raw_bytes.len() as u64;
        let file_name_enc = usk.encrypt_string(clean_name)?;

        // Attempt remote Vaultwarden attachment upload when online
        let mut uploaded_att: Option<ItemAttachment> = None;
        if account.access_token.is_some() {
            let att_key = UserSymmetricKey::generate();
            let att_key_enc = encrypt_bytes(&*att_key.to_bytes(), usk.enc_key(), usk.mac_key())?;
            let enc_data_str = encrypt_bytes(&raw_bytes, att_key.enc_key(), att_key.mac_key())?;
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let cid = item_id.to_string();
            let fname_enc_c = file_name_enc.clone();
            if let Ok(remote_cipher) = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let cid = cid.clone();
                    let fname_enc = fname_enc_c.clone();
                    let att_key_enc = att_key_enc.clone();
                    let bytes = enc_data_str.as_bytes().to_vec();
                    async move {
                        client
                            .upload_attachment(&server_url, &tok, &cid, &fname_enc, &att_key_enc, bytes)
                            .await
                    }
                })
                .await
            {
                if let Some(last) = remote_cipher.attachments.last() {
                    uploaded_att = Some(ItemAttachment {
                        id: last.id.clone(),
                        file_name: clean_name.to_string(),
                        size,
                        size_name: format_size_bytes(size),
                        has_local_data: false,
                    });
                }
                self.storage.upsert_cipher(&account.id, &remote_cipher, None)?;
                let mut guard = self.write_state()?;
                if let Some(unlocked) = &mut guard.unlocked {
                    unlocked
                        .ciphers
                        .insert(remote_cipher.id.clone(), remote_cipher);
                }
            }
        }

        let att = if let Some(remote) = uploaded_att {
            remote
        } else {
            let att_id = new_uuid();
            let data_enc = encrypt_bytes(&raw_bytes, usk.enc_key(), usk.mac_key())?;
            self.storage.upsert_local_attachment(&StoredLocalAttachment {
                id: att_id.clone(),
                account_id: account.id.clone(),
                cipher_id: item_id.to_string(),
                file_name_enc,
                data_enc,
                size,
                created_at: Utc::now().to_rfc3339(),
            })?;
            ItemAttachment {
                id: att_id,
                file_name: clean_name.to_string(),
                size,
                size_name: format_size_bytes(size),
                has_local_data: true,
            }
        };

        // Persist attachment reference in ItemPayload & update in-memory item
        let mut next_item = item;
        next_item.payload.attachments.push(att.clone());
        let draft = Self::item_to_draft(&next_item);
        {
            let mut guard = self.write_state()?;
            if let Some(unlocked) = &mut guard.unlocked {
                if let Some(it) = unlocked.items.get_mut(item_id) {
                    it.payload.attachments = next_item.payload.attachments.clone();
                }
            }
        }
        let _ = self.item_update(item_id, draft).await;

        Ok(att)
    }

    pub async fn attachment_download(
        &self,
        item_id: &str,
        attachment_id: &str,
    ) -> Result<AttachmentDownloadResult, CoreError> {
        let (mut account, usk, att_meta, remote_dto) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let item = unlocked
                .items
                .get(item_id)
                .ok_or_else(|| CoreError::NotFound("条目不存在".to_string()))?;
            let meta = item
                .payload
                .attachments
                .iter()
                .find(|a| a.id == attachment_id)
                .cloned();
            let r_dto = unlocked
                .ciphers
                .get(item_id)
                .and_then(|c| c.attachments.iter().find(|a| a.id == attachment_id))
                .cloned();
            (acc, unlocked.usk.clone(), meta, r_dto)
        };

        if let Some(local) = self.storage.get_local_attachment(&account.id, attachment_id)? {
            let file_name = usk.decrypt_string(&local.file_name_enc)?.to_string();
            let pt = decrypt_bytes(&local.data_enc, usk.enc_key(), usk.mac_key())?;
            return Ok(AttachmentDownloadResult {
                mime_type: guess_mime_from_filename(&file_name),
                file_name,
                data_base64: B64.encode(&*pt),
            });
        }

        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let cid = item_id.to_string();
            let aid = attachment_id.to_string();
            let direct_url = remote_dto.as_ref().and_then(|d| d.url.clone());

            let bytes = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let cid = cid.clone();
                    let aid = aid.clone();
                    let direct_url = direct_url.clone();
                    async move {
                        client
                            .fetch_attachment_bytes(&server_url, &tok, &cid, &aid, direct_url.as_deref())
                            .await
                    }
                })
                .await?;

            let dec_bytes = if let Some(key_enc) = remote_dto.as_ref().and_then(|d| d.key.as_deref())
            {
                let att_key_bytes = decrypt_bytes(key_enc, usk.enc_key(), usk.mac_key())?;
                let att_key = UserSymmetricKey::from_bytes(&att_key_bytes)?;
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    if text.starts_with("2.") || text.starts_with("0.") {
                        decrypt_bytes(text, att_key.enc_key(), att_key.mac_key())?.to_vec()
                    } else {
                        bytes
                    }
                } else {
                    bytes
                }
            } else {
                bytes
            };

            let file_name = att_meta
                .map(|m| m.file_name)
                .unwrap_or_else(|| format!("attachment-{attachment_id}"));
            return Ok(AttachmentDownloadResult {
                mime_type: guess_mime_from_filename(&file_name),
                file_name,
                data_base64: B64.encode(&dec_bytes),
            });
        }

        Err(CoreError::NotFound("附件不存在或离线不可用".to_string()))
    }

    pub async fn attachment_delete(
        &self,
        item_id: &str,
        attachment_id: &str,
    ) -> Result<(), CoreError> {
        let mut account = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            if guard.unlocked.is_none() {
                return Err(CoreError::InvalidState("保险库已锁定".to_string()));
            }
            acc
        };

        self.storage
            .delete_local_attachment(&account.id, attachment_id)?;

        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let cid = item_id.to_string();
            let aid = attachment_id.to_string();
            let _ = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    let cid = cid.clone();
                    let aid = aid.clone();
                    async move {
                        client
                            .delete_attachment(&server_url, &tok, &cid, &aid)
                            .await
                    }
                })
                .await;
        }

        let maybe_draft = {
            let mut guard = self.write_state()?;
            if let Some(unlocked) = &mut guard.unlocked {
                if let Some(c) = unlocked.ciphers.get_mut(item_id) {
                    c.attachments.retain(|a| a.id != attachment_id);
                }
                if let Some(it) = unlocked.items.get_mut(item_id) {
                    it.payload.attachments.retain(|a| a.id != attachment_id);
                    Some(Self::item_to_draft(it))
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(draft) = maybe_draft {
            let _ = self.item_update(item_id, draft).await;
        }
        Ok(())
    }

    // --- SSH Keys ---

    pub fn ssh_generate_ed25519(&self, comment: Option<&str>) -> Result<SshKeyPair, CoreError> {
        ssh_generate_ed25519(comment)
    }

    pub fn ssh_sign_ed25519(
        &self,
        private_key_openssh: &str,
        data: &[u8],
    ) -> Result<Vec<u8>, CoreError> {
        ssh_sign_ed25519(private_key_openssh, data)
    }

    pub fn ssh_list_identities(&self) -> Result<Vec<SshIdentity>, CoreError> {
        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;

        let mut identities = Vec::new();
        for item in unlocked.items.values() {
            if item.deleted_at.is_some() || item.payload.archived {
                continue;
            }
            if item.payload.category != ItemCategory::SshKey {
                continue;
            }
            let all_fields: Vec<_> = item
                .payload
                .sections
                .iter()
                .flat_map(|s| s.fields.iter())
                .collect();
            let pub_key = all_fields
                .iter()
                .find(|f| f.field_type == FieldType::SshPublicKey && !f.value.trim().is_empty())
                .map(|f| f.value.trim().to_string());
            if let Some(pk) = pub_key {
                let fp = ssh_fingerprint_from_public(&pk).unwrap_or_default();
                identities.push(SshIdentity {
                    item_id: item.id.clone(),
                    title: item.title.clone(),
                    public_key: pk,
                    fingerprint_sha256: fp,
                });
            }
        }
        Ok(identities)
    }

    // --- Favicon ---

    pub async fn favicon_fetch(&self, host: &str) -> Result<Option<String>, CoreError> {
        let clean_host = host
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();

        if clean_host.is_empty()
            || clean_host == "localhost"
            || clean_host == "127.0.0.1"
            || !clean_host.contains('.')
        {
            return Ok(None);
        }

        let (favicon_enabled, server_url) = {
            let guard = self.read_state()?;
            match &guard.account {
                Some(acc) => (acc.favicon_enabled, Some(acc.server_url.clone())),
                None => (true, None),
            }
        };

        if !favicon_enabled {
            return Ok(None);
        }

        if let Some((data_uri, fetched_at)) = self.storage.get_favicon_cache(&clean_host)? {
            if let Ok(dt) = DateTime::parse_from_rfc3339(&fetched_at) {
                if Utc::now().signed_duration_since(dt.with_timezone(&Utc)) < Duration::days(7) {
                    return Ok(Some(data_uri));
                }
            }
        }

        let mut candidates = Vec::new();
        if let Some(base) = server_url {
            if let Ok(norm) = VaultwardenClient::normalize_base_url(&base) {
                candidates.push(format!("{norm}/icons/{clean_host}/icon.png"));
            }
        }
        candidates.push(format!("https://{clean_host}/favicon.ico"));

        for url in candidates {
            if let Some(bytes) = self.client.fetch_favicon_bytes(&url, 64 * 1024).await {
                if let Some(mime) = detect_image_mime(&bytes) {
                    let data_uri = format!("data:{mime};base64,{}", B64.encode(&bytes));
                    let _ = self.storage.upsert_favicon_cache(
                        &clean_host,
                        &data_uri,
                        &Utc::now().to_rfc3339(),
                    );
                    return Ok(Some(data_uri));
                }
            }
        }

        Ok(None)
    }

    // --- Importers & Exporters ---

    pub async fn vault_import(
        &self,
        format: &str,
        data: &str,
        is_base64: bool,
        target_vault_id: Option<&str>,
    ) -> Result<ImportSummary, CoreError> {
        {
            let guard = self.read_state()?;
            if guard.unlocked.is_none() {
                return Err(CoreError::InvalidState("保险库已锁定，请先解锁".to_string()));
            }
        }

        let parsed = parse_import_payload(format, data, is_base64)?;
        let mut vault_name_to_id: HashMap<String, String> = {
            let guard = self.read_state()?;
            guard
                .unlocked
                .as_ref()
                .map(|u| {
                    u.vaults
                        .iter()
                        .map(|v| (v.name.to_lowercase(), v.id.clone()))
                        .collect()
                })
                .unwrap_or_default()
        };

        let mut imported_vaults = 0usize;
        if target_vault_id.is_none() {
            for vname in parsed.vaults {
                let key = vname.to_lowercase();
                if !vault_name_to_id.contains_key(&key) {
                    if let Ok(created) = self.vault_create(&vname, None, None).await {
                        vault_name_to_id.insert(key, created.id);
                        imported_vaults += 1;
                    }
                }
            }
        }

        let mut imported_items = 0usize;
        let mut skipped_items = parsed.skipped_items;
        let mut warnings = parsed.warnings;

        for (opt_vname, mut draft) in parsed.items {
            draft.vault_id = if let Some(tid) = target_vault_id {
                tid.to_string()
            } else if let Some(vn) = opt_vname {
                vault_name_to_id
                    .get(&vn.to_lowercase())
                    .cloned()
                    .unwrap_or_else(|| DEFAULT_PERSONAL_VAULT_ID.to_string())
            } else {
                DEFAULT_PERSONAL_VAULT_ID.to_string()
            };

            match self.item_create(draft).await {
                Ok(_) => imported_items += 1,
                Err(e) => {
                    skipped_items += 1;
                    warnings.push(e.to_string());
                }
            }
        }

        Ok(ImportSummary {
            imported_vaults,
            imported_items,
            skipped_items,
            warnings,
        })
    }

    pub async fn vault_export(
        &self,
        format: &str,
        master_password: &str,
        export_passphrase: Option<&str>,
    ) -> Result<ExportResult, CoreError> {
        if master_password.is_empty() {
            return Err(CoreError::Validation("导出前需要输入主密码验证身份".to_string()));
        }

        let (account, vaults, items, usk) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;
            let items: Vec<ItemDetail> = unlocked.items.values().cloned().collect();
            (acc, unlocked.vaults.clone(), items, unlocked.usk.clone())
        };

        // Verify master password before allowing export
        let kdf = KdfConfig {
            kdf: account.kdf_type,
            kdf_iterations: account.kdf_iterations,
            kdf_memory: account.kdf_memory,
            kdf_parallelism: account.kdf_parallelism,
        };
        let pw_owned = master_password.to_string();
        let email_owned = account.email.clone();
        let protected = account.protected_symmetric_key.clone();
        let fmt = format.to_string();
        let pass_owned = export_passphrase.map(|s| s.to_string());

        let (file_name, content) = tokio::task::spawn_blocking(move || {
            let mk = derive_master_key(&pw_owned, &email_owned, &kdf)?;
            let smk = stretch_master_key(&mk)?;
            unprotect_user_symmetric_key(&protected, &smk)
                .map_err(|_| CoreError::auth("主密码校验失败，无法导出"))?;
            build_export_content(&fmt, &vaults, &items, &usk, pass_owned.as_deref())
        })
        .await
        .map_err(|e| CoreError::Internal(format!("导出任务执行失败: {e}")))??;

        Ok(ExportResult { file_name, content })
    }

    // --- Watchtower / Clipboard ---

    pub async fn watchtower_scan(&self, check_hibp: bool) -> Result<WatchtowerReport, CoreError> {
        let items: Vec<ItemDetail> = {
            let guard = self.read_state()?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;
            unlocked.items.values().cloned().collect()
        };

        if check_hibp {
            let breached = check_hibp_breached_sha1_hashes(&self.client, &items).await?;
            let now = Utc::now().to_rfc3339();
            let mut guard = self.write_state()?;
            if let Some(unlocked) = &mut guard.unlocked {
                unlocked.hibp_breached = Some(breached);
                unlocked.hibp_checked_at = Some(now);
                return Ok(run_watchtower_audit(
                    &items,
                    unlocked.hibp_breached.as_ref(),
                    unlocked.hibp_checked_at.clone(),
                ));
            }
        }

        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;
        Ok(run_watchtower_audit(
            &items,
            unlocked.hibp_breached.as_ref(),
            unlocked.hibp_checked_at.clone(),
        ))
    }

    pub fn clipboard_copy_secret(
        &self,
        text: &str,
        label: &str,
        is_sensitive: bool,
    ) -> Result<(), CoreError> {
        let clear_after = {
            let guard = self.read_state()?;
            guard
                .account
                .as_ref()
                .map(|a| a.clipboard_clear_seconds)
                .unwrap_or(30)
        };
        self.clipboard
            .copy_secret(text, label, is_sensitive, clear_after)
    }

    pub fn clipboard_clear_now(&self) -> Result<(), CoreError> {
        self.clipboard.clear_now()
    }

    // --- Account Passkeys & Profile ---

    fn account_user_handle(account_id: &str) -> String {
        URL_SAFE_NO_PAD.encode(account_id.as_bytes())
    }

    pub fn account_passkey_list(&self) -> Result<AccountPasskeyListResponse, CoreError> {
        let guard = self.read_state()?;
        let acc = guard
            .account
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        let credentials = self.storage.list_account_passkeys(&acc.id)?;
        Ok(AccountPasskeyListResponse {
            rp_id: KEYSMITH_ACCOUNT_RP_ID.to_string(),
            user_id: Self::account_user_handle(&acc.id),
            credentials,
        })
    }

    pub fn account_passkey_register(
        &self,
        name: &str,
        device_type: &str,
    ) -> Result<AccountPasskey, CoreError> {
        let guard = self.read_state()?;
        let acc = guard
            .account
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        if guard.unlocked.is_none() {
            return Err(CoreError::InvalidState("保险库已锁定，请先解锁".to_string()));
        }

        let mut cred_id_bytes = [0u8; 24];
        OsRng.fill_bytes(&mut cred_id_bytes);
        let cred_id = URL_SAFE_NO_PAD.encode(cred_id_bytes);

        let priv_key = RsaPrivateKey::new(&mut OsRng, 2048)
            .map_err(|e| CoreError::Crypto(format!("生成通行密钥对失败: {e}")))?;
        let spki = priv_key
            .to_public_key()
            .to_public_key_der()
            .map_err(|e| CoreError::Crypto(format!("导出通行密钥公钥失败: {e}")))?;
        let _pkcs8 = priv_key.to_pkcs8_der();

        let is_multi = device_type == "multiDevice";
        let clean_name = if name.trim().is_empty() {
            if is_multi {
                "Mac Touch ID 通行密钥".to_string()
            } else {
                "外置硬件安全密钥".to_string()
            }
        } else {
            name.trim().to_string()
        };

        let pk = AccountPasskey {
            id: cred_id,
            passkey_user_id: Self::account_user_handle(&acc.id),
            credential_public_key: B64.encode(spki.as_bytes()),
            credential_type: "public-key".to_string(),
            credential_device_type: if is_multi {
                "multiDevice".to_string()
            } else {
                "singleDevice".to_string()
            },
            credential_backed_up: is_multi,
            aaguid: if is_multi {
                APPLE_TOUCH_ID_AAGUID.to_string()
            } else {
                YUBIKEY_5_AAGUID.to_string()
            },
            provider_icon: None,
            name: clean_name,
            transports: if is_multi {
                vec!["internal".to_string(), "hybrid".to_string()]
            } else {
                vec!["usb".to_string(), "nfc".to_string()]
            },
            last_used_at: None,
            registered_at: Utc::now().timestamp_millis(),
            counter: 0,
            prf_supported: true,
        };

        self.storage.upsert_account_passkey(&acc.id, &pk)?;
        Ok(pk)
    }

    pub fn account_passkey_rename(&self, id: &str, name: &str) -> Result<AccountPasskey, CoreError> {
        let guard = self.read_state()?;
        let acc = guard
            .account
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        let mut list = self.storage.list_account_passkeys(&acc.id)?;
        let target = list
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| CoreError::NotFound("通行密钥不存在".to_string()))?;
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            target.name = trimmed.to_string();
        }
        let updated = target.clone();
        self.storage.upsert_account_passkey(&acc.id, &updated)?;
        Ok(updated)
    }

    pub fn account_passkey_delete(&self, id: &str) -> Result<(), CoreError> {
        let guard = self.read_state()?;
        let acc = guard
            .account
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        self.storage.delete_account_passkey(&acc.id, id)
    }

    pub fn account_update_profile(
        &self,
        display_name: &str,
    ) -> Result<AccountProfileResponse, CoreError> {
        let mut guard = self.write_state()?;
        let mut acc = guard
            .account
            .clone()
            .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
        let trimmed = display_name.trim();
        if !trimmed.is_empty() {
            acc.display_name = trimmed.to_string();
        }
        self.storage.upsert_account(&acc)?;
        guard.account = Some(acc.clone());
        Ok(AccountProfileResponse {
            rp_id: KEYSMITH_ACCOUNT_RP_ID.to_string(),
            user_id: Self::account_user_handle(&acc.id),
            name: acc.email,
            display_name: acc.display_name,
        })
    }

    // --- Vaultwarden Sends ---

    pub async fn send_list(&self) -> Result<Vec<SendItem>, CoreError> {
        let (mut account, usk) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;
            (acc, unlocked.usk.clone())
        };

        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            if let Ok(remote_sends) = self
                .with_fresh_token(&mut account, move |tok| {
                    let client = client.clone();
                    let server_url = server_url.clone();
                    async move { client.list_sends(&server_url, &tok).await }
                })
                .await
            {
                self.storage.replace_synced_sends(&account.id, &remote_sends)?;
                let mut sends = HashMap::new();
                let mut send_dtos = HashMap::new();
                let mut send_seeds = HashMap::new();
                for dto in remote_sends {
                    if let Ok((item, seed)) = decode_send_dto(&dto, &usk, &account.server_url) {
                        send_dtos.insert(dto.id.clone(), dto);
                        send_seeds.insert(item.id.clone(), seed);
                        sends.insert(item.id.clone(), item);
                    }
                }
                let mut guard = self.write_state()?;
                if let Some(unlocked) = &mut guard.unlocked {
                    unlocked.sends = sends;
                    unlocked.send_dtos = send_dtos;
                    unlocked.send_seeds = send_seeds;
                }
            }
        }

        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("保险库已锁定，请先解锁".to_string()))?;
        let mut out: Vec<SendItem> = unlocked.sends.values().cloned().collect();
        out.sort_by(|a, b| b.revision_date.cmp(&a.revision_date));
        Ok(out)
    }

    pub async fn send_create_text(&self, input: SendCreateTextInput) -> Result<SendItem, CoreError> {
        if input.name.trim().is_empty() {
            return Err(CoreError::Validation("Send 名称不能为空".to_string()));
        }
        if input.text.is_empty() {
            return Err(CoreError::Validation("Send 文本内容不能为空".to_string()));
        }

        let (mut account, usk) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            (acc, unlocked.usk.clone())
        };

        let seed = generate_send_seed();
        let payload = encode_send_payload(
            SendType::Text,
            &input.name,
            input.notes.as_deref(),
            Some((&input.text, input.hidden)),
            None,
            input.max_access_count,
            input.expiration_date.as_deref(),
            &input.deletion_date,
            input.password.as_deref(),
            input.disabled,
            input.hide_email,
            &seed,
            &usk,
        )?;

        let dto = if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let p_clone = payload.clone();
            self.with_fresh_token(&mut account, move |tok| {
                let client = client.clone();
                let server_url = server_url.clone();
                let p = p_clone.clone();
                async move { client.create_text_send(&server_url, &tok, &p).await }
            })
            .await?
        } else {
            let now = Utc::now().to_rfc3339();
            let local_id = new_uuid();
            let access_id = URL_SAFE_NO_PAD.encode(&seed[..8]);
            SendDto {
                id: local_id,
                access_id,
                send_type: 0,
                name: Some(payload.name),
                notes: payload.notes,
                key: Some(payload.key),
                max_access_count: payload.max_access_count,
                access_count: 0,
                revision_date: Some(now),
                expiration_date: payload.expiration_date,
                deletion_date: payload.deletion_date,
                password: payload.password.map(serde_json::Value::String),
                disabled: payload.disabled,
                hide_email: payload.hide_email,
                text: payload.text,
                file: None,
                extra: Default::default(),
            }
        };

        let (item, decoded_seed) = decode_send_dto(&dto, &usk, &account.server_url)?;
        self.storage.upsert_send(&account.id, &dto)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.send_dtos.insert(dto.id.clone(), dto);
            unlocked.send_seeds.insert(item.id.clone(), decoded_seed);
            unlocked.sends.insert(item.id.clone(), item.clone());
        }
        Ok(item)
    }

    pub async fn send_create_file(&self, input: SendCreateFileInput) -> Result<SendItem, CoreError> {
        const MAX_SEND_FILE_BYTES: usize = 10 * 1024 * 1024;
        if input.name.trim().is_empty() {
            return Err(CoreError::Validation("Send 名称不能为空".to_string()));
        }
        let clean_file_name = input.file_name.trim();
        if clean_file_name.is_empty() {
            return Err(CoreError::Validation("文件名不能为空".to_string()));
        }
        let raw_b64 = input
            .data_base64
            .trim()
            .split_once("base64,")
            .map(|(_, rest)| rest)
            .unwrap_or_else(|| input.data_base64.trim());
        let raw_bytes = B64
            .decode(raw_b64)
            .map_err(|e| CoreError::Validation(format!("文件 Base64 解码失败: {e}")))?;
        if raw_bytes.len() > MAX_SEND_FILE_BYTES {
            return Err(CoreError::Validation(
                "文件大小超过客户端上限 (10 MB)".to_string(),
            ));
        }

        let (mut account, usk) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            (acc, unlocked.usk.clone())
        };

        let seed = generate_send_seed();
        let send_key = derive_send_key(&seed)?;
        let enc_bytes = encrypt_send_buffer(&raw_bytes, send_key.enc_key(), send_key.mac_key())?;
        let enc_size = enc_bytes.len() as u64;

        let payload = encode_send_payload(
            SendType::File,
            &input.name,
            input.notes.as_deref(),
            None,
            Some((clean_file_name, enc_size)),
            input.max_access_count,
            input.expiration_date.as_deref(),
            &input.deletion_date,
            input.password.as_deref(),
            input.disabled,
            input.hide_email,
            &seed,
            &usk,
        )?;
        let enc_file_name = payload
            .file
            .as_ref()
            .and_then(|f| f.file_name.clone())
            .unwrap_or_else(|| clean_file_name.to_string());

        let dto = if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let p_clone = payload.clone();
            let fname_clone = enc_file_name.clone();
            let bytes_clone = enc_bytes.clone();
            self.with_fresh_token(&mut account, move |tok| {
                let client = client.clone();
                let server_url = server_url.clone();
                let p = p_clone.clone();
                let fname = fname_clone.clone();
                let bytes = bytes_clone.clone();
                async move {
                    client
                        .create_file_send(&server_url, &tok, &p, &fname, bytes)
                        .await
                }
            })
            .await?
        } else {
            let now = Utc::now().to_rfc3339();
            let local_id = new_uuid();
            let access_id = URL_SAFE_NO_PAD.encode(&seed[..8]);
            SendDto {
                id: local_id,
                access_id,
                send_type: 1,
                name: Some(payload.name),
                notes: payload.notes,
                key: Some(payload.key),
                max_access_count: payload.max_access_count,
                access_count: 0,
                revision_date: Some(now),
                expiration_date: payload.expiration_date,
                deletion_date: payload.deletion_date,
                password: payload.password.map(serde_json::Value::String),
                disabled: payload.disabled,
                hide_email: payload.hide_email,
                text: None,
                file: Some(SendFileDto {
                    id: Some(new_uuid()),
                    file_name: Some(enc_file_name),
                    size: Some(serde_json::Value::from(raw_bytes.len() as u64)),
                    size_name: Some(format_size_bytes(raw_bytes.len() as u64)),
                    extra: Default::default(),
                }),
                extra: Default::default(),
            }
        };

        let (item, decoded_seed) = decode_send_dto(&dto, &usk, &account.server_url)?;
        self.storage.upsert_send(&account.id, &dto)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.send_dtos.insert(dto.id.clone(), dto);
            unlocked.send_seeds.insert(item.id.clone(), decoded_seed);
            unlocked.sends.insert(item.id.clone(), item.clone());
        }
        Ok(item)
    }

    pub async fn send_update(&self, id: &str, input: SendUpdateInput) -> Result<SendItem, CoreError> {
        if input.name.trim().is_empty() {
            return Err(CoreError::Validation("Send 名称不能为空".to_string()));
        }

        let (mut account, usk, existing_item, existing_dto, seed) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let existing = unlocked
                .sends
                .get(id)
                .cloned()
                .ok_or_else(|| CoreError::NotFound("Send 不存在".to_string()))?;
            let dto = unlocked.send_dtos.get(id).cloned();
            let seed = unlocked
                .send_seeds
                .get(id)
                .cloned()
                .unwrap_or_else(generate_send_seed);
            (acc, unlocked.usk.clone(), existing, dto, seed)
        };

        let effective_text = match existing_item.send_type {
            SendType::Text => Some((
                input
                    .text
                    .as_deref()
                    .or(existing_item.text.as_deref())
                    .unwrap_or(""),
                input.hidden.unwrap_or(existing_item.hidden),
            )),
            SendType::File => None,
        };
        let effective_file = match existing_item.send_type {
            SendType::File => Some((
                existing_item.file_name.as_deref().unwrap_or("file.bin"),
                existing_item.file_size.unwrap_or(0),
            )),
            SendType::Text => None,
        };

        let mut payload = encode_send_payload(
            existing_item.send_type,
            &input.name,
            input.notes.as_deref(),
            effective_text.map(|(t, h)| (t, h)),
            effective_file,
            input.max_access_count,
            input.expiration_date.as_deref(),
            &input.deletion_date,
            input.password.as_deref(),
            input.disabled,
            input.hide_email,
            &seed,
            &usk,
        )?;
        payload.file_length = None;

        let dto = if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            let p_clone = payload.clone();
            self.with_fresh_token(&mut account, move |tok| {
                let client = client.clone();
                let server_url = server_url.clone();
                let id = id_owned.clone();
                let p = p_clone.clone();
                async move { client.update_send(&server_url, &tok, &id, &p).await }
            })
            .await?
        } else {
            let mut next = existing_dto.unwrap_or_default();
            next.id = existing_item.id.clone();
            next.access_id = existing_item.access_id.clone();
            next.name = Some(payload.name);
            next.notes = payload.notes;
            next.key = Some(payload.key);
            next.max_access_count = payload.max_access_count;
            next.expiration_date = payload.expiration_date;
            next.deletion_date = payload.deletion_date;
            next.revision_date = Some(Utc::now().to_rfc3339());
            if let Some(pw) = payload.password {
                next.password = Some(serde_json::Value::String(pw));
            }
            next.disabled = payload.disabled;
            next.hide_email = payload.hide_email;
            if payload.text.is_some() {
                next.text = payload.text;
            }
            next
        };

        let (item, decoded_seed) = decode_send_dto(&dto, &usk, &account.server_url)?;
        self.storage.upsert_send(&account.id, &dto)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.send_dtos.insert(dto.id.clone(), dto);
            unlocked.send_seeds.insert(item.id.clone(), decoded_seed);
            unlocked.sends.insert(item.id.clone(), item.clone());
        }
        Ok(item)
    }

    pub async fn send_remove_password(&self, id: &str) -> Result<SendItem, CoreError> {
        let (mut account, usk, existing_dto) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("保险库已锁定".to_string()))?;
            let dto = unlocked
                .send_dtos
                .get(id)
                .cloned()
                .ok_or_else(|| CoreError::NotFound("Send 不存在".to_string()))?;
            (acc, unlocked.usk.clone(), dto)
        };

        let dto = if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            self.with_fresh_token(&mut account, move |tok| {
                let client = client.clone();
                let server_url = server_url.clone();
                let id = id_owned.clone();
                async move { client.remove_send_password(&server_url, &tok, &id).await }
            })
            .await?
        } else {
            let mut next = existing_dto;
            next.password = None;
            next.revision_date = Some(Utc::now().to_rfc3339());
            next
        };

        let (item, decoded_seed) = decode_send_dto(&dto, &usk, &account.server_url)?;
        self.storage.upsert_send(&account.id, &dto)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.send_dtos.insert(dto.id.clone(), dto);
            unlocked.send_seeds.insert(item.id.clone(), decoded_seed);
            unlocked.sends.insert(item.id.clone(), item.clone());
        }
        Ok(item)
    }

    pub async fn send_delete(&self, id: &str) -> Result<(), CoreError> {
        let mut account = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("请先登录".to_string()))?;
            if guard.unlocked.is_none() {
                return Err(CoreError::InvalidState("保险库已锁定".to_string()));
            }
            acc
        };

        if account.access_token.is_some() {
            let client = self.client.clone();
            let server_url = account.server_url.clone();
            let id_owned = id.to_string();
            self.with_fresh_token(&mut account, move |tok| {
                let client = client.clone();
                let server_url = server_url.clone();
                let id = id_owned.clone();
                async move { client.delete_send(&server_url, &tok, &id).await }
            })
            .await?;
        }

        self.storage.delete_send_row(id)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.sends.remove(id);
            unlocked.send_dtos.remove(id);
            unlocked.send_seeds.remove(id);
        }
        Ok(())
    }

    // --- Organizations & Collections ---

    pub fn organization_list(&self) -> Result<Vec<OrganizationInfo>, CoreError> {
        let guard = self.read_state()?;
        let unlocked = guard
            .unlocked
            .as_ref()
            .ok_or_else(|| CoreError::InvalidState("Vault is locked".to_string()))?;
        Ok(unlocked.organizations.clone())
    }

    pub async fn item_share_to_organization(
        &self,
        item_id: &str,
        organization_id: &str,
        collection_ids: Vec<String>,
    ) -> Result<ItemDetail, CoreError> {
        let org_id = organization_id.trim().to_string();
        if org_id.is_empty() || collection_ids.is_empty() {
            return Err(CoreError::Validation(
                "Organization ID and at least one collection are required".to_string(),
            ));
        }

        let (mut account, mut org_cipher, org_usk) = {
            let guard = self.read_state()?;
            let acc = guard
                .account
                .clone()
                .ok_or_else(|| CoreError::InvalidState("No active account".to_string()))?;
            let unlocked = guard
                .unlocked
                .as_ref()
                .ok_or_else(|| CoreError::InvalidState("Vault is locked".to_string()))?;
            let item = unlocked
                .items
                .get(item_id)
                .ok_or_else(|| CoreError::NotFound("Item not found".to_string()))?;
            let org_usk = unlocked
                .org_keys
                .get(&org_id)
                .cloned()
                .ok_or_else(|| {
                    CoreError::Crypto(
                        "Missing decrypted organization symmetric key; re-sync or log in again"
                            .to_string(),
                    )
                })?;
            let draft = Self::item_to_draft(item);
            let (mut c, _) = draft_to_cipher(&item.id, &draft, None, Some(item), &org_usk)?;
            c.organization_id = Some(org_id.clone());
            c.folder_id = None;
            c.collection_ids = collection_ids.clone();
            (acc, c, org_usk)
        };

        if account.access_token.is_none() {
            return Err(CoreError::InvalidState(
                "Sharing to an organization requires server connectivity".to_string(),
            ));
        }

        let client = self.client.clone();
        let server_url = account.server_url.clone();
        let item_id_owned = item_id.to_string();
        let cipher_clone = org_cipher.clone();
        let col_ids_clone = collection_ids.clone();

        org_cipher = self
            .with_fresh_token(&mut account, move |tok| {
                let client = client.clone();
                let server_url = server_url.clone();
                let id = item_id_owned.clone();
                let c = cipher_clone.clone();
                let cols = col_ids_clone.clone();
                async move { client.share_cipher(&server_url, &tok, &id, &c, &cols).await }
            })
            .await?;

        self.storage.upsert_cipher(&account.id, &org_cipher, None)?;
        let updated_item = cipher_to_item(&org_cipher, &org_usk)?;

        let mut guard = self.write_state()?;
        if let Some(unlocked) = &mut guard.unlocked {
            unlocked.ciphers.insert(org_cipher.id.clone(), org_cipher);
            unlocked
                .items
                .insert(updated_item.id.clone(), updated_item.clone());
            Self::recompute_vault_counts(unlocked);
        }
        Ok(updated_item)
    }

    // --- App Settings & Storage Maintenance ---

    pub fn app_settings_get(&self) -> Result<AppSettings, CoreError> {
        let raw = self.storage.get_all_app_settings()?;
        let language = raw
            .get("language")
            .cloned()
            .filter(|v| {
                matches!(
                    v.as_str(),
                    "system" | "en" | "zh-CN" | "zh-TW" | "ja" | "ko" | "de" | "fr" | "es"
                )
            })
            .unwrap_or_else(|| "en".to_string());
        let theme = raw
            .get("theme")
            .cloned()
            .filter(|v| matches!(v.as_str(), "system" | "light" | "dark"))
            .unwrap_or_else(|| "system".to_string());
        let custom_shortcuts = raw
            .get("custom_shortcuts")
            .and_then(|s| serde_json::from_str::<HashMap<String, String>>(s).ok())
            .unwrap_or_default();
        let last_server_url = raw
            .get("last_server_url")
            .cloned()
            .filter(|s| !s.trim().is_empty());

        Ok(AppSettings {
            language,
            theme,
            custom_shortcuts,
            last_server_url,
        })
    }

    pub fn app_settings_update(&self, patch: AppSettingsPatch) -> Result<AppSettings, CoreError> {
        if let Some(lang) = patch.language {
            if matches!(
                lang.as_str(),
                "system" | "en" | "zh-CN" | "zh-TW" | "ja" | "ko" | "de" | "fr" | "es"
            ) {
                self.storage.set_app_setting("language", &lang)?;
            }
        }
        if let Some(theme) = patch.theme {
            if matches!(theme.as_str(), "system" | "light" | "dark") {
                self.storage.set_app_setting("theme", &theme)?;
            }
        }
        if let Some(shortcuts) = patch.custom_shortcuts {
            let json = serde_json::to_string(&shortcuts)
                .map_err(|e| CoreError::Internal(format!("序列化快捷键配置失败: {e}")))?;
            self.storage.set_app_setting("custom_shortcuts", &json)?;
        }
        if let Some(url) = patch.last_server_url {
            self.storage
                .set_app_setting("last_server_url", url.trim())?;
        }
        self.app_settings_get()
    }

    pub fn checkpoint_storage(&self) -> Result<(), CoreError> {
        self.storage.wal_checkpoint()
    }
}

fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        Some("image/x-icon")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        Some("image/svg+xml")
    } else {
        None
    }
}

fn guess_mime_from_filename(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if lower.ends_with(".pdf") {
        "application/pdf".to_string()
    } else if lower.ends_with(".txt") || lower.ends_with(".pem") || lower.ends_with(".key") || lower.ends_with(".pub") {
        "text/plain".to_string()
    } else if lower.ends_with(".json") {
        "application/json".to_string()
    } else {
        "application/octet-stream".to_string()
    }
}
