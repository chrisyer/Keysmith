use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;

pub const APP_SUPPORT_DIR_NAME: &str = "dev.keysmith.desktop";
pub const SOCKET_FILE_NAME: &str = "keysmith.sock";
#[cfg(windows)]
pub const WINDOWS_PIPE_NAME: &str = r"\\.\pipe\dev.keysmith.desktop";

/// Returns the default IPC endpoint path (Unix domain socket on Unix, Named Pipe on Windows).
/// Respects `KEYSMITH_SOCKET` if set.
pub fn default_socket_path() -> Result<PathBuf> {
    if let Some(override_path) = std::env::var_os("KEYSMITH_SOCKET") {
        if !override_path.is_empty() {
            return Ok(PathBuf::from(override_path));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").context("HOME environment variable is not set")?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_SUPPORT_DIR_NAME)
            .join(SOCKET_FILE_NAME));
    }
    #[cfg(target_os = "windows")]
    {
        return Ok(PathBuf::from(WINDOWS_PIPE_NAME));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share"))
            })
            .context("Neither XDG_DATA_HOME nor HOME environment variable is set")?;
        Ok(base.join(APP_SUPPORT_DIR_NAME).join(SOCKET_FILE_NAME))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Async client speaking newline-delimited JSON-RPC over `keysmith.sock`.
pub struct SocketClient {
    socket_path: PathBuf,
    next_id: AtomicU64,
}

impl SocketClient {
    pub fn new(socket_path: PathBuf) -> Self {
        Self {
            socket_path,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn from_default_path() -> Result<Self> {
        Ok(Self::new(default_socket_path()?))
    }

    pub fn socket_path(&self) -> &PathBuf {
        &self.socket_path
    }

    /// Sends a single RPC request and waits for the matching newline-delimited JSON response.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let req = RpcRequest {
            id,
            method: method.to_string(),
            params,
        };
        let resp = self.send_raw_request(&req).await?;
        if resp.id != id {
            return Err(anyhow!(
                "RPC response id mismatch: expected {}, got {}",
                id,
                resp.id
            ));
        }
        if resp.ok {
            Ok(resp.result.unwrap_or(Value::Null))
        } else {
            Err(anyhow!(
                "{}",
                resp.error
                    .unwrap_or_else(|| "Unknown RPC error".to_string())
            ))
        }
    }

    /// Forwards a pre-built `RpcRequest` (preserving caller's `id`) and returns the raw `RpcResponse`.
    pub async fn send_raw_request(&self, req: &RpcRequest) -> Result<RpcResponse> {
        #[cfg(unix)]
        let stream = UnixStream::connect(&self.socket_path).await.with_context(|| {
            format!(
                "Failed to connect to Keysmith socket at {} (is Keysmith running?)",
                self.socket_path.display()
            )
        })?;

        #[cfg(windows)]
        let stream = {
            let mut attempt = 0u8;
            loop {
                match ClientOptions::new().open(&self.socket_path) {
                    Ok(client) => break client,
                    Err(e) if e.raw_os_error() == Some(231) && attempt < 15 => {
                        attempt += 1;
                        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                    }
                    Err(e) => {
                        return Err(anyhow!(
                            "Failed to connect to Keysmith pipe at {} (is Keysmith running?): {e}",
                            self.socket_path.display()
                        ));
                    }
                }
            }
        };

        let (reader, mut writer) = tokio::io::split(stream);
        let mut payload = serde_json::to_vec(req).context("Failed to serialize RPC request")?;
        payload.push(b'\n');
        writer
            .write_all(&payload)
            .await
            .context("Failed to write RPC request to keysmith.sock")?;
        writer
            .flush()
            .await
            .context("Failed to flush RPC request")?;

        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();
        let bytes = buf_reader
            .read_line(&mut line)
            .await
            .context("Failed to read RPC response from keysmith.sock")?;
        if bytes == 0 {
            return Err(anyhow!("Keysmith closed the socket without a response"));
        }

        let resp: RpcResponse =
            serde_json::from_str(line.trim_end()).context("Invalid JSON response from Keysmith")?;
        Ok(resp)
    }

    pub async fn status(&self) -> Result<Value> {
        self.call("status", json!({})).await
    }

    pub async fn list(&self, query: Option<&str>) -> Result<Value> {
        self.call("list", json!({ "query": query })).await
    }

    pub async fn get(&self, id_or_title: &str, field: Option<&str>) -> Result<Value> {
        self.call(
            "get",
            json!({ "idOrTitle": id_or_title, "field": field }),
        )
        .await
    }

    pub async fn totp(&self, id_or_title: &str) -> Result<Value> {
        self.call("totp", json!({ "idOrTitle": id_or_title })).await
    }

    pub async fn generate(&self, length: Option<u32>, passphrase: bool) -> Result<Value> {
        self.call(
            "generate",
            json!({ "length": length, "passphrase": passphrase }),
        )
        .await
    }

    pub async fn url_match(&self, url: &str) -> Result<Value> {
        self.call("url_match", json!({ "url": url })).await
    }

    pub async fn ssh_list_keys(&self) -> Result<Value> {
        self.call("ssh_list_keys", json!({})).await
    }

    pub async fn ssh_sign_ed25519(
        &self,
        public_key_blob_b64: &str,
        data_b64: &str,
        flags: u32,
    ) -> Result<Value> {
        self.call(
            "ssh_sign_ed25519",
            json!({
                "publicKeyBlob": public_key_blob_b64,
                "data": data_b64,
                "flags": flags
            }),
        )
        .await
    }

    pub async fn passkey_match(&self, params: Value) -> Result<Value> {
        self.call("passkey_match", params).await
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::net::UnixListener;

    async fn spawn_mock_server(socket_path: PathBuf) -> tokio::task::JoinHandle<()> {
        let listener = UnixListener::bind(&socket_path).expect("bind mock sock");
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let (reader, mut writer) = stream.into_split();
                    let mut lines = BufReader::new(reader).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let req: RpcRequest = serde_json::from_str(&line).expect("parse req");
                        let resp = match req.method.as_str() {
                            "status" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({ "status": "Unlocked", "email": "u@example.com" })),
                                error: None,
                            },
                            "list" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!([
                                    { "id": "item-1", "title": "GitHub", "username": "alice" }
                                ])),
                                error: None,
                            },
                            "get" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({ "id": "item-1", "title": "GitHub", "value": "s3cr3t" })),
                                error: None,
                            },
                            "totp" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({ "code": "123456", "remainingSeconds": 21 })),
                                error: None,
                            },
                            "generate" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({ "value": "xK9#mP2qL7!wZ4vB" })),
                                error: None,
                            },
                            "url_match" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!([{ "id": "item-1", "title": "GitHub" }])),
                                error: None,
                            },
                            "ssh_list_keys" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({ "keys": [] })),
                                error: None,
                            },
                            "ssh_sign_ed25519" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({ "signature": "AAAA" })),
                                error: None,
                            },
                            "passkey_match" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({ "handled": false, "fallback": true })),
                                error: None,
                            },
                            other => RpcResponse {
                                id: req.id,
                                ok: false,
                                result: None,
                                error: Some(format!("unknown method: {other}")),
                            },
                        };
                        let mut out = serde_json::to_vec(&resp).unwrap();
                        out.push(b'\n');
                        let _ = writer.write_all(&out).await;
                        let _ = writer.flush().await;
                    }
                });
            }
        })
    }

    #[tokio::test]
    async fn rpc_methods_roundtrip_and_error() {
        let dir = std::env::temp_dir().join(format!("ks_rpc_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let sock_path = dir.join("keysmith.sock");
        let _ = std::fs::remove_file(&sock_path);

        let server = spawn_mock_server(sock_path.clone()).await;
        let client = SocketClient::new(sock_path.clone());

        assert_eq!(client.status().await.unwrap()["status"], "Unlocked");
        assert_eq!(client.list(Some("git")).await.unwrap()[0]["title"], "GitHub");
        assert_eq!(
            client.get("GitHub", Some("password")).await.unwrap()["value"],
            "s3cr3t"
        );
        assert_eq!(client.totp("GitHub").await.unwrap()["code"], "123456");
        assert!(client.generate(Some(16), false).await.unwrap()["value"].is_string());
        assert_eq!(
            client.url_match("https://github.com/login").await.unwrap()[0]["id"],
            "item-1"
        );
        assert!(client.ssh_list_keys().await.unwrap()["keys"].is_array());
        assert_eq!(
            client.ssh_sign_ed25519("BLOB", "DATA", 0).await.unwrap()["signature"],
            "AAAA"
        );
        assert_eq!(
            client.passkey_match(json!({ "action": "get", "rpId": "github.com" })).await.unwrap()["fallback"],
            true
        );

        let err = client.call("nonexistent", json!({})).await.unwrap_err();
        assert!(err.to_string().contains("unknown method"));

        server.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
