use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::error::CoreError;
use crate::protocol::VaultwardenClient;

const RECORD_SEPARATOR: char = '\x1e';
const HANDSHAKE_FRAME: &str = "{\"protocol\":\"json\",\"version\":1}\x1e";
const PING_FRAME: &str = "{\"type\":6}\x1e";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignalREvent {
    Connected,
    Disconnected(Option<String>),
    SyncCipher {
        action: String,
        cipher_id: Option<String>,
    },
    SyncFolder {
        action: String,
        folder_id: Option<String>,
    },
    SyncVault,
}

#[derive(Debug, Deserialize)]
struct SignalRFrame {
    #[serde(default, rename = "type")]
    frame_type: u8,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    arguments: Vec<Value>,
}

/// Convert HTTP(S) Vaultwarden base URL to WebSocket SignalR hub URL.
pub fn build_hub_url(server_url: &str, access_token: &str) -> Result<String, CoreError> {
    let base = VaultwardenClient::normalize_base_url(server_url)?;
    let ws_base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        return Err(CoreError::Validation("无效的服务器协议".to_string()));
    };
    Ok(format!(
        "{ws_base}/notifications/hub?access_token={}",
        url::form_urlencoded::byte_serialize(access_token.as_bytes()).collect::<String>()
    ))
}

/// Parse `\x1e`-delimited SignalR JSON frames from a text payload.
pub fn parse_signalr_frames(raw: &str) -> Vec<SignalREvent> {
    let mut events = Vec::new();
    for segment in raw.split(RECORD_SEPARATOR) {
        let trimmed = segment.trim();
        if trimmed.is_empty() || trimmed == "{}" {
            continue;
        }
        let Ok(frame) = serde_json::from_str::<SignalRFrame>(trimmed) else {
            continue;
        };
        match frame.frame_type {
            1 => {
                let target = frame.target.as_deref().unwrap_or("");
                if target.eq_ignore_ascii_case("ReceiveMessage") {
                    if let Some(arg) = frame.arguments.first() {
                        if let Some(ev) = map_receive_message(arg) {
                            events.push(ev);
                        }
                    }
                } else if target.starts_with("SyncCipher") {
                    let cid = frame
                        .arguments
                        .first()
                        .and_then(|v| v.get("Id").or_else(|| v.get("id")))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    events.push(SignalREvent::SyncCipher {
                        action: target.to_string(),
                        cipher_id: cid,
                    });
                } else if target.starts_with("SyncFolder") {
                    let fid = frame
                        .arguments
                        .first()
                        .and_then(|v| v.get("Id").or_else(|| v.get("id")))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    events.push(SignalREvent::SyncFolder {
                        action: target.to_string(),
                        folder_id: fid,
                    });
                } else if target.contains("SyncVault") {
                    events.push(SignalREvent::SyncVault);
                }
            }
            7 => {
                events.push(SignalREvent::Disconnected(Some(
                    "服务端主动关闭 SignalR 连接".to_string(),
                )));
            }
            _ => {}
        }
    }
    events
}

fn map_receive_message(msg: &Value) -> Option<SignalREvent> {
    // Bitwarden UpdateType enum:
    // 0: SyncCipherUpdate, 1: SyncCipherCreate, 2: SyncLoginDelete, 3: SyncCipherDelete,
    // 4: SyncVault, 5: SyncOrgKeys, 6: SyncFolderCreate, 7: SyncFolderUpdate, 8: SyncFolderDelete
    let update_type = msg
        .get("Type")
        .or_else(|| msg.get("type"))
        .and_then(|v| v.as_u64())?;
    let payload = msg.get("Payload").or_else(|| msg.get("payload"));
    let item_id = payload
        .and_then(|p| p.get("Id").or_else(|| p.get("id")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match update_type {
        0 => Some(SignalREvent::SyncCipher {
            action: "SyncCipherUpdate".to_string(),
            cipher_id: item_id,
        }),
        1 => Some(SignalREvent::SyncCipher {
            action: "SyncCipherCreate".to_string(),
            cipher_id: item_id,
        }),
        2 | 3 => Some(SignalREvent::SyncCipher {
            action: "SyncCipherDelete".to_string(),
            cipher_id: item_id,
        }),
        6 => Some(SignalREvent::SyncFolder {
            action: "SyncFolderCreate".to_string(),
            folder_id: item_id,
        }),
        7 => Some(SignalREvent::SyncFolder {
            action: "SyncFolderUpdate".to_string(),
            folder_id: item_id,
        }),
        8 => Some(SignalREvent::SyncFolder {
            action: "SyncFolderDelete".to_string(),
            folder_id: item_id,
        }),
        4 | 5 | 10 | 11 | 12 | 13 | 14 => Some(SignalREvent::SyncVault),
        _ => None,
    }
}

/// Run the SignalR WebSocket loop until shutdown is signaled or the connection drops.
pub async fn run_signalr_session(
    server_url: &str,
    access_token: &str,
    event_tx: mpsc::Sender<SignalREvent>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), CoreError> {
    let hub_url = build_hub_url(server_url, access_token)?;
    let mut request = hub_url
        .into_client_request()
        .map_err(|e| CoreError::Network(format!("构造 SignalR 请求失败: {e}")))?;

    if let Ok(val) = HeaderValue::from_str(&format!("Bearer {access_token}")) {
        request.headers_mut().insert("Authorization", val);
    }

    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| CoreError::Network(format!("连接 SignalR 失败: {e}")))?;

    let (mut write, mut read) = ws_stream.split();

    write
        .send(Message::Text(HANDSHAKE_FRAME.to_string()))
        .await
        .map_err(|e| CoreError::Network(format!("SignalR 握手失败: {e}")))?;

    let _ = event_tx.send(SignalREvent::Connected).await;
    let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(20));

    loop {
        tokio::select! {
            changed = shutdown_rx.changed() => {
                if changed.is_err() || *shutdown_rx.borrow() {
                    let _ = write.send(Message::Close(None)).await;
                    let _ = event_tx.send(SignalREvent::Disconnected(None)).await;
                    break;
                }
            }
            _ = ping_interval.tick() => {
                if write.send(Message::Text(PING_FRAME.to_string())).await.is_err() {
                    let _ = event_tx.send(SignalREvent::Disconnected(Some("SignalR 心跳发送失败".to_string()))).await;
                    break;
                }
            }
            msg_opt = read.next() => {
                match msg_opt {
                    Some(Ok(Message::Text(txt))) => {
                        // Reply to incoming ping frames (type:6)
                        if txt.contains("\"type\":6") {
                            let _ = write.send(Message::Text(PING_FRAME.to_string())).await;
                        }
                        for ev in parse_signalr_frames(&txt) {
                            let is_close = matches!(ev, SignalREvent::Disconnected(_));
                            let _ = event_tx.send(ev).await;
                            if is_close {
                                return Ok(());
                            }
                        }
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        if let Ok(txt) = String::from_utf8(bin) {
                            for ev in parse_signalr_frames(&txt) {
                                let _ = event_tx.send(ev).await;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = write.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        let _ = event_tx.send(SignalREvent::Disconnected(None)).await;
                        break;
                    }
                    Some(Err(e)) => {
                        let _ = event_tx.send(SignalREvent::Disconnected(Some(e.to_string()))).await;
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}
