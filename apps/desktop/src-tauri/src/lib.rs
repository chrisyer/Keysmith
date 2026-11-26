pub mod commands;
pub mod events;
pub mod ipc_socket;
pub mod macos;
pub mod nmh;
#[cfg(target_os = "windows")]
pub mod windows_native;

use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use keysmith_core::domain::{AuthStatus, GeneratorOptions};
use keysmith_core::protocol::signalr::{run_signalr_session, SignalREvent};
use keysmith_core::AppCore;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;
use tokio::sync::{mpsc, watch};

use crate::commands::{
    apply_window_preferences, destroy_floating_windows_and_wipe, emit_data_changed,
    set_main_window_compact, show_generator_window, show_main_window, show_quick_access_window,
    toggle_quick_access_window, update_global_shortcut, AppState,
};
use crate::events::{
    SessionStateChangedPayload, UiOpenAboutPayload, EVENT_SESSION_STATE_CHANGED,
    EVENT_SYNC_STATUS, EVENT_UI_FOCUS_SEARCH, EVENT_UI_NEW_ITEM, EVENT_UI_OPEN_ABOUT,
    EVENT_UI_OPEN_SETTINGS, EVENT_UI_SYNC_VAULT,
};
use crate::ipc_socket::spawn_ipc_socket_server;
use crate::macos::{
    register_sleep_and_screen_lock_observers, set_app_dock_icon, MacosBiometricKeyStore,
    MacosClipboard,
};

const DOCK_ICON_PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray-icon@2x.png");
const TRAY_ID: &str = "main-tray";

fn normalize_locale_code(raw: &str) -> &'static str {
    let low = raw.trim().to_ascii_lowercase().replace('_', "-");
    if low.starts_with("zh-tw")
        || low.starts_with("zh-hk")
        || low.starts_with("zh-mo")
        || low.starts_with("zh-hant")
    {
        return "zh-TW";
    }
    if low.starts_with("zh") {
        return "zh-CN";
    }
    if low.starts_with("ja") {
        return "ja";
    }
    if low.starts_with("ko") {
        return "ko";
    }
    if low.starts_with("de") {
        return "de";
    }
    if low.starts_with("fr") {
        return "fr";
    }
    if low.starts_with("es") {
        return "es";
    }
    "en"
}

fn resolve_menu_locale(lang: &str) -> &'static str {
    let trimmed = lang.trim();
    if trimmed.is_empty() || trimmed == "system" {
        if let Some(sys) = crate::macos::system_preferred_language() {
            return normalize_locale_code(&sys);
        }
        let env_lang = std::env::var("LANG")
            .or_else(|_| std::env::var("LC_ALL"))
            .unwrap_or_default();
        return normalize_locale_code(&env_lang);
    }
    normalize_locale_code(trimmed)
}

struct MenuLabels {
    show: &'static str,
    main_window: &'static str,
    quick_access: &'static str,
    generator: &'static str,
    copy_pw: &'static str,
    lock: &'static str,
    quit: &'static str,
    about: &'static str,
    check_updates: &'static str,
    settings: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    new_item: &'static str,
    search_vault: &'static str,
    sync_vault: &'static str,
    window: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    fullscreen: &'static str,
    close_window: &'static str,
}

fn menu_labels(lang: &str) -> MenuLabels {
    match resolve_menu_locale(lang) {
        "zh-CN" => MenuLabels {
            show: "显示 Keysmith",
            main_window: "Keysmith 主窗口",
            quick_access: "Quick Access",
            generator: "密码生成器",
            copy_pw: "快速复制新密码",
            lock: "锁定保险库",
            quit: "退出 Keysmith",
            about: "关于 Keysmith",
            check_updates: "检查更新...",
            settings: "设置...",
            hide: "隐藏 Keysmith",
            hide_others: "隐藏其他",
            show_all: "全部显示",
            edit: "编辑",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "拷贝",
            paste: "粘贴",
            select_all: "全选",
            new_item: "新建项目",
            search_vault: "搜索密码库",
            sync_vault: "立即同步",
            window: "窗口",
            minimize: "最小化",
            zoom: "缩放",
            fullscreen: "进入全屏幕",
            close_window: "关闭窗口",
        },
        "zh-TW" => MenuLabels {
            show: "顯示 Keysmith",
            main_window: "Keysmith 主視窗",
            quick_access: "Quick Access",
            generator: "密碼產生器",
            copy_pw: "快速複製新密碼",
            lock: "鎖定保險庫",
            quit: "結束 Keysmith",
            about: "關於 Keysmith",
            check_updates: "檢查更新...",
            settings: "設定...",
            hide: "隱藏 Keysmith",
            hide_others: "隱藏其他",
            show_all: "顯示全部",
            edit: "編輯",
            undo: "還原",
            redo: "重做",
            cut: "剪下",
            copy: "複製",
            paste: "貼上",
            select_all: "全選",
            new_item: "新增項目",
            search_vault: "搜尋密碼庫",
            sync_vault: "立即同步",
            window: "視窗",
            minimize: "最小化",
            zoom: "縮放",
            fullscreen: "進入全螢幕",
            close_window: "關閉視窗",
        },
        "ja" => MenuLabels {
            show: "Keysmith を表示",
            main_window: "Keysmith メインウィンドウ",
            quick_access: "Quick Access",
            generator: "パスワード生成",
            copy_pw: "新しいパスワードをコピー",
            lock: "保管庫をロック",
            quit: "Keysmith を終了",
            about: "Keysmith について",
            check_updates: "アップデートを確認...",
            settings: "設定...",
            hide: "Keysmith を隠す",
            hide_others: "ほかを隠す",
            show_all: "すべて表示",
            edit: "編集",
            undo: "取り消す",
            redo: "やり直す",
            cut: "カット",
            copy: "コピー",
            paste: "ペースト",
            select_all: "すべてを選択",
            new_item: "新規項目",
            search_vault: "保管庫を検索",
            sync_vault: "今すぐ同期",
            window: "ウィンドウ",
            minimize: "最小化",
            zoom: "拡大/縮小",
            fullscreen: "フルスクリーンにする",
            close_window: "ウィンドウを閉じる",
        },
        "ko" => MenuLabels {
            show: "Keysmith 보기",
            main_window: "Keysmith 기본 윈도우",
            quick_access: "Quick Access",
            generator: "비밀번호 생성기",
            copy_pw: "새 비밀번호 복사",
            lock: "금고 잠그기",
            quit: "Keysmith 종료",
            about: "Keysmith 정보",
            check_updates: "업데이트 확인...",
            settings: "설정...",
            hide: "Keysmith 가리기",
            hide_others: "기타 가리기",
            show_all: "모두 보기",
            edit: "편집",
            undo: "실행 취소",
            redo: "다시 실행",
            cut: "오려두기",
            copy: "복사하기",
            paste: "붙여넣기",
            select_all: "모두 선택",
            new_item: "새 항목",
            search_vault: "금고 검색",
            sync_vault: "지금 동기화",
            window: "윈도우",
            minimize: "최소화",
            zoom: "확대/축소",
            fullscreen: "전체 화면 시작",
            close_window: "윈도우 닫기",
        },
        "de" => MenuLabels {
            show: "Keysmith anzeigen",
            main_window: "Keysmith-Hauptfenster",
            quick_access: "Quick Access",
            generator: "Passwortgenerator",
            copy_pw: "Neues Passwort kopieren",
            lock: "Tresor sperren",
            quit: "Keysmith beenden",
            about: "Über Keysmith",
            check_updates: "Nach Updates suchen...",
            settings: "Einstellungen...",
            hide: "Keysmith ausblenden",
            hide_others: "Andere ausblenden",
            show_all: "Alle einblenden",
            edit: "Bearbeiten",
            undo: "Widerrufen",
            redo: "Wiederholen",
            cut: "Ausschneiden",
            copy: "Kopieren",
            paste: "Einsetzen",
            select_all: "Alles auswählen",
            new_item: "Neuer Eintrag",
            search_vault: "Tresor durchsuchen",
            sync_vault: "Jetzt synchronisieren",
            window: "Fenster",
            minimize: "Minimieren",
            zoom: "Zoomen",
            fullscreen: "Vollbild ein",
            close_window: "Fenster schließen",
        },
        "fr" => MenuLabels {
            show: "Afficher Keysmith",
            main_window: "Fenêtre principale Keysmith",
            quick_access: "Quick Access",
            generator: "Générateur de mots de passe",
            copy_pw: "Copier un nouveau mot de passe",
            lock: "Verrouiller le coffre",
            quit: "Quitter Keysmith",
            about: "À propos de Keysmith",
            check_updates: "Rechercher des mises à jour...",
            settings: "Réglages...",
            hide: "Masquer Keysmith",
            hide_others: "Masquer les autres",
            show_all: "Tout afficher",
            edit: "Édition",
            undo: "Annuler",
            redo: "Rétablir",
            cut: "Couper",
            copy: "Copier",
            paste: "Coller",
            select_all: "Tout sélectionner",
            new_item: "Nouvel élément",
            search_vault: "Rechercher dans le coffre",
            sync_vault: "Synchroniser maintenant",
            window: "Fenêtre",
            minimize: "Réduire",
            zoom: "Agrandir",
            fullscreen: "Activer le mode plein écran",
            close_window: "Fermer la fenêtre",
        },
        "es" => MenuLabels {
            show: "Mostrar Keysmith",
            main_window: "Ventana principal de Keysmith",
            quick_access: "Quick Access",
            generator: "Generador de contraseñas",
            copy_pw: "Copiar nueva contraseña",
            lock: "Bloquear bóveda",
            quit: "Salir de Keysmith",
            about: "Acerca de Keysmith",
            check_updates: "Buscar actualizaciones...",
            settings: "Ajustes...",
            hide: "Ocultar Keysmith",
            hide_others: "Ocultar otros",
            show_all: "Mostrar todo",
            edit: "Edición",
            undo: "Deshacer",
            redo: "Rehacer",
            cut: "Cortar",
            copy: "Copiar",
            paste: "Pegar",
            select_all: "Seleccionar todo",
            new_item: "Nuevo elemento",
            search_vault: "Buscar en la bóveda",
            sync_vault: "Sincronizar ahora",
            window: "Ventana",
            minimize: "Minimizar",
            zoom: "Zoom",
            fullscreen: "Usar pantalla completa",
            close_window: "Cerrar ventana",
        },
        _ => MenuLabels {
            show: "Show Keysmith",
            main_window: "Main Window",
            quick_access: "Quick Access",
            generator: "Password Generator",
            copy_pw: "Copy New Password",
            lock: "Lock Vault",
            quit: "Quit Keysmith",
            about: "About Keysmith",
            check_updates: "Check for Updates...",
            settings: "Settings...",
            hide: "Hide Keysmith",
            hide_others: "Hide Others",
            show_all: "Show All",
            edit: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            new_item: "New Item",
            search_vault: "Search Vault",
            sync_vault: "Sync Now",
            window: "Window",
            minimize: "Minimize",
            zoom: "Zoom",
            fullscreen: "Enter Full Screen",
            close_window: "Close Window",
        },
    }
}

fn handle_menu_action(app: &AppHandle, raw_id: &str) {
    let action = raw_id
        .strip_prefix("tray:")
        .or_else(|| raw_id.strip_prefix("app:"))
        .unwrap_or(raw_id);
    let from_tray = raw_id.starts_with("tray:");

    match action {
        "show" => {
            show_main_window(app);
        }
        "about" => {
            show_main_window(app);
            let _ = app.emit_to(
                "main",
                EVENT_UI_OPEN_ABOUT,
                UiOpenAboutPayload {
                    check_updates: false,
                },
            );
        }
        "check_updates" => {
            show_main_window(app);
            let _ = app.emit_to(
                "main",
                EVENT_UI_OPEN_ABOUT,
                UiOpenAboutPayload {
                    check_updates: true,
                },
            );
        }
        "settings" => {
            show_main_window(app);
            let _ = app.emit_to("main", EVENT_UI_OPEN_SETTINGS, ());
        }
        "new_item" => {
            show_main_window(app);
            let _ = app.emit_to("main", EVENT_UI_NEW_ITEM, ());
        }
        "search" => {
            show_main_window(app);
            let _ = app.emit_to("main", EVENT_UI_FOCUS_SEARCH, ());
        }
        "sync" => {
            show_main_window(app);
            let _ = app.emit_to("main", EVENT_UI_SYNC_VAULT, ());
        }
        "quick_access" => {
            if from_tray {
                let _ = show_quick_access_window(app);
            } else {
                let _ = toggle_quick_access_window(app);
            }
        }
        "generator" => {
            let _ = show_generator_window(app);
        }
        "quick_copy_password" => {
            if let Some(state) = app.try_state::<AppState>() {
                let res = state.core.generator_generate(GeneratorOptions::default());
                let _ = state.core.clipboard_copy_secret(&res.value, "Generated Password", true);
                let _ = state.core.generator_history_record(
                    &res.value,
                    "password",
                    res.strength.entropy_bits,
                    Some("tray"),
                );
            }
        }
        "lock" => {
            destroy_floating_windows_and_wipe(app);
            if let Some(state) = app.try_state::<AppState>() {
                if state.core.session_lock("menu").is_ok() {
                    set_main_window_compact(app, true);
                    let next = state.signalr_poke.borrow().wrapping_add(1);
                    let _ = state.signalr_poke.send(next);
                    let _ = app.emit(
                        EVENT_SESSION_STATE_CHANGED,
                        SessionStateChangedPayload {
                            status: "Locked".to_string(),
                            reason: Some("menu".to_string()),
                        },
                    );
                }
            }
        }
        "quit" => {
            if let Some(state) = app.try_state::<AppState>() {
                let _ = state.core.checkpoint_storage();
            }
            app.exit(0);
        }
        _ => {}
    }
}

fn build_app_menu(app: &AppHandle, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let l = menu_labels(lang);
    let about_item = MenuItem::with_id(app, "app:about", l.about, true, None::<&str>)?;
    let updates_item =
        MenuItem::with_id(app, "app:check_updates", l.check_updates, true, None::<&str>)?;
    let settings_item =
        MenuItem::with_id(app, "app:settings", l.settings, true, Some("CommandOrControl+,"))?;
    let lock_item = MenuItem::with_id(
        app,
        "app:lock",
        l.lock,
        true,
        Some("CommandOrControl+L"),
    )?;
    let quit_item = MenuItem::with_id(
        app,
        "app:quit",
        l.quit,
        true,
        Some("CommandOrControl+Q"),
    )?;

    let app_submenu = Submenu::with_items(
        app,
        "Keysmith",
        true,
        &[
            &about_item,
            &updates_item,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &lock_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(l.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(l.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(l.show_all))?,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let new_item = MenuItem::with_id(
        app,
        "app:new_item",
        l.new_item,
        true,
        Some("CommandOrControl+N"),
    )?;
    let search_item = MenuItem::with_id(
        app,
        "app:search",
        l.search_vault,
        true,
        Some("CommandOrControl+F"),
    )?;
    let sync_item = MenuItem::with_id(
        app,
        "app:sync",
        l.sync_vault,
        true,
        Some("CommandOrControl+R"),
    )?;

    let edit_submenu = Submenu::with_items(
        app,
        l.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(l.undo))?,
            &PredefinedMenuItem::redo(app, Some(l.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(l.cut))?,
            &PredefinedMenuItem::copy(app, Some(l.copy))?,
            &PredefinedMenuItem::paste(app, Some(l.paste))?,
            &PredefinedMenuItem::select_all(app, Some(l.select_all))?,
            &PredefinedMenuItem::separator(app)?,
            &new_item,
            &search_item,
            &sync_item,
        ],
    )?;

    let main_window_item = MenuItem::with_id(app, "app:show", l.main_window, true, None::<&str>)?;
    let quick_item = MenuItem::with_id(app, "app:quick_access", l.quick_access, true, None::<&str>)?;
    let generator_item = MenuItem::with_id(
        app,
        "app:generator",
        l.generator,
        true,
        Some("CommandOrControl+Shift+G"),
    )?;

    let window_submenu = Submenu::with_items(
        app,
        l.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(l.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(l.zoom))?,
            &PredefinedMenuItem::fullscreen(app, Some(l.fullscreen))?,
            &PredefinedMenuItem::separator(app)?,
            &main_window_item,
            &quick_item,
            &generator_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(l.close_window))?,
        ],
    )?;

    Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])
}

fn build_tray_menu(app: &AppHandle, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let l = menu_labels(lang);
    let show_item = MenuItem::with_id(app, "tray:show", l.show, true, None::<&str>)?;
    let quick_item =
        MenuItem::with_id(app, "tray:quick_access", l.quick_access, true, None::<&str>)?;
    let generator_item =
        MenuItem::with_id(app, "tray:generator", l.generator, true, None::<&str>)?;
    let quick_copy_item =
        MenuItem::with_id(app, "tray:quick_copy_password", l.copy_pw, true, None::<&str>)?;
    let lock_item = MenuItem::with_id(app, "tray:lock", l.lock, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray:quit", l.quit, true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &show_item,
            &quick_item,
            &generator_item,
            &quick_copy_item,
            &PredefinedMenuItem::separator(app)?,
            &lock_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )
}

pub fn refresh_localized_menus(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let app_menu = build_app_menu(app, lang)?;
        app.set_menu(app_menu)?;
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tray_menu = build_tray_menu(app, lang)?;
        tray.set_menu(Some(tray_menu))?;
    }
    Ok(())
}

fn setup_app_menu(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let menu = build_app_menu(app, lang)?;
        app.set_menu(menu)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, lang);
    }
    Ok(())
}

fn setup_tray(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    let tray_menu = build_tray_menu(app, lang)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .tooltip("Keysmith");

    #[cfg(target_os = "macos")]
    {
        if let Ok(tray_img) = tauri::image::Image::from_bytes(TRAY_ICON_PNG) {
            builder = builder.icon(tray_img).icon_as_template(true);
        } else if let Some(icon) = app.default_window_icon().cloned() {
            builder = builder.icon(icon);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(tray_img) = tauri::image::Image::from_bytes(DOCK_ICON_PNG) {
            builder = builder.icon(tray_img);
        } else if let Some(icon) = app.default_window_icon().cloned() {
            builder = builder.icon(icon);
        }
    }

    builder
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id.starts_with("tray:") {
                handle_menu_action(app, id);
            }
        })
        .build(app)?;

    Ok(())
}

fn spawn_signalr_supervisor(
    app: AppHandle,
    core: Arc<AppCore>,
    mut poke_rx: watch::Receiver<u64>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            let session = core.session_get_state();
            let creds = if session.status == AuthStatus::Unlocked {
                core.signalr_credentials()
            } else {
                None
            };

            let Some((server_url, access_token)) = creds else {
                core.set_signalr_connected(false);
                let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
                tokio::select! {
                    _ = poke_rx.changed() => {},
                    _ = tokio::time::sleep(Duration::from_secs(15)) => {},
                }
                continue;
            };

            let (ev_tx, mut ev_rx) = mpsc::channel::<SignalREvent>(32);
            let (shutdown_tx, shutdown_rx) = watch::channel(false);

            let url_c = server_url.clone();
            let tok_c = access_token.clone();
            let session_task = tauri::async_runtime::spawn(async move {
                let _ = run_signalr_session(&url_c, &tok_c, ev_tx, shutdown_rx).await;
            });

            loop {
                tokio::select! {
                    changed = poke_rx.changed() => {
                        if changed.is_err() {
                            let _ = shutdown_tx.send(true);
                            return;
                        }
                        let st = core.session_get_state();
                        let next_creds = if st.status == AuthStatus::Unlocked {
                            core.signalr_credentials()
                        } else {
                            None
                        };
                        if next_creds.as_ref() != Some(&(server_url.clone(), access_token.clone())) {
                            let _ = shutdown_tx.send(true);
                            break;
                        }
                    }
                    ev_opt = ev_rx.recv() => {
                        match ev_opt {
                            Some(SignalREvent::Connected) => {
                                core.set_signalr_connected(true);
                                let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
                            }
                            Some(SignalREvent::Disconnected(_)) | None => {
                                core.set_signalr_connected(false);
                                let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
                                break;
                            }
                            Some(SignalREvent::SyncCipher { .. })
                            | Some(SignalREvent::SyncFolder { .. })
                            | Some(SignalREvent::SyncVault) => {
                                if core.sync_now().await.is_ok() {
                                    emit_data_changed(&app, true, Vec::new(), Vec::new());
                                }
                                let _ = app.emit(EVENT_SYNC_STATUS, core.sync_get_status());
                            }
                        }
                    }
                }
            }

            let _ = session_task.await;

            // Backoff before reconnecting if still unlocked
            tokio::select! {
                _ = poke_rx.changed() => {},
                _ = tokio::time::sleep(Duration::from_secs(5)) => {},
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = toggle_quick_access_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            set_app_dock_icon(DOCK_ICON_PNG);

            let biometric = Arc::new(MacosBiometricKeyStore::new());
            let clipboard = Arc::new(MacosClipboard::new(handle.clone()));
            let core = Arc::new(
                AppCore::new(biometric, clipboard)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?,
            );

            let (signalr_poke, signalr_poke_rx) = watch::channel(0u64);
            let initial_session = core.session_get_state();
            let initial_lang = core
                .app_settings_get()
                .map(|s| s.language)
                .unwrap_or_else(|_| "system".to_string());

            app.manage(AppState {
                core: Arc::clone(&core),
                large_type_payload: Mutex::new(None),
                large_type_pinned: AtomicBool::new(false),
                quick_access_pinned: AtomicBool::new(false),
                quick_access_last_shown_ms: AtomicU64::new(0),
                signalr_poke: signalr_poke.clone(),
                saved_main_logical_size: Mutex::new(None),
                main_window_compact: AtomicBool::new(false),
            });

            if let Err(err) = setup_app_menu(&handle, &initial_lang) {
                eprintln!("[keysmith] failed to setup macOS menu: {err}");
            }
            if let Err(err) = setup_tray(&handle, &initial_lang) {
                eprintln!("[keysmith] failed to setup system tray: {err}");
            }

            if let Err(err) = update_global_shortcut(&handle, &initial_session.quick_access_shortcut) {
                eprintln!("[keysmith] {err}");
            }
            apply_window_preferences(&handle, &initial_session);

            // Close-to-tray behavior on main window
            if let Some(main_win) = handle.get_webview_window("main") {
                let win_handle = handle.clone();
                let win_core = Arc::clone(&core);
                main_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if win_core.session_get_state().close_to_tray {
                            api.prevent_close();
                            if let Some(w) = win_handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                    }
                });
            }

            // Fallback show timer (1200ms) in case frontend fails before calling window_main_ready
            let fallback_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1200)).await;
                if let Some(w) = fallback_handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(false) {
                        if let Some(st) = fallback_handle.try_state::<AppState>() {
                            set_main_window_compact(
                                &fallback_handle,
                                st.core.session_get_state().status == AuthStatus::Locked,
                            );
                        }
                        let _ = w.show();
                    }
                }
            });

            // Sleep & screen lock observer -> lock vault + destroy floating windows
            let sleep_handle = handle.clone();
            let sleep_core = Arc::clone(&core);
            let sleep_poke = signalr_poke.clone();
            register_sleep_and_screen_lock_observers(Arc::new(move |reason| {
                let st = sleep_core.session_get_state();
                if st.lock_on_sleep && st.status == AuthStatus::Unlocked {
                    destroy_floating_windows_and_wipe(&sleep_handle);
                    if sleep_core.session_lock(reason).is_ok() {
                        set_main_window_compact(&sleep_handle, true);
                        let next = sleep_poke.borrow().wrapping_add(1);
                        let _ = sleep_poke.send(next);
                        let _ = sleep_handle.emit(
                            EVENT_SESSION_STATE_CHANGED,
                            SessionStateChangedPayload {
                                status: "Locked".to_string(),
                                reason: Some(reason.to_string()),
                            },
                        );
                    }
                }
            }));

            // Background auto-lock checker
            let bg_handle = handle.clone();
            let bg_core = Arc::clone(&core);
            let bg_poke = signalr_poke;
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    if let Ok(true) = bg_core.check_auto_lock() {
                        destroy_floating_windows_and_wipe(&bg_handle);
                        set_main_window_compact(&bg_handle, true);
                        let next = bg_poke.borrow().wrapping_add(1);
                        let _ = bg_poke.send(next);
                        let _ = bg_handle.emit(
                            EVENT_SESSION_STATE_CHANGED,
                            SessionStateChangedPayload {
                                status: "Locked".to_string(),
                                reason: Some("auto_lock".to_string()),
                            },
                        );
                    }
                }
            });

            // SignalR real-time sync supervisor + Unix Domain Socket IPC server
            spawn_signalr_supervisor(handle.clone(), Arc::clone(&core), signalr_poke_rx);
            spawn_ipc_socket_server(handle.clone(), Arc::clone(&core));

            // Auto-register Native Messaging Host manifests & sync bundled browser extension
            let nmh_handle = handle;
            tauri::async_runtime::spawn_blocking(move || {
                let res_dir = nmh_handle.path().resource_dir().ok();
                let _ = crate::nmh::auto_install_nmh_for_detected_browsers(
                    res_dir.as_deref(),
                    &[],
                );
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id.starts_with("app:") {
                handle_menu_action(app, id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_check_server,
            commands::auth_prelogin,
            commands::auth_login,
            commands::auth_register,
            commands::auth_logout,
            commands::auth_passkey_login,
            commands::account_list,
            commands::account_switch,
            commands::session_get_state,
            commands::session_update_preferences,
            commands::session_unlock_password,
            commands::session_unlock_biometric,
            commands::session_lock,
            commands::session_touch_activity,
            commands::vault_list,
            commands::vault_create,
            commands::vault_rename,
            commands::vault_delete,
            commands::vault_set_travel_safe,
            commands::vault_import,
            commands::vault_export,
            commands::vault_export_emergency_kit,
            commands::snapshot_list,
            commands::snapshot_create,
            commands::snapshot_restore,
            commands::snapshot_delete,
            commands::organization_list,
            commands::item_share_to_organization,
            commands::item_list,
            commands::item_get_all_stats,
            commands::item_get,
            commands::item_create,
            commands::item_update,
            commands::item_update_watchtower_flags,
            commands::item_toggle_favorite,
            commands::item_duplicate,
            commands::item_set_archived,
            commands::item_move_vault,
            commands::item_batch_trash,
            commands::item_batch_add_tag,
            commands::item_trash,
            commands::item_restore,
            commands::item_delete_permanent,
            commands::item_empty_trash,
            commands::send_list,
            commands::send_create_text,
            commands::send_create_file,
            commands::send_update,
            commands::send_remove_password,
            commands::send_delete,
            commands::attachment_upload,
            commands::attachment_download,
            commands::attachment_delete,
            commands::sync_get_status,
            commands::sync_now,
            commands::totp_compute,
            commands::totp_parse_qr_image,
            commands::generator_generate,
            commands::generator_generate_masked_email,
            commands::generator_history_list,
            commands::generator_history_record,
            commands::generator_history_clear,
            commands::watchtower_scan,
            commands::ssh_generate_ed25519,
            commands::ssh_agent_socket_path,
            commands::autofill_auto_type,
            commands::favicon_fetch,
            commands::clipboard_copy_secret,
            commands::clipboard_clear_now,
            commands::clipboard_read_image_base64,
            commands::account_passkey_list,
            commands::account_passkey_register,
            commands::account_passkey_rename,
            commands::account_passkey_delete,
            commands::account_update_profile,
            commands::window_main_ready,
            commands::window_set_compact_lock,
            commands::window_open_large_type,
            commands::window_close_large_type,
            commands::window_set_large_type_pin,
            commands::large_type_get_payload,
            commands::window_toggle_quick_access,
            commands::window_open_generator,
            commands::window_toggle_generator,
            commands::window_close_generator,
            commands::window_hide_quick_access,
            commands::window_focus_main_item,
            commands::system_open_url,
            commands::browser_integration_status,
            commands::browser_integration_configure,
            commands::browser_open_extension_folder,
            commands::app_check_update_info,
            commands::app_settings_get,
            commands::app_settings_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Keysmith Tauri application");

    app.run(|app_handle, event| {
        match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                show_main_window(app_handle);
            }
            RunEvent::Exit => {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let _ = state.core.checkpoint_storage();
                }
            }
            _ => {}
        }
    });
}
