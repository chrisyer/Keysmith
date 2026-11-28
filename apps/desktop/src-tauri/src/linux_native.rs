//! Linux desktop platform integrations:
//! - Cross-platform testable helpers (`helpers`) for `/proc/self/stat`, XDG autostart, and locale parsing
//! - Freedesktop Secret Service (`keyring`) + Polkit (`zbus`) user verification
//! - `logind` (`PrepareForSleep`) and Freedesktop/GNOME/Cinnamon `ScreenSaver` auto-lock listeners
//! - Wayland (`wl-copy`/`wtype`/`grim`) and X11 (`arboard`/`xclip`/`xdotool`/`import`) clipboard, Auto-Type, and QR scan
//! - XDG `.desktop` autostart entry management

pub mod helpers {
    use std::path::{Path, PathBuf};

    /// Parses field 22 (`starttime`) from Linux `/proc/self/stat`, safely handling
    /// executable names containing spaces or parentheses by splitting after the last `')'`.
    pub fn parse_proc_stat_start_time(stat_content: &str) -> Option<u64> {
        let close_paren = stat_content.rfind(')')?;
        let rest = stat_content.get(close_paren + 1..)?.trim_start();
        // Fields after `(comm)`: field 3 (`state`) is index 0, so field 22 (`starttime`) is index 19.
        rest.split_ascii_whitespace().nth(19)?.parse::<u64>().ok()
    }

    /// Generates an XDG Autostart `.desktop` entry for the given executable path.
    pub fn build_xdg_autostart_desktop_entry(exec_path: &str) -> String {
        let escaped = exec_path
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('$', "\\$")
            .replace('`', "\\`");
        format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Version=1.0\n\
             Name=Keysmith\n\
             Comment=Local-first zero-knowledge password & passkey manager\n\
             Exec=\"{escaped}\"\n\
             Icon=keysmith\n\
             Terminal=false\n\
             Categories=Utility;Security;\n\
             StartupNotify=false\n\
             X-GNOME-Autostart-enabled=true\n"
        )
    }

    /// Resolves XDG autostart `.desktop` destination path.
    pub fn resolve_xdg_autostart_path(
        xdg_config_home: Option<&Path>,
        home: Option<&Path>,
    ) -> Option<PathBuf> {
        let base = xdg_config_home
            .filter(|p| !p.as_os_str().is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                home.filter(|p| !p.as_os_str().is_empty())
                    .map(|h| h.join(".config"))
            })?;
        Some(base.join("autostart").join("keysmith.desktop"))
    }

    /// Resolves preferred language tag from standard Linux locale environment variables.
    pub fn parse_linux_locale_env(
        lc_all: Option<&str>,
        lc_messages: Option<&str>,
        language: Option<&str>,
        lang: Option<&str>,
    ) -> Option<String> {
        let candidates = [
            lc_all,
            lc_messages,
            language.and_then(|v| v.split(':').next()),
            lang,
        ];
        for raw in candidates.into_iter().flatten() {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let no_encoding = trimmed.split('.').next().unwrap_or(trimmed);
            let no_modifier = no_encoding.split('@').next().unwrap_or(no_encoding);
            if no_modifier.is_empty()
                || no_modifier.eq_ignore_ascii_case("C")
                || no_modifier.eq_ignore_ascii_case("POSIX")
            {
                continue;
            }
            return Some(no_modifier.replace('_', "-"));
        }
        None
    }
    /// Runs a blocking closure on a dedicated OS thread outside any active Tokio runtime.
    pub fn run_blocking_on_dedicated_thread<T, F>(name: &str, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        let handle = std::thread::Builder::new()
            .name(name.to_string())
            .spawn(f)
            .map_err(|e| format!("Failed to spawn thread {name}: {e}"))?;
        handle
            .join()
            .map_err(|_| format!("Thread {name} panicked"))
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::collections::HashMap;
    use std::fs::{self, OpenOptions};
    use std::io::{Cursor, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::thread;

    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use keysmith_core::error::CoreError;
    use keyring::Entry;
    use sha2::{Digest, Sha256};
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::Value;
    use zeroize::{Zeroize, Zeroizing};

    use super::helpers::{
        build_xdg_autostart_desktop_entry, parse_linux_locale_env, parse_proc_stat_start_time,
        resolve_xdg_autostart_path,
    };
    use crate::macos::AutoTypeStep;

    const SECRET_SERVICE_NAME: &str = "dev.keysmith.desktop";
    const POLKIT_ACTIONS: &[&str] = &[
        "dev.keysmith.desktop.unlock",
        "org.freedesktop.policykit.exec",
    ];
    static LAST_ACTIVE_X11_WINDOW: AtomicU64 = AtomicU64::new(0);

    fn is_wayland_session() -> bool {
        std::env::var_os("WAYLAND_DISPLAY")
            .is_some_and(|v| !v.is_empty())
            || std::env::var("XDG_SESSION_TYPE")
                .map(|v| v.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false)
    }

    fn has_display_x11() -> bool {
        std::env::var_os("DISPLAY").is_some_and(|v| !v.is_empty())
    }

    fn command_exists(bin: &str) -> bool {
        let Some(paths) = std::env::var_os("PATH") else {
            return false;
        };
        std::env::split_paths(&paths).any(|dir| {
            let full = dir.join(bin);
            full.is_file()
        })
    }

    fn dbus_name_has_owner(conn: &Connection, name: &str) -> bool {
        Proxy::new(
            conn,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
        )
        .and_then(|proxy| proxy.call::<_, _, bool>("NameHasOwner", &(name,)))
        .unwrap_or(false)
    }

    fn current_proc_start_time() -> u64 {
        fs::read_to_string("/proc/self/stat")
            .ok()
            .and_then(|raw| parse_proc_stat_start_time(&raw))
            .unwrap_or(0)
    }

    fn run_on_dbus_thread<T, F>(name: &str, f: F) -> Result<T, CoreError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, CoreError> + Send + 'static,
    {
        super::helpers::run_blocking_on_dedicated_thread(name, f)
            .map_err(CoreError::Biometric)?
    }

    // MARK: - Biometric / Polkit User Verification + Secret Service Keyring

    pub fn is_polkit_policy_installed() -> bool {
        Path::new("/usr/share/polkit-1/actions/dev.keysmith.desktop.policy").is_file()
    }

    pub fn has_tray_watcher() -> bool {
        run_on_dbus_thread("keysmith-tray-probe", || {
            let Ok(session_conn) = Connection::session() else {
                return Ok(false);
            };
            Ok(
                dbus_name_has_owner(&session_conn, "org.kde.StatusNotifierWatcher")
                    || dbus_name_has_owner(&session_conn, "org.freedesktop.StatusNotifierWatcher"),
            )
        })
        .unwrap_or(false)
    }

    pub fn biometry_is_available() -> bool {
        run_on_dbus_thread("keysmith-dbus-probe", || {
            let Ok(session_conn) = Connection::session() else {
                return Ok(false);
            };
            if !dbus_name_has_owner(&session_conn, "org.freedesktop.secrets") {
                return Ok(false);
            }
            let Ok(sys_conn) = Connection::system() else {
                return Ok(false);
            };
            Ok(dbus_name_has_owner(&sys_conn, "org.freedesktop.PolicyKit1"))
        })
        .unwrap_or(false)
    }

    fn biometry_authenticate_sync(reason: &str) -> Result<(), CoreError> {
        let conn = Connection::system().map_err(|e| {
            CoreError::Biometric(format!(
                "Failed to connect to system D-Bus for Polkit verification: {e}"
            ))
        })?;
        let proxy = Proxy::new(
            &conn,
            "org.freedesktop.PolicyKit1",
            "/org/freedesktop/PolicyKit1/Authority",
            "org.freedesktop.PolicyKit1.Authority",
        )
        .map_err(|e| {
            CoreError::Biometric(format!("Failed to create Polkit D-Bus proxy: {e}"))
        })?;

        let pid = std::process::id();
        let start_time = current_proc_start_time();
        let mut subject_details: HashMap<&str, Value<'_>> = HashMap::new();
        subject_details.insert("pid", Value::U32(pid));
        subject_details.insert("start-time", Value::U64(start_time));
        let subject = ("unix-process", subject_details);

        let mut details: HashMap<&str, &str> = HashMap::new();
        if !reason.trim().is_empty() {
            details.insert("polkit.message", reason);
        }

        for (idx, &action_id) in POLKIT_ACTIONS.iter().enumerate() {
            let reply: Result<(bool, bool, HashMap<String, String>), _> = proxy.call(
                "CheckAuthorization",
                &(subject.clone(), action_id, details.clone(), 1u32, ""),
            );
            match reply {
                Ok((is_authorized, _is_challenge, _out_details)) => {
                    if is_authorized {
                        return Ok(());
                    }
                    return Err(CoreError::Biometric(
                        "Polkit authentication was cancelled or denied".to_string(),
                    ));
                }
                Err(err) => {
                    let msg = err.to_string();
                    let unknown_action = msg.contains("Unknown action")
                        || msg.contains("ActionLookup")
                        || msg.contains("not registered");
                    if unknown_action && idx + 1 < POLKIT_ACTIONS.len() {
                        continue;
                    }
                    return Err(CoreError::Biometric(format!(
                        "Polkit verification failed: {msg}"
                    )));
                }
            }
        }

        Err(CoreError::Biometric(
            "Polkit verification failed: no registered policy action available".to_string(),
        ))
    }

    pub fn biometry_authenticate(reason: &str) -> Result<(), CoreError> {
        let owned_reason = reason.to_string();
        run_on_dbus_thread("keysmith-polkit-auth", move || {
            biometry_authenticate_sync(&owned_reason)
        })
    }

    pub fn keychain_save(account_id: &str, key: &[u8]) -> Result<(), CoreError> {
        let owned_account = account_id.to_string();
        let owned_key = Zeroizing::new(key.to_vec());
        run_on_dbus_thread("keysmith-secret-save", move || {
            let entry = Entry::new(SECRET_SERVICE_NAME, &owned_account).map_err(|e| {
                CoreError::Biometric(format!("Failed to open Secret Service entry: {e}"))
            })?;
            entry.set_secret(&owned_key).map_err(|e| {
                CoreError::Biometric(format!(
                    "Failed to save unlock key into Freedesktop Secret Service: {e}"
                ))
            })
        })
    }

    pub fn keychain_load_with_reason(
        account_id: &str,
        reason: &str,
    ) -> Result<Zeroizing<Vec<u8>>, CoreError> {
        let owned_account = account_id.to_string();
        let owned_reason = reason.to_string();
        run_on_dbus_thread("keysmith-secret-load", move || {
            biometry_authenticate_sync(&owned_reason)?;
            let entry = Entry::new(SECRET_SERVICE_NAME, &owned_account).map_err(|e| {
                CoreError::Biometric(format!("Failed to open Secret Service entry: {e}"))
            })?;
            let secret = entry.get_secret().map_err(|e| {
                CoreError::Biometric(format!(
                    "Failed to load unlock key from Freedesktop Secret Service: {e}"
                ))
            })?;
            Ok(Zeroizing::new(secret))
        })
    }

    pub fn keychain_delete(account_id: &str) -> Result<(), CoreError> {
        let owned_account = account_id.to_string();
        run_on_dbus_thread("keysmith-secret-delete", move || {
            let entry = match Entry::new(SECRET_SERVICE_NAME, &owned_account) {
                Ok(e) => e,
                Err(_) => return Ok(()),
            };
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(CoreError::Biometric(format!(
                    "Failed to delete Secret Service unlock key: {e}"
                ))),
            }
        })
    }

    // MARK: - Sleep & Screen-Lock Observers

    pub fn register_sleep_and_screen_lock_observers(
        on_trigger: Arc<dyn Fn(&'static str) + Send + Sync>,
    ) {
        let sleep_cb = Arc::clone(&on_trigger);
        let _ = thread::Builder::new()
            .name("keysmith-login1-watch".to_string())
            .spawn(move || {
                let Ok(conn) = Connection::system() else {
                    return;
                };
                let Ok(proxy) = Proxy::new(
                    &conn,
                    "org.freedesktop.login1",
                    "/org/freedesktop/login1",
                    "org.freedesktop.login1.Manager",
                ) else {
                    return;
                };
                let Ok(signals) = proxy.receive_signal("PrepareForSleep") else {
                    return;
                };
                for msg in signals {
                    if let Ok(going_to_sleep) = msg.body().deserialize::<bool>() {
                        if going_to_sleep {
                            sleep_cb("sleep");
                        }
                    }
                }
            });

        let lock_cb = on_trigger;
        let _ = thread::Builder::new()
            .name("keysmith-screensaver-watch".to_string())
            .spawn(move || {
                let Ok(conn) = Connection::session() else {
                    return;
                };
                let candidates = [
                    (
                        "org.freedesktop.ScreenSaver",
                        "/org/freedesktop/ScreenSaver",
                        "org.freedesktop.ScreenSaver",
                    ),
                    (
                        "org.gnome.ScreenSaver",
                        "/org/gnome/ScreenSaver",
                        "org.gnome.ScreenSaver",
                    ),
                    (
                        "org.cinnamon.ScreenSaver",
                        "/org/cinnamon/ScreenSaver",
                        "org.cinnamon.ScreenSaver",
                    ),
                ];
                let Some((dest, path, iface)) = candidates
                    .into_iter()
                    .find(|(service, _, _)| dbus_name_has_owner(&conn, service))
                else {
                    return;
                };
                let Ok(proxy) = Proxy::new(&conn, dest, path, iface) else {
                    return;
                };
                let Ok(signals) = proxy.receive_signal("ActiveChanged") else {
                    return;
                };
                for msg in signals {
                    if let Ok(active) = msg.body().deserialize::<bool>() {
                        if active {
                            lock_cb("screen_lock");
                        }
                    }
                }
            });
    }

    // MARK: - Clipboard (arboard + wl-copy/wl-paste + xclip fallbacks)

    fn write_stdin_tool(bin: &str, args: &[&str], data: &[u8]) -> Result<(), String> {
        let mut child = Command::new(bin)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("{bin}: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(data)
                .map_err(|e| format!("{bin} stdin write: {e}"))?;
        }
        let status = child.wait().map_err(|e| format!("{bin} wait: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("{bin} exited with {status}"))
        }
    }

    fn read_stdout_tool(bin: &str, args: &[&str]) -> Option<Vec<u8>> {
        let out = Command::new(bin).args(args).output().ok()?;
        if out.status.success() {
            Some(out.stdout)
        } else {
            None
        }
    }

    pub fn pasteboard_write(text: &str, _is_sensitive: bool) -> Result<(), CoreError> {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if cb.set_text(text.to_string()).is_ok() {
                return Ok(());
            }
        }
        if is_wayland_session()
            && command_exists("wl-copy")
            && write_stdin_tool("wl-copy", &[], text.as_bytes()).is_ok()
        {
            return Ok(());
        }
        if has_display_x11()
            && command_exists("xclip")
            && write_stdin_tool("xclip", &["-selection", "clipboard", "-i"], text.as_bytes()).is_ok()
        {
            return Ok(());
        }
        Err(CoreError::Clipboard(
            "Failed to write Linux clipboard (tried arboard, wl-copy, and xclip)".to_string(),
        ))
    }

    pub fn pasteboard_clear_if_matches(expected_digest: &[u8; 32]) -> Result<(), CoreError> {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(current) = cb.get_text() {
                let digest: [u8; 32] = Sha256::digest(current.as_bytes()).into();
                if &digest == expected_digest {
                    let _ = cb.clear();
                }
                return Ok(());
            }
        }
        if is_wayland_session() && command_exists("wl-paste") {
            if let Some(bytes) = read_stdout_tool("wl-paste", &["--no-newline"]) {
                let digest: [u8; 32] = Sha256::digest(&bytes).into();
                if &digest == expected_digest && command_exists("wl-copy") {
                    let _ = Command::new("wl-copy").arg("--clear").status();
                }
                return Ok(());
            }
        }
        if has_display_x11() && command_exists("xclip") {
            if let Some(bytes) = read_stdout_tool("xclip", &["-selection", "clipboard", "-o"]) {
                let digest: [u8; 32] = Sha256::digest(&bytes).into();
                if &digest == expected_digest {
                    let _ = write_stdin_tool("xclip", &["-selection", "clipboard", "-i"], b"");
                }
            }
        }
        Ok(())
    }

    pub fn pasteboard_clear_unconditional() -> Result<(), CoreError> {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.clear();
        }
        if is_wayland_session() && command_exists("wl-copy") {
            let _ = Command::new("wl-copy").arg("--clear").status();
        }
        if has_display_x11() && command_exists("xclip") {
            let _ = write_stdin_tool("xclip", &["-selection", "clipboard", "-i"], b"");
        }
        Ok(())
    }

    pub fn pasteboard_read_image_png_base64() -> Option<String> {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(img) = cb.get_image() {
                if let Some(rgba) =
                    image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())
                {
                    let dyn_img = image::DynamicImage::ImageRgba8(rgba);
                    let mut png_bytes = Vec::new();
                    if dyn_img
                        .write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
                        .is_ok()
                    {
                        return Some(B64.encode(png_bytes));
                    }
                }
            }
        }
        if is_wayland_session() && command_exists("wl-paste") {
            if let Some(bytes) = read_stdout_tool("wl-paste", &["--type", "image/png"]) {
                if !bytes.is_empty() {
                    return Some(B64.encode(bytes));
                }
            }
        }
        None
    }

    // MARK: - XDG Autostart

    pub fn set_launch_at_login(enabled: bool) -> Result<(), CoreError> {
        let xdg = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let desktop_path = resolve_xdg_autostart_path(xdg.as_deref(), home.as_deref())
            .ok_or_else(|| {
                CoreError::Internal(
                    "Neither XDG_CONFIG_HOME nor HOME is set for autostart".to_string(),
                )
            })?;

        if enabled {
            if let Some(parent) = desktop_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    CoreError::Internal(format!(
                        "Failed to create {}: {e}",
                        parent.display()
                    ))
                })?;
            }
            let exec_path = std::env::var_os("APPIMAGE")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .or_else(|| std::env::current_exe().ok())
                .ok_or_else(|| {
                    CoreError::Internal("Failed to resolve executable path".to_string())
                })?;
            let content = build_xdg_autostart_desktop_entry(&exec_path.to_string_lossy());
            fs::write(&desktop_path, content).map_err(|e| {
                CoreError::Internal(format!(
                    "Failed to write {}: {e}",
                    desktop_path.display()
                ))
            })?;
        } else if desktop_path.exists() {
            fs::remove_file(&desktop_path).map_err(|e| {
                CoreError::Internal(format!(
                    "Failed to remove {}: {e}",
                    desktop_path.display()
                ))
            })?;
        }
        Ok(())
    }

    // MARK: - Locale

    pub fn system_preferred_language() -> Option<String> {
        parse_linux_locale_env(
            std::env::var("LC_ALL").ok().as_deref(),
            std::env::var("LC_MESSAGES").ok().as_deref(),
            std::env::var("LANGUAGE").ok().as_deref(),
            std::env::var("LANG").ok().as_deref(),
        )
    }

    // MARK: - Wayland / X11 Auto-Type

    pub fn record_frontmost_external_app() {
        if has_display_x11() && command_exists("xdotool") {
            if let Some(out) = read_stdout_tool("xdotool", &["getactivewindow"]) {
                if let Ok(text) = std::str::from_utf8(&out) {
                    if let Ok(wid) = text.trim().parse::<u64>() {
                        LAST_ACTIVE_X11_WINDOW.store(wid, Ordering::SeqCst);
                    }
                }
            }
        }
    }

    pub fn auto_type_sequence(steps: &[AutoTypeStep]) -> Result<(), CoreError> {
        if steps.is_empty() {
            return Ok(());
        }
        let wayland = is_wayland_session();

        if wayland && command_exists("wtype") {
            for step in steps {
                let status = match step {
                    AutoTypeStep::Text(text) => Command::new("wtype")
                        .arg("--")
                        .arg(text)
                        .status(),
                    AutoTypeStep::Tab => Command::new("wtype")
                        .args(["-k", "Tab"])
                        .status(),
                    AutoTypeStep::Enter => Command::new("wtype")
                        .args(["-k", "Return"])
                        .status(),
                }
                .map_err(|e| CoreError::Internal(format!("Failed to execute wtype: {e}")))?;
                if !status.success() {
                    return Err(CoreError::Internal(format!("wtype failed with {status}")));
                }
            }
            return Ok(());
        }

        if wayland && command_exists("ydotool") {
            for step in steps {
                let status = match step {
                    AutoTypeStep::Text(text) => Command::new("ydotool")
                        .args(["type", "--key-delay", "10", "--"])
                        .arg(text)
                        .status(),
                    AutoTypeStep::Tab => Command::new("ydotool")
                        .args(["key", "15:1", "15:0"])
                        .status(),
                    AutoTypeStep::Enter => Command::new("ydotool")
                        .args(["key", "28:1", "28:0"])
                        .status(),
                }
                .map_err(|e| CoreError::Internal(format!("Failed to execute ydotool: {e}")))?;
                if !status.success() {
                    return Err(CoreError::Internal(format!(
                        "ydotool failed with {status}"
                    )));
                }
            }
            return Ok(());
        }

        if has_display_x11() && command_exists("xdotool") {
            let wid = LAST_ACTIVE_X11_WINDOW.load(Ordering::SeqCst);
            if wid != 0 {
                let _ = Command::new("xdotool")
                    .args(["windowactivate", "--sync", &wid.to_string()])
                    .status();
            }
            for step in steps {
                let status = match step {
                    AutoTypeStep::Text(text) => Command::new("xdotool")
                        .args(["type", "--clearmodifiers", "--delay", "12", "--"])
                        .arg(text)
                        .status(),
                    AutoTypeStep::Tab => Command::new("xdotool")
                        .args(["key", "--clearmodifiers", "Tab"])
                        .status(),
                    AutoTypeStep::Enter => Command::new("xdotool")
                        .args(["key", "--clearmodifiers", "Return"])
                        .status(),
                }
                .map_err(|e| CoreError::Internal(format!("Failed to execute xdotool: {e}")))?;
                if !status.success() {
                    return Err(CoreError::Internal(format!(
                        "xdotool failed with {status}"
                    )));
                }
            }
            return Ok(());
        }

        if wayland {
            Err(CoreError::Validation(
                "Auto-type on Wayland requires 'wtype' or 'ydotool' installed in PATH"
                    .to_string(),
            ))
        } else {
            Err(CoreError::Validation(
                "Auto-type on X11 requires 'xdotool' installed in PATH".to_string(),
            ))
        }
    }

    // MARK: - Screen TOTP QR Scanning

    struct ZeroWipeGuard(PathBuf);

    impl Drop for ZeroWipeGuard {
        fn drop(&mut self) {
            if let Ok(meta) = fs::metadata(&self.0) {
                let len = meta.len() as usize;
                if let Ok(mut file) = OpenOptions::new().write(true).open(&self.0) {
                    let mut zeros = vec![0u8; len.min(8 * 1024 * 1024)];
                    let _ = file.write_all(&zeros);
                    let _ = file.sync_all();
                    zeros.zeroize();
                }
            }
            let _ = fs::remove_file(&self.0);
        }
    }

    fn temp_qr_path() -> Result<PathBuf, CoreError> {
        let base_dir = crate::ipc_socket::resolve_app_data_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("tmp-qr");
        fs::create_dir_all(&base_dir)
            .map_err(|e| CoreError::Internal(format!("Failed to create tmp-qr dir: {e}")))?;
        let _ = fs::set_permissions(&base_dir, fs::Permissions::from_mode(0o700));
        let nonce: u64 = rand::random();
        let path = base_dir.join(format!("qr-{}-{nonce:016x}.png", std::process::id()));
        if let Ok(file) = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
        {
            let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
        }
        Ok(path)
    }

    pub fn scan_screen_totp_qr() -> Result<Option<String>, CoreError> {
        let wayland = is_wayland_session();

        // 1. Prefer zero-disk in-memory capture pipes
        if wayland && command_exists("grim") {
            if let Some(png_bytes) = read_stdout_tool("grim", &["-t", "png", "-"]) {
                if !png_bytes.is_empty() {
                    let uri = keysmith_core::totp::parse_totp_qr_bytes(&png_bytes)?;
                    return Ok(Some(uri));
                }
            }
        }
        if has_display_x11() && command_exists("import") {
            if let Some(png_bytes) = read_stdout_tool("import", &["-window", "root", "png:-"]) {
                if !png_bytes.is_empty() {
                    let uri = keysmith_core::totp::parse_totp_qr_bytes(&png_bytes)?;
                    return Ok(Some(uri));
                }
            }
        }

        // 2. Temp-file fallback with 0700/0600 permissions and immediate zero-wipe guard
        let tools: &[(&str, &[&str])] = if wayland {
            &[
                ("spectacle", &["-b", "-n", "-o"]),
                ("gnome-screenshot", &["-f"]),
                ("scrot", &["-z"]),
            ]
        } else {
            &[
                ("scrot", &["-z"]),
                ("gnome-screenshot", &["-f"]),
                ("spectacle", &["-b", "-n", "-o"]),
            ]
        };

        for (bin, args) in tools {
            if !command_exists(bin) {
                continue;
            }
            let tmp = temp_qr_path()?;
            let _guard = ZeroWipeGuard(tmp.clone());
            let mut cmd = Command::new(bin);
            cmd.args(*args).arg(&tmp);
            if let Ok(status) = cmd.status() {
                if status.success() && tmp.is_file() {
                    let bytes = fs::read(&tmp).map_err(|e| {
                        CoreError::Internal(format!("Failed to read temporary QR image: {e}"))
                    })?;
                    let uri = keysmith_core::totp::parse_totp_qr_bytes(&bytes)?;
                    return Ok(Some(uri));
                }
            }
        }

        if wayland {
            Err(CoreError::Validation(
                "Screen QR scanning on Wayland requires 'grim', 'spectacle', or 'gnome-screenshot'"
                    .to_string(),
            ))
        } else {
            Err(CoreError::Validation(
                "Screen QR scanning on X11 requires ImageMagick ('import'), 'scrot', or 'gnome-screenshot'"
                    .to_string(),
            ))
        }
    }
}

#[cfg(target_os = "linux")]
pub use imp::*;

#[cfg(test)]
mod tests {
    use super::helpers::*;
    use std::path::Path;

    #[test]
    fn parses_proc_stat_starttime_including_spaces_and_parens() {
        let sample = "4321 (key smith ) helper) S 1 4321 4321 0 -1 4194304 123 0 0 0 5 1 0 0 20 0 8 0 987654321 123456 500";
        assert_eq!(parse_proc_stat_start_time(sample), Some(987654321));
        assert_eq!(parse_proc_stat_start_time("bad stat"), None);
    }

    #[test]
    fn builds_valid_xdg_autostart_entry_and_resolves_path() {
        let entry = build_xdg_autostart_desktop_entry("/opt/Keysmith/keysmith.AppImage");
        assert!(entry.contains("[Desktop Entry]"));
        assert!(entry.contains("Exec=\"/opt/Keysmith/keysmith.AppImage\""));
        assert!(entry.contains("X-GNOME-Autostart-enabled=true"));

        let xdg_path =
            resolve_xdg_autostart_path(Some(Path::new("/tmp/xdg-cfg")), Some(Path::new("/home/alice")));
        assert_eq!(
            xdg_path.unwrap(),
            Path::new("/tmp/xdg-cfg/autostart/keysmith.desktop")
        );
        let home_path = resolve_xdg_autostart_path(None, Some(Path::new("/home/alice")));
        assert_eq!(
            home_path.unwrap(),
            Path::new("/home/alice/.config/autostart/keysmith.desktop")
        );
    }

    #[test]
    fn parses_linux_locale_environment_variables() {
        assert_eq!(
            parse_linux_locale_env(None, None, None, Some("zh_CN.UTF-8")),
            Some("zh-CN".to_string())
        );
        assert_eq!(
            parse_linux_locale_env(Some("C.UTF-8"), Some("fr_FR@euro"), None, Some("en_US.UTF-8")),
            Some("fr-FR".to_string())
        );
        assert_eq!(
            parse_linux_locale_env(None, None, Some("ja_JP:en_US"), None),
            Some("ja-JP".to_string())
        );
        assert_eq!(parse_linux_locale_env(Some("C"), None, None, Some("POSIX")), None);
    }

    #[tokio::test]
    async fn dedicated_thread_helper_avoids_tokio_nested_runtime_panic() {
        let value = run_blocking_on_dedicated_thread("test-nested-tokio", || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build inner runtime");
            rt.block_on(async { 42usize })
        });
        assert_eq!(value, Ok(42));

        #[cfg(target_os = "linux")]
        {
            let _ = super::biometry_is_available();
            let _ = super::has_tray_watcher();
        }
    }
}
