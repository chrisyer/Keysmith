pub mod codec;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemCategory {
    Login,
    Password,
    SecureNote,
    CreditCard,
    Identity,
    ApiCredential,
    Database,
    Server,
    SshKey,
    SoftwareLicense,
    Passkey,
    BankAccount,
    CryptoWallet,
    WifiRouter,
    Passport,
    DriverLicense,
    Membership,
    MedicalRecord,
    Document,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldType {
    Text,
    Password,
    Email,
    Url,
    Totp,
    Date,
    MonthYear,
    Phone,
    Number,
    Address,
    Multiline,
    SshPrivateKey,
    SshPublicKey,
    KeyValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldPurpose {
    Username,
    Password,
    Totp,
    CardNumber,
    CardCvv,
    CardExpiry,
    Pin,
    RecoveryCodes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UrlMatchRule {
    Domain,
    Host,
    StartsWith,
    Exact,
    Never,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ItemIcon {
    Domain { host: String },
    Preset { name: String, color: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemField {
    pub id: String,
    pub label: String,
    pub field_type: FieldType,
    pub value: String,
    #[serde(default)]
    pub sensitive: bool,
    #[serde(default)]
    pub copyable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<FieldPurpose>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSection {
    pub id: String,
    pub title: String,
    pub fields: Vec<ItemField>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUrl {
    pub id: String,
    pub uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub match_rule: UrlMatchRule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordHistoryEntry {
    pub value: String,
    pub changed_at: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchtowerFlags {
    #[serde(default)]
    pub ignore_weak: bool,
    #[serde(default)]
    pub ignore_reused: bool,
    #[serde(default)]
    pub ignore_missing_2fa: bool,
    #[serde(default)]
    pub ignore_unsecured_url: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchtowerFlagsPatch {
    pub ignore_weak: Option<bool>,
    pub ignore_reused: Option<bool>,
    pub ignore_missing_2fa: Option<bool>,
    pub ignore_unsecured_url: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCredential {
    pub credential_id: String,
    pub rp_id: String,
    pub rp_name: String,
    pub user_handle: String,
    pub user_name: String,
    pub user_display_name: String,
    pub algorithm: i32,
    pub private_key_pkcs8: String,
    pub public_key_spki: String,
    pub sign_count: u32,
    pub discoverable: bool,
    pub aaguid: String,
    pub transports: Vec<String>,
    pub backed_up: bool,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAttachment {
    pub id: String,
    pub file_name: String,
    pub size: u64,
    pub size_name: String,
    #[serde(default)]
    pub has_local_data: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDownloadResult {
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPasskey {
    pub id: String,
    pub passkey_user_id: String,
    pub credential_public_key: String,
    pub credential_type: String,
    pub credential_device_type: String,
    pub credential_backed_up: bool,
    pub aaguid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_icon: Option<String>,
    pub name: String,
    pub transports: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<i64>,
    pub registered_at: i64,
    pub counter: u32,
    pub prf_supported: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPasskeyListResponse {
    pub rp_id: String,
    pub user_id: String,
    pub credentials: Vec<AccountPasskey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileResponse {
    pub rp_id: String,
    pub user_id: String,
    pub name: String,
    pub display_name: String,
}

pub const ITEM_SCHEMA_V1: &str = "keysmith.item.v1";
pub const VAULT_SCHEMA_V1: &str = "keysmith.vault.v1";
pub const DEFAULT_PERSONAL_VAULT_ID: &str = "personal";
pub const DEFAULT_QUICK_ACCESS_SHORTCUT: &str = "CommandOrControl+Shift+Space";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPayload {
    pub schema: String,
    pub category: ItemCategory,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<ItemIcon>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub urls: Vec<ItemUrl>,
    #[serde(default)]
    pub sections: Vec<ItemSection>,
    #[serde(default)]
    pub passkeys: Vec<PasskeyCredential>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub password_history: Vec<PasswordHistoryEntry>,
    #[serde(default)]
    pub watchtower: WatchtowerFlags,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub reprompt: bool,
    #[serde(default)]
    pub attachments: Vec<ItemAttachment>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMetaJson {
    pub schema: String,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub is_default: bool,
    #[serde(default)]
    pub is_organization: bool,
    pub item_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WatchtowerIssueType {
    Weak,
    Reused,
    #[serde(rename = "missing_2fa", alias = "missing2fa")]
    Missing2fa,
    UnsecuredUrl,
    Expiring,
    Breached,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub id: String,
    pub vault_id: String,
    pub title: String,
    pub subtitle: String,
    pub category: ItemCategory,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<ItemIcon>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub has_totp: bool,
    pub has_passkey: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub has_password: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub reprompt: bool,
    #[serde(default)]
    pub attachment_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    pub updated_at: String,
    pub issues: Vec<WatchtowerIssueType>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    pub id: String,
    pub vault_id: String,
    pub title: String,
    pub favorite: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    #[serde(flatten)]
    pub payload: ItemPayload,
}

impl ItemDetail {
    /// Convert an existing item detail into an editable draft preserving all metadata.
    pub fn to_draft(&self) -> ItemDraft {
        ItemDraft {
            id: Some(self.id.clone()),
            vault_id: self.vault_id.clone(),
            title: self.title.clone(),
            favorite: self.favorite,
            category: self.payload.category,
            subtitle: self.payload.subtitle.clone(),
            icon: self.payload.icon.clone(),
            tags: self.payload.tags.clone(),
            urls: self.payload.urls.clone(),
            sections: self.payload.sections.clone(),
            passkeys: self.payload.passkeys.clone(),
            notes: self.payload.notes.clone(),
            password_history: self.payload.password_history.clone(),
            watchtower: self.payload.watchtower,
            archived: self.payload.archived,
            reprompt: self.payload.reprompt,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub vault_id: String,
    pub title: String,
    #[serde(default)]
    pub favorite: bool,
    pub category: ItemCategory,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub icon: Option<ItemIcon>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub urls: Vec<ItemUrl>,
    #[serde(default)]
    pub sections: Vec<ItemSection>,
    #[serde(default)]
    pub passkeys: Vec<PasskeyCredential>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub password_history: Vec<PasswordHistoryEntry>,
    #[serde(default)]
    pub watchtower: WatchtowerFlags,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub reprompt: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortBy {
    TitleAsc,
    TitleDesc,
    UpdatedDesc,
    CreatedDesc,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemFilter {
    #[serde(default)]
    pub vault_id: Option<String>,
    #[serde(default)]
    pub category: Option<ItemCategory>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub passkey_only: Option<bool>,
    #[serde(default)]
    pub trashed: Option<bool>,
    #[serde(default)]
    pub archived: Option<bool>,
    #[serde(default)]
    pub watchtower_issue: Option<WatchtowerIssueType>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub sort_by: Option<SortBy>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStats {
    pub total_count: usize,
    pub favorite_count: usize,
    pub passkey_count: usize,
    pub trash_count: usize,
    #[serde(default)]
    pub archived_count: usize,
    pub category_counts: HashMap<String, usize>,
    pub tag_counts: Vec<TagCount>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthStatus {
    Unauthenticated,
    Locked,
    Unlocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub account_id: String,
    pub status: AuthStatus,
    pub email: String,
    pub display_name: String,
    pub server_url: String,
    pub biometric_enabled: bool,
    pub auto_lock_minutes: u32,
    pub clipboard_clear_seconds: u64,
    pub last_sync_at: String,
    pub kdf_type: String,
    pub close_to_tray: bool,
    pub lock_on_sleep: bool,
    pub screen_capture_protected: bool,
    pub vibrancy_enabled: bool,
    pub favicon_enabled: bool,
    pub quick_access_shortcut: String,
    pub biometric_max_days: u32,
    pub launch_at_login: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPreferencesPatch {
    pub biometric_enabled: Option<bool>,
    pub auto_lock_minutes: Option<u32>,
    pub clipboard_clear_seconds: Option<u64>,
    pub close_to_tray: Option<bool>,
    pub lock_on_sleep: Option<bool>,
    pub screen_capture_protected: Option<bool>,
    pub vibrancy_enabled: Option<bool>,
    pub favicon_enabled: Option<bool>,
    pub quick_access_shortcut: Option<String>,
    pub biometric_max_days: Option<u32>,
    pub launch_at_login: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub server_url: String,
    pub is_active: bool,
    pub kdf_type: String,
    pub last_sync_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorHistoryEntry {
    pub id: String,
    pub value: String,
    pub mode: String,
    pub entropy_bits: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyPair {
    pub public_key: String,
    pub private_key_openssh: String,
    pub fingerprint_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshIdentity {
    pub item_id: String,
    pub title: String,
    pub public_key: String,
    pub fingerprint_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported_vaults: usize,
    pub imported_items: usize,
    pub skipped_items: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStateKind {
    Idle,
    Syncing,
    Offline,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: SyncStateKind,
    pub pending_count: usize,
    pub last_sync_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub signalr_connected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeneratorMode {
    Password,
    Passphrase,
    Pin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorOptions {
    pub mode: GeneratorMode,
    pub length: usize,
    pub include_digits: bool,
    pub include_symbols: bool,
    pub exclude_ambiguous: bool,
    pub word_count: usize,
    pub separator: String,
    pub capitalize: bool,
    pub include_number_in_phrase: bool,
    pub pin_length: usize,
}

impl Default for GeneratorOptions {
    fn default() -> Self {
        Self {
            mode: GeneratorMode::Password,
            length: 20,
            include_digits: true,
            include_symbols: true,
            exclude_ambiguous: true,
            word_count: 4,
            separator: "-".to_string(),
            capitalize: true,
            include_number_in_phrase: true,
            pin_length: 6,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordStrength {
    pub score: u8,
    pub label: String,
    pub entropy_bits: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorResult {
    pub value: String,
    pub strength: PasswordStrength,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpCode {
    pub code: String,
    pub formatted_code: String,
    pub remaining_seconds: u64,
    pub period: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchtowerReport {
    pub score: u32,
    pub total_audited: usize,
    pub total_risk_items: usize,
    pub counts: HashMap<WatchtowerIssueType, usize>,
    pub item_ids_by_issue: HashMap<WatchtowerIssueType, Vec<String>>,
    pub item_issues: HashMap<String, Vec<WatchtowerIssueType>>,
    pub hibp_checked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hibp_checked_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    #[serde(default)]
    pub custom_shortcuts: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_server_url: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            theme: "system".to_string(),
            custom_shortcuts: HashMap::new(),
            last_server_url: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsPatch {
    pub language: Option<String>,
    pub theme: Option<String>,
    pub custom_shortcuts: Option<HashMap<String, String>>,
    pub last_server_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SendType {
    Text,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendItem {
    pub id: String,
    pub access_id: String,
    pub send_type: SendType,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_size_name: Option<String>,
    pub share_url: String,
    pub max_access_count: Option<u32>,
    pub access_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiration_date: Option<String>,
    pub deletion_date: String,
    pub revision_date: String,
    pub disabled: bool,
    pub hide_email: bool,
    pub has_password: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendCreateTextInput {
    pub name: String,
    pub text: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub max_access_count: Option<u32>,
    #[serde(default)]
    pub expiration_date: Option<String>,
    pub deletion_date: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub hide_email: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendCreateFileInput {
    pub name: String,
    pub file_name: String,
    pub data_base64: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub max_access_count: Option<u32>,
    #[serde(default)]
    pub expiration_date: Option<String>,
    pub deletion_date: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub hide_email: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendUpdateInput {
    pub name: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub max_access_count: Option<u32>,
    #[serde(default)]
    pub expiration_date: Option<String>,
    pub deletion_date: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub hide_email: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheckResult {
    pub ok: bool,
    pub version: String,
    #[serde(default)]
    pub disable_user_registration: bool,
}

pub fn format_size_bytes(size: u64) -> String {
    if size < 1024 {
        format!("{size} B")
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
    }
}

pub fn derive_subtitle(item: &ItemPayload) -> String {
    if let Some(sub) = &item.subtitle {
        if !sub.trim().is_empty() {
            return sub.trim().to_string();
        }
    }

    let all_fields: Vec<&ItemField> = item.sections.iter().flat_map(|s| s.fields.iter()).collect();

    if let Some(f) = all_fields
        .iter()
        .find(|f| f.purpose == Some(FieldPurpose::Username) && !f.value.trim().is_empty())
    {
        return f.value.trim().to_string();
    }

    if item.category == ItemCategory::CreditCard {
        if let Some(f) = all_fields
            .iter()
            .find(|f| f.purpose == Some(FieldPurpose::CardNumber) && !f.value.trim().is_empty())
        {
            return mask_card_number(&f.value);
        }
    }

    if let Some(f) = all_fields
        .iter()
        .find(|f| !f.sensitive && !f.value.trim().is_empty())
    {
        return f.value.trim().to_string();
    }

    if let Some(first_url) = item.urls.first() {
        if !first_url.uri.trim().is_empty() {
            return extract_domain(&first_url.uri);
        }
    }

    if !item.notes.trim().is_empty() {
        return item
            .notes
            .trim()
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(42)
            .collect();
    }

    "无副标题".to_string()
}

pub fn extract_domain(uri: &str) -> String {
    let candidate = if uri.contains("://") {
        uri.to_string()
    } else {
        format!("https://{uri}")
    };
    if let Ok(parsed) = url::Url::parse(&candidate) {
        if let Some(host) = parsed.host_str() {
            return host.strip_prefix("www.").unwrap_or(host).to_string();
        }
    }
    uri.to_string()
}

pub fn mask_card_number(raw: &str) -> String {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 4 {
        return "•••• ••••".to_string();
    }
    let last4 = &digits[digits.len() - 4..];
    format!("•••• •••• •••• {last4}")
}

pub fn item_to_summary(item: &ItemDetail, issues: Vec<WatchtowerIssueType>) -> ItemSummary {
    let all_fields: Vec<&ItemField> = item
        .payload
        .sections
        .iter()
        .flat_map(|s| s.fields.iter())
        .collect();
    let username = all_fields
        .iter()
        .find(|f| f.purpose == Some(FieldPurpose::Username) && !f.value.trim().is_empty())
        .map(|f| f.value.trim().to_string());
    let has_totp = all_fields
        .iter()
        .any(|f| f.field_type == FieldType::Totp && !f.value.trim().is_empty());
    let has_password = all_fields
        .iter()
        .any(|f| f.purpose == Some(FieldPurpose::Password) && !f.value.trim().is_empty());
    let has_passkey = !item.payload.passkeys.is_empty();

    ItemSummary {
        id: item.id.clone(),
        vault_id: item.vault_id.clone(),
        title: item.title.clone(),
        subtitle: derive_subtitle(&item.payload),
        category: item.payload.category,
        icon: item.payload.icon.clone(),
        tags: item.payload.tags.clone(),
        favorite: item.favorite,
        has_totp,
        has_passkey,
        primary_url: item.payload.urls.first().map(|u| u.uri.clone()),
        username,
        has_password,
        archived: item.payload.archived,
        reprompt: item.payload.reprompt,
        attachment_count: item.payload.attachments.len(),
        deleted_at: item.deleted_at.clone(),
        updated_at: item.payload.updated_at.clone(),
        issues,
    }
}
