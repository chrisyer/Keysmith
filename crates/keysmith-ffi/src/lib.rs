pub mod cxf;
pub mod mapper;
pub mod runtime;

use std::path::Path;
use std::sync::Arc;

use zeroize::Zeroizing;

use keysmith_core::domain::{
    domains_are_equivalent, AppSettingsPatch, FieldPurpose, FieldType, GeneratorOptions,
    ImportSummary, ItemCategory, ItemDraft, ItemField, ItemFilter, ItemIcon, ItemSection,
    ItemUrl, SendCreateTextInput, SessionPreferencesPatch, UrlMatchRule, WatchtowerFlags,
    DEFAULT_PERSONAL_VAULT_ID,
};
use keysmith_core::passkey::{
    assert_passkey_with_client_data_hash, create_passkey_with_client_data_hash,
    decode_credential_id_bytes, encode_b64u, normalize_rp_id, now_rfc3339,
    passkey_matches_credential_list, COSE_ALG_EDDSA, COSE_ALG_ES256,
};
use keysmith_core::storage::Storage;
use keysmith_core::traits::{BiometricKeyStore, ClipboardManager};
use keysmith_core::{AppCore, CoreError};

use crate::cxf::{export_cxf_bundle_json, parse_cxf_bundle_to_drafts};
use crate::mapper::{
    build_passkey_candidate, collect_text_insert_candidates, parse_item_draft_preserving_passkeys,
    parse_json, serialize_redacted_item_detail, to_json_string, FfiError, PasskeyCandidateDto,
};
use crate::runtime::FfiRuntime;

uniffi::setup_scaffolding!();

#[uniffi::export(callback_interface)]
pub trait FfiBiometricKeyStore: Send + Sync {
    fn is_available(&self) -> bool;
    fn save_unlock_key(&self, account_id: String, key: Vec<u8>) -> Result<(), FfiError>;
    fn load_unlock_key(&self, account_id: String, reason: String) -> Result<Vec<u8>, FfiError>;
    fn delete_unlock_key(&self, account_id: String) -> Result<(), FfiError>;
    fn verify_user(&self, reason: String) -> Result<(), FfiError>;
}

#[uniffi::export(callback_interface)]
pub trait FfiClipboardManager: Send + Sync {
    fn copy_secret(
        &self,
        text: String,
        label: String,
        is_sensitive: bool,
        clear_after_secs: u64,
    ) -> Result<(), FfiError>;
    fn clear_now(&self) -> Result<(), FfiError>;
}

struct BiometricStoreAdapter {
    inner: Box<dyn FfiBiometricKeyStore>,
}

impl BiometricKeyStore for BiometricStoreAdapter {
    fn is_available(&self) -> bool {
        self.inner.is_available()
    }

    fn save_unlock_key(&self, account_id: &str, key: &[u8]) -> Result<(), CoreError> {
        self.inner
            .save_unlock_key(account_id.to_string(), key.to_vec())
            .map_err(CoreError::from)
    }

    fn load_unlock_key(
        &self,
        account_id: &str,
        reason: &str,
    ) -> Result<Zeroizing<Vec<u8>>, CoreError> {
        self.inner
            .load_unlock_key(account_id.to_string(), reason.to_string())
            .map(Zeroizing::new)
            .map_err(CoreError::from)
    }

    fn delete_unlock_key(&self, account_id: &str) -> Result<(), CoreError> {
        self.inner
            .delete_unlock_key(account_id.to_string())
            .map_err(CoreError::from)
    }

    fn verify_user(&self, reason: &str) -> Result<(), CoreError> {
        self.inner
            .verify_user(reason.to_string())
            .map_err(CoreError::from)
    }
}

struct ClipboardManagerAdapter {
    inner: Box<dyn FfiClipboardManager>,
}

impl ClipboardManager for ClipboardManagerAdapter {
    fn copy_secret(
        &self,
        text: &str,
        label: &str,
        is_sensitive: bool,
        clear_after_secs: u64,
    ) -> Result<(), CoreError> {
        self.inner
            .copy_secret(
                text.to_string(),
                label.to_string(),
                is_sensitive,
                clear_after_secs,
            )
            .map_err(CoreError::from)
    }

    fn clear_now(&self) -> Result<(), CoreError> {
        self.inner.clear_now().map_err(CoreError::from)
    }
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiApplePasskeyRegistration {
    pub credential_id: Vec<u8>,
    pub attestation_object: Vec<u8>,
    pub client_data_hash: Vec<u8>,
    pub item_id: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiApplePasskeyAssertion {
    pub credential_id: Vec<u8>,
    pub user_handle: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
    pub client_data_hash: Vec<u8>,
}

#[derive(uniffi::Object)]
pub struct KeysmithCoreHandle {
    core: AppCore,
    runtime: FfiRuntime,
}

#[uniffi::export]
impl KeysmithCoreHandle {
    #[uniffi::constructor]
    pub fn new(
        db_path: String,
        biometric: Box<dyn FfiBiometricKeyStore>,
        clipboard: Box<dyn FfiClipboardManager>,
        is_extension: bool,
        user_agent: String,
    ) -> Result<Arc<Self>, FfiError> {
        let trimmed_path = db_path.trim();
        let storage = if trimmed_path == ":memory:" {
            Storage::open_in_memory().map_err(FfiError::from)?
        } else {
            if trimmed_path.is_empty() {
                return Err(FfiError::Validation {
                    msg: "数据库路径不能为空".to_string(),
                });
            }
            Storage::open(Path::new(trimmed_path)).map_err(FfiError::from)?
        };
        let runtime = FfiRuntime::new(is_extension)?;
        let bio_arc: Arc<dyn BiometricKeyStore> = Arc::new(BiometricStoreAdapter { inner: biometric });
        let clip_arc: Arc<dyn ClipboardManager> =
            Arc::new(ClipboardManagerAdapter { inner: clipboard });
        let ua_opt = if user_agent.trim().is_empty() {
            None
        } else {
            Some(user_agent)
        };
        let core = AppCore::with_storage_and_client_info(storage, bio_arc, clip_arc, ua_opt)
            .map_err(FfiError::from)?;
        core.set_defer_remote_sync(is_extension);
        Ok(Arc::new(Self { core, runtime }))
    }

    // --- Auth & Server ---

    pub fn auth_check_server_json(
        &self,
        server_url: String,
        allow_insecure_http: bool,
    ) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(
                self.core
                    .auth_check_server_with_policy(&server_url, allow_insecure_http),
            )
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn auth_prelogin_json(
        &self,
        server_url: String,
        email: String,
        allow_insecure_http: bool,
    ) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.auth_prelogin_with_policy(
                &server_url,
                &email,
                allow_insecure_http,
            ))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn auth_login_json(
        &self,
        server_url: String,
        email: String,
        master_password: String,
        two_factor_provider: Option<u8>,
        two_factor_token: Option<String>,
        two_factor_remember: bool,
        allow_insecure_http: bool,
    ) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.auth_login_with_2fa(
                &server_url,
                &email,
                &master_password,
                two_factor_provider,
                two_factor_token.as_deref(),
                two_factor_remember,
                allow_insecure_http,
            ))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn auth_register_json(
        &self,
        server_url: String,
        email: String,
        display_name: String,
        master_password: String,
        hint: Option<String>,
        allow_insecure_http: bool,
    ) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.auth_register_with_hint(
                &server_url,
                &email,
                &display_name,
                &master_password,
                hint.as_deref(),
                None,
                allow_insecure_http,
            ))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn auth_logout(&self, clear_local_cache: bool) -> Result<(), FfiError> {
        self.runtime
            .block_on(self.core.auth_logout(clear_local_cache))
            .map_err(FfiError::from)
    }

    // --- Account ---

    pub fn account_list_json(&self) -> Result<String, FfiError> {
        let res = self.core.account_list().map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn account_switch_json(&self, account_id: String) -> Result<String, FfiError> {
        let res = self
            .core
            .account_switch(&account_id)
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn account_update_profile_json(&self, display_name: String) -> Result<String, FfiError> {
        let res = self
            .core
            .account_update_profile(&display_name)
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    // --- Session & Auto-Lock ---

    pub fn session_get_state_json(&self) -> Result<String, FfiError> {
        let state = self.core.session_get_state();
        to_json_string(&state)
    }

    pub fn session_update_preferences_json(&self, patch_json: String) -> Result<String, FfiError> {
        let patch: SessionPreferencesPatch = parse_json(&patch_json)?;
        let res = self
            .core
            .session_update_preferences(patch)
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn session_unlock_password_json(&self, password: String) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.session_unlock_password(&password))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn session_unlock_biometric_json(&self) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.session_unlock_biometric())
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn session_verify_user_presence(&self, reason: Option<String>) -> Result<(), FfiError> {
        self.runtime
            .block_on(self.core.session_verify_user_presence(reason.as_deref()))
            .map_err(FfiError::from)
    }

    pub fn session_lock(&self, reason: String) -> Result<(), FfiError> {
        self.core.session_lock(&reason).map_err(FfiError::from)
    }

    pub fn session_touch_activity(&self) {
        self.core.session_touch_activity();
    }

    pub fn check_auto_lock(&self) -> Result<bool, FfiError> {
        self.core.check_auto_lock().map_err(FfiError::from)
    }

    // --- Vaults ---

    pub fn vault_list_json(&self) -> Result<String, FfiError> {
        let res = self.core.vault_list().map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn vault_create_json(
        &self,
        name: String,
        icon: Option<String>,
        color: Option<String>,
    ) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(
                self.core
                    .vault_create(&name, color.as_deref(), icon.as_deref()),
            )
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn vault_rename_json(&self, id: String, name: String) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.vault_rename(&id, &name))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn vault_set_travel_safe_json(
        &self,
        id: String,
        travel_safe: bool,
    ) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.vault_set_travel_safe(&id, travel_safe))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn vault_delete(&self, id: String) -> Result<(), FfiError> {
        self.runtime
            .block_on(self.core.vault_delete(&id))
            .map_err(FfiError::from)
    }

    // --- Items ---

    pub fn item_list_json(&self, filter_json: String) -> Result<String, FfiError> {
        let filter: ItemFilter = if filter_json.trim().is_empty() {
            ItemFilter::default()
        } else {
            parse_json(&filter_json)?
        };
        let res = self.core.item_list(filter).map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn item_get_json(&self, id: String) -> Result<String, FfiError> {
        let item = self
            .core
            .item_get(&id)
            .map_err(FfiError::from)?
            .ok_or_else(|| FfiError::Validation {
                msg: format!("未找到条目: {id}"),
            })?;
        serialize_redacted_item_detail(&item)
    }

    pub fn item_create_json(&self, draft_json: String) -> Result<String, FfiError> {
        let draft = parse_item_draft_preserving_passkeys(&draft_json, None)?;
        let item = self
            .runtime
            .block_on(self.core.item_create(draft))
            .map_err(FfiError::from)?;
        serialize_redacted_item_detail(&item)
    }

    pub fn item_update_json(&self, id: String, draft_json: String) -> Result<String, FfiError> {
        let existing = self.core.item_get(&id).map_err(FfiError::from)?;
        let draft = parse_item_draft_preserving_passkeys(&draft_json, existing.as_ref())?;
        let item = self
            .runtime
            .block_on(self.core.item_update(&id, draft))
            .map_err(FfiError::from)?;
        serialize_redacted_item_detail(&item)
    }

    pub fn item_toggle_favorite_json(&self, id: String) -> Result<String, FfiError> {
        let existing = self
            .core
            .item_get(&id)
            .map_err(FfiError::from)?
            .ok_or_else(|| FfiError::Validation {
                msg: format!("未找到条目: {id}"),
            })?;
        let item = self
            .runtime
            .block_on(self.core.item_toggle_favorite(&id, !existing.favorite))
            .map_err(FfiError::from)?;
        serialize_redacted_item_detail(&item)
    }

    pub fn item_trash(&self, id: String) -> Result<(), FfiError> {
        self.runtime
            .block_on(self.core.item_trash(&id))
            .map_err(FfiError::from)
    }

    pub fn item_restore(&self, id: String) -> Result<(), FfiError> {
        self.runtime
            .block_on(self.core.item_restore(&id))
            .map_err(FfiError::from)
    }

    pub fn item_delete_permanent(&self, id: String) -> Result<(), FfiError> {
        self.runtime
            .block_on(self.core.item_delete_permanent(&id))
            .map_err(FfiError::from)
    }

    pub fn item_empty_trash(&self) -> Result<u32, FfiError> {
        self.runtime
            .block_on(self.core.item_empty_trash())
            .map(|n| n as u32)
            .map_err(FfiError::from)
    }

    // --- Sync ---

    pub fn sync_get_status_json(&self) -> Result<String, FfiError> {
        let status = self.core.sync_get_status();
        to_json_string(&status)
    }

    pub fn sync_now_json(&self) -> Result<String, FfiError> {
        let status = self
            .runtime
            .block_on(self.core.sync_now())
            .map_err(FfiError::from)?;
        to_json_string(&status)
    }

    pub fn check_and_sync_if_changed_json(&self, sync_on_unknown: bool) -> Result<String, FfiError> {
        let changed = self
            .runtime
            .block_on(self.core.check_and_sync_if_changed(sync_on_unknown))
            .map_err(FfiError::from)?;
        let status = self.core.sync_get_status();
        let payload = serde_json::json!({
            "changed": changed,
            "status": status,
        });
        to_json_string(&payload)
    }

    // --- TOTP & Generator ---

    pub fn totp_compute_json(&self, secret_or_uri: String) -> Result<String, FfiError> {
        let res = self
            .core
            .totp_compute(&secret_or_uri)
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn totp_parse_qr_image(&self, image_base64: String) -> Result<String, FfiError> {
        self.core
            .totp_parse_qr_image(&image_base64)
            .map_err(FfiError::from)
    }

    pub fn generator_generate_json(&self, options_json: String) -> Result<String, FfiError> {
        let opts: GeneratorOptions = if options_json.trim().is_empty() {
            GeneratorOptions::default()
        } else {
            parse_json(&options_json)?
        };
        let res = self.core.generator_generate(opts);
        to_json_string(&res)
    }

    pub fn generator_history_list_json(&self) -> Result<String, FfiError> {
        let res = self
            .core
            .generator_history_list()
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn generator_history_clear(&self) -> Result<(), FfiError> {
        self.core.generator_history_clear().map_err(FfiError::from)
    }

    // --- Watchtower ---

    pub fn watchtower_scan_json(&self, check_hibp: bool) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.watchtower_scan(check_hibp))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    // --- Send ---

    pub fn send_list_json(&self) -> Result<String, FfiError> {
        let res = self
            .runtime
            .block_on(self.core.send_list())
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn send_create_text_json(&self, input_json: String) -> Result<String, FfiError> {
        let input: SendCreateTextInput = parse_json(&input_json)?;
        let res = self
            .runtime
            .block_on(self.core.send_create_text(input))
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn send_delete(&self, id: String) -> Result<(), FfiError> {
        self.runtime
            .block_on(self.core.send_delete(&id))
            .map_err(FfiError::from)
    }

    // --- Emergency Kit, Snapshots, Settings, Clipboard & Storage ---

    pub fn vault_export_emergency_kit_json(&self) -> Result<String, FfiError> {
        let res = self
            .core
            .vault_export_emergency_kit()
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn snapshot_list_json(&self) -> Result<String, FfiError> {
        let res = self.core.snapshot_list().map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn snapshot_create_json(&self) -> Result<String, FfiError> {
        let res = self.core.snapshot_create().map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn snapshot_delete(&self, id: String) -> Result<(), FfiError> {
        self.core.snapshot_delete(&id).map_err(FfiError::from)
    }

    pub fn app_settings_get_json(&self) -> Result<String, FfiError> {
        let res = self.core.app_settings_get().map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn app_settings_update_json(&self, patch_json: String) -> Result<String, FfiError> {
        let patch: AppSettingsPatch = parse_json(&patch_json)?;
        let res = self
            .core
            .app_settings_update(patch)
            .map_err(FfiError::from)?;
        to_json_string(&res)
    }

    pub fn favicon_fetch(&self, host: String) -> Result<Option<String>, FfiError> {
        self.runtime
            .block_on(self.core.favicon_fetch(&host))
            .map_err(FfiError::from)
    }

    pub fn clipboard_copy_secret(
        &self,
        text: String,
        label: String,
        is_sensitive: bool,
        clear_after_secs: u64,
    ) -> Result<(), FfiError> {
        let timeout_opt = if clear_after_secs > 0 {
            Some(clear_after_secs)
        } else {
            None
        };
        self.core
            .clipboard_copy_secret_with_timeout(&text, &label, is_sensitive, timeout_opt)
            .map_err(FfiError::from)
    }

    pub fn clipboard_clear_now(&self) -> Result<(), FfiError> {
        self.core.clipboard_clear_now().map_err(FfiError::from)
    }

    pub fn checkpoint_storage(&self) -> Result<(), FfiError> {
        self.core.checkpoint_storage().map_err(FfiError::from)
    }

    // --- Apple AutoFill / Passkey / TextToInsert / CXF ---

    pub fn passkey_list_for_rp_json(
        &self,
        rp_id: String,
        allow_credential_ids_b64u: Vec<String>,
    ) -> Result<String, FfiError> {
        let clean_rp = normalize_rp_id(&rp_id);
        let custom_equiv = self
            .core
            .app_settings_get()
            .map(|s| s.custom_equivalent_domains)
            .unwrap_or_default();

        let summaries = self
            .core
            .item_list(ItemFilter {
                passkey_only: Some(true),
                trashed: Some(false),
                archived: Some(false),
                ..Default::default()
            })
            .map_err(FfiError::from)?;

        let mut candidates: Vec<PasskeyCandidateDto> = Vec::new();
        for sum in summaries {
            if let Ok(Some(item)) = self.core.item_get(&sum.id) {
                for pk in &item.payload.passkeys {
                    let pk_rp = normalize_rp_id(&pk.rp_id);
                    let rp_match = clean_rp.is_empty()
                        || pk_rp == clean_rp
                        || domains_are_equivalent(&pk_rp, &clean_rp, &custom_equiv);
                    if !rp_match {
                        continue;
                    }
                    if !allow_credential_ids_b64u.is_empty()
                        && !passkey_matches_credential_list(pk, &allow_credential_ids_b64u)
                    {
                        continue;
                    }
                    candidates.push(build_passkey_candidate(&item, pk));
                }
            }
        }
        to_json_string(&candidates)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn passkey_create_apple(
        &self,
        client_data_hash: Vec<u8>,
        rp_id: String,
        rp_name: String,
        user_id: Vec<u8>,
        user_name: String,
        user_display_name: String,
        target_item_id: Option<String>,
    ) -> Result<FfiApplePasskeyRegistration, FfiError> {
        let created = create_passkey_with_client_data_hash(
            &client_data_hash,
            &rp_id,
            &rp_name,
            &user_id,
            &user_name,
            &user_display_name,
            &[COSE_ALG_ES256, COSE_ALG_EDDSA],
        )
        .map_err(FfiError::from)?;

        let clean_rp = normalize_rp_id(&rp_id);
        let origin_url = format!("https://{clean_rp}");
        let target_id = target_item_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let saved = if let Some(item_id) = target_id {
            let existing = self
                .core
                .item_get(item_id)
                .map_err(FfiError::from)?
                .ok_or_else(|| FfiError::Validation {
                    msg: format!("未找到要绑定的条目: {item_id}"),
                })?;
            let mut draft = existing.to_draft();
            draft.passkeys.push(created.credential);
            let has_url = draft
                .urls
                .iter()
                .any(|u| normalize_rp_id(&u.uri) == clean_rp);
            if !has_url && !clean_rp.is_empty() {
                draft.urls.push(ItemUrl {
                    id: format!("u-{}", uuid::Uuid::new_v4()),
                    uri: origin_url,
                    label: None,
                    match_rule: UrlMatchRule::Domain,
                });
            }
            self.runtime
                .block_on(self.core.item_update(&existing.id, draft))
                .map_err(FfiError::from)?
        } else {
            let title = if !rp_name.trim().is_empty() {
                rp_name.trim().to_string()
            } else {
                clean_rp.clone()
            };
            let draft = ItemDraft {
                id: None,
                vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
                title,
                favorite: false,
                category: ItemCategory::Login,
                subtitle: None,
                icon: Some(ItemIcon::Domain {
                    host: clean_rp.clone(),
                }),
                tags: Vec::new(),
                urls: vec![ItemUrl {
                    id: format!("u-{}", uuid::Uuid::new_v4()),
                    uri: origin_url,
                    label: None,
                    match_rule: UrlMatchRule::Domain,
                }],
                sections: vec![ItemSection {
                    id: format!("sec-{}", uuid::Uuid::new_v4()),
                    title: "登录信息".to_string(),
                    fields: if user_name.trim().is_empty() {
                        Vec::new()
                    } else {
                        vec![ItemField {
                            id: format!("f-user-{}", uuid::Uuid::new_v4()),
                            label: "用户名".to_string(),
                            field_type: FieldType::Text,
                            value: user_name.trim().to_string(),
                            sensitive: false,
                            copyable: true,
                            purpose: Some(FieldPurpose::Username),
                        }]
                    },
                }],
                passkeys: vec![created.credential],
                notes: String::new(),
                password_history: Vec::new(),
                watchtower: WatchtowerFlags::default(),
                archived: false,
                reprompt: false,
                ..Default::default()
            };
            self.runtime
                .block_on(self.core.item_create(draft))
                .map_err(FfiError::from)?
        };

        Ok(FfiApplePasskeyRegistration {
            credential_id: created.credential_id,
            attestation_object: created.attestation_object,
            client_data_hash: created.client_data_hash,
            item_id: saved.id,
        })
    }

    pub fn passkey_assert_apple(
        &self,
        client_data_hash: Vec<u8>,
        rp_id: String,
        credential_id: Vec<u8>,
    ) -> Result<FfiApplePasskeyAssertion, FfiError> {
        if credential_id.is_empty() {
            return Err(FfiError::Validation {
                msg: "Passkey credentialId 不能为空".to_string(),
            });
        }
        let custom_equiv = self
            .core
            .app_settings_get()
            .map(|s| s.custom_equivalent_domains)
            .unwrap_or_default();
        let cred_b64u = encode_b64u(&credential_id);
        let cand_list = vec![cred_b64u];

        let summaries = self
            .core
            .item_list(ItemFilter {
                passkey_only: Some(true),
                trashed: Some(false),
                archived: Some(false),
                ..Default::default()
            })
            .map_err(FfiError::from)?;

        let mut matched: Option<(keysmith_core::domain::ItemDetail, usize)> = None;
        for sum in summaries {
            if let Ok(Some(item)) = self.core.item_get(&sum.id) {
                if let Some(idx) = item.payload.passkeys.iter().position(|pk| {
                    decode_credential_id_bytes(&pk.credential_id)
                        .map(|raw| raw == credential_id)
                        .unwrap_or(false)
                        || passkey_matches_credential_list(pk, &cand_list)
                }) {
                    matched = Some((item, idx));
                    break;
                }
            }
        }

        let (item, pk_idx) = matched.ok_or_else(|| FfiError::Validation {
            msg: "未找到匹配的 Passkey 凭据".to_string(),
        })?;
        let pk = &item.payload.passkeys[pk_idx];
        let asserted =
            assert_passkey_with_client_data_hash(pk, &client_data_hash, &rp_id, &custom_equiv)
                .map_err(FfiError::from)?;

        let mut draft = item.to_draft();
        if let Some(target_pk) = draft.passkeys.get_mut(pk_idx) {
            target_pk.sign_count = asserted.next_sign_count;
            target_pk.last_used_at = Some(now_rfc3339());
        }
        let _ = self
            .runtime
            .block_on(self.core.item_update(&item.id, draft));

        Ok(FfiApplePasskeyAssertion {
            credential_id: asserted.credential_id,
            user_handle: asserted.user_handle,
            authenticator_data: asserted.authenticator_data,
            signature: asserted.signature,
            client_data_hash: asserted.client_data_hash,
        })
    }

    pub fn text_insert_candidates_json(&self, query: String) -> Result<String, FfiError> {
        let vaults = self.core.vault_list().map_err(FfiError::from)?;
        let summaries = self
            .core
            .item_list(ItemFilter {
                trashed: Some(false),
                archived: Some(false),
                ..Default::default()
            })
            .map_err(FfiError::from)?;
        let mut details = Vec::with_capacity(summaries.len());
        for sum in summaries {
            if let Ok(Some(item)) = self.core.item_get(&sum.id) {
                details.push(item);
            }
        }
        let candidates = collect_text_insert_candidates(&details, &vaults, &query);
        to_json_string(&candidates)
    }

    pub fn cxf_export_bundle_json(&self) -> Result<String, FfiError> {
        let session = self.core.session_get_state();
        let summaries = self
            .core
            .item_list(ItemFilter {
                trashed: Some(false),
                ..Default::default()
            })
            .map_err(FfiError::from)?;
        let mut details = Vec::with_capacity(summaries.len());
        for sum in summaries {
            if let Ok(Some(item)) = self.core.item_get(&sum.id) {
                details.push(item);
            }
        }
        export_cxf_bundle_json(
            &details,
            &session.account_id,
            &session.email,
            &session.display_name,
        )
    }

    pub fn cxf_import_bundle_json(&self, bundle_json: String) -> Result<String, FfiError> {
        let _ = self.core.vault_list().map_err(FfiError::from)?;
        let (drafts, mut skipped_items, mut warnings) = parse_cxf_bundle_to_drafts(&bundle_json)?;
        let mut imported_items = 0usize;
        for draft in drafts {
            match self.runtime.block_on(self.core.item_create(draft)) {
                Ok(_) => imported_items += 1,
                Err(e) => {
                    skipped_items += 1;
                    warnings.push(e.to_string());
                }
            }
        }
        let summary = ImportSummary {
            imported_vaults: 0,
            imported_items,
            skipped_items,
            warnings,
        };
        to_json_string(&summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keysmith_core::crypto::{
        derive_master_key, protect_user_symmetric_key, stretch_master_key, KdfConfig,
        UserSymmetricKey,
    };
    use keysmith_core::storage::StoredAccount;
    use sha2::Digest;

    struct TestBio;
    impl FfiBiometricKeyStore for TestBio {
        fn is_available(&self) -> bool {
            false
        }
        fn save_unlock_key(&self, _account_id: String, _key: Vec<u8>) -> Result<(), FfiError> {
            Err(FfiError::Biometric {
                msg: "unsupported".into(),
            })
        }
        fn load_unlock_key(&self, _account_id: String, _reason: String) -> Result<Vec<u8>, FfiError> {
            Err(FfiError::Biometric {
                msg: "unsupported".into(),
            })
        }
        fn delete_unlock_key(&self, _account_id: String) -> Result<(), FfiError> {
            Ok(())
        }
        fn verify_user(&self, _reason: String) -> Result<(), FfiError> {
            Err(FfiError::Biometric {
                msg: "unsupported".into(),
            })
        }
    }

    struct TestClip;
    impl FfiClipboardManager for TestClip {
        fn copy_secret(
            &self,
            _text: String,
            _label: String,
            _is_sensitive: bool,
            _clear_after_secs: u64,
        ) -> Result<(), FfiError> {
            Ok(())
        }
        fn clear_now(&self) -> Result<(), FfiError> {
            Ok(())
        }
    }

    #[test]
    fn ffi_handle_scrubs_passkey_private_key_and_supports_apple_passkeys_text_insert_and_cxf() {
        let tmp_dir = std::env::temp_dir().join(format!("keysmith_ffi_test_{}", uuid::Uuid::new_v4()));
        let db_path = tmp_dir.join("keysmith.db");
        let storage = Storage::open(&db_path).unwrap();

        let kdf = KdfConfig {
            kdf: 0,
            kdf_iterations: 5_000,
            kdf_memory: None,
            kdf_parallelism: None,
        };
        let mk = derive_master_key("FfiPass#2026!", "ffi@example.com", &kdf).unwrap();
        let smk = stretch_master_key(&mk).unwrap();
        let usk = UserSymmetricKey::generate();
        let acc = StoredAccount::default_prefs(
            "acc-ffi".to_string(),
            "https://vault.example.com".to_string(),
            "ffi@example.com".to_string(),
            "FFI User".to_string(),
            kdf.kdf,
            kdf.kdf_iterations,
            kdf.kdf_memory,
            kdf.kdf_parallelism,
            protect_user_symmetric_key(&usk, &smk).unwrap(),
            "dev-ffi".to_string(),
        );
        storage.upsert_account(&acc).unwrap();
        drop(storage);

        let handle = KeysmithCoreHandle::new(
            db_path.to_string_lossy().to_string(),
            Box::new(TestBio),
            Box::new(TestClip),
            true,
            "Keysmith/0.1.4 (iOS; AutoFill)".to_string(),
        )
        .unwrap();

        let state_json = handle.session_unlock_password_json("FfiPass#2026!".to_string()).unwrap();
        assert!(state_json.contains("Unlocked"));

        let hash = sha2::Sha256::digest(b"apple-client-data").to_vec();
        let reg = handle
            .passkey_create_apple(
                hash.clone(),
                "github.com".to_string(),
                "GitHub".to_string(),
                b"user-1".to_vec(),
                "cherry".to_string(),
                "Cherry".to_string(),
                None,
            )
            .unwrap();
        assert_eq!(reg.credential_id.len(), 16);
        assert!(!reg.attestation_object.is_empty());

        // item_get_json must scrub privateKeyPkcs8
        let detail_json = handle.item_get_json(reg.item_id.clone()).unwrap();
        assert!(!detail_json.contains("privateKeyPkcs8"));

        // Updating item from scrubbed draft JSON must preserve privateKeyPkcs8 in Rust
        let mut detail_val: serde_json::Value = serde_json::from_str(&detail_json).unwrap();
        detail_val["title"] = serde_json::Value::String("GitHub Updated".to_string());
        let updated_json = handle
            .item_update_json(reg.item_id.clone(), detail_val.to_string())
            .unwrap();
        assert!(updated_json.contains("GitHub Updated"));
        assert!(!updated_json.contains("privateKeyPkcs8"));

        let list_json = handle
            .passkey_list_for_rp_json("github.com".to_string(), vec![])
            .unwrap();
        assert!(list_json.contains("github.com"));
        assert!(!list_json.contains("privateKeyPkcs8"));

        let assertion = handle
            .passkey_assert_apple(hash, "github.com".to_string(), reg.credential_id.clone())
            .unwrap();
        assert_eq!(assertion.user_handle, b"user-1");
        assert!(!assertion.signature.is_empty());

        let text_candidates = handle.text_insert_candidates_json("github".to_string()).unwrap();
        assert!(text_candidates.contains("cherry"));

        let cxf_bundle = handle.cxf_export_bundle_json().unwrap();
        assert!(cxf_bundle.contains("passkey"));
        let import_res = handle.cxf_import_bundle_json(cxf_bundle).unwrap();
        assert!(import_res.contains("\"importedItems\":1"));

        handle.session_lock("test_done".to_string()).unwrap();
        handle.checkpoint_storage().unwrap();
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
