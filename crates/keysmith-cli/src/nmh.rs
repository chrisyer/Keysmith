use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde_json::json;

use crate::socket_client::{RpcRequest, RpcResponse, SocketClient, APP_SUPPORT_DIR_NAME};

pub const NMH_HOST_NAME: &str = APP_SUPPORT_DIR_NAME;
pub const DEFAULT_EXTENSION_ID: &str = "ianpdijhflnmmhbmjdhiombdghhpfkmg";
const MAX_INCOMING_NMH_BYTES: usize = 16 * 1024 * 1024;
const MAX_OUTGOING_NMH_BYTES: usize = 1024 * 1024;

/// Reads a single 4-byte native-endian length-prefixed JSON message from `reader`.
/// Returns `Ok(None)` on clean EOF before the 4-byte header.
pub fn read_nmh_message<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e).context("Failed to read Native Messaging length prefix"),
    }

    let len = u32::from_ne_bytes(len_buf) as usize;
    if len == 0 {
        return Err(anyhow!("Native Messaging frame length cannot be 0"));
    }
    if len > MAX_INCOMING_NMH_BYTES {
        return Err(anyhow!(
            "Native Messaging frame exceeds maximum size: {len} bytes"
        ));
    }

    let mut payload = vec![0u8; len];
    reader
        .read_exact(&mut payload)
        .context("Failed to read Native Messaging payload")?;
    Ok(Some(payload))
}

/// Writes a 4-byte native-endian length-prefixed JSON message to `writer` and flushes.
pub fn write_nmh_message<W: Write>(writer: &mut W, payload: &[u8]) -> Result<()> {
    if payload.len() > MAX_OUTGOING_NMH_BYTES {
        return Err(anyhow!(
            "Outgoing Native Messaging payload exceeds 1 MiB Chrome limit ({} bytes)",
            payload.len()
        ));
    }
    let len_bytes = (payload.len() as u32).to_ne_bytes();
    writer
        .write_all(&len_bytes)
        .context("Failed to write Native Messaging length prefix")?;
    writer
        .write_all(payload)
        .context("Failed to write Native Messaging payload")?;
    writer
        .flush()
        .context("Failed to flush Native Messaging stdout")?;
    Ok(())
}

/// Runs the Chrome Native Messaging Host stdio loop, bridging to `keysmith.sock`.
pub async fn run_nmh() -> Result<()> {
    let client = SocketClient::from_nmh_default_path()?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);

    // Blocking stdin reader thread so stdio doesn't stall the tokio runtime
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut locked = stdin.lock();
        while let Ok(Some(msg)) = read_nmh_message(&mut locked) {
            if tx.blocking_send(msg).is_err() {
                break;
            }
        }
    });

    let stdout = std::io::stdout();
    while let Some(raw_bytes) = rx.recv().await {
        let resp = match serde_json::from_slice::<RpcRequest>(&raw_bytes) {
            Ok(req) => match client.send_raw_request(&req).await {
                Ok(rpc_resp) => rpc_resp,
                Err(err) => RpcResponse {
                    id: req.id,
                    ok: false,
                    result: None,
                    error: Some(err.to_string()),
                },
            },
            Err(err) => RpcResponse {
                id: 0,
                ok: false,
                result: None,
                error: Some(format!("Invalid JSON request: {err}")),
            },
        };

        let out_bytes = serde_json::to_vec(&resp).context("Failed to serialize NMH response")?;
        let mut locked_out = stdout.lock();
        write_nmh_message(&mut locked_out, &out_bytes)?;
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserTarget {
    Chrome,
    Edge,
    Arc,
    Brave,
}

impl BrowserTarget {
    pub fn label(self) -> &'static str {
        match self {
            Self::Chrome => "Google Chrome",
            Self::Edge => "Microsoft Edge",
            Self::Arc => "Arc",
            Self::Brave => "Brave",
        }
    }

    pub fn linux_manifest_dir(self, config_dir: &Path) -> PathBuf {
        match self {
            Self::Chrome => config_dir
                .join("google-chrome")
                .join("NativeMessagingHosts"),
            Self::Edge => config_dir
                .join("microsoft-edge")
                .join("NativeMessagingHosts"),
            Self::Arc => config_dir
                .join("chromium")
                .join("NativeMessagingHosts"),
            Self::Brave => config_dir
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join("NativeMessagingHosts"),
        }
    }

    pub fn manifest_dir(self, home: &Path) -> PathBuf {
        #[cfg(target_os = "linux")]
        {
            let config_dir = std::env::var_os("XDG_CONFIG_HOME")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"));
            return self.linux_manifest_dir(&config_dir);
        }
        #[cfg(not(target_os = "linux"))]
        {
            let app_support = home.join("Library").join("Application Support");
            match self {
                Self::Chrome => app_support
                    .join("Google")
                    .join("Chrome")
                    .join("NativeMessagingHosts"),
                Self::Edge => app_support
                    .join("Microsoft Edge")
                    .join("NativeMessagingHosts"),
                Self::Arc => app_support
                    .join("Arc")
                    .join("User Data")
                    .join("NativeMessagingHosts"),
                Self::Brave => app_support
                    .join("BraveSoftware")
                    .join("Brave-Browser")
                    .join("NativeMessagingHosts"),
            }
        }
    }
}

pub fn build_nmh_manifest_json(host_binary_path: &Path, extension_id: &str) -> serde_json::Value {
    json!({
        "name": NMH_HOST_NAME,
        "description": "Keysmith Desktop Native Messaging Host",
        "path": host_binary_path.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{extension_id}/")
        ]
    })
}

pub fn install_nmh_manifests(
    home: &Path,
    host_binary_path: &Path,
    extension_id: &str,
    targets: &[BrowserTarget],
) -> Result<Vec<PathBuf>> {
    let trimmed = extension_id.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(anyhow!(
            "Invalid browser extension id: '{extension_id}'"
        ));
    }

    let selected = if targets.is_empty() {
        vec![BrowserTarget::Chrome]
    } else {
        targets.to_vec()
    };

    let manifest = build_nmh_manifest_json(host_binary_path, trimmed);
    let formatted = serde_json::to_vec_pretty(&manifest)?;

    let mut written = Vec::with_capacity(selected.len());
    for target in selected {
        let dir = target.manifest_dir(home);
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("Failed to create {}", dir.display()))?;
        let file_path = dir.join(format!("{NMH_HOST_NAME}.json"));
        std::fs::write(&file_path, &formatted)
            .with_context(|| format!("Failed to write {}", file_path.display()))?;
        written.push(file_path);
    }

    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn nmh_four_byte_native_endian_framing_roundtrip() {
        let msg = br#"{"id":1,"method":"status","params":{}}"#;
        let mut buf = Vec::new();
        write_nmh_message(&mut buf, msg).unwrap();

        assert_eq!(&buf[..4], &(msg.len() as u32).to_ne_bytes());
        assert_eq!(&buf[4..], msg);

        let mut cursor = Cursor::new(buf);
        let decoded = read_nmh_message(&mut cursor).unwrap().unwrap();
        assert_eq!(decoded, msg);

        // Clean EOF returns None
        assert!(read_nmh_message(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn nmh_rejects_oversized_or_zero_frames() {
        let mut zero = Cursor::new(0u32.to_ne_bytes().to_vec());
        assert!(read_nmh_message(&mut zero).is_err());

        let oversized_len = ((MAX_INCOMING_NMH_BYTES + 1) as u32).to_ne_bytes();
        let mut oversized = Cursor::new(oversized_len.to_vec());
        assert!(read_nmh_message(&mut oversized).is_err());
    }

    #[test]
    fn install_nmh_writes_valid_manifests_for_selected_browsers() {
        let temp_home = std::env::temp_dir().join(format!("ks_nmh_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_home);
        std::fs::create_dir_all(&temp_home).unwrap();

        let bin = PathBuf::from("/usr/local/bin/ks");
        let ext_id = "abcdefghijklmnopabcdefghijklmnop";
        let paths = install_nmh_manifests(
            &temp_home,
            &bin,
            ext_id,
            &[BrowserTarget::Chrome, BrowserTarget::Edge, BrowserTarget::Arc],
        )
        .unwrap();

        assert_eq!(paths.len(), 3);
        for path in &paths {
            assert!(path.exists());
            let parsed: serde_json::Value =
                serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            assert_eq!(parsed["name"], "dev.keysmith.desktop");
            assert_eq!(parsed["path"], "/usr/local/bin/ks");
            assert_eq!(parsed["type"], "stdio");
            assert_eq!(
                parsed["allowed_origins"][0],
                "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
            );
        }

        let _ = std::fs::remove_dir_all(&temp_home);
    }
}
