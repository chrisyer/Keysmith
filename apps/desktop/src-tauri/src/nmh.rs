use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ipc_socket::{
    resolve_app_data_dir, resolve_socket_path, APP_SUPPORT_DIR_NAME, NMH_TOKEN_FILE_NAME,
};

pub const NMH_HOST_NAME: &str = APP_SUPPORT_DIR_NAME;
pub const KEYSMITH_EXTENSION_ID: &str = "ianpdijhflnmmhbmjdhiombdghhpfkmg";
const MAX_INCOMING_NMH_BYTES: usize = 16 * 1024 * 1024;
const MAX_OUTGOING_NMH_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInstallInfo {
    pub id: String,
    pub label: String,
    pub detected: bool,
    pub configured: bool,
    pub manifest_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserIntegrationStatus {
    pub extension_id: String,
    pub host_path: String,
    pub extension_dir: Option<String>,
    pub browsers: Vec<BrowserInstallInfo>,
}

struct BrowserDef {
    id: &'static str,
    label: &'static str,
    app_support_rel: &'static [&'static str],
    extra_subpath: &'static [&'static str],
}

const MACOS_BROWSERS: &[BrowserDef] = &[
    BrowserDef {
        id: "chrome",
        label: "Google Chrome",
        app_support_rel: &["Google", "Chrome"],
        extra_subpath: &[],
    },
    BrowserDef {
        id: "edge",
        label: "Microsoft Edge",
        app_support_rel: &["Microsoft Edge"],
        extra_subpath: &[],
    },
    BrowserDef {
        id: "arc",
        label: "Arc",
        app_support_rel: &["Arc", "User Data"],
        extra_subpath: &[],
    },
    BrowserDef {
        id: "brave",
        label: "Brave",
        app_support_rel: &["BraveSoftware", "Brave-Browser"],
        extra_subpath: &[],
    },
    BrowserDef {
        id: "chromium",
        label: "Chromium",
        app_support_rel: &["Chromium"],
        extra_subpath: &[],
    },
    BrowserDef {
        id: "vivaldi",
        label: "Vivaldi",
        app_support_rel: &["Vivaldi"],
        extra_subpath: &[],
    },
];

impl BrowserDef {
    fn base_dir(&self, home: &Path) -> PathBuf {
        let mut p = home.join("Library").join("Application Support");
        for seg in self.app_support_rel {
            p.push(seg);
        }
        p
    }

    fn manifest_dir(&self, home: &Path) -> PathBuf {
        let mut p = self.base_dir(home);
        for seg in self.extra_subpath {
            p.push(seg);
        }
        p.push("NativeMessagingHosts");
        p
    }
}

/// Checks CLI arguments and runs Chrome Native Messaging stdio bridge before
/// initializing Tauri/AppKit when invoked by Chromium browsers.
pub fn maybe_run_nmh_from_args() -> bool {
    let Some(first_arg) = std::env::args().nth(1) else {
        return false;
    };
    if first_arg.starts_with("chrome-extension://")
        || first_arg.starts_with("moz-extension://")
        || first_arg == "--nmh"
        || first_arg == "nmh"
    {
        if let Err(err) = run_nmh_stdio() {
            eprintln!("[keysmith-nmh] {err}");
        }
        return true;
    }
    false
}

pub fn read_nmh_message<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, String> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(format!("Failed to read Native Messaging length prefix: {e}")),
    }

    let len = u32::from_ne_bytes(len_buf) as usize;
    if len == 0 {
        return Err("Native Messaging frame length cannot be 0".to_string());
    }
    if len > MAX_INCOMING_NMH_BYTES {
        return Err(format!(
            "Native Messaging frame exceeds maximum size: {len} bytes"
        ));
    }

    let mut payload = vec![0u8; len];
    reader
        .read_exact(&mut payload)
        .map_err(|e| format!("Failed to read Native Messaging payload: {e}"))?;
    Ok(Some(payload))
}

pub fn write_nmh_message<W: Write>(writer: &mut W, payload: &[u8]) -> Result<(), String> {
    if payload.len() > MAX_OUTGOING_NMH_BYTES {
        return Err(format!(
            "Outgoing Native Messaging payload exceeds 1 MiB limit ({} bytes)",
            payload.len()
        ));
    }
    let len_bytes = (payload.len() as u32).to_ne_bytes();
    writer
        .write_all(&len_bytes)
        .map_err(|e| format!("Failed to write Native Messaging length prefix: {e}"))?;
    writer
        .write_all(payload)
        .map_err(|e| format!("Failed to write Native Messaging payload: {e}"))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush Native Messaging stdout: {e}"))?;
    Ok(())
}

fn resolve_nmh_token_path(sock_path: &Path) -> Option<PathBuf> {
    #[cfg(unix)]
    if let Some(parent) = sock_path.parent() {
        return Some(parent.join(NMH_TOKEN_FILE_NAME));
    }
    resolve_app_data_dir().map(|d| d.join(NMH_TOKEN_FILE_NAME))
}

fn read_nmh_auth_token(sock_path: &Path) -> Result<String, String> {
    let token_path = resolve_nmh_token_path(sock_path).ok_or_else(|| {
        "Keysmith desktop app is not running or IPC auth token is missing. Please open Keysmith first."
            .to_string()
    })?;
    let raw = std::fs::read_to_string(&token_path).map_err(|_| {
        "Keysmith desktop app is not running or IPC auth token is missing. Please open Keysmith first."
            .to_string()
    })?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(
            "Keysmith desktop app is not running or IPC auth token is missing. Please open Keysmith first."
                .to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn forward_nmh_request(sock_path: &Path, raw_bytes: &[u8]) -> Vec<u8> {
    let mut parsed: Value = match serde_json::from_slice(raw_bytes) {
        Ok(v) => v,
        Err(err) => {
            return serde_json::to_vec(&json!({
                "id": 0,
                "ok": false,
                "error": format!("Invalid JSON request: {err}"),
            }))
            .unwrap_or_default();
        }
    };
    let req_id = parsed.get("id").and_then(|v| v.as_u64()).unwrap_or(0);

    let err_response = |msg: String| -> Vec<u8> {
        serde_json::to_vec(&json!({
            "id": req_id,
            "ok": false,
            "error": msg,
        }))
        .unwrap_or_default()
    };

    let Some(obj) = parsed.as_object_mut() else {
        return err_response("Invalid JSON request: expected JSON object".to_string());
    };
    let token = match read_nmh_auth_token(sock_path) {
        Ok(t) => t,
        Err(msg) => return err_response(msg),
    };
    obj.insert("authToken".to_string(), Value::String(token));

    let mut line_bytes = match serde_json::to_vec(&parsed) {
        Ok(b) => b,
        Err(err) => return err_response(format!("Failed to encode request: {err}")),
    };
    line_bytes.push(b'\n');

    #[cfg(unix)]
    let mut stream = match UnixStream::connect(sock_path) {
        Ok(s) => s,
        Err(_) => {
            return err_response(
                "Keysmith desktop app is not running. Please open Keysmith first.".to_string(),
            );
        }
    };

    #[cfg(windows)]
    let mut stream = {
        let mut connected = None;
        for attempt in 0..10 {
            match std::fs::OpenOptions::new().read(true).write(true).open(sock_path) {
                Ok(f) => {
                    connected = Some(f);
                    break;
                }
                Err(err) if err.raw_os_error() == Some(231) && attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(30));
                }
                Err(_) => break,
            }
        }
        match connected {
            Some(s) => s,
            None => {
                return err_response(
                    "Keysmith desktop app is not running. Please open Keysmith first.".to_string(),
                );
            }
        }
    };

    if let Err(err) = stream.write_all(&line_bytes).and_then(|_| stream.flush()) {
        return err_response(format!("Failed to communicate with Keysmith desktop: {err}"));
    }

    let mut reader = BufReader::new(stream);
    let mut reply_line = String::new();
    match reader.read_line(&mut reply_line) {
        Ok(0) => err_response("Keysmith desktop closed IPC connection".to_string()),
        Ok(_) => reply_line.trim_end().as_bytes().to_vec(),
        Err(err) => err_response(format!("Failed to read response from Keysmith desktop: {err}")),
    }
}

pub fn run_nmh_stdio() -> Result<(), String> {
    let sock_path = resolve_socket_path()
        .ok_or_else(|| "HOME is not set; cannot locate keysmith.sock".to_string())?;

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut in_lock = stdin.lock();
    let mut out_lock = stdout.lock();

    while let Some(raw_bytes) = read_nmh_message(&mut in_lock)? {
        let reply = forward_nmh_request(&sock_path, &raw_bytes);
        write_nmh_message(&mut out_lock, &reply)?;
    }

    Ok(())
}

fn is_valid_extension_id(id: &str) -> bool {
    let trimmed = id.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn collect_origins(existing_path: &Path, extra_extension_ids: &[String]) -> Vec<String> {
    let mut origins = BTreeSet::new();
    origins.insert(format!("chrome-extension://{KEYSMITH_EXTENSION_ID}/"));

    for id in extra_extension_ids {
        let clean = id.trim();
        if is_valid_extension_id(clean) {
            origins.insert(format!("chrome-extension://{clean}/"));
        }
    }

    if let Ok(bytes) = std::fs::read(existing_path) {
        if let Ok(json_val) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(arr) = json_val.get("allowed_origins").and_then(|v| v.as_array()) {
                for entry in arr {
                    if let Some(s) = entry.as_str() {
                        if s.starts_with("chrome-extension://") && s.ends_with('/') {
                            origins.insert(s.to_string());
                        }
                    }
                }
            }
        }
    }

    origins.into_iter().collect()
}

pub fn resolve_extension_install_dir(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join(APP_SUPPORT_DIR_NAME)
        .join("browser-extension")
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create {}: {e}", dst.display()))?;
    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read {}: {e}", src.display()))?;

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                format!(
                    "Failed to copy {} to {}: {e}",
                    src_path.display(),
                    dst_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn locate_source_extension_dir(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(res) = resource_dir {
        let bundled = res.join("browser-extension");
        if bundled.join("manifest.json").is_file() {
            return Some(bundled);
        }
    }
    let dev_fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("browser-extension");
    if dev_fallback.join("manifest.json").is_file() {
        return Some(dev_fallback);
    }
    None
}

/// Copies the bundled `browser-extension` directory to a stable non-bundle path under
/// the OS application data directory so Chromium's "Load unpacked" picker can always select it cleanly.
pub fn sync_bundled_extension_dir(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let dst = resolve_app_data_dir()?.join("browser-extension");
    if let Some(src) = locate_source_extension_dir(resource_dir) {
        if copy_dir_recursive(&src, &dst).is_ok() {
            return Some(dst);
        }
    }
    if dst.join("manifest.json").is_file() {
        return Some(dst);
    }
    locate_source_extension_dir(resource_dir)
}

fn write_nmh_manifest_for_dir(
    manifest_dir: &Path,
    host_str: &str,
    extra_extension_ids: &[String],
    label: &str,
) -> (PathBuf, bool) {
    let manifest_path = manifest_dir.join(format!("{NMH_HOST_NAME}.json"));
    let origins = collect_origins(&manifest_path, extra_extension_ids);
    let manifest = json!({
        "name": NMH_HOST_NAME,
        "description": "Keysmith Desktop Native Messaging Host",
        "path": host_str,
        "type": "stdio",
        "allowed_origins": origins,
    });
    let configured = std::fs::create_dir_all(manifest_dir)
        .map_err(|e| format!("Failed to create {}: {e}", manifest_dir.display()))
        .and_then(|_| {
            serde_json::to_vec_pretty(&manifest)
                .map_err(|e| format!("Failed to serialize NMH JSON: {e}"))
        })
        .and_then(|bytes| {
            std::fs::write(&manifest_path, bytes)
                .map_err(|e| format!("Failed to write {}: {e}", manifest_path.display()))
        })
        .map_err(|err| {
            eprintln!("[keysmith-nmh] failed for {label}: {err}");
        })
        .is_ok();
    (manifest_path, configured)
}

pub fn auto_install_nmh_in_home(
    home: &Path,
    host_path: &Path,
    extension_dir: Option<&Path>,
    extra_extension_ids: &[String],
) -> BrowserIntegrationStatus {
    let host_str = host_path.to_string_lossy().to_string();
    let mut browsers = Vec::with_capacity(MACOS_BROWSERS.len());

    for def in MACOS_BROWSERS {
        let base = def.base_dir(home);
        let detected = base.is_dir();
        let manifest_dir = def.manifest_dir(home);
        let (manifest_path, configured) = if detected {
            write_nmh_manifest_for_dir(&manifest_dir, &host_str, extra_extension_ids, def.label)
        } else {
            (manifest_dir.join(format!("{NMH_HOST_NAME}.json")), false)
        };

        browsers.push(BrowserInstallInfo {
            id: def.id.to_string(),
            label: def.label.to_string(),
            detected,
            configured,
            manifest_path: manifest_path.to_string_lossy().to_string(),
        });
    }

    BrowserIntegrationStatus {
        extension_id: KEYSMITH_EXTENSION_ID.to_string(),
        host_path: host_str,
        extension_dir: extension_dir.map(|p| p.to_string_lossy().to_string()),
        browsers,
    }
}

pub fn auto_install_linux_nmh_in_config_dir(
    config_dir: &Path,
    host_path: &Path,
    extension_dir: Option<&Path>,
    extra_extension_ids: &[String],
) -> BrowserIntegrationStatus {
    struct LinuxBrowserDef {
        id: &'static str,
        label: &'static str,
        rel_dir: &'static [&'static str],
    }

    const LINUX_BROWSERS: &[LinuxBrowserDef] = &[
        LinuxBrowserDef {
            id: "chrome",
            label: "Google Chrome",
            rel_dir: &["google-chrome"],
        },
        LinuxBrowserDef {
            id: "chromium",
            label: "Chromium",
            rel_dir: &["chromium"],
        },
        LinuxBrowserDef {
            id: "edge",
            label: "Microsoft Edge",
            rel_dir: &["microsoft-edge"],
        },
        LinuxBrowserDef {
            id: "brave",
            label: "Brave",
            rel_dir: &["BraveSoftware", "Brave-Browser"],
        },
        LinuxBrowserDef {
            id: "vivaldi",
            label: "Vivaldi",
            rel_dir: &["vivaldi"],
        },
    ];

    let host_str = host_path.to_string_lossy().to_string();
    let mut browsers = Vec::with_capacity(LINUX_BROWSERS.len());

    for def in LINUX_BROWSERS {
        let mut base = config_dir.to_path_buf();
        for seg in def.rel_dir {
            base.push(seg);
        }
        let detected = base.is_dir();
        let manifest_dir = base.join("NativeMessagingHosts");
        let (manifest_path, configured) = if detected {
            write_nmh_manifest_for_dir(&manifest_dir, &host_str, extra_extension_ids, def.label)
        } else {
            (manifest_dir.join(format!("{NMH_HOST_NAME}.json")), false)
        };

        browsers.push(BrowserInstallInfo {
            id: def.id.to_string(),
            label: def.label.to_string(),
            detected,
            configured,
            manifest_path: manifest_path.to_string_lossy().to_string(),
        });
    }

    BrowserIntegrationStatus {
        extension_id: KEYSMITH_EXTENSION_ID.to_string(),
        host_path: host_str,
        extension_dir: extension_dir.map(|p| p.to_string_lossy().to_string()),
        browsers,
    }
}

#[cfg(windows)]
fn normalize_win_exe_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
}

#[cfg(windows)]
fn auto_install_windows_browsers(
    host_path: &Path,
    extension_dir: Option<&Path>,
    extra_extension_ids: &[String],
) -> BrowserIntegrationStatus {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    struct WinBrowserDef {
        id: &'static str,
        label: &'static str,
        user_data_rel: &'static [&'static str],
        reg_path: &'static str,
    }

    const WIN_BROWSERS: &[WinBrowserDef] = &[
        WinBrowserDef {
            id: "chrome",
            label: "Google Chrome",
            user_data_rel: &["Google", "Chrome", "User Data"],
            reg_path: r"HKCU\Software\Google\Chrome\NativeMessagingHosts\dev.keysmith.desktop",
        },
        WinBrowserDef {
            id: "edge",
            label: "Microsoft Edge",
            user_data_rel: &["Microsoft", "Edge", "User Data"],
            reg_path: r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\dev.keysmith.desktop",
        },
        WinBrowserDef {
            id: "brave",
            label: "Brave",
            user_data_rel: &["BraveSoftware", "Brave-Browser", "User Data"],
            reg_path: r"HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.keysmith.desktop",
        },
        WinBrowserDef {
            id: "chromium",
            label: "Chromium",
            user_data_rel: &["Chromium", "User Data"],
            reg_path: r"HKCU\Software\Chromium\NativeMessagingHosts\dev.keysmith.desktop",
        },
        WinBrowserDef {
            id: "vivaldi",
            label: "Vivaldi",
            user_data_rel: &["Vivaldi", "User Data"],
            reg_path: r"HKCU\Software\Vivaldi\NativeMessagingHosts\dev.keysmith.desktop",
        },
    ];

    let host_str = normalize_win_exe_path(host_path);
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default();
    let app_data_dir = resolve_app_data_dir().unwrap_or_else(std::env::temp_dir);
    let nmh_dir = app_data_dir.join("nmh");
    let manifest_path = nmh_dir.join(format!("{NMH_HOST_NAME}.json"));
    let origins = collect_origins(&manifest_path, extra_extension_ids);
    let manifest_bytes = serde_json::to_vec_pretty(&json!({
        "name": NMH_HOST_NAME,
        "description": "Keysmith Desktop Native Messaging Host",
        "path": host_str,
        "type": "stdio",
        "allowed_origins": origins,
    }))
    .unwrap_or_default();

    let manifest_ready = std::fs::create_dir_all(&nmh_dir).is_ok()
        && std::fs::write(&manifest_path, &manifest_bytes).is_ok();
    let manifest_str = manifest_path.to_string_lossy().to_string();

    let mut browsers = Vec::with_capacity(WIN_BROWSERS.len());
    for def in WIN_BROWSERS {
        let mut user_data = local_app_data.clone();
        for seg in def.user_data_rel {
            user_data.push(seg);
        }
        let detected = !local_app_data.as_os_str().is_empty() && user_data.is_dir();
        let configured = if detected && manifest_ready {
            std::process::Command::new("reg")
                .args(["add", def.reg_path, "/ve", "/t", "REG_SZ", "/d", &manifest_str, "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        } else {
            false
        };
        browsers.push(BrowserInstallInfo {
            id: def.id.to_string(),
            label: def.label.to_string(),
            detected,
            configured,
            manifest_path: manifest_str.clone(),
        });
    }

    BrowserIntegrationStatus {
        extension_id: KEYSMITH_EXTENSION_ID.to_string(),
        host_path: host_str,
        extension_dir: extension_dir.map(|p| p.to_string_lossy().to_string()),
        browsers,
    }
}

pub fn auto_install_nmh_for_detected_browsers(
    resource_dir: Option<&Path>,
    extra_extension_ids: &[String],
) -> BrowserIntegrationStatus {
    #[cfg(target_os = "linux")]
    let host_path = std::env::var_os("APPIMAGE")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().and_then(|p| p.canonicalize()).ok())
        .unwrap_or_else(|| PathBuf::from("keysmith-desktop"));

    #[cfg(not(target_os = "linux"))]
    let host_path = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .unwrap_or_else(|_| PathBuf::from("keysmith-desktop"));

    let ext_dir = sync_bundled_extension_dir(resource_dir);

    #[cfg(windows)]
    {
        return auto_install_windows_browsers(&host_path, ext_dir.as_deref(), extra_extension_ids);
    }

    #[cfg(target_os = "linux")]
    {
        let config_dir = std::env::var_os("XDG_CONFIG_HOME")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"))
            })
            .unwrap_or_else(|| PathBuf::from("/tmp"));
        return auto_install_linux_nmh_in_config_dir(
            &config_dir,
            &host_path,
            ext_dir.as_deref(),
            extra_extension_ids,
        );
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"));
        auto_install_nmh_in_home(&home, &host_path, ext_dir.as_deref(), extra_extension_ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use sha2::{Digest, Sha256};
    use std::io::Cursor;

    fn compute_chrome_ext_id_from_b64_key(b64_key: &str) -> String {
        let der = B64.decode(b64_key).unwrap();
        let digest = Sha256::digest(&der);
        let mut out = String::with_capacity(32);
        for &b in &digest[..16] {
            out.push((b'a' + (b >> 4)) as char);
            out.push((b'a' + (b & 0x0f)) as char);
        }
        out
    }

    #[test]
    fn manifest_key_matches_fixed_extension_id() {
        let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("browser-extension")
            .join("manifest.json");
        let parsed: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        let b64_key = parsed["key"].as_str().expect("manifest.json must have key");
        assert_eq!(compute_chrome_ext_id_from_b64_key(b64_key), KEYSMITH_EXTENSION_ID);
    }

    #[test]
    fn auto_install_writes_only_detected_browsers_and_preserves_custom_origins() {
        let temp_home = std::env::temp_dir().join(format!("ks_desktop_nmh_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_home);

        // Simulate Chrome & Arc installed on this Mac, Edge/Brave not installed
        let chrome_dir = temp_home.join("Library/Application Support/Google/Chrome");
        let chrome_nmh = chrome_dir.join("NativeMessagingHosts");
        let arc_dir = temp_home.join("Library/Application Support/Arc/User Data");
        std::fs::create_dir_all(&chrome_nmh).unwrap();
        std::fs::create_dir_all(&arc_dir).unwrap();

        // Pre-existing custom extension origin in Chrome manifest
        let custom_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        std::fs::write(
            chrome_nmh.join(format!("{NMH_HOST_NAME}.json")),
            serde_json::to_vec_pretty(&json!({
                "name": NMH_HOST_NAME,
                "path": "/old/path/ks",
                "type": "stdio",
                "allowed_origins": [format!("chrome-extension://{custom_id}/")]
            }))
            .unwrap(),
        )
        .unwrap();

        let host_bin = PathBuf::from("/Applications/Keysmith.app/Contents/MacOS/keysmith-desktop");
        let ext_dir = temp_home.join("Library/Application Support/dev.keysmith.desktop/browser-extension");
        let status = auto_install_nmh_in_home(&temp_home, &host_bin, Some(&ext_dir), &[]);

        assert_eq!(status.extension_id, KEYSMITH_EXTENSION_ID);
        let chrome_info = status.browsers.iter().find(|b| b.id == "chrome").unwrap();
        assert!(chrome_info.detected && chrome_info.configured);
        let arc_info = status.browsers.iter().find(|b| b.id == "arc").unwrap();
        assert!(arc_info.detected && arc_info.configured);
        let edge_info = status.browsers.iter().find(|b| b.id == "edge").unwrap();
        assert!(!edge_info.detected && !edge_info.configured);

        let written_chrome: Value = serde_json::from_slice(
            &std::fs::read(&chrome_info.manifest_path).unwrap(),
        )
        .unwrap();
        assert_eq!(written_chrome["path"], host_bin.to_string_lossy().as_ref());
        let origins = written_chrome["allowed_origins"].as_array().unwrap();
        assert!(origins
            .iter()
            .any(|v| v.as_str() == Some(&format!("chrome-extension://{KEYSMITH_EXTENSION_ID}/"))));
        assert!(origins
            .iter()
            .any(|v| v.as_str() == Some(&format!("chrome-extension://{custom_id}/"))));

        let _ = std::fs::remove_dir_all(&temp_home);
    }

    #[test]
    fn auto_install_linux_nmh_writes_detected_xdg_browsers() {
        let temp_cfg =
            std::env::temp_dir().join(format!("ks_linux_nmh_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_cfg);

        std::fs::create_dir_all(temp_cfg.join("google-chrome")).unwrap();
        std::fs::create_dir_all(temp_cfg.join("BraveSoftware/Brave-Browser")).unwrap();

        let host_bin = PathBuf::from("/home/alice/.local/bin/keysmith");
        let ext_dir = PathBuf::from("/home/alice/.local/share/dev.keysmith.desktop/browser-extension");
        let status = auto_install_linux_nmh_in_config_dir(
            &temp_cfg,
            &host_bin,
            Some(&ext_dir),
            &["cccccccccccccccccccccccccccccccc".to_string()],
        );

        let chrome = status.browsers.iter().find(|b| b.id == "chrome").unwrap();
        assert!(chrome.detected && chrome.configured);
        let brave = status.browsers.iter().find(|b| b.id == "brave").unwrap();
        assert!(brave.detected && brave.configured);
        let edge = status.browsers.iter().find(|b| b.id == "edge").unwrap();
        assert!(!edge.detected && !edge.configured);

        let parsed: Value =
            serde_json::from_slice(&std::fs::read(&chrome.manifest_path).unwrap()).unwrap();
        assert_eq!(parsed["path"], host_bin.to_string_lossy().as_ref());
        assert_eq!(parsed["name"], NMH_HOST_NAME);

        let _ = std::fs::remove_dir_all(&temp_cfg);
    }

    #[test]
    fn nmh_framing_roundtrip() {
        let msg = br#"{"id":1,"method":"status","params":{}}"#;
        let mut buf = Vec::new();
        write_nmh_message(&mut buf, msg).unwrap();
        let mut cursor = Cursor::new(buf);
        assert_eq!(read_nmh_message(&mut cursor).unwrap().unwrap(), msg);
        assert!(read_nmh_message(&mut cursor).unwrap().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn forward_nmh_request_injects_nmh_auth_token_and_overwrites_spoofed_token() {
        use std::os::unix::net::UnixListener;

        let temp_dir = std::env::temp_dir().join(format!("ks_nmh_fwd_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let sock_path = temp_dir.join("keysmith.sock");
        let listener = UnixListener::bind(&sock_path).unwrap();

        // Missing token must fail cleanly without panicking.
        let missing_reply: Value = serde_json::from_slice(&forward_nmh_request(
            &sock_path,
            br#"{"id":7,"method":"status","params":{}}"#,
        ))
        .unwrap();
        assert_eq!(missing_reply["id"], 7);
        assert_eq!(missing_reply["ok"], false);

        // Write real ipc-nmh.token and verify forwarding injects it over any spoofed value.
        let expected_token = "deadbeef0123456789abcdef";
        std::fs::write(temp_dir.join(NMH_TOKEN_FILE_NAME), format!("{expected_token}\n")).unwrap();

        let server_handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let received: Value = serde_json::from_str(line.trim_end()).unwrap();
            assert_eq!(received["id"], 7);
            assert_eq!(received["method"], "status");
            assert_eq!(received["authToken"], expected_token);

            let mut writer = stream;
            writer
                .write_all(br#"{"id":7,"ok":true,"result":{"status":"Unlocked"}}"#)
                .unwrap();
            writer.write_all(b"\n").unwrap();
            writer.flush().unwrap();
        });

        let ok_reply: Value = serde_json::from_slice(&forward_nmh_request(
            &sock_path,
            br#"{"id":7,"method":"status","authToken":"spoofed-cli-token","params":{}}"#,
        ))
        .unwrap();
        server_handle.join().unwrap();

        assert_eq!(ok_reply["id"], 7);
        assert_eq!(ok_reply["ok"], true);
        assert_eq!(ok_reply["result"]["status"], "Unlocked");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
