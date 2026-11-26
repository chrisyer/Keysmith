use std::path::PathBuf;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use keysmith_core::domain::codec::new_uuid;
use keysmith_core::domain::{
    extract_domain, mask_card_number, AuthStatus, FieldPurpose, FieldType, GeneratorMode,
    GeneratorOptions, ItemCategory, ItemDetail, ItemDraft, ItemField, ItemFilter, ItemIcon,
    ItemSection, ItemUrl, UrlMatchRule, WatchtowerFlags, DEFAULT_PERSONAL_VAULT_ID,
};
use keysmith_core::passkey::{
    assert_passkey_credential, create_passkey_credential, normalize_rp_id, now_rfc3339,
    passkey_matches_credential_list, rp_id_matches_origin, PasskeyAssertParams,
    PasskeyCreateParams,
};
use keysmith_core::AppCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixListener;
#[cfg(windows)]
use tokio::net::windows::named_pipe::ServerOptions;
use url::Url;

use crate::commands::{
    apply_window_preferences, emit_data_changed, emit_session_state, poke_signalr,
    show_main_window, AppState,
};
use crate::events::{UiFocusItemPayload, EVENT_SYNC_STATUS, EVENT_UI_FOCUS_ITEM};

pub const APP_SUPPORT_DIR_NAME: &str = "dev.keysmith.desktop";
const SOCKET_FILE_NAME: &str = "keysmith.sock";
#[cfg(windows)]
const WINDOWS_PIPE_NAME: &str = r"\\.\pipe\dev.keysmith.desktop";

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: u64,
    method: String,
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

    #[cfg(unix)]
    tauri::async_runtime::spawn(async move {
        if let Some(parent) = sock_path.parent() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                eprintln!("[keysmith] failed to create IPC socket dir: {err}");
                return;
            }
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

        while let Ok((stream, _)) = listener.accept().await {
            let a = app.clone();
            let c = Arc::clone(&core);
            tokio::spawn(handle_connection(stream, a, c));
        }
    });

    #[cfg(windows)]
    tauri::async_runtime::spawn(async move {
        let pipe_name = sock_path.to_string_lossy().to_string();
        let mut server = match ServerOptions::new()
            .first_pipe_instance(true)
            .create(&pipe_name)
        {
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

            server = match ServerOptions::new().create(&pipe_name) {
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
                match dispatch_rpc(&app, &core, &req.method, &req.params).await {
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
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    match method {
        "status" => {
            let state = core.session_get_state();
            let mut val = serde_json::to_value(state).map_err(|e| e.to_string())?;
            let language = core
                .app_settings_get()
                .map(|s| s.language)
                .unwrap_or_else(|_| "en".to_string());
            if let Some(obj) = val.as_object_mut() {
                obj.insert("language".to_string(), Value::String(language));
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
        "get" | "item_get" => rpc_get(core, params).await,
        "totp" => rpc_totp(core, params).await,
        "item_update_quick" => rpc_item_update_quick(app, core, params).await,
        "item_trash" => rpc_item_trash(app, core, params).await,
        "generate" => rpc_generate(core, params),
        "clipboard_copy" => rpc_clipboard_copy(core, params),
        "url_match" => rpc_url_match(core, params),
        "cards_and_identities" => rpc_cards_and_identities(core),
        "check_login_save" => rpc_check_login_save(core, params),
        "save_or_update_login" => rpc_save_or_update_login(app, core, params).await,
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
                return Err("请先登录 Keysmith 账号".to_string());
            }
            if !st.biometric_enabled {
                return Err("未启用 Touch ID / 生物识别解锁".to_string());
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
                .ok_or_else(|| "缺少 itemId 参数".to_string())?
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
        "ssh_sign_ed25519" => rpc_ssh_sign_ed25519(core, params),
        "passkey_match" => rpc_passkey_match(core, params),
        other => Err(format!("Unsupported RPC method: {other}")),
    }
}

fn require_unlocked(core: &AppCore) -> Result<(), String> {
    let state = core.session_get_state();
    match state.status {
        AuthStatus::Unlocked => Ok(()),
        AuthStatus::Locked => Err("Keysmith 保险库已锁定，请先解锁".to_string()),
        AuthStatus::Unauthenticated => Err("请先登录 Keysmith 账号".to_string()),
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

fn rpc_clipboard_copy(core: &AppCore, params: &Value) -> Result<Value, String> {
    require_unlocked(core)?;
    let value = params
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 value 参数".to_string())?;
    let label = params
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("浏览器扩展内容");
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
        return Err("缺少条目标识或标题".to_string());
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
        .ok_or_else(|| format!("未找到匹配条目: {needle}"))?;

    core.item_get(&matched.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "条目不存在".to_string())
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

async fn rpc_get(core: &AppCore, params: &Value) -> Result<Value, String> {
    let id_or_title = params
        .get("idOrTitle")
        .or_else(|| params.get("itemId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 idOrTitle 参数".to_string())?;
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
                    return Ok(json!({
                        "id": item.id,
                        "title": item.title,
                        "field": field_name,
                        "value": f.value,
                    }));
                }
            }
        }
        return Err(format!("条目「{}」中未找到字段「{}」", item.title, field_name));
    }

    let (username, password, totp) = extract_credentials(&item);
    let mut val = serde_json::to_value(&item).map_err(|e| e.to_string())?;
    if let Some(obj) = val.as_object_mut() {
        obj.insert("hasTotp".to_string(), Value::Bool(totp.is_some()));
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
    Ok(val)
}

async fn rpc_totp(core: &AppCore, params: &Value) -> Result<Value, String> {
    let id_or_title = params
        .get("idOrTitle")
        .or_else(|| params.get("itemId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 idOrTitle 参数".to_string())?;
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
    let secret = totp_opt.ok_or_else(|| format!("条目「{}」未配置 TOTP", item.title))?;
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
    let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
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
    let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
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
                if item_host == target_host {
                    return true;
                }
                registrable_domain(&item_host) == registrable_domain(target_host)
            } else {
                false
            }
        }
    }
}

fn item_matches_url(item: &ItemDetail, raw_url: &str, target_url: &Url, target_host: &str) -> bool {
    if item
        .payload
        .urls
        .iter()
        .any(|u| url_matches_target(&u.uri, u.match_rule, raw_url, target_url, target_host))
    {
        return true;
    }
    item.payload.passkeys.iter().any(|pk| {
        let pk_rp = pk.rp_id.trim().to_ascii_lowercase();
        !pk_rp.is_empty()
            && (target_host == pk_rp
                || target_host.ends_with(&format!(".{pk_rp}"))
                || registrable_domain(&pk_rp) == registrable_domain(target_host))
    })
}

fn rpc_url_match(core: &AppCore, params: &Value) -> Result<Value, String> {
    let raw_url = params
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "缺少 url 参数".to_string())?;

    let Some((target_url, target_host)) = parse_url_host(raw_url) else {
        return Ok(json!([]));
    };

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
        if !item_matches_url(&item, raw_url, &target_url, &target_host) {
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
            "username": username,
            "password": if reprompt { Value::Null } else { password.map(Value::String).unwrap_or(Value::Null) },
            "totp": totp_code,
            "hasTotp": totp_secret.is_some(),
            "hasPasskey": passkey_count > 0,
            "passkeyCount": passkey_count,
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
        .ok_or_else(|| "缺少 url 参数".to_string())?;
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
        if !item_matches_url(&item, raw_url, &target_url, &target_host) {
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
        .ok_or_else(|| "缺少 url 参数".to_string())?;
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
            .ok_or_else(|| format!("未找到条目: {id}"))?;
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
            let already_has_url = draft
                .urls
                .iter()
                .any(|u| url_matches_target(&u.uri, u.match_rule, raw_url, &target_url, &target_host));
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
        let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
        return Ok(json!({
            "action": "updated",
            "itemId": saved.id,
            "title": saved.title,
        }));
    }

    if username.is_empty() && password.is_empty() {
        return Err("用户名和密码不能同时为空".to_string());
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
    };

    let saved = core
        .item_create(draft)
        .await
        .map_err(|e| e.to_string())?;
    emit_data_changed(app, false, vec![saved.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
    Ok(json!({
        "action": "created",
        "itemId": saved.id,
        "title": saved.title,
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

    let resolved_rp_id = if rp_id_raw.is_empty() {
        parse_url_host(origin)
            .map(|(_, h)| normalize_rp_id(&h))
            .unwrap_or_default()
    } else {
        rp_id_raw
    };

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

    if !origin.is_empty() && !rp_id_matches_origin(&resolved_rp_id, origin) {
        return Err(format!("Passkey RP ID ({resolved_rp_id}) 与来源 ({origin}) 不合法或域名不匹配"));
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
                    || (!rp_id_explicit && !origin.is_empty() && rp_id_matches_origin(&pk_rp, origin)));
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
                item_matches_url(&item, origin, orig_url, orig_host)
            } else if let Some((ref rp_url, ref rp_host)) = parse_url_host(&resolved_rp_id) {
                item_matches_url(&item, &resolved_rp_id, rp_url, rp_host)
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
        .ok_or_else(|| "缺少 origin 参数".to_string())?
        .to_string();
    let options = params
        .get("options")
        .ok_or_else(|| "缺少 WebAuthn options 参数".to_string())?;

    let rp_id = options
        .get("rp")
        .and_then(|r| r.get("id"))
        .and_then(|v| v.as_str())
        .map(normalize_rp_id)
        .filter(|s| !s.is_empty())
        .or_else(|| parse_url_host(&origin).map(|(_, h)| normalize_rp_id(&h)))
        .ok_or_else(|| "无法解析 WebAuthn RP ID".to_string())?;

    if !rp_id_matches_origin(&rp_id, &origin) {
        return Err(format!("Passkey RP ID ({rp_id}) 与来源 ({origin}) 不匹配"));
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
                        "error": "此账号已在 Keysmith 中注册过通行密钥",
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
        .ok_or_else(|| "缺少 WebAuthn user 字段".to_string())?;
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
        .ok_or_else(|| "缺少 WebAuthn challenge".to_string())?
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
    let cross_origin = params
        .get("crossOrigin")
        .and_then(|v| v.as_bool())
        .or_else(|| options.get("crossOrigin").and_then(|v| v.as_bool()))
        .unwrap_or(false);

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
            .ok_or_else(|| format!("未找到要绑定的条目: {item_id}"))?;
        let mut draft = existing.to_draft();
        draft.passkeys.push(created.credential);
        if let Some((orig_url, orig_host)) = parse_url_host(&origin) {
            let has_url = draft
                .urls
                .iter()
                .any(|u| url_matches_target(&u.uri, u.match_rule, &origin, &orig_url, &orig_host));
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
        };
        core.item_create(draft).await.map_err(|e| e.to_string())?
    };

    emit_data_changed(app, false, vec![saved.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());

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
        .ok_or_else(|| "缺少 origin 参数".to_string())?
        .to_string();
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "缺少 itemId 参数".to_string())?;
    let credential_id = params
        .get("credentialId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "缺少 credentialId 参数".to_string())?;
    let options = params
        .get("options")
        .ok_or_else(|| "缺少 WebAuthn options 参数".to_string())?;
    let challenge_b64u = options
        .get("challenge")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 WebAuthn challenge".to_string())?
        .to_string();

    let item = core
        .item_get(item_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("未找到条目: {item_id}"))?;

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
        .ok_or_else(|| "未找到匹配的 Passkey 凭据".to_string())?;

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

    let (next_sign_count, response_json) = assert_passkey_credential(
        pk,
        &PasskeyAssertParams {
            origin,
            rp_id,
            challenge_b64u,
            cross_origin,
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
        let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
    }

    Ok(json!({
        "handled": true,
        "credential": response_json,
    }))
}

fn rpc_ssh_sign_ed25519(core: &AppCore, params: &Value) -> Result<Value, String> {
    let target_blob = params
        .get("publicKeyBlob")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "缺少 publicKeyBlob 参数".to_string())?;
    let data_b64 = params
        .get("data")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 data 参数".to_string())?;
    let raw_data = B64
        .decode(data_b64.trim())
        .map_err(|e| format!("data Base64 解码失败: {e}"))?;

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
            .map(|f| f.value.as_str())
            .ok_or_else(|| format!("SSH 密钥「{}」缺少私钥内容", item.title))?;

        let sig = core
            .ssh_sign_ed25519(priv_key, &raw_data)
            .map_err(|e| e.to_string())?;
        return Ok(json!({ "signature": B64.encode(&sig) }));
    }

    Err("未在已解锁保险库中找到匹配的 Ed25519 私钥".to_string())
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

    let mut matched_count = 0usize;
    for sum in items {
        if let Ok(Some(detail)) = core.item_get(&sum.id) {
            for pk in &detail.payload.passkeys {
                if pk.rp_id.eq_ignore_ascii_case(&resolved_rp_id)
                    || registrable_domain(&pk.rp_id.to_ascii_lowercase())
                        == registrable_domain(&resolved_rp_id.to_ascii_lowercase())
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
