pub mod signalr;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{multipart, Client, StatusCode};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

fn deserialize_null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    T: Default + Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

use crate::crypto::{normalize_email, KdfConfig};
use crate::error::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigSettingsDto {
    #[serde(default, alias = "DisableUserRegistration")]
    pub disable_user_registration: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigDto {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub settings: Option<ServerConfigSettingsDto>,
    #[serde(default, alias = "DisableUserRegistration")]
    pub disable_user_registration: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreloginResponse {
    #[serde(alias = "Kdf")]
    pub kdf: u8,
    #[serde(alias = "KdfIterations")]
    pub kdf_iterations: u32,
    #[serde(default, alias = "KdfMemory")]
    pub kdf_memory: Option<u32>,
    #[serde(default, alias = "KdfParallelism")]
    pub kdf_parallelism: Option<u32>,
}

impl From<PreloginResponse> for KdfConfig {
    fn from(r: PreloginResponse) -> Self {
        Self {
            kdf: r.kdf,
            kdf_iterations: r.kdf_iterations,
            kdf_memory: r.kdf_memory,
            kdf_parallelism: r.kdf_parallelism,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default, alias = "Key", alias = "key")]
    pub key: Option<String>,
    #[serde(default, alias = "PrivateKey", alias = "privateKey")]
    pub private_key: Option<String>,
    #[serde(default, alias = "Kdf", alias = "kdf")]
    pub kdf: Option<u8>,
    #[serde(default, alias = "KdfIterations", alias = "kdfIterations")]
    pub kdf_iterations: Option<u32>,
    #[serde(default, alias = "KdfMemory", alias = "kdfMemory")]
    pub kdf_memory: Option<u32>,
    #[serde(default, alias = "KdfParallelism", alias = "kdfParallelism")]
    pub kdf_parallelism: Option<u32>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeysRequest {
    pub public_key: String,
    pub encrypted_private_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub email: String,
    pub name: String,
    pub master_password_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_password_hint: Option<String>,
    pub user_symmetric_key: String,
    pub key: String,
    pub keys: RegisterKeysRequest,
    pub kdf: u8,
    pub kdf_iterations: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kdf_memory: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kdf_parallelism: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(default, alias = "Name")]
    pub name: Option<String>,
    #[serde(default, alias = "Key")]
    pub key: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(default, alias = "Email")]
    pub email: Option<String>,
    #[serde(default, alias = "Name")]
    pub name: Option<String>,
    #[serde(default, alias = "Key")]
    pub key: Option<String>,
    #[serde(default, alias = "PrivateKey")]
    pub private_key: Option<String>,
    #[serde(default, alias = "Kdf")]
    pub kdf: Option<u8>,
    #[serde(default, alias = "KdfIterations")]
    pub kdf_iterations: Option<u32>,
    #[serde(default, alias = "KdfMemory")]
    pub kdf_memory: Option<u32>,
    #[serde(default, alias = "KdfParallelism")]
    pub kdf_parallelism: Option<u32>,
    #[serde(default, alias = "Organizations", deserialize_with = "deserialize_null_default")]
    pub organizations: Vec<OrganizationDto>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "Name")]
    pub name: String,
    #[serde(default, alias = "RevisionDate")]
    pub revision_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(default, alias = "OrganizationId")]
    pub organization_id: Option<String>,
    #[serde(alias = "Name")]
    pub name: String,
    #[serde(default, alias = "ReadOnly", deserialize_with = "deserialize_null_default")]
    pub read_only: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherAttachmentDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(default, alias = "FileName")]
    pub file_name: Option<String>,
    #[serde(default, alias = "Size")]
    pub size: Option<Value>,
    #[serde(default, alias = "SizeName")]
    pub size_name: Option<String>,
    #[serde(default, alias = "Key")]
    pub key: Option<String>,
    #[serde(default, alias = "Url")]
    pub url: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl CipherAttachmentDto {
    pub fn size_bytes(&self) -> u64 {
        match &self.size {
            Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
            Some(Value::String(s)) => s.parse::<u64>().unwrap_or(0),
            _ => 0,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherLoginUriDto {
    #[serde(default, alias = "Uri")]
    pub uri: Option<String>,
    #[serde(default, alias = "Match", rename = "match")]
    pub uri_match: Option<u8>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherFido2CredentialDto {
    #[serde(default, alias = "CredentialId")]
    pub credential_id: Option<String>,
    #[serde(default, alias = "KeyType")]
    pub key_type: Option<String>,
    #[serde(default, alias = "KeyAlgorithm")]
    pub key_algorithm: Option<String>,
    #[serde(default, alias = "KeyCurve")]
    pub key_curve: Option<String>,
    #[serde(default, alias = "KeyValue")]
    pub key_value: Option<String>,
    #[serde(default, alias = "RpId")]
    pub rp_id: Option<String>,
    #[serde(default, alias = "RpName")]
    pub rp_name: Option<String>,
    #[serde(default, alias = "Counter")]
    pub counter: Option<String>,
    #[serde(default, alias = "UserHandle")]
    pub user_handle: Option<String>,
    #[serde(default, alias = "UserName")]
    pub user_name: Option<String>,
    #[serde(default, alias = "UserDisplayName")]
    pub user_display_name: Option<String>,
    #[serde(default, alias = "Discoverable")]
    pub discoverable: Option<String>,
    #[serde(default, alias = "CreationDate")]
    pub creation_date: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherLoginDto {
    #[serde(default, alias = "Username")]
    pub username: Option<String>,
    #[serde(default, alias = "Password")]
    pub password: Option<String>,
    #[serde(default, alias = "Totp")]
    pub totp: Option<String>,
    #[serde(default, alias = "Uris", deserialize_with = "deserialize_null_default")]
    pub uris: Vec<CipherLoginUriDto>,
    #[serde(
        default,
        alias = "Fido2Credentials",
        deserialize_with = "deserialize_null_default"
    )]
    pub fido2_credentials: Vec<CipherFido2CredentialDto>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherSecureNoteDto {
    #[serde(default, alias = "Type", rename = "type", deserialize_with = "deserialize_null_default")]
    pub note_type: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherCardDto {
    #[serde(default, alias = "CardholderName")]
    pub cardholder_name: Option<String>,
    #[serde(default, alias = "Brand")]
    pub brand: Option<String>,
    #[serde(default, alias = "Number")]
    pub number: Option<String>,
    #[serde(default, alias = "ExpMonth")]
    pub exp_month: Option<String>,
    #[serde(default, alias = "ExpYear")]
    pub exp_year: Option<String>,
    #[serde(default, alias = "Code")]
    pub code: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherIdentityDto {
    #[serde(default, alias = "Title")]
    pub title: Option<String>,
    #[serde(default, alias = "FirstName")]
    pub first_name: Option<String>,
    #[serde(default, alias = "MiddleName")]
    pub middle_name: Option<String>,
    #[serde(default, alias = "LastName")]
    pub last_name: Option<String>,
    #[serde(default, alias = "Address1")]
    pub address1: Option<String>,
    #[serde(default, alias = "Address2")]
    pub address2: Option<String>,
    #[serde(default, alias = "City")]
    pub city: Option<String>,
    #[serde(default, alias = "Country")]
    pub country: Option<String>,
    #[serde(default, alias = "Company")]
    pub company: Option<String>,
    #[serde(default, alias = "Email")]
    pub email: Option<String>,
    #[serde(default, alias = "Phone")]
    pub phone: Option<String>,
    #[serde(default, alias = "Ssn")]
    pub ssn: Option<String>,
    #[serde(default, alias = "PassportNumber")]
    pub passport_number: Option<String>,
    #[serde(default, alias = "LicenseNumber")]
    pub license_number: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherFieldDto {
    #[serde(default, alias = "Name")]
    pub name: Option<String>,
    #[serde(default, alias = "Value")]
    pub value: Option<String>,
    #[serde(default, alias = "Type", rename = "type", deserialize_with = "deserialize_null_default")]
    pub field_type: u8,
    #[serde(default, alias = "LinkedId")]
    pub linked_id: Option<u32>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherPasswordHistoryDto {
    #[serde(default, alias = "Password")]
    pub password: Option<String>,
    #[serde(default, alias = "LastUsedDate")]
    pub last_used_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(default, alias = "OrganizationId")]
    pub organization_id: Option<String>,
    #[serde(default, alias = "FolderId")]
    pub folder_id: Option<String>,
    #[serde(default, alias = "CollectionIds", deserialize_with = "deserialize_null_default")]
    pub collection_ids: Vec<String>,
    #[serde(alias = "Type", rename = "type")]
    pub cipher_type: u8,
    #[serde(default, alias = "Name")]
    pub name: Option<String>,
    #[serde(default, alias = "Notes")]
    pub notes: Option<String>,
    #[serde(default, alias = "Favorite", deserialize_with = "deserialize_null_default")]
    pub favorite: bool,
    #[serde(default, alias = "Login")]
    pub login: Option<CipherLoginDto>,
    #[serde(default, alias = "SecureNote")]
    pub secure_note: Option<CipherSecureNoteDto>,
    #[serde(default, alias = "Card")]
    pub card: Option<CipherCardDto>,
    #[serde(default, alias = "Identity")]
    pub identity: Option<CipherIdentityDto>,
    #[serde(default, alias = "Fields", deserialize_with = "deserialize_null_default")]
    pub fields: Vec<CipherFieldDto>,
    #[serde(default, alias = "PasswordHistory", deserialize_with = "deserialize_null_default")]
    pub password_history: Vec<CipherPasswordHistoryDto>,
    #[serde(default, alias = "Attachments", deserialize_with = "deserialize_null_default")]
    pub attachments: Vec<CipherAttachmentDto>,
    #[serde(default, alias = "Reprompt")]
    pub reprompt: Option<u8>,
    #[serde(default, alias = "RevisionDate")]
    pub revision_date: Option<String>,
    #[serde(default, alias = "CreationDate")]
    pub creation_date: Option<String>,
    #[serde(default, alias = "DeletedDate")]
    pub deleted_date: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CipherCreateUpdatePayload {
    #[serde(rename = "type")]
    pub cipher_type: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    pub name: Option<String>,
    pub notes: Option<String>,
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<CipherLoginDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secure_note: Option<CipherSecureNoteDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card: Option<CipherCardDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<CipherIdentityDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<CipherFieldDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub password_history: Vec<CipherPasswordHistoryDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reprompt: Option<u8>,
}

impl From<&CipherDto> for CipherCreateUpdatePayload {
    fn from(c: &CipherDto) -> Self {
        Self {
            cipher_type: c.cipher_type,
            folder_id: c.folder_id.clone(),
            organization_id: c.organization_id.clone(),
            name: c.name.clone(),
            notes: c.notes.clone(),
            favorite: c.favorite,
            login: c.login.clone(),
            secure_note: c.secure_note.clone(),
            card: c.card.clone(),
            identity: c.identity.clone(),
            fields: c.fields.clone(),
            password_history: c.password_history.clone(),
            reprompt: c.reprompt,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTextDto {
    #[serde(default, alias = "Text")]
    pub text: Option<String>,
    #[serde(default, alias = "Hidden", deserialize_with = "deserialize_null_default")]
    pub hidden: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendFileDto {
    #[serde(default, alias = "Id")]
    pub id: Option<String>,
    #[serde(default, alias = "FileName")]
    pub file_name: Option<String>,
    #[serde(default, alias = "Size")]
    pub size: Option<Value>,
    #[serde(default, alias = "SizeName")]
    pub size_name: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl SendFileDto {
    pub fn size_bytes(&self) -> u64 {
        match &self.size {
            Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
            Some(Value::String(s)) => s.parse::<u64>().unwrap_or(0),
            _ => 0,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendDto {
    #[serde(default, alias = "Id")]
    pub id: String,
    #[serde(default, alias = "AccessId")]
    pub access_id: String,
    #[serde(default, alias = "Type", rename = "type")]
    pub send_type: u8,
    #[serde(default, alias = "Name")]
    pub name: Option<String>,
    #[serde(default, alias = "Notes")]
    pub notes: Option<String>,
    #[serde(default, alias = "Key")]
    pub key: Option<String>,
    #[serde(default, alias = "MaxAccessCount")]
    pub max_access_count: Option<u32>,
    #[serde(default, alias = "AccessCount", deserialize_with = "deserialize_null_default")]
    pub access_count: u32,
    #[serde(default, alias = "RevisionDate")]
    pub revision_date: Option<String>,
    #[serde(default, alias = "ExpirationDate")]
    pub expiration_date: Option<String>,
    #[serde(default, alias = "DeletionDate")]
    pub deletion_date: String,
    #[serde(default, alias = "Password")]
    pub password: Option<Value>,
    #[serde(default, alias = "Disabled", deserialize_with = "deserialize_null_default")]
    pub disabled: bool,
    #[serde(default, alias = "HideEmail", deserialize_with = "deserialize_null_default")]
    pub hide_email: bool,
    #[serde(default, alias = "Text")]
    pub text: Option<SendTextDto>,
    #[serde(default, alias = "File")]
    pub file: Option<SendFileDto>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl SendDto {
    pub fn has_password(&self) -> bool {
        match &self.password {
            Some(Value::String(s)) => !s.is_empty(),
            Some(Value::Bool(b)) => *b,
            Some(Value::Null) | None => false,
            Some(_) => true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendCreateUpdatePayload {
    #[serde(rename = "type")]
    pub send_type: u8,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_access_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration_date: Option<String>,
    pub deletion_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    pub disabled: bool,
    pub hide_email: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<SendTextDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<SendFileDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_length: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendFileV2Response {
    #[serde(default, alias = "SendResponse")]
    pub send_response: Option<SendDto>,
    #[serde(default, alias = "Url")]
    pub url: Option<String>,
    #[serde(default, alias = "FileUploadType")]
    pub file_upload_type: Option<u8>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    pub profile: ProfileDto,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub folders: Vec<FolderDto>,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub collections: Vec<CollectionDto>,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub ciphers: Vec<CipherDto>,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub sends: Vec<SendDto>,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub organizations: Vec<OrganizationDto>,
}

#[derive(Clone)]
pub struct VaultwardenClient {
    http: Client,
}

impl Default for VaultwardenClient {
    fn default() -> Self {
        Self::new()
    }
}

impl VaultwardenClient {
    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent("Keysmith/0.1.0 (macOS; Tauri)")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { http }
    }

    pub fn normalize_base_url(server_url: &str) -> Result<String, CoreError> {
        let trimmed = server_url.trim().trim_end_matches('/');
        let parsed = url::Url::parse(trimmed)
            .map_err(|_| CoreError::Validation("服务器地址格式无效".to_string()))?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(CoreError::Validation(
                "服务器地址必须以 http:// 或 https:// 开头".to_string(),
            ));
        }
        Ok(trimmed.to_string())
    }

    fn map_http_status_err(status: StatusCode, op: &str, body: &str) -> CoreError {
        if status == StatusCode::UNAUTHORIZED {
            return CoreError::Unauthorized(format!("{op} 返回 401"));
        }
        CoreError::Network(format!("{op} ({status}): {body}"))
    }

    pub async fn check_server(&self, server_url: &str) -> Result<(String, bool), CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .get(format!("{base}/api/config"))
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(CoreError::Network(format!(
                "服务器返回状态码 {}",
                resp.status()
            )));
        }
        let cfg: ServerConfigDto = resp
            .json()
            .await
            .map_err(|e| CoreError::Network(format!("解析 /api/config 响应失败: {e}")))?;
        let disable_reg = cfg
            .settings
            .as_ref()
            .and_then(|s| s.disable_user_registration)
            .or(cfg.disable_user_registration)
            .unwrap_or(false);
        Ok((
            cfg.version.unwrap_or_else(|| "Vaultwarden".to_string()),
            disable_reg,
        ))
    }

    pub async fn prelogin(&self, server_url: &str, email: &str) -> Result<KdfConfig, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let email = normalize_email(email);
        let resp = self
            .http
            .post(format!("{base}/identity/accounts/prelogin"))
            .json(&serde_json::json!({ "email": email }))
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(CoreError::Network(format!(
                "Prelogin 失败 ({status}): {text}"
            )));
        }
        let body: PreloginResponse = resp
            .json()
            .await
            .map_err(|e| CoreError::Network(format!("解析 Prelogin 响应失败: {e}")))?;
        Ok(body.into())
    }

    pub async fn login_password(
        &self,
        server_url: &str,
        email: &str,
        master_password_hash: &str,
        device_identifier: &str,
        two_factor_code: Option<&str>,
    ) -> Result<TokenResponse, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let normalized = normalize_email(email);
        let auth_email = URL_SAFE_NO_PAD.encode(normalized.as_bytes());

        let mut form: Vec<(&str, String)> = vec![
            ("grant_type", "password".to_string()),
            ("username", normalized),
            ("password", master_password_hash.to_string()),
            ("scope", "api offline_access".to_string()),
            ("client_id", "desktop".to_string()),
            ("deviceType", "6".to_string()),
            ("deviceIdentifier", device_identifier.to_string()),
            ("deviceName", "Keysmith".to_string()),
        ];

        if let Some(code) = two_factor_code {
            let clean = code.trim();
            if !clean.is_empty() {
                form.push(("twoFactorProvider", "0".to_string()));
                form.push(("twoFactorToken", clean.to_string()));
                form.push(("twoFactorRemember", "0".to_string()));
            }
        }

        let resp = self
            .http
            .post(format!("{base}/identity/connect/token"))
            .header("Auth-Email", auth_email)
            .form(&form)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;

        if !status.is_success() {
            if let Ok(json) = serde_json::from_str::<Value>(&text) {
                let providers = extract_two_factor_providers(&json);
                if !providers.is_empty()
                    || json
                        .get("error_description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_lowercase().contains("two factor"))
                        .unwrap_or(false)
                {
                    return Err(CoreError::two_factor_required(
                        "需要双重验证（2FA），请输入验证码",
                        providers,
                    ));
                }
                let msg = json
                    .get("ErrorModel")
                    .and_then(|m| m.get("Message"))
                    .and_then(|v| v.as_str())
                    .or_else(|| json.get("error_description").and_then(|v| v.as_str()))
                    .or_else(|| json.get("message").and_then(|v| v.as_str()))
                    .unwrap_or("邮箱或主密码错误");
                return Err(CoreError::auth(msg.to_string()));
            }
            return Err(CoreError::auth(format!("登录失败 ({status}): {text}")));
        }

        serde_json::from_str(&text)
            .map_err(|e| CoreError::Network(format!("解析 Token 响应失败: {e}")))
    }

    pub async fn refresh_token(
        &self,
        server_url: &str,
        refresh_token: &str,
    ) -> Result<TokenResponse, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let form = [
            ("grant_type", "refresh_token"),
            ("client_id", "desktop"),
            ("refresh_token", refresh_token),
        ];
        let resp = self
            .http
            .post(format!("{base}/identity/connect/token"))
            .form(&form)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(CoreError::auth(format!("刷新 Token 失败 ({status}): {text}")));
        }
        serde_json::from_str(&text)
            .map_err(|e| CoreError::Network(format!("解析刷新 Token 响应失败: {e}")))
    }

    pub async fn register(
        &self,
        server_url: &str,
        mut payload: RegisterRequest,
    ) -> Result<(), CoreError> {
        let base = Self::normalize_base_url(server_url)?;

        let verify_resp = self
            .http
            .post(format!("{base}/identity/accounts/register/send-verification-email"))
            .json(&serde_json::json!({
                "email": payload.email,
                "name": payload.name
            }))
            .send()
            .await;

        if let Ok(resp) = verify_resp {
            if resp.status().is_success() {
                let text = resp.text().await.unwrap_or_default();
                let trimmed = text.trim().trim_matches('"').to_string();
                if !trimmed.is_empty() && !trimmed.starts_with('{') {
                    payload.token = Some(trimmed);
                } else if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    if let Some(tok) = v.as_str().or_else(|| v.get("token").and_then(|t| t.as_str())) {
                        payload.token = Some(tok.to_string());
                    }
                }
                if payload.token.is_some() {
                    let finish_resp = self
                        .http
                        .post(format!("{base}/identity/accounts/register/finish"))
                        .json(&payload)
                        .send()
                        .await
                        .map_err(|e| CoreError::Network(e.to_string()))?;
                    if finish_resp.status().is_success() {
                        return Ok(());
                    }
                    let status = finish_resp.status();
                    let err_text = finish_resp.text().await.unwrap_or_default();
                    return Err(CoreError::auth(format!("注册完成失败 ({status}): {err_text}")));
                }
            }
        }

        let resp = self
            .http
            .post(format!("{base}/identity/accounts/register"))
            .json(&payload)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(CoreError::auth(format!("注册失败 ({status}): {text}")));
        }
        Ok(())
    }

    pub async fn sync(&self, server_url: &str, access_token: &str) -> Result<SyncResponse, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .get(format!("{base}/api/sync?excludeDomains=true"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(Self::map_http_status_err(status, "同步失败", &text));
        }
        serde_json::from_str(&text)
            .map_err(|e| CoreError::Network(format!("解析同步数据失败: {e}")))
    }

    pub async fn create_folder(
        &self,
        server_url: &str,
        access_token: &str,
        name_enc: &str,
    ) -> Result<FolderDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .post(format!("{base}/api/folders"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({ "name": name_enc }))
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "创建文件夹失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析文件夹响应失败: {e}")))
    }

    pub async fn update_folder(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
        name_enc: &str,
    ) -> Result<FolderDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .put(format!("{base}/api/folders/{id}"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({ "name": name_enc }))
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "更新文件夹失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析文件夹响应失败: {e}")))
    }

    pub async fn delete_folder(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
    ) -> Result<(), CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .delete(format!("{base}/api/folders/{id}"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "删除文件夹失败", &text));
        }
        Ok(())
    }

    pub async fn create_cipher(
        &self,
        server_url: &str,
        access_token: &str,
        cipher: &CipherDto,
    ) -> Result<CipherDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let payload = CipherCreateUpdatePayload::from(cipher);
        let resp = self
            .http
            .post(format!("{base}/api/ciphers"))
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "创建条目失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析条目响应失败: {e}")))
    }

    pub async fn update_cipher(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
        cipher: &CipherDto,
    ) -> Result<CipherDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let payload = CipherCreateUpdatePayload::from(cipher);
        let resp = self
            .http
            .put(format!("{base}/api/ciphers/{id}"))
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "更新条目失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析条目响应失败: {e}")))
    }

    pub async fn trash_cipher(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
    ) -> Result<(), CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .put(format!("{base}/api/ciphers/{id}/delete"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "移入回收站失败", &text));
        }
        Ok(())
    }

    pub async fn restore_cipher(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
    ) -> Result<CipherDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .put(format!("{base}/api/ciphers/{id}/restore"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "恢复条目失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析恢复响应失败: {e}")))
    }

    pub async fn delete_cipher_permanent(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
    ) -> Result<(), CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .delete(format!("{base}/api/ciphers/{id}"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "永久删除条目失败", &text));
        }
        Ok(())
    }

    pub async fn upload_attachment(
        &self,
        server_url: &str,
        access_token: &str,
        cipher_id: &str,
        file_name_enc: &str,
        key_enc: &str,
        encrypted_bytes: Vec<u8>,
    ) -> Result<CipherDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let part = multipart::Part::bytes(encrypted_bytes)
            .file_name(file_name_enc.to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let form = multipart::Form::new()
            .text("key", key_enc.to_string())
            .part("data", part);

        let resp = self
            .http
            .post(format!("{base}/api/ciphers/{cipher_id}/attachment"))
            .bearer_auth(access_token)
            .multipart(form)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "上传附件失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析附件响应失败: {e}")))
    }

    pub async fn delete_attachment(
        &self,
        server_url: &str,
        access_token: &str,
        cipher_id: &str,
        attachment_id: &str,
    ) -> Result<(), CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .delete(format!(
                "{base}/api/ciphers/{cipher_id}/attachment/{attachment_id}"
            ))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "删除附件失败", &text));
        }
        Ok(())
    }

    pub async fn fetch_attachment_bytes(
        &self,
        server_url: &str,
        access_token: &str,
        cipher_id: &str,
        attachment_id: &str,
        direct_url: Option<&str>,
    ) -> Result<Vec<u8>, CoreError> {
        let target_url = if let Some(u) = direct_url {
            if u.starts_with("http://") || u.starts_with("https://") {
                u.to_string()
            } else {
                let base = Self::normalize_base_url(server_url)?;
                format!("{base}/{}", u.trim_start_matches('/'))
            }
        } else {
            let base = Self::normalize_base_url(server_url)?;
            let meta_resp = self
                .http
                .get(format!(
                    "{base}/api/ciphers/{cipher_id}/attachment/{attachment_id}"
                ))
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| CoreError::Network(e.to_string()))?;
            let status = meta_resp.status();
            if !status.is_success() {
                let text = meta_resp.text().await.unwrap_or_default();
                return Err(Self::map_http_status_err(status, "获取附件信息失败", &text));
            }
            let att: CipherAttachmentDto = meta_resp
                .json()
                .await
                .map_err(|e| CoreError::Network(format!("解析附件元数据失败: {e}")))?;
            let u = att
                .url
                .ok_or_else(|| CoreError::Network("服务端未返回附件下载地址".to_string()))?;
            if u.starts_with("http://") || u.starts_with("https://") {
                u
            } else {
                format!("{base}/{}", u.trim_start_matches('/'))
            }
        };

        let resp = self
            .http
            .get(&target_url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "下载附件失败", &text));
        }
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| CoreError::Network(e.to_string()))
    }

    pub async fn fetch_favicon_bytes(&self, url: &str, max_bytes: usize) -> Option<Vec<u8>> {
        let resp = self
            .http
            .get(url)
            .timeout(std::time::Duration::from_secs(4))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let bytes = resp.bytes().await.ok()?;
        if bytes.is_empty() || bytes.len() > max_bytes {
            return None;
        }
        Some(bytes.to_vec())
    }

    pub async fn check_hibp_range(&self, prefix5: &str) -> Result<String, CoreError> {
        let resp = self
            .http
            .get(format!("https://api.pwnedpasswords.com/range/{prefix5}"))
            .header("Add-Padding", "true")
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(CoreError::Network(format!(
                "HIBP 查询失败 ({})",
                resp.status()
            )));
        }
        resp.text()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))
    }

    pub async fn list_sends(
        &self,
        server_url: &str,
        access_token: &str,
    ) -> Result<Vec<SendDto>, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .get(format!("{base}/api/sends"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(Self::map_http_status_err(status, "获取 Send 列表失败", &text));
        }
        let val: Value = serde_json::from_str(&text)
            .map_err(|e| CoreError::Network(format!("解析 Send 列表失败: {e}")))?;
        if let Some(arr) = val.get("data").or_else(|| val.get("Data")) {
            serde_json::from_value(arr.clone())
                .map_err(|e| CoreError::Network(format!("解析 Send 列表失败: {e}")))
        } else {
            serde_json::from_value(val)
                .map_err(|e| CoreError::Network(format!("解析 Send 列表失败: {e}")))
        }
    }

    pub async fn create_text_send(
        &self,
        server_url: &str,
        access_token: &str,
        payload: &SendCreateUpdatePayload,
    ) -> Result<SendDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .post(format!("{base}/api/sends"))
            .bearer_auth(access_token)
            .json(payload)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "创建 Send 失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析 Send 响应失败: {e}")))
    }

    pub async fn create_file_send(
        &self,
        server_url: &str,
        access_token: &str,
        payload: &SendCreateUpdatePayload,
        encrypted_file_name: &str,
        encrypted_file_bytes: Vec<u8>,
    ) -> Result<SendDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        // 1. Try modern /api/sends/file/v2 two-step upload flow first
        let v2_resp = self
            .http
            .post(format!("{base}/api/sends/file/v2"))
            .bearer_auth(access_token)
            .json(payload)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;

        let v2_status = v2_resp.status();
        if v2_status.is_success() {
            let body_text = v2_resp
                .text()
                .await
                .map_err(|e| CoreError::Network(e.to_string()))?;
            let v2: SendFileV2Response = serde_json::from_str(&body_text)
                .map_err(|e| CoreError::Network(format!("解析 Send 文件元数据失败: {e}")))?;

            let mut send_dto = v2
                .send_response
                .or_else(|| serde_json::from_str::<SendDto>(&body_text).ok().filter(|s| !s.id.is_empty()))
                .ok_or_else(|| CoreError::Network("服务端未返回 Send 文件响应".to_string()))?;

            let upload_url = if let Some(u) = v2.url.filter(|s| !s.trim().is_empty()) {
                if u.starts_with("http://") || u.starts_with("https://") {
                    u
                } else {
                    format!("{base}/{}", u.trim_start_matches('/'))
                }
            } else {
                let file_id = send_dto
                    .file
                    .as_ref()
                    .and_then(|f| f.id.as_deref())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("file");
                format!("{base}/api/sends/{}/file/{file_id}", send_dto.id)
            };

            let part = multipart::Part::bytes(encrypted_file_bytes)
                .file_name(encrypted_file_name.to_string())
                .mime_str("application/octet-stream")
                .map_err(|e| CoreError::Network(e.to_string()))?;
            let form = multipart::Form::new().part("data", part);
            let up_resp = self
                .http
                .post(&upload_url)
                .bearer_auth(access_token)
                .multipart(form)
                .send()
                .await
                .map_err(|e| CoreError::Network(e.to_string()))?;
            let up_status = up_resp.status();
            if !up_status.is_success() {
                let text = up_resp.text().await.unwrap_or_default();
                return Err(Self::map_http_status_err(up_status, "上传 Send 文件数据失败", &text));
            }
            if let Ok(updated) = up_resp.json::<SendDto>().await {
                if !updated.id.is_empty() {
                    send_dto = updated;
                }
            }
            return Ok(send_dto);
        }

        if v2_status != StatusCode::NOT_FOUND && v2_status != StatusCode::METHOD_NOT_ALLOWED {
            let text = v2_resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(v2_status, "创建文件 Send 失败", &text));
        }

        // 2. Fallback to legacy single multipart /api/sends/file endpoint
        let model_json = serde_json::to_string(payload)
            .map_err(|e| CoreError::Internal(format!("序列化 Send payload 失败: {e}")))?;
        let part = multipart::Part::bytes(encrypted_file_bytes)
            .file_name(encrypted_file_name.to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let form = multipart::Form::new()
            .text("model", model_json)
            .part("data", part);
        let resp = self
            .http
            .post(format!("{base}/api/sends/file"))
            .bearer_auth(access_token)
            .multipart(form)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "创建文件 Send 失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析文件 Send 响应失败: {e}")))
    }

    pub async fn update_send(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
        payload: &SendCreateUpdatePayload,
    ) -> Result<SendDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .put(format!("{base}/api/sends/{id}"))
            .bearer_auth(access_token)
            .json(payload)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "更新 Send 失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析 Send 响应失败: {e}")))
    }

    pub async fn remove_send_password(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
    ) -> Result<SendDto, CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .put(format!("{base}/api/sends/{id}/remove-password"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "移除 Send 密码失败", &text));
        }
        resp.json()
            .await
            .map_err(|e| CoreError::Network(format!("解析 Send 响应失败: {e}")))
    }

    pub async fn delete_send(
        &self,
        server_url: &str,
        access_token: &str,
        id: &str,
    ) -> Result<(), CoreError> {
        let base = Self::normalize_base_url(server_url)?;
        let resp = self
            .http
            .delete(format!("{base}/api/sends/{id}"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(Self::map_http_status_err(status, "删除 Send 失败", &text));
        }
        Ok(())
    }
}

fn extract_two_factor_providers(json: &Value) -> Vec<u8> {
    let arr = json
        .get("TwoFactorProviders")
        .or_else(|| json.get("twoFactorProviders"))
        .and_then(|v| v.as_array());
    let mut providers = Vec::new();
    if let Some(items) = arr {
        for item in items {
            if let Some(n) = item.as_u64() {
                providers.push(n as u8);
            } else if let Some(s) = item.as_str() {
                if let Ok(n) = s.parse::<u8>() {
                    providers.push(n);
                }
            }
        }
    }
    if providers.is_empty() {
        if let Some(obj) = json
            .get("TwoFactorProviders2")
            .or_else(|| json.get("twoFactorProviders2"))
            .and_then(|v| v.as_object())
        {
            for k in obj.keys() {
                if let Ok(n) = k.parse::<u8>() {
                    providers.push(n);
                }
            }
        }
    }
    providers
}
