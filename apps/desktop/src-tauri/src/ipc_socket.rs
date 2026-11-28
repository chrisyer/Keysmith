use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use keysmith_core::domain::codec::new_uuid;
use keysmith_core::domain::{
    domains_are_equivalent, extract_domain, is_domain_autofill_disabled, mask_card_number,
    AuthStatus, FieldPurpose, FieldType, GeneratorMode, GeneratorOptions, ItemCategory, ItemDetail,
    ItemDraft, ItemField, ItemFilter, ItemIcon, ItemSection, ItemUrl, UrlMatchRule,
    WatchtowerFlags, DEFAULT_PERSONAL_VAULT_ID,
};
use keysmith_core::passkey::{
    assert_passkey_credential, create_passkey_credential, normalize_rp_id, now_rfc3339,
    passkey_matches_credential_list, rp_id_matches_origin_ext, PasskeyAssertParams,
    PasskeyCreateParams,
};
use keysmith_core::session::localized_biometric_reason;
use keysmith_core::AppCore;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixListener;
#[cfg(windows)]
use tokio::net::windows::named_pipe::ServerOptions;
use url::Url;
use zeroize::Zeroizing;

use crate::commands::{
    apply_window_preferences, emit_data_changed, emit_session_state, emit_sync_status_and_poke,
    poke_signalr, show_main_window, AppState,
};
use crate::events::{UiFocusItemPayload, EVENT_UI_FOCUS_ITEM};

pub const APP_SUPPORT_DIR_NAME: &str = "dev.keysmith.desktop";
const SOCKET_FILE_NAME: &str = "keysmith.sock";
pub const NMH_TOKEN_FILE_NAME: &str = "ipc-nmh.token";
const CLI_TOKEN_FILE_NAME: &str = "ipc-cli.token";
#[cfg(windows)]
const WINDOWS_PIPE_NAME: &str = r"\\.\pipe\dev.keysmith.desktop";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ClientRole {
    BrowserExtension,
    Cli,
}

#[derive(Clone)]
struct IpcAuthTokens {
    nmh: Zeroizing<String>,
    cli: Zeroizing<String>,
}

static IPC_AUTH_TOKENS: OnceLock<RwLock<Option<IpcAuthTokens>>> = OnceLock::new();
static LAST_IPC_BIOMETRIC_ATTEMPT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn ipc_tokens_slot() -> &'static RwLock<Option<IpcAuthTokens>> {
    IPC_AUTH_TOKENS.get_or_init(|| RwLock::new(None))
}

fn generate_hex_token_256() -> Zeroizing<String> {
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    let mut out = String::with_capacity(64);
    for b in raw {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    Zeroizing::new(out)
}

fn write_ipc_token_file(dir: &Path, name: &str, token: &str) -> Result<(), String> {
    let path = dir.join(name);
    std::fs::write(&path, token.as_bytes())
        .map_err(|e| format!("Failed to write IPC token {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to chmod IPC token {}: {e}", path.display()))?;
    }
    #[cfg(windows)]
    {
        crate::windows_native::harden_path_current_user_only(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn init_ipc_tokens(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create IPC data dir {}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to chmod IPC data dir {}: {e}", dir.display()))?;
    }
    #[cfg(windows)]
    {
        crate::windows_native::harden_path_current_user_only(dir).map_err(|e| e.to_string())?;
    }
    let tokens = IpcAuthTokens {
        nmh: generate_hex_token_256(),
        cli: generate_hex_token_256(),
    };
    write_ipc_token_file(dir, NMH_TOKEN_FILE_NAME, &tokens.nmh)?;
    write_ipc_token_file(dir, CLI_TOKEN_FILE_NAME, &tokens.cli)?;
    let mut guard = ipc_tokens_slot().write().unwrap_or_else(|e| e.into_inner());
    *guard = Some(tokens);
    Ok(())
}

pub fn cleanup_ipc_tokens() {
    if let Some(dir) = resolve_app_data_dir() {
        let _ = std::fs::remove_file(dir.join(NMH_TOKEN_FILE_NAME));
        let _ = std::fs::remove_file(dir.join(CLI_TOKEN_FILE_NAME));
    }
    if let Ok(mut guard) = ipc_tokens_slot().write() {
        *guard = None;
    }
}

fn ct_eq_str(a: &str, b: &str) -> bool {
    a.len() == b.len() && bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}

fn authenticate_ipc_token(provided: Option<&str>) -> Option<ClientRole> {
    let raw = provided?.trim();
    if raw.is_empty() {
        return None;
    }
    let guard = ipc_tokens_slot().read().ok()?;
    let tokens = guard.as_ref()?;
    if ct_eq_str(raw, &tokens.nmh) {
        Some(ClientRole::BrowserExtension)
    } else if ct_eq_str(raw, &tokens.cli) {
        Some(ClientRole::Cli)
    } else {
        None
    }
}

fn is_method_allowed(role: ClientRole, method: &str) -> bool {
    match role {
        ClientRole::BrowserExtension => matches!(
            method,
            "status"
                | "list"
                | "search"
                | "get"
                | "item_get"
                | "totp"
                | "item_update_quick"
                | "item_trash"
                | "generate"
                | "generate_masked_email"
                | "clipboard_copy"
                | "url_match"
                | "cards_and_identities"
                | "check_login_save"
                | "save_or_update_login"
                | "check_sso_save"
                | "save_sso_login"
                | "passkey_list_for_rp"
                | "passkey_create"
                | "passkey_assert"
                | "passkey_match"
                | "open_desktop"
                | "unlock_biometric"
                | "focus_item"
        ),
        ClientRole::Cli => matches!(
            method,
            "status"
                | "list"
                | "search"
                | "get"
                | "item_get"
                | "totp"
                | "generate"
                | "resolve_secret_ref"
                | "ssh_list_keys"
                | "ssh_sign_ed25519"
                | "open_desktop"
        ),
    }
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: u64,
    method: String,
    #[serde(default, rename = "authToken")]
    auth_token: Option<String>,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct RpcResponse {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub fn resolve_app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        return Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_SUPPORT_DIR_NAME),
        );
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE").map(|u| PathBuf::from(u).join("AppData").join("Roaming"))
            })?;
        return Some(appdata.join(APP_SUPPORT_DIR_NAME));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))?;
        Some(base.join(APP_SUPPORT_DIR_NAME))
    }
}

pub fn resolve_socket_path() -> Option<PathBuf> {
    if let Some(override_path) = std::env::var_os("KEYSMITH_SOCKET") {
        if !override_path.is_empty() {
            return Some(PathBuf::from(override_path));
        }
    }
    #[cfg(windows)]
    {
        return Some(PathBuf::from(WINDOWS_PIPE_NAME));
    }
    #[cfg(not(windows))]
    {
        Some(resolve_app_data_dir()?.join(SOCKET_FILE_NAME))
    }
}

pub fn spawn_ipc_socket_server(app: AppHandle, core: Arc<AppCore>) {
    let Some(sock_path) = resolve_socket_path() else {
        eprintln!("[keysmith] cannot resolve IPC endpoint path");
        return;
    };

    if let Some(data_dir) = resolve_app_data_dir() {
        if let Err(err) = init_ipc_tokens(&data_dir) {
            eprintln!("[keysmith] failed to initialize IPC auth tokens: {err}");
        }
    }

    #[cfg(unix)]
    {
        if let Some(dir) = resolve_app_data_dir() {
            let ssh_sock = dir.join("ssh-agent.sock");
            let core_ssh = Arc::clone(&core);
            tauri::async_runtime::spawn(async move {
                spawn_embedded_ssh_agent(ssh_sock, core_ssh).await;
            });
        }
    }

    #[cfg(unix)]
    tauri::async_runtime::spawn(async move {
        if let Some(parent) = sock_path.parent() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                eprintln!("[keysmith] failed to create IPC socket dir: {err}");
                return;
            }
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
        if sock_path.exists() {
            let _ = std::fs::remove_file(&sock_path);
        }

        let listener = match UnixListener::bind(&sock_path) {
            Ok(l) => l,
            Err(err) => {
                eprintln!(
                    "[keysmith] failed to bind IPC socket {}: {err}",
                    sock_path.display()
                );
                return;
            }
        };

        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&sock_path, std::fs::Permissions::from_mode(0o600));
        }

        let expected_uid = unsafe { libc::geteuid() };
        while let Ok((stream, _)) = listener.accept().await {
            let peer_uid_ok = stream
                .peer_cred()
                .map(|c| c.uid() == expected_uid)
                .unwrap_or(false);
            if !peer_uid_ok {
                eprintln!("[security] rejected keysmith.sock connection from foreign peer UID");
                continue;
            }
            let a = app.clone();
            let c = Arc::clone(&core);
            tokio::spawn(handle_connection(stream, a, c));
        }
    });

    #[cfg(windows)]
    tauri::async_runtime::spawn(async move {
        let pipe_name = sock_path.to_string_lossy().to_string();
        let create_pipe_instance = |first: bool| -> Result<tokio::net::windows::named_pipe::NamedPipeServer, String> {
            let mut opts = ServerOptions::new();
            opts.first_pipe_instance(first);
            opts.reject_remote_clients(true);
            crate::windows_native::with_current_user_security_attributes(|sa| unsafe {
                opts.create_with_security_attributes_raw(&pipe_name, sa)
            })?
            .map_err(|e| e.to_string())
        };
        let mut server = match create_pipe_instance(true) {
            Ok(s) => s,
            Err(err) => {
                eprintln!("[keysmith] failed to create Windows named pipe {pipe_name}: {err}");
                return;
            }
        };

        loop {
            if let Err(err) = server.connect().await {
                eprintln!("[keysmith] named pipe accept error: {err}");
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                continue;
            }
            let connected = server;
            let a = app.clone();
            let c = Arc::clone(&core);
            tokio::spawn(handle_connection(connected, a, c));

            server = match create_pipe_instance(false) {
                Ok(s) => s,
                Err(err) => {
                    eprintln!("[keysmith] failed to create next pipe instance: {err}");
                    break;
                }
            };
        }
    });
}

async fn handle_connection<S>(stream: S, app: AppHandle, core: Arc<AppCore>)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut lines = BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<RpcRequest>(trimmed) {
            Ok(req) => {
                let id = req.id;
                match authenticate_ipc_token(req.auth_token.as_deref()) {
                    Some(role) if is_method_allowed(role, &req.method) => {
                        match dispatch_rpc(&app, &core, role, &req.method, &req.params).await {
                            Ok(val) => RpcResponse {
                                id,
                                ok: true,
                                result: Some(val),
                                error: None,
                            },
                            Err(err) => RpcResponse {
                                id,
                                ok: false,
                                result: None,
                                error: Some(err),
                            },
                        }
                    }
                    Some(_) => RpcResponse {
                        id,
                        ok: false,
                        result: None,
                        error: Some(format!(
                            "Forbidden RPC method '{}' for this IPC client role",
                            req.method
                        )),
                    },
                    None => RpcResponse {
                        id,
                        ok: false,
                        result: None,
                        error: Some(
                            "Unauthorized IPC client: missing or invalid authToken".to_string(),
                        ),
                    },
                }
            }
            Err(err) => RpcResponse {
                id: 0,
                ok: false,
                result: None,
                error: Some(format!("Invalid JSON request: {err}")),
            },
        };

        if let Ok(mut out) = serde_json::to_vec(&resp) {
            out.push(b'\n');
            if writer.write_all(&out).await.is_err() {
                break;
            }
            let _ = writer.flush().await;
        }
    }
}

async fn dispatch_rpc(
    app: &AppHandle,
    core: &Arc<AppCore>,
    role: ClientRole,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    match method {
        "status" => {
            let state = core.session_get_state();
            let mut val = serde_json::to_value(state).map_err(|e| e.to_string())?;
            let settings = core.app_settings_get().unwrap_or_default();
            if let Some(obj) = val.as_object_mut() {
                obj.insert("language".to_string(), Value::String(settings.language));
                obj.insert(
                    "autoCopyTotp".to_string(),
                    Value::Bool(settings.auto_copy_totp_on_fill),
                );
                obj.insert(
                    "disabledAutofillDomains".to_string(),
                    serde_json::to_value(settings.disabled_autofill_domains)
                        .unwrap_or(Value::Array(Vec::new())),
                );
            }
            Ok(val)
        }
        "list" | "search" => {
            let query = params
                .get("query")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let items = core
                .item_list(ItemFilter {
                    query,
                    trashed: Some(false),
                    archived: Some(false),
                    ..Default::default()
                })
                .map_err(|e| e.to_string())?;
            serde_json::to_value(items).map_err(|e| e.to_string())
        }
        "get" | "item_get" => rpc_get(core, role, params).await,
        "totp" => rpc_totp(core, params).await,
        "item_update_quick" => rpc_item_update_quick(app, core, params).await,
        "item_trash" => rpc_item_trash(app, core, params).await,
        "generate" => rpc_generate(core, params),
        "generate_masked_email" => rpc_generate_masked_email(core, params).await,
        "resolve_secret_ref" => rpc_resolve_secret_ref(core, params).await,
        "clipboard_copy" => rpc_clipboard_copy(core, params),
        "url_match" => rpc_url_match(core, params),
        "cards_and_identities" => rpc_cards_and_identities(core),
        "check_login_save" => rpc_check_login_save(core, params),
        "save_or_update_login" => rpc_save_or_update_login(app, core, params).await,
        "check_sso_save" => rpc_check_sso_save(core, params),
        "save_sso_login" => rpc_save_sso_login(app, core, params).await,
        "passkey_list_for_rp" => rpc_passkey_list_for_rp(core, params),
        "passkey_create" => rpc_passkey_create(app, core, params).await,
        "passkey_assert" => rpc_passkey_assert(app, core, params).await,
        "open_desktop" => {
            show_main_window(app);
            Ok(json!({ "opened": true }))
        }
        "unlock_biometric" => {
            let st = core.session_get_state();
            if st.status == AuthStatus::Unlocked {
                return Ok(json!({ "unlocked": true, "status": "Unlocked" }));
            }
            if st.status != AuthStatus::Locked {
                return Err("Please sign in to Keysmith first".to_string());
            }
            if !st.biometric_enabled {
                return Err("Biometric unlock is not enabled".to_string());
            }
            {
                let mut guard = LAST_IPC_BIOMETRIC_ATTEMPT
                    .get_or_init(|| Mutex::new(None))
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(prev) = *guard {
                    if prev.elapsed() < Duration::from_secs(5) {
                        return Err("Biometric unlock requested too frequently; please try again shortly".to_string());
                    }
                }
                *guard = Some(Instant::now());
            }
            let session = core
                .session_unlock_biometric()
                .await
                .map_err(|e| e.to_string())?;
            emit_session_state(app, &session, "biometric");
            apply_window_preferences(app, &session);
            if let Some(state) = app.try_state::<AppState>() {
                poke_signalr(&state);
            }
            Ok(json!({ "unlocked": true, "status": "Unlocked" }))
        }
        "focus_item" => {
            let item_id = params
                .get("itemId")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "Missing itemId parameter".to_string())?
                .to_string();
            if let Some(win) = app.get_webview_window("quick-access") {
                let _ = win.hide();
            }
            show_main_window(app);
            let _ = app.emit_to(
                "main",
                EVENT_UI_FOCUS_ITEM,
                UiFocusItemPayload { item_id },
            );
            Ok(json!({ "focused": true }))
        }
        "ssh_list_keys" => {
            if !core
                .app_settings_get()
                .map(|s| s.ssh_agent_enabled)
                .unwrap_or(false)
            {
                return Ok(json!({ "keys": [] }));
            }
            let identities = core.ssh_list_identities().map_err(|e| e.to_string())?;
            let keys: Vec<Value> = identities
                .into_iter()
                .map(|ident| {
                    json!({
                        "id": ident.item_id,
                        "title": ident.title,
                        "publicKey": ident.public_key,
                        "fingerprintSha256": ident.fingerprint_sha256,
                    })
                })
                .collect();
            Ok(json!({ "keys": keys }))
        }
        "ssh_sign_ed25519" => rpc_ssh_sign_ed25519(core, params).await,
        "passkey_match" => rpc_passkey_match(core, params),
        other => Err(format!("Unsupported RPC method: {other}")),
    }
}

fn require_unlocked(core: &AppCore) -> Result<(), String> {
    let state = core.session_get_state();
    match state.status {
        AuthStatus::Unlocked => Ok(()),
        AuthStatus::Locked => Err("Keysmith vault is locked; please unlock first".to_string()),
        AuthStatus::Unauthenticated => Err("Please sign in to Keysmith first".to_string()),
    }
}

fn rpc_generate(core: &AppCore, params: &Value) -> Result<Value, String> {
    let mut opts = GeneratorOptions::default();
    let mode_str = params
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if mode_str == "passphrase"
        || params.get("passphrase").and_then(|v| v.as_bool()) == Some(true)
    {
        opts.mode = GeneratorMode::Passphrase;
    } else if mode_str == "pin" {
        opts.mode = GeneratorMode::Pin;
    }

    if let Some(len) = params.get("length").and_then(|v| v.as_u64()) {
        let len_usize = (len as usize).clamp(4, 128);
        match opts.mode {
            GeneratorMode::Passphrase => opts.word_count = len_usize.clamp(3, 12),
            GeneratorMode::Pin => opts.pin_length = len_usize.clamp(4, 16),
            GeneratorMode::Password => opts.length = len_usize,
        }
    }
    if let Some(wc) = params.get("wordCount").and_then(|v| v.as_u64()) {
        opts.word_count = (wc as usize).clamp(3, 12);
    }
    if let Some(pl) = params.get("pinLength").and_then(|v| v.as_u64()) {
        opts.pin_length = (pl as usize).clamp(4, 16);
    }
    if let Some(b) = params.get("includeDigits").and_then(|v| v.as_bool()) {
        opts.include_digits = b;
    }
    if let Some(b) = params.get("includeSymbols").and_then(|v| v.as_bool()) {
        opts.include_symbols = b;
    }
    if let Some(b) = params.get("excludeAmbiguous").and_then(|v| v.as_bool()) {
        opts.exclude_ambiguous = b;
    }
    if let Some(b) = params.get("capitalize").and_then(|v| v.as_bool()) {
        opts.capitalize = b;
    }
    if let Some(b) = params.get("includeNumberInPhrase").and_then(|v| v.as_bool()) {
        opts.include_number_in_phrase = b;
    }
    if let Some(sep) = params.get("separator").and_then(|v| v.as_str()) {
        if !sep.is_empty() && sep.len() <= 4 {
            opts.separator = sep.to_string();
        }
    }

    let res = core.generator_generate(opts);
    serde_json::to_value(res).map_err(|e| e.to_string())
}

async fn rpc_generate_masked_email(core: &Arc<AppCore>, params: &Value) -> Result<Value, String> {
    let domain_hint = params
        .get("domain")
        .or_else(|| params.get("url"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let alias = core
        .generator_generate_masked_email(domain_hint)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({
        "email": alias,
        "value": alias,
    }))
}

async fn rpc_resolve_secret_ref(core: &Arc<AppCore>, params: &Value) -> Result<Value, String> {
    require_unlocked(core)?;
    let reference = params
        .get("reference")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing reference parameter".to_string())?;
    let (item, value) = core
        .resolve_secret_reference(reference)
        .map_err(|e| e.to_string())?;
    if item.payload.reprompt {
        core.session_verify_biometric_reprompt(None)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(json!({
        "id": item.id,
        "title": item.title,
        "value": value,
    }))
}

fn rpc_clipboard_copy(core: &AppCore, params: &Value) -> Result<Value, String> {
    require_unlocked(core)?;
    let value = params
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing value parameter".to_string())?;
    let label = params
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("Browser Extension");
    let sensitive = params
        .get("sensitive")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    core.clipboard_copy_secret(value, label, sensitive)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "copied": true }))
}

fn find_item_by_id_or_title(core: &AppCore, id_or_title: &str) -> Result<ItemDetail, String> {
    let needle = id_or_title.trim();
    if needle.is_empty() {
        return Err("Missing item ID or title".to_string());
    }
    if let Some(exact) = core.item_get(needle).map_err(|e| e.to_string())? {
        return Ok(exact);
    }

    let list = core
        .item_list(ItemFilter {
            trashed: Some(false),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    let needle_lower = needle.to_lowercase();
    let matched = list
        .iter()
        .find(|s| s.title.to_lowercase() == needle_lower)
        .or_else(|| {
            list.iter()
                .find(|s| s.title.to_lowercase().contains(&needle_lower))
        })
        .ok_or_else(|| format!("Matching item not found: {needle}"))?;

    core.item_get(&matched.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Item not found".to_string())
}

fn extract_credentials(item: &ItemDetail) -> (Option<String>, Option<String>, Option<String>) {
    let mut username = None;
    let mut password = None;
    let mut totp = None;
    for sec in &item.payload.sections {
        for f in &sec.fields {
            if f.value.trim().is_empty() {
                continue;
            }
            if username.is_none()
                && (f.purpose == Some(FieldPurpose::Username) || f.field_type == FieldType::Email)
            {
                username = Some(f.value.clone());
            }
            if password.is_none()
                && (f.purpose == Some(FieldPurpose::Password)
                    || f.field_type == FieldType::Password)
            {
                password = Some(f.value.clone());
            }
            if totp.is_none()
                && (f.purpose == Some(FieldPurpose::Totp) || f.field_type == FieldType::Totp)
            {
                totp = Some(f.value.clone());
            }
        }
    }
    (username, password, totp)
}

fn sanitize_rpc_item_value(val: &mut Value, role: ClientRole, reveal_cli: bool) {
    let Some(obj) = val.as_object_mut() else {
        return;
    };
    let redact_all_sensitive = role == ClientRole::Cli && !reveal_cli;
    if redact_all_sensitive {
        if obj.get("password").and_then(|v| v.as_str()).is_some() {
            obj.insert("password".to_string(), Value::String("[REDACTED]".to_string()));
        }
        if obj.get("totp").and_then(|v| v.as_str()).is_some() {
            obj.insert("totp".to_string(), Value::String("[REDACTED]".to_string()));
        }
        obj.insert("redacted".to_string(), Value::Bool(true));
    }

    if let Some(payload) = obj.get_mut("payload").and_then(|v| v.as_object_mut()) {
        if let Some(passkeys) = payload.get_mut("passkeys").and_then(|v| v.as_array_mut()) {
            for pk in passkeys {
                if let Some(pk_obj) = pk.as_object_mut() {
                    pk_obj.remove("privateKeyPkcs8");
                }
            }
        }
        if let Some(history) = payload
            .get_mut("passwordHistory")
            .and_then(|v| v.as_array_mut())
        {
            for entry in history {
                if let Some(e_obj) = entry.as_object_mut() {
                    if e_obj.get("password").and_then(|v| v.as_str()).is_some() {
                        e_obj.insert("password".to_string(), Value::String("[REDACTED]".to_string()));
                    }
                }
            }
        }
        if let Some(sections) = payload.get_mut("sections").and_then(|v| v.as_array_mut()) {
            for sec in sections {
                let Some(fields) = sec.get_mut("fields").and_then(|v| v.as_array_mut()) else {
                    continue;
                };
                for f in fields {
                    let Some(f_obj) = f.as_object_mut() else {
                        continue;
                    };
                    let ftype = f_obj.get("fieldType").and_then(|v| v.as_str()).unwrap_or("");
                    let is_ssh_priv = ftype == "SshPrivateKey";
                    let is_sensitive_field = f_obj
                        .get("sensitive")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                        || matches!(
                            ftype,
                            "Password" | "Totp" | "SshPrivateKey"
                        );
                    if is_ssh_priv || (redact_all_sensitive && is_sensitive_field) {
                        f_obj.insert("value".to_string(), Value::String("[REDACTED]".to_string()));
                    }
                }
            }
        }
    }
}

async fn rpc_get(core: &AppCore, role: ClientRole, params: &Value) -> Result<Value, String> {
    let id_or_title = params
        .get("idOrTitle")
        .or_else(|| params.get("itemId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing idOrTitle parameter".to_string())?;
    let item = find_item_by_id_or_title(core, id_or_title)?;
    let reveal_cli = params
        .get("reveal")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if item.payload.reprompt {
        let verify_bio = params
            .get("verifyBiometric")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if verify_bio {
            core.session_verify_biometric_reprompt(None)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            return Err("This item requires master password reprompt".to_string());
        }
    }

    if let Some(field_name) = params
        .get("field")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let target_lower = field_name.to_lowercase();
        if target_lower == "notes" {
            return Ok(json!({
                "id": item.id,
                "title": item.title,
                "field": field_name,
                "value": item.payload.notes,
            }));
        }
        if target_lower == "title" {
            return Ok(json!({
                "id": item.id,
                "title": item.title,
                "field": field_name,
                "value": item.title,
            }));
        }

        for sec in &item.payload.sections {
            for f in &sec.fields {
                let purpose_match = f
                    .purpose
                    .and_then(|p| serde_json::to_value(p).ok())
                    .and_then(|v| v.as_str().map(str::to_string))
                    .map(|p| p.eq_ignore_ascii_case(&target_lower))
                    .unwrap_or(false);
                let type_match = serde_json::to_value(f.field_type)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .map(|t| t.eq_ignore_ascii_case(&target_lower))
                    .unwrap_or(false);
                let label_match = f.label.to_lowercase() == target_lower;
                if purpose_match || type_match || label_match {
                    if role == ClientRole::BrowserExtension
                        && f.field_type == FieldType::SshPrivateKey
                    {
                        return Err("Browser extension cannot access SSH private keys".to_string());
                    }
                    let redacted = role == ClientRole::Cli
                        && !reveal_cli
                        && (f.sensitive
                            || matches!(
                                f.field_type,
                                FieldType::Password
                                    | FieldType::Totp
                                    | FieldType::SshPrivateKey
                            ));
                    let value = if redacted {
                        "[REDACTED]".to_string()
                    } else {
                        f.value.clone()
                    };
                    return Ok(json!({
                        "id": item.id,
                        "title": item.title,
                        "field": field_name,
                        "value": value,
                        "redacted": redacted,
                    }));
                }
            }
        }
        return Err(format!("Field \"{field_name}\" not found in item \"{}\"", item.title));
    }

    let (username, password, totp) = extract_credentials(&item);
    let mut val = serde_json::to_value(&item).map_err(|e| e.to_string())?;
    if let Some(obj) = val.as_object_mut() {
        obj.insert("hasTotp".to_string(), Value::Bool(totp.is_some()));
        if let Some(ref sso) = item.payload.sso_provider {
            obj.insert("ssoProvider".to_string(), Value::String(sso.clone()));
        }
        if let Some(u) = username {
            obj.insert("username".to_string(), Value::String(u));
        }
        if let Some(p) = password {
            obj.insert("password".to_string(), Value::String(p));
        }
        if let Some(t) = totp {
            obj.insert("totp".to_string(), Value::String(t));
        }
    }
    sanitize_rpc_item_value(&mut val, role, reveal_cli);
    Ok(val)
}

async fn rpc_totp(core: &AppCore, params: &Value) -> Result<Value, String> {
    let id_or_title = params
        .get("idOrTitle")
        .or_else(|| params.get("itemId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing idOrTitle parameter".to_string())?;
    let item = find_item_by_id_or_title(core, id_or_title)?;
    if item.payload.reprompt {
        let verify_bio = params
            .get("verifyBiometric")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if verify_bio {
            core.session_verify_biometric_reprompt(None)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            return Err("This item requires master password reprompt".to_string());
        }
    }
    let (_, _, totp_opt) = extract_credentials(&item);
    let secret = totp_opt.ok_or_else(|| format!("TOTP is not configured on item \"{}\"", item.title))?;
    let code = core.totp_compute(&secret).map_err(|e| e.to_string())?;
    serde_json::to_value(code).map_err(|e| e.to_string())
}

async fn rpc_item_update_quick(
    app: &AppHandle,
    core: &Arc<AppCore>,
    params: &Value,
) -> Result<Value, String> {
    require_unlocked(core)?;
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing itemId parameter".to_string())?;
    let existing = core
        .item_get(item_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Item not found: {item_id}"))?;

    if existing.payload.reprompt {
        let verify_bio = params
            .get("verifyBiometric")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if verify_bio {
            core.session_verify_biometric_reprompt(None)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            return Err("This item requires master password reprompt".to_string());
        }
    }

    let mut draft = existing.to_draft();
    if let Some(title) = params
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        draft.title = title.to_string();
    }
    if let Some(username) = params.get("username").and_then(|v| v.as_str()) {
        upsert_section_field(
            &mut draft.sections,
            FieldPurpose::Username,
            "用户名",
            FieldType::Text,
            false,
            username.trim(),
        );
    }
    if let Some(password) = params.get("password").and_then(|v| v.as_str()) {
        upsert_section_field(
            &mut draft.sections,
            FieldPurpose::Password,
            "密码",
            FieldType::Password,
            true,
            password,
        );
    }
    if let Some(notes) = params.get("notes").and_then(|v| v.as_str()) {
        draft.notes = notes.to_string();
    }
    if let Some(url_str) = params.get("url").and_then(|v| v.as_str()) {
        let trimmed_url = url_str.trim();
        if trimmed_url.is_empty() {
            if !draft.urls.is_empty() {
                draft.urls.remove(0);
            }
        } else if let Some(first) = draft.urls.first_mut() {
            first.uri = trimmed_url.to_string();
        } else {
            draft.urls.push(ItemUrl {
                id: format!("u-{}", new_uuid()),
                uri: trimmed_url.to_string(),
                label: None,
                match_rule: UrlMatchRule::Domain,
            });
        }
    }

    let updated = core
        .item_update(&existing.id, draft)
        .await
        .map_err(|e| e.to_string())?;
    emit_data_changed(app, false, vec![updated.id.clone()], Vec::new());
    emit_sync_status_and_poke(app, core);
    Ok(json!({ "updated": true, "id": updated.id, "title": updated.title }))
}

async fn rpc_item_trash(
    app: &AppHandle,
    core: &Arc<AppCore>,
    params: &Value,
) -> Result<Value, String> {
    require_unlocked(core)?;
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing itemId parameter".to_string())?;
    let existing = core
        .item_get(item_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Item not found: {item_id}"))?;
    if existing.payload.reprompt {
        let verify_bio = params
            .get("verifyBiometric")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if verify_bio {
            core.session_verify_biometric_reprompt(None)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            return Err("This item requires master password reprompt".to_string());
        }
    }
    core.item_trash(&existing.id)
        .await
        .map_err(|e| e.to_string())?;
    emit_data_changed(app, true, Vec::new(), vec![existing.id.clone()]);
    emit_sync_status_and_poke(app, core);
    Ok(json!({ "trashed": true, "id": existing.id }))
}

fn parse_url_host(raw: &str) -> Option<(Url, String)> {
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let parsed = Url::parse(&candidate).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    Some((parsed, host))
}

fn registrable_domain(host: &str) -> &str {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() >= 2 {
        let idx = host.len() - parts[parts.len() - 1].len() - parts[parts.len() - 2].len() - 1;
        &host[idx..]
    } else {
        host
    }
}

fn url_matches_target(
    item_uri: &str,
    rule: UrlMatchRule,
    target_raw: &str,
    target_url: &Url,
    target_host: &str,
    custom_equivalents: &[Vec<String>],
) -> bool {
    if rule == UrlMatchRule::Never || item_uri.trim().is_empty() {
        return false;
    }
    match rule {
        UrlMatchRule::Never => false,
        UrlMatchRule::Exact => item_uri.trim().eq_ignore_ascii_case(target_raw.trim()),
        UrlMatchRule::StartsWith => target_raw
            .trim()
            .to_ascii_lowercase()
            .starts_with(&item_uri.trim().to_ascii_lowercase()),
        UrlMatchRule::Host => {
            if let Some((item_parsed, item_host)) = parse_url_host(item_uri) {
                item_host == target_host
                    && item_parsed.port_or_known_default() == target_url.port_or_known_default()
            } else {
                false
            }
        }
        UrlMatchRule::Domain => {
            if let Some((_, item_host)) = parse_url_host(item_uri) {
                if item_host == target_host
                    || registrable_domain(&item_host) == registrable_domain(target_host)
                {
                    return true;
                }
                domains_are_equivalent(&item_host, target_host, custom_equivalents)
            } else {
                false
            }
        }
    }
}

fn item_matches_url(
    item: &ItemDetail,
    raw_url: &str,
    target_url: &Url,
    target_host: &str,
    custom_equivalents: &[Vec<String>],
) -> bool {
    if item.payload.urls.iter().any(|u| {
        url_matches_target(
            &u.uri,
            u.match_rule,
            raw_url,
            target_url,
            target_host,
            custom_equivalents,
        )
    }) {
        return true;
    }
    item.payload.passkeys.iter().any(|pk| {
        let pk_rp = pk.rp_id.trim().to_ascii_lowercase();
        !pk_rp.is_empty()
            && (target_host == pk_rp
                || target_host.ends_with(&format!(".{pk_rp}"))
                || registrable_domain(&pk_rp) == registrable_domain(target_host)
                || domains_are_equivalent(&pk_rp, target_host, custom_equivalents))
    })
}

fn rpc_url_match(core: &AppCore, params: &Value) -> Result<Value, String> {
    let raw_url = params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing url parameter".to_string())?;

    let Some((target_url, target_host)) = parse_url_host(raw_url) else {
        return Ok(json!([]));
    };

    let settings = core.app_settings_get().unwrap_or_default();
    let site_disabled =
        is_domain_autofill_disabled(&target_host, &settings.disabled_autofill_domains);
    let auto_copy_totp = settings.auto_copy_totp_on_fill;
    let custom_equiv = &settings.custom_equivalent_domains;

    let summaries = core
        .item_list(ItemFilter {
            trashed: Some(false),
            archived: Some(false),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    let mut matches = Vec::new();
    for sum in summaries {
        if sum.primary_url.is_none()
            && !sum.has_passkey
            && sum.category != ItemCategory::Login
            && sum.category != ItemCategory::Password
            && sum.category != ItemCategory::Passkey
        {
            continue;
        }
        let Ok(Some(item)) = core.item_get(&sum.id) else {
            continue;
        };
        if !item_matches_url(&item, raw_url, &target_url, &target_host, custom_equiv) {
            continue;
        }

        let (username, password, totp_secret) = extract_credentials(&item);
        let reprompt = item.payload.reprompt;
        let totp_code = if reprompt {
            None
        } else {
            totp_secret
                .as_deref()
                .and_then(|s| core.totp_compute(s).ok())
                .map(|c| c.code)
        };
        let urls: Vec<&str> = item.payload.urls.iter().map(|u| u.uri.as_str()).collect();
        let passkey_count = item.payload.passkeys.len();

        matches.push(json!({
            "id": item.id,
            "title": item.title,
            "category": item.payload.category,
            "favorite": item.favorite,
            "reprompt": reprompt,
            "ssoProvider": item.payload.sso_provider,
            "username": username,
            "password": if reprompt { Value::Null } else { password.map(Value::String).unwrap_or(Value::Null) },
            "totp": totp_code,
            "hasTotp": totp_secret.is_some(),
            "hasPasskey": passkey_count > 0,
            "passkeyCount": passkey_count,
            "autoCopyTotp": auto_copy_totp,
            "siteAutofillDisabled": site_disabled,
            "urls": urls,
        }));
    }

    Ok(Value::Array(matches))
}

fn find_field_value<'a>(item: &'a ItemDetail, purposes: &[FieldPurpose], labels: &[&str], types: &[FieldType]) -> Option<String> {
    let all_fields: Vec<&ItemField> = item
        .payload
        .sections
        .iter()
        .flat_map(|s| s.fields.iter())
        .collect();
    for p in purposes {
        if let Some(f) = all_fields.iter().find(|f| f.purpose == Some(*p) && !f.value.trim().is_empty()) {
            return Some(f.value.trim().to_string());
        }
    }
    for t in types {
        if let Some(f) = all_fields.iter().find(|f| f.field_type == *t && !f.value.trim().is_empty()) {
            return Some(f.value.trim().to_string());
        }
    }
    for lbl in labels {
        let lbl_lower = lbl.to_ascii_lowercase();
        if let Some(f) = all_fields
            .iter()
            .find(|f| !f.value.trim().is_empty() && f.label.to_ascii_lowercase().contains(&lbl_lower))
        {
            return Some(f.value.trim().to_string());
        }
    }
    None
}

fn rpc_cards_and_identities(core: &AppCore) -> Result<Value, String> {
    require_unlocked(core)?;
    let summaries = core
        .item_list(ItemFilter {
            trashed: Some(false),
            archived: Some(false),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    let mut cards = Vec::new();
    let mut identities = Vec::new();

    for sum in summaries {
        match sum.category {
            ItemCategory::CreditCard => {
                let Ok(Some(item)) = core.item_get(&sum.id) else {
                    continue;
                };
                let reprompt = item.payload.reprompt;
                let number = find_field_value(&item, &[FieldPurpose::CardNumber], &["卡号", "number"], &[FieldType::Number]);
                let last4 = number.as_deref().map(mask_card_number).unwrap_or_default();
                let expiry = find_field_value(&item, &[FieldPurpose::CardExpiry], &["有效期", "exp"], &[FieldType::MonthYear]);
                let (exp_year, exp_month) = if let Some(exp) = &expiry {
                    if let Some((y, m)) = exp.split_once('-').or_else(|| exp.split_once('/')) {
                        (y.trim().to_string(), m.trim().to_string())
                    } else {
                        (String::new(), String::new())
                    }
                } else {
                    (String::new(), String::new())
                };
                let holder = find_field_value(&item, &[], &["持卡人", "holder", "name"], &[]);
                let cvv = find_field_value(&item, &[FieldPurpose::CardCvv], &["cvv", "安全码"], &[]);
                let brand = find_field_value(&item, &[], &["卡组织", "brand"], &[]);

                cards.push(json!({
                    "id": item.id,
                    "title": item.title,
                    "reprompt": reprompt,
                    "holder": holder,
                    "maskedNumber": last4,
                    "number": if reprompt { Value::Null } else { number.map(Value::String).unwrap_or(Value::Null) },
                    "expiry": expiry,
                    "expYear": exp_year,
                    "expMonth": exp_month,
                    "cvv": if reprompt { Value::Null } else { cvv.map(Value::String).unwrap_or(Value::Null) },
                    "brand": brand,
                }));
            }
            ItemCategory::Identity => {
                let Ok(Some(item)) = core.item_get(&sum.id) else {
                    continue;
                };
                let reprompt = item.payload.reprompt;
                let first_name = find_field_value(&item, &[], &["名", "first"], &[]);
                let last_name = find_field_value(&item, &[], &["姓", "last"], &[]);
                let full_name = find_field_value(&item, &[], &["姓名", "full"], &[]).or_else(|| {
                    match (first_name.as_deref(), last_name.as_deref()) {
                        (Some(f), Some(l)) => Some(format!("{f} {l}")),
                        (Some(f), None) => Some(f.to_string()),
                        (None, Some(l)) => Some(l.to_string()),
                        _ => None,
                    }
                });
                let company = find_field_value(&item, &[], &["公司", "company"], &[]);
                let email = find_field_value(&item, &[FieldPurpose::Username], &["邮箱", "email"], &[FieldType::Email]);
                let phone = find_field_value(&item, &[], &["电话", "手机", "phone"], &[FieldType::Phone]);
                let address = find_field_value(&item, &[], &["地址", "address"], &[FieldType::Address]);

                identities.push(json!({
                    "id": item.id,
                    "title": item.title,
                    "reprompt": reprompt,
                    "fullName": full_name,
                    "firstName": first_name,
                    "lastName": last_name,
                    "company": company,
                    "email": email,
                    "phone": phone,
                    "address": address,
                }));
            }
            _ => {}
        }
    }

    Ok(json!({ "cards": cards, "identities": identities }))
}

fn rpc_check_login_save(core: &AppCore, params: &Value) -> Result<Value, String> {
    if core.session_get_state().status != AuthStatus::Unlocked {
        return Ok(json!({ "shouldPrompt": false, "reason": "locked" }));
    }
    let raw_url = params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing url parameter".to_string())?;
    let username = params
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let password = params
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if password.is_empty() {
        return Ok(json!({ "shouldPrompt": false, "reason": "empty_password" }));
    }

    let Some((target_url, target_host)) = parse_url_host(raw_url) else {
        return Ok(json!({ "shouldPrompt": false, "reason": "invalid_url" }));
    };
    let custom_equiv = core
        .app_settings_get()
        .map(|s| s.custom_equivalent_domains)
        .unwrap_or_default();

    let summaries = core
        .item_list(ItemFilter {
            trashed: Some(false),
            archived: Some(false),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    let mut matched_same_domain: Vec<(String, String, Option<String>, Option<String>)> = Vec::new();
    for sum in summaries {
        if sum.category != ItemCategory::Login && sum.category != ItemCategory::Password {
            continue;
        }
        let Ok(Some(item)) = core.item_get(&sum.id) else {
            continue;
        };
        if !item_matches_url(&item, raw_url, &target_url, &target_host, &custom_equiv) {
            continue;
        }
        let (u, p, _) = extract_credentials(&item);
        if let (Some(existing_u), Some(existing_p)) = (u.as_deref(), p.as_deref()) {
            let user_same = if username.is_empty() {
                false
            } else {
                existing_u.trim().eq_ignore_ascii_case(username)
            };
            if user_same && existing_p == password {
                return Ok(json!({
                    "shouldPrompt": false,
                    "reason": "already_saved",
                    "itemId": item.id,
                }));
            }
            if user_same && existing_p != password {
                return Ok(json!({
                    "shouldPrompt": true,
                    "mode": "update",
                    "itemId": item.id,
                    "title": item.title,
                    "existingUsername": existing_u,
                    "suggestedTitle": extract_domain(raw_url),
                }));
            }
        }
        matched_same_domain.push((item.id, item.title, u, p));
    }

    // Also handle password-only change forms where username wasn't present on the page
    if username.is_empty() && matched_same_domain.len() == 1 {
        let (id, title, existing_u, existing_p) = &matched_same_domain[0];
        if existing_p.as_deref() == Some(password) {
            return Ok(json!({
                "shouldPrompt": false,
                "reason": "already_saved",
                "itemId": id,
            }));
        }
        return Ok(json!({
            "shouldPrompt": true,
            "mode": "update",
            "itemId": id,
            "title": title,
            "existingUsername": existing_u,
            "suggestedTitle": extract_domain(raw_url),
        }));
    }

    Ok(json!({
        "shouldPrompt": true,
        "mode": "create",
        "suggestedTitle": extract_domain(raw_url),
        "existingCount": matched_same_domain.len(),
    }))
}

fn upsert_section_field(
    sections: &mut Vec<ItemSection>,
    purpose: FieldPurpose,
    label: &str,
    field_type: FieldType,
    sensitive: bool,
    value: &str,
) {
    for sec in sections.iter_mut() {
        if let Some(f) = sec.fields.iter_mut().find(|f| f.purpose == Some(purpose)) {
            f.value = value.to_string();
            return;
        }
    }
    if sections.is_empty() {
        sections.push(ItemSection {
            id: format!("sec-{}", new_uuid()),
            title: "登录信息".to_string(),
            fields: Vec::new(),
        });
    }
    sections[0].fields.push(ItemField {
        id: format!("f-{}", new_uuid()),
        label: label.to_string(),
        field_type,
        value: value.to_string(),
        sensitive,
        copyable: true,
        purpose: Some(purpose),
    });
}

async fn rpc_save_or_update_login(
    app: &AppHandle,
    core: &Arc<AppCore>,
    params: &Value,
) -> Result<Value, String> {
    require_unlocked(core)?;

    let raw_url = params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing url parameter".to_string())?;
    let username = params
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let password = params
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let title_param = params
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let host = extract_domain(raw_url);
    let normalized_url = if raw_url.contains("://") {
        Url::parse(raw_url)
            .map(|u| format!("{}://{}", u.scheme(), u.host_str().unwrap_or(&host)))
            .unwrap_or_else(|_| raw_url.to_string())
    } else {
        format!("https://{host}")
    };

    if let Some(id) = item_id {
        let existing = core
            .item_get(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Item not found: {id}"))?;
        let mut draft = existing.to_draft();
        if let Some(t) = title_param {
            draft.title = t;
        }
        if !username.is_empty() {
            upsert_section_field(
                &mut draft.sections,
                FieldPurpose::Username,
                "用户名",
                FieldType::Text,
                false,
                &username,
            );
        }
        if !password.is_empty() {
            upsert_section_field(
                &mut draft.sections,
                FieldPurpose::Password,
                "密码",
                FieldType::Password,
                true,
                &password,
            );
        }
        if let Some((target_url, target_host)) = parse_url_host(raw_url) {
            let custom_equiv = core
                .app_settings_get()
                .map(|s| s.custom_equivalent_domains)
                .unwrap_or_default();
            let already_has_url = draft.urls.iter().any(|u| {
                url_matches_target(
                    &u.uri,
                    u.match_rule,
                    raw_url,
                    &target_url,
                    &target_host,
                    &custom_equiv,
                )
            });
            if !already_has_url {
                draft.urls.push(ItemUrl {
                    id: format!("u-{}", new_uuid()),
                    uri: normalized_url,
                    label: None,
                    match_rule: UrlMatchRule::Domain,
                });
            }
        }
        let saved = core
            .item_update(&existing.id, draft)
            .await
            .map_err(|e| e.to_string())?;
        emit_data_changed(app, false, vec![saved.id.clone()], Vec::new());
        emit_sync_status_and_poke(app, core);
        return Ok(json!({
            "action": "updated",
            "itemId": saved.id,
            "title": saved.title,
        }));
    }

    if username.is_empty() && password.is_empty() {
        return Err("Username and password cannot both be empty".to_string());
    }

    let title = title_param.unwrap_or_else(|| {
        if host.is_empty() {
            "新登录条目".to_string()
        } else {
            host.clone()
        }
    });

    let mut fields = Vec::new();
    if !username.is_empty() {
        fields.push(ItemField {
            id: format!("f-user-{}", new_uuid()),
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
            id: format!("f-pass-{}", new_uuid()),
            label: "密码".to_string(),
            field_type: FieldType::Password,
            value: password,
            sensitive: true,
            copyable: true,
            purpose: Some(FieldPurpose::Password),
        });
    }

    let draft = ItemDraft {
        id: None,
        vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
        title,
        favorite: false,
        category: ItemCategory::Login,
        subtitle: None,
        icon: if host.is_empty() {
            None
        } else {
            Some(ItemIcon::Domain { host })
        },
        tags: Vec::new(),
        urls: vec![ItemUrl {
            id: format!("u-{}", new_uuid()),
            uri: normalized_url,
            label: None,
            match_rule: UrlMatchRule::Domain,
        }],
        sections: vec![ItemSection {
            id: format!("sec-{}", new_uuid()),
            title: "登录信息".to_string(),
            fields,
        }],
        passkeys: Vec::new(),
        notes: String::new(),
        password_history: Vec::new(),
        watchtower: WatchtowerFlags::default(),
        archived: false,
        reprompt: false,
        ..Default::default()
    };

    let saved = core
        .item_create(draft)
        .await
        .map_err(|e| e.to_string())?;
    emit_data_changed(app, false, vec![saved.id.clone()], Vec::new());
    emit_sync_status_and_poke(app, core);
    Ok(json!({
        "action": "created",
        "itemId": saved.id,
        "title": saved.title,
    }))
}

fn rpc_check_sso_save(core: &AppCore, params: &Value) -> Result<Value, String> {
    if core.session_get_state().status != AuthStatus::Unlocked {
        return Ok(json!({ "shouldPrompt": false, "reason": "locked" }));
    }
    let raw_url = params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing url parameter".to_string())?;
    let provider = params
        .get("provider")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing provider parameter".to_string())?;

    let Some((target_url, target_host)) = parse_url_host(raw_url) else {
        return Ok(json!({ "shouldPrompt": false, "reason": "invalid_url" }));
    };

    let settings = core.app_settings_get().unwrap_or_default();
    if is_domain_autofill_disabled(&target_host, &settings.disabled_autofill_domains) {
        return Ok(json!({ "shouldPrompt": false, "reason": "site_disabled" }));
    }

    let summaries = core
        .item_list(ItemFilter {
            trashed: Some(false),
            archived: Some(false),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    let mut attach_candidate: Option<(String, String, Option<String>)> = None;
    for sum in summaries {
        if sum.category != ItemCategory::Login
            && sum.category != ItemCategory::Password
            && sum.category != ItemCategory::Passkey
        {
            continue;
        }
        let Ok(Some(item)) = core.item_get(&sum.id) else {
            continue;
        };
        if !item_matches_url(
            &item,
            raw_url,
            &target_url,
            &target_host,
            &settings.custom_equivalent_domains,
        ) {
            continue;
        }
        if let Some(ref existing_sso) = item.payload.sso_provider {
            if existing_sso.trim().eq_ignore_ascii_case(provider) {
                return Ok(json!({
                    "shouldPrompt": false,
                    "reason": "already_saved",
                    "itemId": item.id,
                }));
            }
        } else if attach_candidate.is_none() && sum.category == ItemCategory::Login {
            let (u, _, _) = extract_credentials(&item);
            attach_candidate = Some((item.id, item.title, u));
        }
    }

    if let Some((item_id, title, existing_u)) = attach_candidate {
        return Ok(json!({
            "shouldPrompt": true,
            "mode": "attach",
            "itemId": item_id,
            "title": title,
            "existingUsername": existing_u,
            "provider": provider,
            "suggestedTitle": extract_domain(raw_url),
        }));
    }

    Ok(json!({
        "shouldPrompt": true,
        "mode": "create",
        "provider": provider,
        "suggestedTitle": extract_domain(raw_url),
    }))
}

async fn rpc_save_sso_login(
    app: &AppHandle,
    core: &Arc<AppCore>,
    params: &Value,
) -> Result<Value, String> {
    require_unlocked(core)?;

    let raw_url = params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing url parameter".to_string())?;
    let provider = params
        .get("provider")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing provider parameter".to_string())?
        .to_string();
    let username = params
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let title_param = params
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let host = extract_domain(raw_url);
    let normalized_url = if raw_url.contains("://") {
        Url::parse(raw_url)
            .map(|u| format!("{}://{}", u.scheme(), u.host_str().unwrap_or(&host)))
            .unwrap_or_else(|_| raw_url.to_string())
    } else {
        format!("https://{host}")
    };

    if let Some(id) = item_id {
        let existing = core
            .item_get(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Item not found: {id}"))?;
        let mut draft = existing.to_draft();
        draft.sso_provider = Some(provider.clone());
        if let Some(t) = title_param {
            draft.title = t;
        }
        if !username.is_empty() {
            upsert_section_field(
                &mut draft.sections,
                FieldPurpose::Username,
                "用户名",
                FieldType::Text,
                false,
                &username,
            );
        }
        if let Some((target_url, target_host)) = parse_url_host(raw_url) {
            let custom_equiv = core
                .app_settings_get()
                .map(|s| s.custom_equivalent_domains)
                .unwrap_or_default();
            let already_has_url = draft.urls.iter().any(|u| {
                url_matches_target(
                    &u.uri,
                    u.match_rule,
                    raw_url,
                    &target_url,
                    &target_host,
                    &custom_equiv,
                )
            });
            if !already_has_url {
                draft.urls.push(ItemUrl {
                    id: format!("u-{}", new_uuid()),
                    uri: normalized_url,
                    label: None,
                    match_rule: UrlMatchRule::Domain,
                });
            }
        }
        let saved = core
            .item_update(&existing.id, draft)
            .await
            .map_err(|e| e.to_string())?;
        emit_data_changed(app, false, vec![saved.id.clone()], Vec::new());
        emit_sync_status_and_poke(app, core);
        return Ok(json!({
            "action": "updated",
            "itemId": saved.id,
            "title": saved.title,
            "ssoProvider": provider,
        }));
    }

    let title = title_param.unwrap_or_else(|| {
        if host.is_empty() {
            format!("{provider} SSO")
        } else {
            host.clone()
        }
    });

    let mut fields = Vec::new();
    if !username.is_empty() {
        fields.push(ItemField {
            id: format!("f-user-{}", new_uuid()),
            label: "用户名".to_string(),
            field_type: FieldType::Text,
            value: username,
            sensitive: false,
            copyable: true,
            purpose: Some(FieldPurpose::Username),
        });
    }

    let draft = ItemDraft {
        id: None,
        vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
        title,
        favorite: false,
        category: ItemCategory::Login,
        subtitle: None,
        icon: if host.is_empty() {
            None
        } else {
            Some(ItemIcon::Domain { host })
        },
        tags: Vec::new(),
        urls: vec![ItemUrl {
            id: format!("u-{}", new_uuid()),
            uri: normalized_url,
            label: None,
            match_rule: UrlMatchRule::Domain,
        }],
        sections: vec![ItemSection {
            id: format!("sec-{}", new_uuid()),
            title: "登录信息".to_string(),
            fields,
        }],
        passkeys: Vec::new(),
        notes: String::new(),
        password_history: Vec::new(),
        watchtower: WatchtowerFlags::default(),
        archived: false,
        reprompt: false,
        sso_provider: Some(provider.clone()),
        ..Default::default()
    };

    let saved = core
        .item_create(draft)
        .await
        .map_err(|e| e.to_string())?;
    emit_data_changed(app, false, vec![saved.id.clone()], Vec::new());
    emit_sync_status_and_poke(app, core);
    Ok(json!({
        "action": "created",
        "itemId": saved.id,
        "title": saved.title,
        "ssoProvider": provider,
    }))
}

fn extract_str_array(val: Option<&Value>) -> Vec<String> {
    val.and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|elem| {
                    elem.as_str()
                        .map(str::to_string)
                        .or_else(|| elem.get("id").and_then(|id| id.as_str()).map(str::to_string))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn rpc_passkey_list_for_rp(core: &AppCore, params: &Value) -> Result<Value, String> {
    let rp_id_raw = params
        .get("rpId")
        .and_then(|v| v.as_str())
        .map(normalize_rp_id)
        .unwrap_or_default();
    let rp_id_explicit = params
        .get("rpIdExplicit")
        .and_then(|v| v.as_bool())
        .unwrap_or(!rp_id_raw.is_empty());
    let origin = params
        .get("origin")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    let tab_url = params
        .get("tabUrl")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");

    let resolved_rp_id = if rp_id_raw.is_empty() {
        parse_url_host(origin)
            .map(|(_, h)| normalize_rp_id(&h))
            .unwrap_or_default()
    } else {
        rp_id_raw
    };
    eprintln!(
        "[audit] passkey_list_for_rp rp_id={} origin={} tab_url={}",
        resolved_rp_id, origin, tab_url
    );

    let state = core.session_get_state();
    if state.status != AuthStatus::Unlocked {
        return Ok(json!({
            "locked": true,
            "signedOut": state.status == AuthStatus::Unauthenticated,
            "biometricEnabled": state.biometric_enabled,
            "rpId": resolved_rp_id,
            "excluded": false,
            "passkeys": [],
            "candidates": [],
        }));
    }

    let custom_equiv = core
        .app_settings_get()
        .map(|s| s.custom_equivalent_domains)
        .unwrap_or_default();

    if !origin.is_empty() && !rp_id_matches_origin_ext(&resolved_rp_id, origin, &custom_equiv) {
        return Err(format!("Passkey RP ID ({resolved_rp_id}) does not match origin ({origin})"));
    }

    let allow_ids = extract_str_array(params.get("allowCredentials"));
    let exclude_ids = extract_str_array(params.get("excludeCredentials"));

    let summaries = core
        .item_list(ItemFilter {
            trashed: Some(false),
            archived: Some(false),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    let parsed_origin = if origin.is_empty() {
        None
    } else {
        parse_url_host(origin)
    };

    let mut passkeys = Vec::new();
    let mut candidates = Vec::new();
    let mut excluded = false;

    for sum in summaries {
        if !sum.has_passkey
            && sum.category != ItemCategory::Login
            && sum.category != ItemCategory::Passkey
            && sum.category != ItemCategory::Password
        {
            continue;
        }
        let Ok(Some(item)) = core.item_get(&sum.id) else {
            continue;
        };

        for pk in &item.payload.passkeys {
            if pk.private_key_pkcs8.trim().is_empty() {
                continue;
            }
            let pk_rp = normalize_rp_id(&pk.rp_id);
            let rp_matches = !pk_rp.is_empty()
                && (pk_rp == resolved_rp_id
                    || domains_are_equivalent(&pk_rp, &resolved_rp_id, &custom_equiv)
                    || (!rp_id_explicit
                        && !origin.is_empty()
                        && rp_id_matches_origin_ext(&pk_rp, origin, &custom_equiv)));
            if !rp_matches {
                continue;
            }
            if !exclude_ids.is_empty() && passkey_matches_credential_list(pk, &exclude_ids) {
                excluded = true;
            }
            if !allow_ids.is_empty() && !passkey_matches_credential_list(pk, &allow_ids) {
                continue;
            }
            passkeys.push(json!({
                "itemId": item.id,
                "itemTitle": item.title,
                "credentialId": pk.credential_id,
                "rpId": pk_rp,
                "rpName": pk.rp_name,
                "userName": pk.user_name,
                "userDisplayName": pk.user_display_name,
                "createdAt": pk.created_at,
                "lastUsedAt": pk.last_used_at,
                "reprompt": item.payload.reprompt,
            }));
        }

        if matches!(item.payload.category, ItemCategory::Login | ItemCategory::Passkey) {
            let matches_origin = if let Some((ref orig_url, ref orig_host)) = parsed_origin {
                item_matches_url(&item, origin, orig_url, orig_host, &custom_equiv)
            } else if let Some((ref rp_url, ref rp_host)) = parse_url_host(&resolved_rp_id) {
                item_matches_url(&item, &resolved_rp_id, rp_url, rp_host, &custom_equiv)
            } else {
                false
            };
            if matches_origin {
                let (username, _, _) = extract_credentials(&item);
                candidates.push(json!({
                    "itemId": item.id,
                    "title": item.title,
                    "username": username,
                    "passkeyCount": item.payload.passkeys.len(),
                    "reprompt": item.payload.reprompt,
                }));
            }
        }
    }

    Ok(json!({
        "locked": false,
        "rpId": resolved_rp_id,
        "excluded": excluded,
        "passkeys": passkeys,
        "candidates": candidates,
    }))
}

fn validate_passkey_origin_and_tab(
    origin: &str,
    tab_url: &str,
    cross_origin: bool,
) -> Result<(), String> {
    let parsed_orig = Url::parse(origin)
        .map_err(|_| format!("Invalid Passkey origin: {origin}"))?;
    if !matches!(parsed_orig.scheme(), "http" | "https") {
        return Err(format!("Unsupported Passkey origin scheme: {origin}"));
    }
    if !cross_origin && !tab_url.is_empty() {
        if let Ok(parsed_tab) = Url::parse(tab_url) {
            if matches!(parsed_tab.scheme(), "http" | "https")
                && parsed_tab.origin().ascii_serialization()
                    != parsed_orig.origin().ascii_serialization()
            {
                return Err(format!(
                    "Non-cross-origin Passkey tab origin ({}) does not match frame origin ({origin})",
                    parsed_tab.origin().ascii_serialization()
                ));
            }
        }
    }
    Ok(())
}

async fn rpc_passkey_create(
    app: &AppHandle,
    core: &Arc<AppCore>,
    params: &Value,
) -> Result<Value, String> {
    require_unlocked(core)?;

    let origin = params
        .get("origin")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing origin parameter".to_string())?
        .to_string();
    let tab_url = params
        .get("tabUrl")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    let options = params
        .get("options")
        .ok_or_else(|| "Missing WebAuthn options parameter".to_string())?;
    let cross_origin_flag = params
        .get("crossOrigin")
        .and_then(|v| v.as_bool())
        .or_else(|| options.get("crossOrigin").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    validate_passkey_origin_and_tab(&origin, tab_url, cross_origin_flag)?;

    let rp_id = options
        .get("rp")
        .and_then(|r| r.get("id"))
        .and_then(|v| v.as_str())
        .map(normalize_rp_id)
        .filter(|s| !s.is_empty())
        .or_else(|| parse_url_host(&origin).map(|(_, h)| normalize_rp_id(&h)))
        .ok_or_else(|| "Unable to resolve WebAuthn RP ID".to_string())?;
    eprintln!(
        "[audit] passkey_create rp_id={} origin={} tab_url={}",
        rp_id, origin, tab_url
    );

    let custom_equiv = core
        .app_settings_get()
        .map(|s| s.custom_equivalent_domains)
        .unwrap_or_default();

    if !rp_id_matches_origin_ext(&rp_id, &origin, &custom_equiv) {
        return Err(format!("Passkey RP ID ({rp_id}) does not match origin ({origin})"));
    }

    let exclude_ids = extract_str_array(options.get("excludeCredentials"));
    if !exclude_ids.is_empty() {
        let existing_items = core
            .item_list(ItemFilter {
                passkey_only: Some(true),
                trashed: Some(false),
                archived: Some(false),
                ..Default::default()
            })
            .map_err(|e| e.to_string())?;
        for sum in existing_items {
            if let Ok(Some(item)) = core.item_get(&sum.id) {
                if item.payload.passkeys.iter().any(|pk| {
                    normalize_rp_id(&pk.rp_id) == rp_id
                        && passkey_matches_credential_list(pk, &exclude_ids)
                }) {
                    return Ok(json!({
                        "handled": true,
                        "errorName": "InvalidStateError",
                        "error": "A passkey for this account is already registered in Keysmith",
                    }));
                }
            }
        }
    }

    let rp_name = options
        .get("rp")
        .and_then(|r| r.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or(&rp_id)
        .to_string();
    let user = options
        .get("user")
        .ok_or_else(|| "Missing WebAuthn user field".to_string())?;
    let user_id_b64u = user
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let raw_user_name = user
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let raw_user_display = user
        .get("displayName")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let user_name = raw_user_name
        .or(raw_user_display)
        .unwrap_or("Passkey User")
        .to_string();
    let user_display_name = raw_user_display.unwrap_or(&user_name).to_string();
    let challenge_b64u = options
        .get("challenge")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing WebAuthn challenge".to_string())?
        .to_string();

    let pub_key_cred_params: Vec<i32> = options
        .get("pubKeyCredParams")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    p.get("alg").and_then(|a| {
                        a.as_i64()
                            .map(|n| n as i32)
                            .or_else(|| a.as_str().and_then(|s| s.trim().parse::<i32>().ok()))
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let discoverable = options
        .get("authenticatorSelection")
        .and_then(|s| s.get("residentKey").or_else(|| s.get("requireResidentKey")))
        .map(|v| match v {
            Value::Bool(b) => *b,
            Value::String(s) => s != "discouraged",
            _ => true,
        })
        .unwrap_or(true);
    let authenticator_attachment = options
        .get("authenticatorSelection")
        .and_then(|s| s.get("authenticatorAttachment"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let cross_origin = cross_origin_flag;

    let prf_ext_in = options.get("extensions").and_then(|e| e.get("prf"));
    let prf_requested = prf_ext_in.is_some();
    let prf_eval_first_b64u = prf_ext_in
        .and_then(|p| p.get("eval"))
        .and_then(|ev| ev.get("first"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let prf_eval_second_b64u = prf_ext_in
        .and_then(|p| p.get("eval"))
        .and_then(|ev| ev.get("second"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let created = create_passkey_credential(&PasskeyCreateParams {
        origin: origin.clone(),
        rp_id: rp_id.clone(),
        rp_name: rp_name.clone(),
        user_id_b64u,
        user_name: user_name.clone(),
        user_display_name,
        challenge_b64u,
        pub_key_cred_params,
        discoverable,
        cross_origin,
        authenticator_attachment,
        prf_requested,
        prf_eval_first_b64u,
        prf_eval_second_b64u,
        custom_equivalent_domains: custom_equiv.clone(),
    })
    .map_err(|e| e.to_string())?;

    let target_item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let saved = if let Some(item_id) = target_item_id {
        let existing = core
            .item_get(item_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Target item not found: {item_id}"))?;
        let mut draft = existing.to_draft();
        draft.passkeys.push(created.credential);
        if let Some((orig_url, orig_host)) = parse_url_host(&origin) {
            let has_url = draft.urls.iter().any(|u| {
                url_matches_target(
                    &u.uri,
                    u.match_rule,
                    &origin,
                    &orig_url,
                    &orig_host,
                    &custom_equiv,
                )
            });
            if !has_url {
                draft.urls.push(ItemUrl {
                    id: format!("u-{}", new_uuid()),
                    uri: origin.clone(),
                    label: None,
                    match_rule: UrlMatchRule::Domain,
                });
            }
        }
        core.item_update(&existing.id, draft)
            .await
            .map_err(|e| e.to_string())?
    } else {
        let title = params
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                if !rp_name.trim().is_empty() && rp_name != rp_id {
                    rp_name.clone()
                } else {
                    rp_id.clone()
                }
            });
        let draft = ItemDraft {
            id: None,
            vault_id: DEFAULT_PERSONAL_VAULT_ID.to_string(),
            title,
            favorite: false,
            category: ItemCategory::Login,
            subtitle: None,
            icon: Some(ItemIcon::Domain {
                host: rp_id.clone(),
            }),
            tags: Vec::new(),
            urls: vec![ItemUrl {
                id: format!("u-{}", new_uuid()),
                uri: origin.clone(),
                label: None,
                match_rule: UrlMatchRule::Domain,
            }],
            sections: vec![ItemSection {
                id: format!("sec-{}", new_uuid()),
                title: "登录信息".to_string(),
                fields: vec![ItemField {
                    id: format!("f-user-{}", new_uuid()),
                    label: "用户名".to_string(),
                    field_type: FieldType::Text,
                    value: user_name,
                    sensitive: false,
                    copyable: true,
                    purpose: Some(FieldPurpose::Username),
                }],
            }],
            passkeys: vec![created.credential],
            notes: String::new(),
            password_history: Vec::new(),
            watchtower: WatchtowerFlags::default(),
            archived: false,
            reprompt: false,
            ..Default::default()
        };
        core.item_create(draft).await.map_err(|e| e.to_string())?
    };

    emit_data_changed(app, false, vec![saved.id.clone()], Vec::new());
    emit_sync_status_and_poke(app, core);

    Ok(json!({
        "handled": true,
        "itemId": saved.id,
        "title": saved.title,
        "credential": created.response_json,
    }))
}

async fn rpc_passkey_assert(
    app: &AppHandle,
    core: &Arc<AppCore>,
    params: &Value,
) -> Result<Value, String> {
    require_unlocked(core)?;

    let origin = params
        .get("origin")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing origin parameter".to_string())?
        .to_string();
    let tab_url = params
        .get("tabUrl")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing itemId parameter".to_string())?;
    let credential_id = params
        .get("credentialId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing credentialId parameter".to_string())?;
    let options = params
        .get("options")
        .ok_or_else(|| "Missing WebAuthn options parameter".to_string())?;
    let challenge_b64u = options
        .get("challenge")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing WebAuthn challenge".to_string())?
        .to_string();

    let item = core
        .item_get(item_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Item not found: {item_id}"))?;

    if item.payload.reprompt {
        let verify_bio = params
            .get("verifyBiometric")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if verify_bio {
            core.session_verify_biometric_reprompt(None)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            return Err("This passkey requires master password reprompt".to_string());
        }
    }

    let pk_idx = item
        .payload
        .passkeys
        .iter()
        .position(|pk| {
            pk.credential_id == credential_id
                || passkey_matches_credential_list(pk, &[credential_id.to_string()])
        })
        .ok_or_else(|| "Matching passkey credential not found".to_string())?;

    let pk = &item.payload.passkeys[pk_idx];
    let rp_id_explicit = options
        .get("rpIdExplicit")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let rp_id = if rp_id_explicit {
        options
            .get("rpId")
            .and_then(|v| v.as_str())
            .map(normalize_rp_id)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| normalize_rp_id(&pk.rp_id))
    } else {
        normalize_rp_id(&pk.rp_id)
    };
    let cross_origin = params
        .get("crossOrigin")
        .and_then(|v| v.as_bool())
        .or_else(|| options.get("crossOrigin").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    validate_passkey_origin_and_tab(&origin, tab_url, cross_origin)?;
    eprintln!(
        "[audit] passkey_assert rp_id={} origin={} tab_url={}",
        rp_id, origin, tab_url
    );

    let custom_equiv = core
        .app_settings_get()
        .map(|s| s.custom_equivalent_domains)
        .unwrap_or_default();

    let prf_ext_in = options.get("extensions").and_then(|e| e.get("prf"));
    let cred_b64u_id = keysmith_core::passkey::decode_credential_id_bytes(&pk.credential_id)
        .ok()
        .map(|b| keysmith_core::passkey::encode_b64u(&b))
        .unwrap_or_default();
    let eval_source = prf_ext_in
        .and_then(|p| p.get("evalByCredential"))
        .and_then(|m| m.get(&cred_b64u_id).or_else(|| m.get(&pk.credential_id)))
        .or_else(|| prf_ext_in.and_then(|p| p.get("eval")));
    let prf_eval_first_b64u = eval_source
        .and_then(|ev| ev.get("first"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let prf_eval_second_b64u = eval_source
        .and_then(|ev| ev.get("second"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let (next_sign_count, response_json) = assert_passkey_credential(
        pk,
        &PasskeyAssertParams {
            origin,
            rp_id,
            challenge_b64u,
            cross_origin,
            prf_eval_first_b64u,
            prf_eval_second_b64u,
            custom_equivalent_domains: custom_equiv,
        },
    )
    .map_err(|e| e.to_string())?;

    let mut draft = item.to_draft();
    if let Some(target_pk) = draft.passkeys.get_mut(pk_idx) {
        target_pk.sign_count = next_sign_count;
        target_pk.last_used_at = Some(now_rfc3339());
    }

    if let Ok(updated) = core.item_update(&item.id, draft).await {
        emit_data_changed(app, false, vec![updated.id], Vec::new());
        emit_sync_status_and_poke(app, core);
    }

    Ok(json!({
        "handled": true,
        "credential": response_json,
    }))
}

static SSH_BIO_APPROVAL_CACHE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

fn ssh_approval_cache() -> &'static Mutex<HashMap<String, Instant>> {
    SSH_BIO_APPROVAL_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn clear_ssh_approval_cache() {
    if let Ok(mut map) = ssh_approval_cache().lock() {
        map.clear();
    }
}

async fn rpc_ssh_sign_ed25519(core: &Arc<AppCore>, params: &Value) -> Result<Value, String> {
    if !core
        .app_settings_get()
        .map(|s| s.ssh_agent_enabled)
        .unwrap_or(false)
    {
        return Err("Keysmith SSH Agent is disabled in Settings".to_string());
    }
    let session = core.session_get_state();
    if session.status != AuthStatus::Unlocked {
        return Err("Keysmith vault is locked; please unlock first".to_string());
    }
    let target_blob = params
        .get("publicKeyBlob")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing publicKeyBlob parameter".to_string())?;
    let data_b64 = params
        .get("data")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing data parameter".to_string())?;
    let raw_data = B64
        .decode(data_b64.trim())
        .map_err(|e| format!("Failed to decode base64 data: {e}"))?;

    let ssh_items = core
        .item_list(ItemFilter {
            category: Some(ItemCategory::SshKey),
            trashed: Some(false),
            archived: Some(false),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    for sum in ssh_items {
        let Ok(Some(item)) = core.item_get(&sum.id) else {
            continue;
        };
        let fields: Vec<_> = item
            .payload
            .sections
            .iter()
            .flat_map(|s| s.fields.iter())
            .collect();
        let pub_matches = fields
            .iter()
            .filter(|f| f.field_type == FieldType::SshPublicKey)
            .any(|f| {
                f.value
                    .split_whitespace()
                    .nth(1)
                    .map(|blob| blob == target_blob)
                    .unwrap_or(false)
            });
        if !pub_matches {
            continue;
        }
        let priv_key = fields
            .iter()
            .find(|f| f.field_type == FieldType::SshPrivateKey && !f.value.trim().is_empty())
            .map(|f| f.value.clone())
            .ok_or_else(|| format!("SSH key \"{}\" is missing private key material", item.title))?;

        let needs_confirm = session.ssh_biometric_confirm || item.payload.reprompt;
        if needs_confirm {
            let cache_key = format!("{}:{target_blob}", session.account_id);
            let cached_valid = {
                let mut map = ssh_approval_cache()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                map.retain(|_, ts| ts.elapsed() < Duration::from_secs(60));
                map.contains_key(&cache_key)
            };
            if !cached_valid {
                let lang = core
                    .app_settings_get()
                    .map(|s| s.language)
                    .unwrap_or_else(|_| "en".to_string());
                let reason = format!(
                    "{} ({})",
                    localized_biometric_reason(&lang, "ssh"),
                    item.title
                );
                core.session_verify_user_presence(Some(&reason))
                    .await
                    .map_err(|e| e.to_string())?;
                if let Ok(mut map) = ssh_approval_cache().lock() {
                    map.insert(cache_key, Instant::now());
                }
            }
        }

        let sig = core
            .ssh_sign_ed25519(&priv_key, &raw_data)
            .map_err(|e| e.to_string())?;
        return Ok(json!({ "signature": B64.encode(&sig) }));
    }

    Err("No matching Ed25519 private key found in unlocked vault".to_string())
}

#[cfg(unix)]
async fn spawn_embedded_ssh_agent(sock_path: PathBuf, core: Arc<AppCore>) {
    if let Some(parent) = sock_path.parent() {
        let _ = std::fs::create_dir_all(parent);
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
    }
    if sock_path.exists() {
        let _ = std::fs::remove_file(&sock_path);
    }
    let Ok(listener) = UnixListener::bind(&sock_path) else {
        return;
    };
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&sock_path, std::fs::Permissions::from_mode(0o600));
    }
    let expected_uid = unsafe { libc::geteuid() };
    while let Ok((stream, _)) = listener.accept().await {
        let peer_uid_ok = stream
            .peer_cred()
            .map(|c| c.uid() == expected_uid)
            .unwrap_or(false);
        if !peer_uid_ok {
            eprintln!("[security] rejected ssh-agent.sock connection from foreign peer UID");
            continue;
        }
        let c = Arc::clone(&core);
        tokio::spawn(handle_ssh_agent_client(stream, c));
    }
}

#[cfg(unix)]
fn ssh_write_string(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(bytes);
}

#[cfg(unix)]
fn ssh_read_string<'a>(slice: &mut &'a [u8]) -> Option<&'a [u8]> {
    if slice.len() < 4 {
        return None;
    }
    let len = u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]) as usize;
    *slice = &slice[4..];
    if slice.len() < len {
        return None;
    }
    let (head, tail) = slice.split_at(len);
    *slice = tail;
    Some(head)
}

#[cfg(unix)]
async fn handle_ssh_agent_client(mut stream: tokio::net::UnixStream, core: Arc<AppCore>) {
    const SSH_AGENT_FAILURE: u8 = 5;
    const SSH_AGENTC_REQUEST_IDENTITIES: u8 = 11;
    const SSH_AGENT_IDENTITIES_ANSWER: u8 = 12;
    const SSH_AGENTC_SIGN_REQUEST: u8 = 13;
    const SSH_AGENT_SIGN_RESPONSE: u8 = 14;

    loop {
        let mut len_buf = [0u8; 4];
        if stream.read_exact(&mut len_buf).await.is_err() {
            break;
        }
        let frame_len = u32::from_be_bytes(len_buf) as usize;
        if frame_len == 0 || frame_len > 256 * 1024 {
            break;
        }
        let mut body = vec![0u8; frame_len];
        if stream.read_exact(&mut body).await.is_err() {
            break;
        }
        let msg_type = body[0];
        let mut payload = &body[1..];

        let reply: Vec<u8> = match msg_type {
            SSH_AGENTC_REQUEST_IDENTITIES => {
                let agent_enabled = core
                    .app_settings_get()
                    .map(|s| s.ssh_agent_enabled)
                    .unwrap_or(false);
                if !agent_enabled {
                    let mut out = vec![SSH_AGENT_IDENTITIES_ANSWER];
                    out.extend_from_slice(&0u32.to_be_bytes());
                    out
                } else {
                    match core.ssh_list_identities() {
                        Ok(idents) => {
                            let mut entries: Vec<(Vec<u8>, String)> = Vec::new();
                            for ident in idents {
                                if let Some(b64_part) = ident.public_key.split_whitespace().nth(1) {
                                    if let Ok(blob) = B64.decode(b64_part) {
                                        entries.push((blob, ident.title));
                                    }
                                }
                            }
                            let mut out = Vec::new();
                            out.push(SSH_AGENT_IDENTITIES_ANSWER);
                            out.extend_from_slice(&(entries.len() as u32).to_be_bytes());
                            for (blob, comment) in entries {
                                ssh_write_string(&mut out, &blob);
                                ssh_write_string(&mut out, comment.as_bytes());
                            }
                            out
                        }
                        Err(_) => {
                            let mut out = vec![SSH_AGENT_IDENTITIES_ANSWER];
                            out.extend_from_slice(&0u32.to_be_bytes());
                            out
                        }
                    }
                }
            }
            SSH_AGENTC_SIGN_REQUEST => {
                match (ssh_read_string(&mut payload), ssh_read_string(&mut payload)) {
                    (Some(key_blob), Some(data)) if !key_blob.is_empty() => {
                        let flags = if payload.len() >= 4 {
                            u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]])
                        } else {
                            0
                        };
                        let req_params = json!({
                            "publicKeyBlob": B64.encode(key_blob),
                            "data": B64.encode(data),
                            "flags": flags,
                        });
                        match rpc_ssh_sign_ed25519(&core, &req_params).await {
                            Ok(val) => {
                                if let Some(sig_b64) =
                                    val.get("signature").and_then(|v| v.as_str())
                                {
                                    if let Ok(raw_sig) = B64.decode(sig_b64) {
                                        let mut sig_blob = Vec::with_capacity(19 + raw_sig.len());
                                        ssh_write_string(&mut sig_blob, b"ssh-ed25519");
                                        ssh_write_string(&mut sig_blob, &raw_sig);
                                        let mut out = vec![SSH_AGENT_SIGN_RESPONSE];
                                        ssh_write_string(&mut out, &sig_blob);
                                        out
                                    } else {
                                        vec![SSH_AGENT_FAILURE]
                                    }
                                } else {
                                    vec![SSH_AGENT_FAILURE]
                                }
                            }
                            Err(_) => vec![SSH_AGENT_FAILURE],
                        }
                    }
                    _ => vec![SSH_AGENT_FAILURE],
                }
            }
            _ => vec![SSH_AGENT_FAILURE],
        };

        let mut frame = Vec::with_capacity(4 + reply.len());
        frame.extend_from_slice(&(reply.len() as u32).to_be_bytes());
        frame.extend_from_slice(&reply);
        if stream.write_all(&frame).await.is_err() || stream.flush().await.is_err() {
            break;
        }
    }
}

fn rpc_passkey_match(core: &AppCore, params: &Value) -> Result<Value, String> {
    let rp_id = params
        .get("rpId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            params
                .get("options")
                .and_then(|o| o.get("rpId").or_else(|| o.get("rp").and_then(|r| r.get("id"))))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("")
        .to_string();

    let resolved_rp_id = if rp_id.is_empty() {
        params
            .get("origin")
            .and_then(|v| v.as_str())
            .and_then(|o| parse_url_host(o).map(|(_, h)| h))
            .unwrap_or_default()
    } else {
        rp_id
    };

    if resolved_rp_id.is_empty() {
        return Ok(json!({ "handled": false, "fallback": true }));
    }

    let Ok(items) = core.item_list(ItemFilter {
        passkey_only: Some(true),
        trashed: Some(false),
        archived: Some(false),
        ..Default::default()
    }) else {
        return Ok(json!({ "handled": false, "fallback": true }));
    };

    let custom_equiv = core
        .app_settings_get()
        .map(|s| s.custom_equivalent_domains)
        .unwrap_or_default();

    let mut matched_count = 0usize;
    for sum in items {
        if let Ok(Some(detail)) = core.item_get(&sum.id) {
            for pk in &detail.payload.passkeys {
                if pk.rp_id.eq_ignore_ascii_case(&resolved_rp_id)
                    || registrable_domain(&pk.rp_id.to_ascii_lowercase())
                        == registrable_domain(&resolved_rp_id.to_ascii_lowercase())
                    || domains_are_equivalent(&pk.rp_id, &resolved_rp_id, &custom_equiv)
                {
                    matched_count += 1;
                }
            }
        }
    }

    Ok(json!({
        "handled": false,
        "fallback": true,
        "matchedCount": matched_count,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_token_auth_and_role_allowlist_work() {
        let dir =
            std::env::temp_dir().join(format!("keysmith_ipc_tok_test_{}", new_uuid()));
        init_ipc_tokens(&dir).expect("init_ipc_tokens");

        let nmh_tok = std::fs::read_to_string(dir.join(NMH_TOKEN_FILE_NAME)).expect("read nmh");
        let cli_tok = std::fs::read_to_string(dir.join(CLI_TOKEN_FILE_NAME)).expect("read cli");
        assert_eq!(nmh_tok.len(), 64);
        assert_eq!(cli_tok.len(), 64);
        assert_ne!(nmh_tok, cli_tok);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir_mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
            let nmh_mode = std::fs::metadata(dir.join(NMH_TOKEN_FILE_NAME))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(dir_mode, 0o700);
            assert_eq!(nmh_mode, 0o600);
        }

        assert_eq!(authenticate_ipc_token(None), None);
        assert_eq!(authenticate_ipc_token(Some("")), None);
        assert_eq!(authenticate_ipc_token(Some("wrong-token")), None);
        assert_eq!(
            authenticate_ipc_token(Some(&nmh_tok)),
            Some(ClientRole::BrowserExtension)
        );
        assert_eq!(
            authenticate_ipc_token(Some(&cli_tok)),
            Some(ClientRole::Cli)
        );

        assert!(is_method_allowed(ClientRole::BrowserExtension, "passkey_assert"));
        assert!(is_method_allowed(ClientRole::BrowserExtension, "unlock_biometric"));
        assert!(!is_method_allowed(ClientRole::BrowserExtension, "ssh_sign_ed25519"));
        assert!(!is_method_allowed(ClientRole::BrowserExtension, "resolve_secret_ref"));

        assert!(is_method_allowed(ClientRole::Cli, "ssh_sign_ed25519"));
        assert!(is_method_allowed(ClientRole::Cli, "resolve_secret_ref"));
        assert!(!is_method_allowed(ClientRole::Cli, "passkey_assert"));
        assert!(!is_method_allowed(ClientRole::Cli, "unlock_biometric"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_passkey_origin_and_tab_enforces_non_cross_origin() {
        assert!(validate_passkey_origin_and_tab(
            "https://app.example.com",
            "https://app.example.com/login",
            false
        )
        .is_ok());
        assert!(validate_passkey_origin_and_tab(
            "https://evil.example.com",
            "https://bank.example.com/login",
            false
        )
        .is_err());
        assert!(validate_passkey_origin_and_tab(
            "https://idp.example.com",
            "https://shop.example.com/checkout",
            true
        )
        .is_ok());
        assert!(validate_passkey_origin_and_tab("javascript:alert(1)", "", false).is_err());
    }

    #[test]
    fn sanitize_rpc_item_value_redacts_secrets_per_role() {
        let sample = json!({
            "id": "item-1",
            "username": "alice",
            "password": "super-secret-password",
            "totp": "JBSWY3DPEHPK3PXP",
            "payload": {
                "passkeys": [{
                    "credentialId": "cred-1",
                    "rpId": "example.com",
                    "privateKeyPkcs8": "SECRET_PKCS8_KEY"
                }],
                "passwordHistory": [{
                    "password": "old-password",
                    "lastUsedDate": "2026-01-01T00:00:00Z"
                }],
                "sections": [{
                    "id": "sec-1",
                    "title": "Main",
                    "fields": [
                        { "fieldType": "Password", "sensitive": true, "value": "super-secret-password" },
                        { "fieldType": "SshPrivateKey", "sensitive": true, "value": "-----BEGIN OPENSSH PRIVATE KEY-----" },
                        { "fieldType": "Text", "sensitive": false, "value": "alice" }
                    ]
                }]
            }
        });

        // BrowserExtension keeps login password for autofill but never sees passkey privateKeyPkcs8, SSH private key, or passwordHistory
        let mut ext_val = sample.clone();
        sanitize_rpc_item_value(&mut ext_val, ClientRole::BrowserExtension, false);
        assert_eq!(ext_val["password"], "super-secret-password");
        assert!(ext_val["payload"]["passkeys"][0].get("privateKeyPkcs8").is_none());
        assert_eq!(ext_val["payload"]["passwordHistory"][0]["password"], "[REDACTED]");
        assert_eq!(ext_val["payload"]["sections"][0]["fields"][1]["value"], "[REDACTED]");

        // CLI defaults to redacted sensitive fields unless reveal=true
        let mut cli_redacted = sample.clone();
        sanitize_rpc_item_value(&mut cli_redacted, ClientRole::Cli, false);
        assert_eq!(cli_redacted["redacted"], true);
        assert_eq!(cli_redacted["password"], "[REDACTED]");
        assert_eq!(cli_redacted["totp"], "[REDACTED]");
        assert_eq!(cli_redacted["payload"]["sections"][0]["fields"][0]["value"], "[REDACTED]");
        assert_eq!(cli_redacted["payload"]["sections"][0]["fields"][2]["value"], "alice");
        assert!(cli_redacted["payload"]["passkeys"][0].get("privateKeyPkcs8").is_none());

        // CLI with reveal=true exposes secrets while still never exposing raw passkey private keys
        let mut cli_revealed = sample;
        sanitize_rpc_item_value(&mut cli_revealed, ClientRole::Cli, true);
        assert_eq!(cli_revealed["password"], "super-secret-password");
        assert_eq!(cli_revealed["payload"]["sections"][0]["fields"][0]["value"], "super-secret-password");
        assert!(cli_revealed["payload"]["passkeys"][0].get("privateKeyPkcs8").is_none());
    }
}
