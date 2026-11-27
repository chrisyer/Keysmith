use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::error::CoreError;
use crate::protocol::VaultwardenClient;

const RECORD_SEPARATOR: char = '\x1e';
const HANDSHAKE_FRAME: &str = "{\"protocol\":\"json\",\"version\":1}\x1e";
const MSGPACK_HANDSHAKE_FRAME: &str = "{\"protocol\":\"messagepack\",\"version\":1}\x1e";
const PING_FRAME: &str = "{\"type\":6}\x1e";
const MSGPACK_PING_FRAME: &[u8] = &[0x02, 0x91, 0x06];

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

/// Convert HTTP(S) Vaultwarden base URL to WebSocket SignalR hub URL without embedding tokens in URL query strings.
pub fn build_hub_url(server_url: &str, access_token: &str) -> Result<String, CoreError> {
    build_hub_url_with_connection_token(server_url, access_token, None)
}

/// Convert HTTP(S) Vaultwarden base URL to WebSocket SignalR hub URL with optional negotiated connection token.
/// Uses `Authorization: Bearer` headers on the WebSocket upgrade request instead of `?access_token=`.
pub fn build_hub_url_with_connection_token(
    server_url: &str,
    access_token: &str,
    connection_token: Option<&str>,
) -> Result<String, CoreError> {
    build_hub_url_with_policy(server_url, access_token, connection_token, false)
}

/// Policy-aware SignalR hub URL builder (allows non-loopback `ws://` only when user explicitly opted in).
pub fn build_hub_url_with_policy(
    server_url: &str,
    _access_token: &str,
    connection_token: Option<&str>,
    allow_insecure_http: bool,
) -> Result<String, CoreError> {
    let base = VaultwardenClient::normalize_base_url_with_policy(server_url, allow_insecure_http)?;
    let ws_base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        return Err(CoreError::Validation("无效的服务器协议".to_string()));
    };
    let mut url = format!("{ws_base}/notifications/hub");
    if let Some(conn_tok) = connection_token.map(str::trim).filter(|s| !s.is_empty()) {
        let encoded_id: String =
            url::form_urlencoded::byte_serialize(conn_tok.as_bytes()).collect();
        url.push_str(&format!("?id={encoded_id}"));
    }
    Ok(url)
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
        if let Some(ev) = map_signalr_fields(
            frame.frame_type,
            frame.target.as_deref().unwrap_or(""),
            &frame.arguments,
        ) {
            events.push(ev);
        }
    }
    events
}

fn map_signalr_fields(frame_type: u8, target: &str, arguments: &[Value]) -> Option<SignalREvent> {
    match frame_type {
        1 => {
            if target.eq_ignore_ascii_case("ReceiveMessage") {
                arguments.first().and_then(map_receive_message)
            } else if target.starts_with("SyncCipher") {
                let cid = arguments
                    .first()
                    .and_then(|v| v.get("Id").or_else(|| v.get("id")))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                Some(SignalREvent::SyncCipher {
                    action: target.to_string(),
                    cipher_id: cid,
                })
            } else if target.starts_with("SyncFolder") {
                let fid = arguments
                    .first()
                    .and_then(|v| v.get("Id").or_else(|| v.get("id")))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                Some(SignalREvent::SyncFolder {
                    action: target.to_string(),
                    folder_id: fid,
                })
            } else if target.contains("SyncVault") {
                Some(SignalREvent::SyncVault)
            } else {
                None
            }
        }
        7 => Some(SignalREvent::Disconnected(Some(
            "服务端主动关闭 SignalR 连接".to_string(),
        ))),
        _ => None,
    }
}

/// Parse varint-length-prefixed SignalR MessagePack binary frames.
/// Returns `(decoded_events, saw_ping)`.
pub fn parse_signalr_msgpack_frames(raw: &[u8]) -> (Vec<SignalREvent>, bool) {
    let mut events = Vec::new();
    let mut saw_ping = false;
    let mut pos = 0usize;

    while pos < raw.len() {
        let Some((frame_len, len_bytes)) = read_varint(&raw[pos..]) else {
            break;
        };
        pos += len_bytes;
        if frame_len == 0 || pos + frame_len > raw.len() {
            break;
        }
        let frame_slice = &raw[pos..pos + frame_len];
        pos += frame_len;

        let mut reader = MsgPackReader::new(frame_slice);
        let Ok(val) = reader.read_value() else {
            continue;
        };
        let Some(arr) = val.as_array() else {
            continue;
        };
        let Some(frame_type_u64) = arr.first().and_then(|v| v.as_u64()) else {
            continue;
        };
        let frame_type = u8::try_from(frame_type_u64).unwrap_or(0);
        if frame_type == 6 {
            saw_ping = true;
            continue;
        }
        if frame_type == 1 {
            // SignalR MessagePack Invocation: [1, Headers, InvocationId, Target, Arguments, ...StreamIds]
            let target = arr.get(3).and_then(|v| v.as_str()).unwrap_or("");
            let arguments = arr
                .get(4)
                .and_then(|v| v.as_array())
                .map(|v| v.as_slice())
                .unwrap_or(&[]);
            if let Some(ev) = map_signalr_fields(frame_type, target, arguments) {
                events.push(ev);
            }
        } else if let Some(ev) = map_signalr_fields(frame_type, "", &[]) {
            events.push(ev);
        }
    }

    (events, saw_ping)
}

fn read_varint(buf: &[u8]) -> Option<(usize, usize)> {
    let mut result = 0usize;
    let mut shift = 0u32;
    for (i, &byte) in buf.iter().take(5).enumerate() {
        result |= ((byte & 0x7f) as usize) << shift;
        if (byte & 0x80) == 0 {
            return Some((result, i + 1));
        }
        shift += 7;
    }
    None
}

struct MsgPackReader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> MsgPackReader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], ()> {
        if self.pos + n > self.buf.len() {
            return Err(());
        }
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    fn read_u8(&mut self) -> Result<u8, ()> {
        Ok(self.take(1)?[0])
    }

    fn read_u16(&mut self) -> Result<u16, ()> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    fn read_u32(&mut self) -> Result<u32, ()> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_u64(&mut self) -> Result<u64, ()> {
        let b = self.take(8)?;
        Ok(u64::from_be_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    fn read_str(&mut self, len: usize) -> Result<Value, ()> {
        let bytes = self.take(len)?;
        Ok(Value::String(String::from_utf8_lossy(bytes).into_owned()))
    }

    fn read_array(&mut self, len: usize) -> Result<Value, ()> {
        let mut vec = Vec::with_capacity(len.min(256));
        for _ in 0..len {
            vec.push(self.read_value()?);
        }
        Ok(Value::Array(vec))
    }

    fn read_map(&mut self, len: usize) -> Result<Value, ()> {
        let mut map = Map::with_capacity(len.min(256));
        for _ in 0..len {
            let key_val = self.read_value()?;
            let val = self.read_value()?;
            let key = match key_val {
                Value::String(s) => s,
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            map.insert(key, val);
        }
        Ok(Value::Object(map))
    }

    fn read_value(&mut self) -> Result<Value, ()> {
        let tag = self.read_u8()?;
        match tag {
            0x00..=0x7f => Ok(Value::Number(Number::from(tag))),
            0x80..=0x8f => self.read_map((tag & 0x0f) as usize),
            0x90..=0x9f => self.read_array((tag & 0x0f) as usize),
            0xa0..=0xbf => self.read_str((tag & 0x1f) as usize),
            0xc0 => Ok(Value::Null),
            0xc2 => Ok(Value::Bool(false)),
            0xc3 => Ok(Value::Bool(true)),
            0xc4 => {
                let len = self.read_u8()? as usize;
                let _ = self.take(len)?;
                Ok(Value::Null)
            }
            0xc5 => {
                let len = self.read_u16()? as usize;
                let _ = self.take(len)?;
                Ok(Value::Null)
            }
            0xc6 => {
                let len = self.read_u32()? as usize;
                let _ = self.take(len)?;
                Ok(Value::Null)
            }
            // Ext formats (including MessagePack timestamp ext -1 used for RevisionDate)
            0xc7 => {
                let len = self.read_u8()? as usize;
                let _ext_type = self.read_u8()?;
                let _ = self.take(len)?;
                Ok(Value::Null)
            }
            0xc8 => {
                let len = self.read_u16()? as usize;
                let _ext_type = self.read_u8()?;
                let _ = self.take(len)?;
                Ok(Value::Null)
            }
            0xc9 => {
                let len = self.read_u32()? as usize;
                let _ext_type = self.read_u8()?;
                let _ = self.take(len)?;
                Ok(Value::Null)
            }
            0xca => {
                let b = self.take(4)?;
                let f = f32::from_be_bytes([b[0], b[1], b[2], b[3]]) as f64;
                Ok(Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null))
            }
            0xcb => {
                let b = self.take(8)?;
                let f = f64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]);
                Ok(Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null))
            }
            0xcc => Ok(Value::Number(Number::from(self.read_u8()?))),
            0xcd => Ok(Value::Number(Number::from(self.read_u16()?))),
            0xce => Ok(Value::Number(Number::from(self.read_u32()?))),
            0xcf => Ok(Value::Number(Number::from(self.read_u64()?))),
            0xd0 => Ok(Value::Number(Number::from(self.read_u8()? as i8))),
            0xd1 => {
                let b = self.take(2)?;
                Ok(Value::Number(Number::from(i16::from_be_bytes([b[0], b[1]]))))
            }
            0xd2 => {
                let b = self.take(4)?;
                Ok(Value::Number(Number::from(i32::from_be_bytes([
                    b[0], b[1], b[2], b[3],
                ]))))
            }
            0xd3 => {
                let b = self.take(8)?;
                Ok(Value::Number(Number::from(i64::from_be_bytes([
                    b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
                ]))))
            }
            0xd4 => {
                let _ = self.take(2)?;
                Ok(Value::Null)
            }
            0xd5 => {
                let _ = self.take(3)?;
                Ok(Value::Null)
            }
            0xd6 => {
                let _ = self.take(5)?;
                Ok(Value::Null)
            }
            0xd7 => {
                let _ = self.take(9)?;
                Ok(Value::Null)
            }
            0xd8 => {
                let _ = self.take(17)?;
                Ok(Value::Null)
            }
            0xd9 => {
                let len = self.read_u8()? as usize;
                self.read_str(len)
            }
            0xda => {
                let len = self.read_u16()? as usize;
                self.read_str(len)
            }
            0xdb => {
                let len = self.read_u32()? as usize;
                self.read_str(len)
            }
            0xdc => {
                let len = self.read_u16()? as usize;
                self.read_array(len)
            }
            0xdd => {
                let len = self.read_u32()? as usize;
                self.read_array(len)
            }
            0xde => {
                let len = self.read_u16()? as usize;
                self.read_map(len)
            }
            0xdf => {
                let len = self.read_u32()? as usize;
                self.read_map(len)
            }
            0xe0..=0xff => Ok(Value::Number(Number::from(tag as i8))),
            _ => Err(()),
        }
    }
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

async fn negotiate_connection_token(
    server_url: &str,
    access_token: &str,
    allow_insecure_http: bool,
) -> Result<Option<String>, CoreError> {
    let base = VaultwardenClient::normalize_base_url_with_policy(server_url, allow_insecure_http)?;
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let Ok(resp) = http
        .post(format!("{base}/notifications/hub/negotiate?negotiateVersion=1"))
        .bearer_auth(access_token)
        .send()
        .await
    else {
        return Ok(None);
    };
    if resp.status().as_u16() == 401 {
        return Err(CoreError::Unauthorized(
            "SignalR negotiate 返回 401".to_string(),
        ));
    }
    if !resp.status().is_success() {
        return Ok(None);
    }
    let Ok(json) = resp.json::<Value>().await else {
        return Ok(None);
    };
    Ok(json
        .get("connectionToken")
        .or_else(|| json.get("connectionId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty()))
}

fn handshake_error_text(raw: &str) -> Option<String> {
    for segment in raw.split(RECORD_SEPARATOR) {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
            if let Some(err) = val.get("error").and_then(|e| e.as_str()) {
                if !err.trim().is_empty() {
                    return Some(err.to_string());
                }
            }
        }
    }
    None
}

async fn connect_and_handshake(
    hub_url: &str,
    access_token: &str,
    use_msgpack: bool,
) -> Result<
    (
        futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            Message,
        >,
        futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
    ),
    CoreError,
> {
    let mut request = hub_url
        .into_client_request()
        .map_err(|e| CoreError::Network(format!("构造 SignalR 请求失败: {e}")))?;

    if let Ok(val) = HeaderValue::from_str(&format!("Bearer {access_token}")) {
        request.headers_mut().insert("Authorization", val);
    }

    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| match e {
            tokio_tungstenite::tungstenite::Error::Http(resp) if resp.status().as_u16() == 401 => {
                CoreError::Unauthorized("SignalR WebSocket 返回 401".to_string())
            }
            other => CoreError::Network(format!("连接 SignalR 失败: {other}")),
        })?;

    let (mut write, mut read) = ws_stream.split();
    let hs = if use_msgpack {
        MSGPACK_HANDSHAKE_FRAME
    } else {
        HANDSHAKE_FRAME
    };
    write
        .send(Message::Text(hs.to_string()))
        .await
        .map_err(|e| CoreError::Network(format!("SignalR 握手失败: {e}")))?;

    if let Ok(Some(Ok(Message::Text(ack)))) =
        tokio::time::timeout(std::time::Duration::from_secs(5), read.next()).await
    {
        if let Some(err) = handshake_error_text(&ack) {
            let _ = write.send(Message::Close(None)).await;
            return Err(CoreError::Network(format!("SignalR 握手被拒绝: {err}")));
        }
    }

    Ok((write, read))
}

/// Run the SignalR WebSocket loop until shutdown is signaled or the connection drops.
pub async fn run_signalr_session(
    server_url: &str,
    access_token: &str,
    event_tx: mpsc::Sender<SignalREvent>,
    shutdown_rx: watch::Receiver<bool>,
) -> Result<(), CoreError> {
    run_signalr_session_with_policy(server_url, access_token, false, event_tx, shutdown_rx).await
}

/// Run the SignalR WebSocket loop with an explicit HTTP opt-in policy for self-hosted LAN servers.
pub async fn run_signalr_session_with_policy(
    server_url: &str,
    access_token: &str,
    allow_insecure_http: bool,
    event_tx: mpsc::Sender<SignalREvent>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), CoreError> {
    let conn_token =
        negotiate_connection_token(server_url, access_token, allow_insecure_http).await?;
    let hub_url = build_hub_url_with_policy(
        server_url,
        access_token,
        conn_token.as_deref(),
        allow_insecure_http,
    )?;

    let (mut use_msgpack, (mut write, mut read)) =
        match connect_and_handshake(&hub_url, access_token, true).await {
            Ok(pair) => (true, pair),
            Err(CoreError::Unauthorized(msg)) => return Err(CoreError::Unauthorized(msg)),
            Err(_) => {
                // Retry once with JSON protocol if server rejected messagepack handshake
                let pair = connect_and_handshake(&hub_url, access_token, false).await?;
                (false, pair)
            }
        };

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
                let ping_msg = if use_msgpack {
                    Message::Binary(MSGPACK_PING_FRAME.to_vec())
                } else {
                    Message::Text(PING_FRAME.to_string())
                };
                if write.send(ping_msg).await.is_err() {
                    let _ = event_tx.send(SignalREvent::Disconnected(Some("SignalR 心跳发送失败".to_string()))).await;
                    break;
                }
            }
            msg_opt = read.next() => {
                match msg_opt {
                    Some(Ok(Message::Text(txt))) => {
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
                        let (mut events, saw_ping) = parse_signalr_msgpack_frames(&bin);
                        if saw_ping {
                            use_msgpack = true;
                            let _ = write.send(Message::Binary(MSGPACK_PING_FRAME.to_vec())).await;
                        }
                        if events.is_empty() && !saw_ping {
                            if let Ok(txt) = String::from_utf8(bin) {
                                events = parse_signalr_frames(&txt);
                            }
                        }
                        for ev in events {
                            let is_close = matches!(ev, SignalREvent::Disconnected(_));
                            let _ = event_tx.send(ev).await;
                            if is_close {
                                return Ok(());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_msgpack_signalr_invocation_with_ext_timestamp_ping_and_close() {
        // Construct MessagePack Invocation:
        // [1, {}, null, "ReceiveMessage", [{"Type": 0, "Payload": {"Id": "cipher-1", "RevisionDate": fixext8(-1, 8 bytes)}}]]
        let mut payload = Vec::new();
        payload.push(0x95); // array of 5
        payload.push(0x01); // frame_type = 1 (Invocation)
        payload.push(0x80); // headers = {}
        payload.push(0xc0); // invocationId = null
        payload.extend_from_slice(b"\xaeReceiveMessage"); // fixstr len 14
        payload.push(0x91); // arguments array of 1
        payload.push(0x82); // map of 2
        payload.extend_from_slice(b"\xa4Type"); // "Type"
        payload.push(0x00); // 0 = SyncCipherUpdate
        payload.extend_from_slice(b"\xa7Payload"); // "Payload"
        payload.push(0x82); // map of 2
        payload.extend_from_slice(b"\xa2Id"); // "Id"
        payload.extend_from_slice(b"\xa8cipher-1"); // "cipher-1"
        payload.extend_from_slice(b"\xacRevisionDate"); // "RevisionDate"
        payload.push(0xd7); // fixext 8
        payload.push(0xff); // ext type -1 (MessagePack Timestamp)
        payload.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);

        // Prepend unsigned LEB128 varint length + append Ping frame [0x02, 0x91, 0x06] + Close frame [0x02, 0x91, 0x07]
        let mut stream = Vec::new();
        let len = payload.len();
        stream.push(len as u8);
        stream.extend_from_slice(&payload);
        stream.extend_from_slice(MSGPACK_PING_FRAME);
        stream.extend_from_slice(&[0x02, 0x91, 0x07]);

        let (events, saw_ping) = parse_signalr_msgpack_frames(&stream);
        assert!(saw_ping);
        assert_eq!(
            events,
            vec![
                SignalREvent::SyncCipher {
                    action: "SyncCipherUpdate".to_string(),
                    cipher_id: Some("cipher-1".to_string()),
                },
                SignalREvent::Disconnected(Some("服务端主动关闭 SignalR 连接".to_string())),
            ]
        );
    }
}
