use std::path::PathBuf;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use keysmith_core::domain::{
    FieldPurpose, FieldType, GeneratorMode, GeneratorOptions, ItemCategory, ItemDetail,
    ItemFilter, UrlMatchRule,
};
use keysmith_core::AppCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use url::Url;

pub const APP_SUPPORT_DIR_NAME: &str = "dev.keysmith.desktop";
const SOCKET_FILE_NAME: &str = "keysmith.sock";

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

pub fn resolve_socket_path() -> Option<PathBuf> {
    if let Some(override_path) = std::env::var_os("KEYSMITH_SOCKET") {
        if !override_path.is_empty() {
            return Some(PathBuf::from(override_path));
        }
    }
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_SUPPORT_DIR_NAME)
            .join(SOCKET_FILE_NAME),
    )
}

pub fn spawn_ipc_socket_server(core: Arc<AppCore>) {
    let Some(sock_path) = resolve_socket_path() else {
        eprintln!("[keysmith] cannot resolve HOME for IPC socket");
        return;
    };

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

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&sock_path, std::fs::Permissions::from_mode(0o600));
        }

        while let Ok((stream, _)) = listener.accept().await {
            let c = Arc::clone(&core);
            tokio::spawn(handle_connection(stream, c));
        }
    });
}

async fn handle_connection(stream: UnixStream, core: Arc<AppCore>) {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<RpcRequest>(trimmed) {
            Ok(req) => {
                let id = req.id;
                let method = req.method;
                let params = req.params;
                let c = Arc::clone(&core);
                let result = tauri::async_runtime::spawn_blocking(move || {
                    dispatch_rpc(&c, &method, &params)
                })
                .await;

                match result {
                    Ok(Ok(val)) => RpcResponse {
                        id,
                        ok: true,
                        result: Some(val),
                        error: None,
                    },
                    Ok(Err(err)) => RpcResponse {
                        id,
                        ok: false,
                        result: None,
                        error: Some(err),
                    },
                    Err(join_err) => RpcResponse {
                        id,
                        ok: false,
                        result: None,
                        error: Some(format!("RPC task failed: {join_err}")),
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

fn dispatch_rpc(core: &AppCore, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "status" => {
            let state = core.session_get_state();
            serde_json::to_value(state).map_err(|e| e.to_string())
        }
        "list" => {
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
        "get" => rpc_get(core, params),
        "totp" => rpc_totp(core, params),
        "generate" => {
            let mut opts = GeneratorOptions::default();
            if params.get("passphrase").and_then(|v| v.as_bool()) == Some(true) {
                opts.mode = GeneratorMode::Passphrase;
            }
            if let Some(len) = params.get("length").and_then(|v| v.as_u64()) {
                let len_usize = (len as usize).clamp(4, 128);
                if opts.mode == GeneratorMode::Passphrase {
                    opts.word_count = len_usize.clamp(3, 12);
                } else {
                    opts.length = len_usize;
                }
            }
            let res = core.generator_generate(opts);
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "url_match" => rpc_url_match(core, params),
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

fn rpc_get(core: &AppCore, params: &Value) -> Result<Value, String> {
    let id_or_title = params
        .get("idOrTitle")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 idOrTitle 参数".to_string())?;
    let item = find_item_by_id_or_title(core, id_or_title)?;

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

fn rpc_totp(core: &AppCore, params: &Value) -> Result<Value, String> {
    let id_or_title = params
        .get("idOrTitle")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 idOrTitle 参数".to_string())?;
    let item = find_item_by_id_or_title(core, id_or_title)?;
    let (_, _, totp_opt) = extract_credentials(&item);
    let secret = totp_opt.ok_or_else(|| format!("条目「{}」未配置 TOTP", item.title))?;
    let code = core.totp_compute(&secret).map_err(|e| e.to_string())?;
    serde_json::to_value(code).map_err(|e| e.to_string())
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

fn url_matches_target(item_uri: &str, rule: UrlMatchRule, target_raw: &str, target_url: &Url, target_host: &str) -> bool {
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
                item_host == target_host && item_parsed.port_or_known_default() == target_url.port_or_known_default()
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
            && sum.category != ItemCategory::Login
            && sum.category != ItemCategory::Password
        {
            continue;
        }
        let Ok(Some(item)) = core.item_get(&sum.id) else {
            continue;
        };
        let is_match = item
            .payload
            .urls
            .iter()
            .any(|u| url_matches_target(&u.uri, u.match_rule, raw_url, &target_url, &target_host));
        if !is_match {
            continue;
        }

        let (username, password, totp_secret) = extract_credentials(&item);
        let totp_code = totp_secret
            .as_deref()
            .and_then(|s| core.totp_compute(s).ok())
            .map(|c| c.code);
        let urls: Vec<&str> = item.payload.urls.iter().map(|u| u.uri.as_str()).collect();

        matches.push(json!({
            "id": item.id,
            "title": item.title,
            "username": username,
            "password": password,
            "totp": totp_code,
            "hasTotp": totp_secret.is_some(),
            "urls": urls,
        }));
    }

    Ok(Value::Array(matches))
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
        .or_else(|| {
            params
                .get("origin")
                .and_then(|v| v.as_str())
                .and_then(|o| parse_url_host(o).map(|(_, h)| h))
                .as_deref()
                .map(|_| "")
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
