use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};

use crate::socket_client::{SocketClient, APP_SUPPORT_DIR_NAME};

pub const SSH_AGENT_FAILURE: u8 = 5;
pub const SSH_AGENT_SUCCESS: u8 = 6;
pub const SSH_AGENTC_REQUEST_IDENTITIES: u8 = 11;
pub const SSH_AGENT_IDENTITIES_ANSWER: u8 = 12;
pub const SSH_AGENTC_SIGN_REQUEST: u8 = 13;
pub const SSH_AGENT_SIGN_RESPONSE: u8 = 14;

const MAX_AGENT_FRAME_LEN: usize = 256 * 1024;
const SSH_ED25519_ALGO: &[u8] = b"ssh-ed25519";

/// Default Unix socket path for `ks ssh-agent`.
pub fn default_ssh_agent_socket_path() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("HOME environment variable is not set")?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join(APP_SUPPORT_DIR_NAME)
        .join("ssh-agent.sock"))
}

/// Encodes an SSH wire string (`uint32 len` + `bytes`).
pub fn encode_ssh_string(buf: &mut Vec<u8>, data: &[u8]) {
    let len = data.len() as u32;
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(data);
}

/// Decodes an SSH wire string (`uint32 len` + `bytes`) from `slice`, advancing it.
pub fn decode_ssh_string<'a>(slice: &mut &'a [u8]) -> Result<&'a [u8]> {
    if slice.len() < 4 {
        return Err(anyhow!("Truncated SSH string length"));
    }
    let len = u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]) as usize;
    *slice = &slice[4..];
    if slice.len() < len {
        return Err(anyhow!("Truncated SSH string payload"));
    }
    let (head, rest) = slice.split_at(len);
    *slice = rest;
    Ok(head)
}

/// Decodes a big-endian `uint32` from `slice`, advancing it.
pub fn decode_u32(slice: &mut &[u8]) -> Result<u32> {
    if slice.len() < 4 {
        return Err(anyhow!("Truncated SSH uint32"));
    }
    let val = u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]);
    *slice = &slice[4..];
    Ok(val)
}

/// Encodes an SSH agent message frame (`uint32 len` + `uint8 type` + `payload`).
pub fn encode_agent_frame(msg_type: u8, payload: &[u8]) -> Vec<u8> {
    let total_len = (1 + payload.len()) as u32;
    let mut out = Vec::with_capacity(4 + 1 + payload.len());
    out.extend_from_slice(&total_len.to_be_bytes());
    out.push(msg_type);
    out.extend_from_slice(payload);
    out
}

/// Reads a single SSH agent message frame `(msg_type, payload)` from an async reader.
/// Returns `Ok(None)` on clean EOF.
pub async fn read_agent_frame<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Option<(u8, Vec<u8>)>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e).context("Failed to read SSH agent frame length"),
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len == 0 || len > MAX_AGENT_FRAME_LEN {
        return Err(anyhow!("Invalid SSH agent frame length: {len}"));
    }
    let mut body = vec![0u8; len];
    reader
        .read_exact(&mut body)
        .await
        .context("Failed to read SSH agent frame body")?;
    let msg_type = body[0];
    let payload = body[1..].to_vec();
    Ok(Some((msg_type, payload)))
}

/// Writes an SSH agent frame to an async writer and flushes.
pub async fn write_agent_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    msg_type: u8,
    payload: &[u8],
) -> Result<()> {
    let frame = encode_agent_frame(msg_type, payload);
    writer
        .write_all(&frame)
        .await
        .context("Failed to write SSH agent frame")?;
    writer.flush().await.context("Failed to flush SSH agent frame")
}

/// Parses an OpenSSH public key line (`ssh-ed25519 AAAA... [comment]`) into `(blob, comment)`.
fn parse_openssh_pubkey_line(line: &str) -> Option<(Vec<u8>, String)> {
    let mut parts = line.split_whitespace();
    let _algo = parts.next()?;
    let b64 = parts.next()?;
    let blob = B64.decode(b64).ok()?;
    let comment = parts.collect::<Vec<_>>().join(" ");
    Some((blob, comment))
}

/// Wraps a raw 64-byte Ed25519 signature into OpenSSH signature wire format if not already wrapped.
pub fn format_ed25519_signature_blob(sig_bytes: &[u8]) -> Result<Vec<u8>> {
    if sig_bytes.len() == 64 {
        let mut blob = Vec::with_capacity(4 + SSH_ED25519_ALGO.len() + 4 + 64);
        encode_ssh_string(&mut blob, SSH_ED25519_ALGO);
        encode_ssh_string(&mut blob, sig_bytes);
        return Ok(blob);
    }
    // Check if already formatted as `ssh_string("ssh-ed25519") || ssh_string(sig)`
    let mut slice = sig_bytes;
    if let Ok(algo) = decode_ssh_string(&mut slice) {
        if algo == SSH_ED25519_ALGO && decode_ssh_string(&mut slice).is_ok() && slice.is_empty() {
            return Ok(sig_bytes.to_vec());
        }
    }
    Err(anyhow!(
        "Unexpected Ed25519 signature length: {} bytes",
        sig_bytes.len()
    ))
}

fn extract_identities(value: &Value) -> Vec<(Vec<u8>, String)> {
    let arr = if let Some(keys) = value.get("keys").and_then(|v| v.as_array()) {
        keys
    } else if let Some(arr) = value.as_array() {
        arr
    } else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for item in arr {
        let comment = item
            .get("comment")
            .or_else(|| item.get("title"))
            .or_else(|| item.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("keysmith")
            .to_string();

        if let Some(blob_b64) = item.get("publicKeyBlob").and_then(|v| v.as_str()) {
            if let Ok(blob) = B64.decode(blob_b64.trim()) {
                out.push((blob, comment));
                continue;
            }
        }
        if let Some(pk_line) = item.get("publicKey").and_then(|v| v.as_str()) {
            if let Some((blob, line_comment)) = parse_openssh_pubkey_line(pk_line) {
                let final_comment = if comment == "keysmith" && !line_comment.is_empty() {
                    line_comment
                } else {
                    comment
                };
                out.push((blob, final_comment));
            }
        }
    }
    out
}

/// Processes a single SSH agent request `(msg_type, payload)` using `client` RPC.
pub async fn handle_agent_message(
    client: &SocketClient,
    msg_type: u8,
    payload: &[u8],
) -> (u8, Vec<u8>) {
    match msg_type {
        SSH_AGENTC_REQUEST_IDENTITIES => match client.ssh_list_keys().await {
            Ok(val) => {
                let keys = extract_identities(&val);
                let mut resp = Vec::new();
                resp.extend_from_slice(&(keys.len() as u32).to_be_bytes());
                for (blob, comment) in keys {
                    encode_ssh_string(&mut resp, &blob);
                    encode_ssh_string(&mut resp, comment.as_bytes());
                }
                (SSH_AGENT_IDENTITIES_ANSWER, resp)
            }
            Err(_) => (SSH_AGENT_FAILURE, Vec::new()),
        },
        SSH_AGENTC_SIGN_REQUEST => {
            let mut slice = payload;
            let Ok(key_blob) = decode_ssh_string(&mut slice) else {
                return (SSH_AGENT_FAILURE, Vec::new());
            };
            let Ok(data) = decode_ssh_string(&mut slice) else {
                return (SSH_AGENT_FAILURE, Vec::new());
            };
            let flags = decode_u32(&mut slice).unwrap_or(0);

            let key_b64 = B64.encode(key_blob);
            let data_b64 = B64.encode(data);

            match client.ssh_sign_ed25519(&key_b64, &data_b64, flags).await {
                Ok(val) => {
                    let sig_b64_opt = val
                        .get("signatureBlob")
                        .or_else(|| val.get("signature"))
                        .and_then(|v| v.as_str())
                        .or_else(|| val.as_str());

                    let Some(sig_b64) = sig_b64_opt else {
                        return (SSH_AGENT_FAILURE, Vec::new());
                    };
                    let Ok(raw_sig) = B64.decode(sig_b64.trim()) else {
                        return (SSH_AGENT_FAILURE, Vec::new());
                    };
                    let Ok(sig_blob) = format_ed25519_signature_blob(&raw_sig) else {
                        return (SSH_AGENT_FAILURE, Vec::new());
                    };
                    let mut resp = Vec::new();
                    encode_ssh_string(&mut resp, &sig_blob);
                    (SSH_AGENT_SIGN_RESPONSE, resp)
                }
                Err(_) => (SSH_AGENT_FAILURE, Vec::new()),
            }
        }
        _ => (SSH_AGENT_FAILURE, Vec::new()),
    }
}

async fn serve_connection(mut stream: UnixStream, client: Arc<SocketClient>) {
    let (mut reader, mut writer) = stream.split();
    while let Ok(Some((msg_type, payload))) = read_agent_frame(&mut reader).await {
        let (resp_type, resp_payload) = handle_agent_message(&client, msg_type, &payload).await;
        if write_agent_frame(&mut writer, resp_type, &resp_payload)
            .await
            .is_err()
        {
            break;
        }
    }
}

/// Runs the OpenSSH-compatible Unix domain socket agent loop.
pub async fn run_ssh_agent(socket_path: Option<PathBuf>) -> Result<()> {
    let bind_path = match socket_path {
        Some(p) => p,
        None => default_ssh_agent_socket_path()?,
    };
    if let Some(parent) = bind_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create directory {}", parent.display()))?;
    }
    if Path::new(&bind_path).exists() {
        let _ = std::fs::remove_file(&bind_path);
    }

    let listener = UnixListener::bind(&bind_path)
        .with_context(|| format!("Failed to bind SSH agent socket at {}", bind_path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&bind_path, std::fs::Permissions::from_mode(0o600));
    }

    eprintln!(
        "Keysmith SSH agent listening on {}\nRun: export SSH_AUTH_SOCK=\"{}\"",
        bind_path.display(),
        bind_path.display()
    );

    let client = Arc::new(SocketClient::from_default_path()?);

    loop {
        tokio::select! {
            accept_res = listener.accept() => {
                match accept_res {
                    Ok((stream, _)) => {
                        let c = Arc::clone(&client);
                        tokio::spawn(serve_connection(stream, c));
                    }
                    Err(err) => {
                        eprintln!("SSH agent accept error: {err}");
                    }
                }
            }
            _ = tokio::signal::ctrl_c() => {
                let _ = std::fs::remove_file(&bind_path);
                break;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::socket_client::{RpcRequest, RpcResponse};
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, BufReader};

    #[test]
    fn wire_frame_and_ssh_string_roundtrip() {
        let mut payload = Vec::new();
        encode_ssh_string(&mut payload, b"ssh-ed25519");
        encode_ssh_string(&mut payload, &[1, 2, 3, 4]);
        payload.extend_from_slice(&42u32.to_be_bytes());

        let frame = encode_agent_frame(SSH_AGENTC_SIGN_REQUEST, &payload);
        let len = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
        assert_eq!(len, 1 + payload.len());
        assert_eq!(frame[4], SSH_AGENTC_SIGN_REQUEST);

        let mut slice = &frame[5..];
        assert_eq!(decode_ssh_string(&mut slice).unwrap(), b"ssh-ed25519");
        assert_eq!(decode_ssh_string(&mut slice).unwrap(), &[1, 2, 3, 4]);
        assert_eq!(decode_u32(&mut slice).unwrap(), 42);
        assert!(slice.is_empty());
    }

    #[tokio::test]
    async fn async_frame_io_and_identities_sign_over_mock_rpc() {
        // Test async frame read/write over duplex stream
        let (mut client_io, mut server_io) = tokio::io::duplex(4096);
        write_agent_frame(&mut client_io, SSH_AGENTC_REQUEST_IDENTITIES, &[])
            .await
            .unwrap();
        let (msg_type, payload) = read_agent_frame(&mut server_io).await.unwrap().unwrap();
        assert_eq!(msg_type, SSH_AGENTC_REQUEST_IDENTITIES);
        assert!(payload.is_empty());

        // Test full RPC-backed identities & sign handling
        let dir = std::env::temp_dir().join(format!("ks_ssh_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let rpc_sock = dir.join("rpc.sock");
        let _ = std::fs::remove_file(&rpc_sock);

        let mut fake_pub_blob = Vec::new();
        encode_ssh_string(&mut fake_pub_blob, b"ssh-ed25519");
        encode_ssh_string(&mut fake_pub_blob, &[7u8; 32]);
        let fake_pub_b64 = B64.encode(&fake_pub_blob);
        let openssh_line = format!("ssh-ed25519 {fake_pub_b64} prod-key");

        let listener = UnixListener::bind(&rpc_sock).unwrap();
        let server = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let line_copy = openssh_line.clone();
                tokio::spawn(async move {
                    let (reader, mut writer) = stream.into_split();
                    let mut lines = BufReader::new(reader).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let req: RpcRequest = serde_json::from_str(&line).unwrap();
                        let resp = match req.method.as_str() {
                            "ssh_list_keys" => RpcResponse {
                                id: req.id,
                                ok: true,
                                result: Some(json!({
                                    "keys": [{ "id": "k1", "publicKey": line_copy, "title": "Prod Server" }]
                                })),
                                error: None,
                            },
                            "ssh_sign_ed25519" => {
                                let raw_sig = [9u8; 64];
                                RpcResponse {
                                    id: req.id,
                                    ok: true,
                                    result: Some(json!({ "signature": B64.encode(raw_sig) })),
                                    error: None,
                                }
                            }
                            _ => RpcResponse {
                                id: req.id,
                                ok: false,
                                result: None,
                                error: Some("unsupported".into()),
                            },
                        };
                        let mut out = serde_json::to_vec(&resp).unwrap();
                        out.push(b'\n');
                        let _ = writer.write_all(&out).await;
                        let _ = writer.flush().await;
                    }
                });
            }
        });

        let client = SocketClient::new(rpc_sock.clone());

        // 1. Request identities
        let (resp_type, resp_payload) =
            handle_agent_message(&client, SSH_AGENTC_REQUEST_IDENTITIES, &[]).await;
        assert_eq!(resp_type, SSH_AGENT_IDENTITIES_ANSWER);
        let mut slice = resp_payload.as_slice();
        assert_eq!(decode_u32(&mut slice).unwrap(), 1);
        assert_eq!(decode_ssh_string(&mut slice).unwrap(), fake_pub_blob.as_slice());
        assert_eq!(decode_ssh_string(&mut slice).unwrap(), b"Prod Server");
        assert!(slice.is_empty());

        // 2. Sign request
        let mut sign_req = Vec::new();
        encode_ssh_string(&mut sign_req, &fake_pub_blob);
        encode_ssh_string(&mut sign_req, b"challenge-data");
        sign_req.extend_from_slice(&0u32.to_be_bytes());

        let (sign_resp_type, sign_resp_payload) =
            handle_agent_message(&client, SSH_AGENTC_SIGN_REQUEST, &sign_req).await;
        assert_eq!(sign_resp_type, SSH_AGENT_SIGN_RESPONSE);
        let mut s_slice = sign_resp_payload.as_slice();
        let sig_blob = decode_ssh_string(&mut s_slice).unwrap();
        assert!(s_slice.is_empty());
        let mut inner = sig_blob;
        assert_eq!(decode_ssh_string(&mut inner).unwrap(), b"ssh-ed25519");
        assert_eq!(decode_ssh_string(&mut inner).unwrap(), &[9u8; 64]);
        assert!(inner.is_empty());

        // 3. Unsupported message returns SSH_AGENT_FAILURE
        let (fail_type, _) = handle_agent_message(&client, 99, &[]).await;
        assert_eq!(fail_type, SSH_AGENT_FAILURE);

        server.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
