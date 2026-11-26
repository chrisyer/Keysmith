use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use keysmith_core::crypto::KdfConfig;
use keysmith_core::domain::{
    AccountPasskey, AccountPasskeyListResponse, AccountProfileResponse, AppSettings,
    AppSettingsPatch, AppUpdateInfo, AttachmentDownloadResult, AuthStatus, ExportResult,
    GeneratorHistoryEntry, GeneratorOptions, GeneratorResult, ImportSummary, ItemAttachment,
    ItemDetail, ItemDraft, ItemFilter, ItemStats, ItemSummary, OrganizationInfo,
    SendCreateFileInput, SendCreateTextInput, SendItem, SendUpdateInput, ServerCheckResult,
    SessionPreferencesPatch, SessionState, SshKeyPair, SyncStateKind, SyncStatus, TotpCode, Vault,
    WatchtowerFlagsPatch, WatchtowerReport,
};
use keysmith_core::error::CoreError;
use keysmith_core::protocol::check_github_latest_release;
use keysmith_core::AppCore;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::watch;
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use crate::events::{
    LargeTypePayload, SessionStateChangedPayload, SyncDataChangedPayload, UiFocusItemPayload,
    EVENT_LARGE_TYPE_UPDATED, EVENT_SESSION_STATE_CHANGED, EVENT_SYNC_DATA_CHANGED,
    EVENT_SYNC_STATUS, EVENT_UI_FOCUS_ITEM, EVENT_UI_SETTINGS_CHANGED,
};
use crate::macos::{
    activate_app_foreground, apply_window_vibrancy,
    clipboard_read_image_png_base64 as macos_read_image_b64, configure_floating_rounded_window,
    set_launch_at_login, set_window_screen_capture_protection,
};

pub struct AppState {
    pub core: Arc<AppCore>,
    pub large_type_payload: Mutex<Option<(Zeroizing<String>, Zeroizing<String>)>>,
    pub large_type_pinned: AtomicBool,
    pub quick_access_pinned: AtomicBool,
    pub quick_access_last_shown_ms: AtomicU64,
    pub signalr_poke: watch::Sender<u64>,
    pub saved_main_logical_size: Mutex<Option<(f64, f64)>>,
    pub main_window_compact: AtomicBool,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummaryDto {
    pub id: String,
    pub account_id: String,
    pub email: String,
    pub display_name: String,
    pub server_url: String,
    pub is_active: bool,
    pub kdf_type: String,
    pub last_sync_at: String,
}

pub fn set_main_window_compact(app: &AppHandle, compact: bool) {
    let (Some(win), Some(state)) = (app.get_webview_window("main"), app.try_state::<AppState>()) else {
        return;
    };
    if compact {
        if !state.main_window_compact.swap(true, Ordering::SeqCst) {
            if let (Ok(phys), Ok(scale)) = (win.inner_size(), win.scale_factor()) {
                let scale = if scale > 0.0 { scale } else { 1.0 };
                let logical_w = (phys.width as f64) / scale;
                let logical_h = (phys.height as f64) / scale;
                if logical_w >= 900.0 && logical_h >= 580.0 {
                    if let Ok(mut guard) = state.saved_main_logical_size.lock() {
                        *guard = Some((logical_w, logical_h));
                    }
                }
            }
            let _ = win.set_min_size(Some(tauri::LogicalSize::new(370.0_f64, 440.0_f64)));
            let _ = win.set_size(tauri::LogicalSize::new(400.0_f64, 480.0_f64));
            let _ = win.center();
        }
    } else if state.main_window_compact.swap(false, Ordering::SeqCst) {
        let (w, h) = state
            .saved_main_logical_size
            .lock()
            .ok()
            .and_then(|g| *g)
            .unwrap_or((1240.0, 800.0));
        let _ = win.set_min_size(Some(tauri::LogicalSize::new(920.0_f64, 600.0_f64)));
        let _ = win.set_size(tauri::LogicalSize::new(w, h));
        let _ = win.center();
    }
}

pub fn emit_session_state(app: &AppHandle, state: &SessionState, reason: &str) {
    set_main_window_compact(app, state.status == AuthStatus::Locked);
    let status = serde_json::to_value(state.status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "Unauthenticated".to_string());
    let _ = app.emit(
        EVENT_SESSION_STATE_CHANGED,
        SessionStateChangedPayload {
            status,
            reason: Some(reason.to_string()),
        },
    );
}

pub fn emit_data_changed(
    app: &AppHandle,
    vault_changed: bool,
    updated_item_ids: Vec<String>,
    deleted_item_ids: Vec<String>,
) {
    let _ = app.emit(
        EVENT_SYNC_DATA_CHANGED,
        SyncDataChangedPayload {
            vault_changed,
            updated_item_ids,
            deleted_item_ids,
        },
    );
}

pub fn poke_signalr(state: &AppState) {
    let next = state.signalr_poke.borrow().wrapping_add(1);
    let _ = state.signalr_poke.send(next);
}

pub fn wipe_large_type_payload(state: &AppState) {
    let mut guard = state
        .large_type_payload
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some((mut label, mut value)) = guard.take() {
        label.zeroize();
        value.zeroize();
    }
    state.large_type_pinned.store(false, Ordering::SeqCst);
}

pub fn destroy_floating_windows_and_wipe(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        wipe_large_type_payload(&state);
        state.quick_access_pinned.store(false, Ordering::SeqCst);
    }
    for label in ["large-type", "quick-access"] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.destroy();
        }
    }
}

pub fn show_main_window(app: &AppHandle) {
    activate_app_foreground(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn apply_window_theme(app: &AppHandle, theme: &str) {
    let target = match theme.trim().to_ascii_lowercase().as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    for label in ["main", "large-type", "quick-access", "generator"] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.set_theme(target);
        }
    }
}

pub fn apply_window_preferences(app: &AppHandle, session: &SessionState) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(settings) = state.core.app_settings_get() {
            apply_window_theme(app, &settings.theme);
        }
    }
    if let Some(main_win) = app.get_webview_window("main") {
        set_window_screen_capture_protection(&main_win, session.screen_capture_protected);
        apply_window_vibrancy(&main_win, session.vibrancy_enabled);
    }
    for label in ["large-type", "quick-access", "generator"] {
        if let Some(win) = app.get_webview_window(label) {
            set_window_screen_capture_protection(&win, session.screen_capture_protected);
        }
    }
}

pub fn update_global_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), CoreError> {
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let _ = app.global_shortcut().unregister_all();
    app.global_shortcut()
        .register(trimmed)
        .map_err(|err| CoreError::Validation(format!("全局快捷键注册失败 ({trimmed}): {err}")))
}

pub fn show_quick_access_window(app: &AppHandle) -> Result<(), CoreError> {
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(());
    };
    let session = state.core.session_get_state();
    if session.status != AuthStatus::Unlocked {
        if session.status == AuthStatus::Locked && session.biometric_enabled {
            let app_c = app.clone();
            let core = Arc::clone(&state.core);
            tauri::async_runtime::spawn(async move {
                match core.session_unlock_biometric().await {
                    Ok(unlocked) => {
                        emit_session_state(&app_c, &unlocked, "biometric");
                        apply_window_preferences(&app_c, &unlocked);
                        if let Some(st) = app_c.try_state::<AppState>() {
                            poke_signalr(&st);
                        }
                        let _ = show_quick_access_window(&app_c);
                    }
                    Err(_) => {
                        set_main_window_compact(&app_c, true);
                        show_main_window(&app_c);
                    }
                }
            });
            return Ok(());
        }
        set_main_window_compact(app, session.status == AuthStatus::Locked);
        show_main_window(app);
        return Ok(());
    }

    state
        .quick_access_last_shown_ms
        .store(now_epoch_ms(), Ordering::SeqCst);

    if let Some(win) = app.get_webview_window("quick-access") {
        configure_floating_rounded_window(&win);
        activate_app_foreground(app);
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        app,
        "quick-access",
        WebviewUrl::App("index.html?window=quick-access".into()),
    )
    .title("Keysmith Quick Access")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .inner_size(840.0, 560.0)
    .min_inner_size(700.0, 460.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| CoreError::Internal(format!("创建 Quick Access 窗口失败: {e}")))?;

    configure_floating_rounded_window(&win);
    set_window_screen_capture_protection(&win, session.screen_capture_protected);

    let app_handle = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if let Some(st) = app_handle.try_state::<AppState>() {
                // Ignore transient blur caused by dismissing macOS tray NSMenu or focusing window
                let shown_at = st.quick_access_last_shown_ms.load(Ordering::SeqCst);
                if now_epoch_ms().saturating_sub(shown_at) < 450 {
                    return;
                }
                if !st.quick_access_pinned.load(Ordering::SeqCst) {
                    if let Some(w) = app_handle.get_webview_window("quick-access") {
                        let _ = w.hide();
                    }
                }
            }
        }
    });

    activate_app_foreground(app);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

pub fn toggle_quick_access_window(app: &AppHandle) -> Result<(), CoreError> {
    if let Some(win) = app.get_webview_window("quick-access") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return Ok(());
        }
    }
    show_quick_access_window(app)
}

pub fn show_generator_window(app: &AppHandle) -> Result<(), CoreError> {
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(());
    };
    let session = state.core.session_get_state();

    if let Some(win) = app.get_webview_window("generator") {
        configure_floating_rounded_window(&win);
        set_window_screen_capture_protection(&win, session.screen_capture_protected);
        activate_app_foreground(app);
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        app,
        "generator",
        WebviewUrl::App("index.html?window=generator".into()),
    )
    .title("Keysmith Generator")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .inner_size(430.0, 560.0)
    .min_inner_size(380.0, 480.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| CoreError::Internal(format!("创建密码生成器窗口失败: {e}")))?;

    configure_floating_rounded_window(&win);
    set_window_screen_capture_protection(&win, session.screen_capture_protected);
    activate_app_foreground(app);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

pub fn toggle_generator_window(app: &AppHandle) -> Result<(), CoreError> {
    if let Some(win) = app.get_webview_window("generator") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return Ok(());
        }
    }
    show_generator_window(app)
}

async fn run_blocking<F, T>(f: F) -> Result<T, CoreError>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| CoreError::Internal(format!("后台任务执行失败: {e}")))
}

// --- Auth & Server ---

#[tauri::command]
pub async fn auth_check_server(
    state: State<'_, AppState>,
    server_url: String,
) -> Result<ServerCheckResult, CoreError> {
    state.core.auth_check_server(&server_url).await
}

#[tauri::command]
pub async fn auth_prelogin(
    state: State<'_, AppState>,
    server_url: String,
    email: String,
) -> Result<KdfConfig, CoreError> {
    state.core.auth_prelogin(&server_url, &email).await
}

#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    email: String,
    master_password: String,
    two_factor_code: Option<String>,
) -> Result<SessionState, CoreError> {
    let session = state
        .core
        .auth_login(
            &server_url,
            &email,
            &master_password,
            two_factor_code.as_deref(),
        )
        .await?;
    emit_session_state(&app, &session, "login");
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    emit_data_changed(&app, true, Vec::new(), Vec::new());
    apply_window_preferences(&app, &session);
    poke_signalr(&state);
    Ok(session)
}

#[tauri::command]
pub async fn auth_register(
    app: AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    email: String,
    name: String,
    master_password: String,
    kdf_config: Option<KdfConfig>,
) -> Result<SessionState, CoreError> {
    let session = state
        .core
        .auth_register(&server_url, &email, &name, &master_password, kdf_config)
        .await?;
    emit_session_state(&app, &session, "register");
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    emit_data_changed(&app, true, Vec::new(), Vec::new());
    apply_window_preferences(&app, &session);
    poke_signalr(&state);
    Ok(session)
}

#[tauri::command]
pub async fn auth_logout(
    app: AppHandle,
    state: State<'_, AppState>,
    clear_local_cache: Option<bool>,
) -> Result<(), CoreError> {
    destroy_floating_windows_and_wipe(&app);
    state
        .core
        .auth_logout(clear_local_cache.unwrap_or(false))
        .await?;
    let next_state = state.core.session_get_state();
    poke_signalr(&state);
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    emit_session_state(&app, &next_state, "logout");
    Ok(())
}

#[tauri::command]
pub async fn auth_passkey_login(
    app: AppHandle,
    state: State<'_, AppState>,
    credential_id: Option<String>,
) -> Result<SessionState, CoreError> {
    let session = state
        .core
        .auth_passkey_login(credential_id.as_deref())
        .await?;
    emit_session_state(&app, &session, "passkey_prf");
    apply_window_preferences(&app, &session);
    poke_signalr(&state);
    Ok(session)
}

// --- Multi-account ---

#[tauri::command]
pub async fn account_list(state: State<'_, AppState>) -> Result<Vec<AccountSummaryDto>, CoreError> {
    let core = Arc::clone(&state.core);
    let accounts = run_blocking(move || core.account_list()).await??;
    Ok(accounts
        .into_iter()
        .map(|a| AccountSummaryDto {
            account_id: a.id.clone(),
            id: a.id,
            email: a.email,
            display_name: a.display_name,
            server_url: a.server_url,
            is_active: a.is_active,
            kdf_type: a.kdf_type,
            last_sync_at: a.last_sync_at,
        })
        .collect())
}

#[tauri::command]
pub async fn account_switch(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
) -> Result<SessionState, CoreError> {
    destroy_floating_windows_and_wipe(&app);
    let core = Arc::clone(&state.core);
    let session = run_blocking(move || core.account_switch(&account_id)).await??;
    emit_session_state(&app, &session, "account_switch");
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    apply_window_preferences(&app, &session);
    let _ = update_global_shortcut(&app, &session.quick_access_shortcut);
    poke_signalr(&state);
    Ok(session)
}

// --- Session ---

#[tauri::command]
pub async fn session_get_state(state: State<'_, AppState>) -> Result<SessionState, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.session_get_state()).await
}

#[tauri::command]
pub async fn session_update_preferences(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SessionPreferencesPatch,
) -> Result<SessionState, CoreError> {
    let prev_shortcut = state.core.session_get_state().quick_access_shortcut;
    let shortcut_changed = patch.quick_access_shortcut.clone();
    let launch_changed = patch.launch_at_login;

    if let Some(ref next_shortcut) = shortcut_changed {
        if let Err(err) = update_global_shortcut(&app, next_shortcut) {
            let _ = update_global_shortcut(&app, &prev_shortcut);
            return Err(err);
        }
    }

    let core = Arc::clone(&state.core);
    let session = run_blocking(move || core.session_update_preferences(patch)).await??;

    if let Some(enabled) = launch_changed {
        let _ = set_launch_at_login(enabled);
    }
    apply_window_preferences(&app, &session);
    Ok(session)
}

#[tauri::command]
pub async fn session_unlock_password(
    app: AppHandle,
    state: State<'_, AppState>,
    master_password: String,
) -> Result<SessionState, CoreError> {
    let session = state.core.session_unlock_password(&master_password).await?;
    emit_session_state(&app, &session, "password");
    apply_window_preferences(&app, &session);
    poke_signalr(&state);
    Ok(session)
}

#[tauri::command]
pub async fn session_unlock_biometric(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SessionState, CoreError> {
    let session = state.core.session_unlock_biometric().await?;
    emit_session_state(&app, &session, "biometric");
    apply_window_preferences(&app, &session);
    poke_signalr(&state);
    Ok(session)
}

#[tauri::command]
pub async fn session_lock(
    app: AppHandle,
    state: State<'_, AppState>,
    reason: Option<String>,
) -> Result<(), CoreError> {
    destroy_floating_windows_and_wipe(&app);
    let r = reason.unwrap_or_else(|| "manual".to_string());
    let core = Arc::clone(&state.core);
    let r_clone = r.clone();
    run_blocking(move || core.session_lock(&r_clone)).await??;
    set_main_window_compact(&app, true);
    poke_signalr(&state);
    let _ = app.emit(
        EVENT_SESSION_STATE_CHANGED,
        SessionStateChangedPayload {
            status: "Locked".to_string(),
            reason: Some(r),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn session_touch_activity(state: State<'_, AppState>) -> Result<(), CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.session_touch_activity()).await
}

// --- Vaults & Importers/Exporters ---

#[tauri::command]
pub async fn vault_list(state: State<'_, AppState>) -> Result<Vec<Vault>, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.vault_list()).await?
}

#[tauri::command]
pub async fn vault_create(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
) -> Result<Vault, CoreError> {
    let vault = state
        .core
        .vault_create(&name, color.as_deref(), icon.as_deref())
        .await?;
    emit_data_changed(&app, true, Vec::new(), Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(vault)
}

#[tauri::command]
pub async fn vault_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Vault, CoreError> {
    let vault = state.core.vault_rename(&id, &name).await?;
    emit_data_changed(&app, true, Vec::new(), Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(vault)
}

#[tauri::command]
pub async fn vault_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CoreError> {
    state.core.vault_delete(&id).await?;
    emit_data_changed(&app, true, Vec::new(), Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(())
}

#[tauri::command]
pub async fn vault_import(
    app: AppHandle,
    state: State<'_, AppState>,
    format: String,
    data: String,
    is_base64: bool,
    target_vault_id: Option<String>,
) -> Result<ImportSummary, CoreError> {
    let summary = state
        .core
        .vault_import(&format, &data, is_base64, target_vault_id.as_deref())
        .await?;
    emit_data_changed(&app, true, Vec::new(), Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(summary)
}

#[tauri::command]
pub async fn vault_export(
    state: State<'_, AppState>,
    format: String,
    master_password: String,
    export_passphrase: Option<String>,
) -> Result<ExportResult, CoreError> {
    state
        .core
        .vault_export(&format, &master_password, export_passphrase.as_deref())
        .await
}

// --- Items & Batch Ops ---

#[tauri::command]
pub async fn item_list(
    state: State<'_, AppState>,
    filter: Option<ItemFilter>,
) -> Result<Vec<ItemSummary>, CoreError> {
    let core = Arc::clone(&state.core);
    let f = filter.unwrap_or_default();
    run_blocking(move || core.item_list(f)).await?
}

#[tauri::command]
pub async fn item_get_all_stats(state: State<'_, AppState>) -> Result<ItemStats, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.item_get_all_stats()).await?
}

#[tauri::command]
pub async fn item_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ItemDetail>, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.item_get(&id)).await?
}

#[tauri::command]
pub async fn item_create(
    app: AppHandle,
    state: State<'_, AppState>,
    draft: ItemDraft,
) -> Result<ItemDetail, CoreError> {
    let created = state.core.item_create(draft).await?;
    emit_data_changed(&app, true, vec![created.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(created)
}

#[tauri::command]
pub async fn item_update(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    draft: ItemDraft,
) -> Result<ItemDetail, CoreError> {
    let updated = state.core.item_update(&id, draft).await?;
    emit_data_changed(&app, false, vec![updated.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(updated)
}

#[tauri::command]
pub async fn item_update_watchtower_flags(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    flags: WatchtowerFlagsPatch,
) -> Result<ItemDetail, CoreError> {
    let updated = state.core.item_update_watchtower_flags(&id, flags).await?;
    emit_data_changed(&app, false, vec![updated.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(updated)
}

#[tauri::command]
pub async fn item_toggle_favorite(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> Result<ItemDetail, CoreError> {
    let updated = state.core.item_toggle_favorite(&id, favorite).await?;
    emit_data_changed(&app, false, vec![updated.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(updated)
}

#[tauri::command]
pub async fn item_duplicate(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<ItemDetail, CoreError> {
    let created = state.core.item_duplicate(&id).await?;
    emit_data_changed(&app, true, vec![created.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(created)
}

#[tauri::command]
pub async fn item_set_archived(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> Result<ItemDetail, CoreError> {
    let updated = state.core.item_set_archived(&id, archived).await?;
    emit_data_changed(&app, true, vec![updated.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(updated)
}

#[tauri::command]
pub async fn item_move_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
    target_vault_id: String,
) -> Result<usize, CoreError> {
    let count = state.core.item_move_vault(&ids, &target_vault_id).await?;
    emit_data_changed(&app, true, ids, Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(count)
}

#[tauri::command]
pub async fn item_batch_trash(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<usize, CoreError> {
    let count = state.core.item_batch_trash(&ids).await?;
    emit_data_changed(&app, true, Vec::new(), ids);
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(count)
}

#[tauri::command]
pub async fn item_batch_add_tag(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
    tag: String,
) -> Result<usize, CoreError> {
    let count = state.core.item_batch_add_tag(&ids, &tag).await?;
    emit_data_changed(&app, false, ids, Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(count)
}

#[tauri::command]
pub async fn item_trash(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CoreError> {
    state.core.item_trash(&id).await?;
    emit_data_changed(&app, true, Vec::new(), vec![id]);
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(())
}

#[tauri::command]
pub async fn item_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CoreError> {
    state.core.item_restore(&id).await?;
    emit_data_changed(&app, true, vec![id], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(())
}

#[tauri::command]
pub async fn item_delete_permanent(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CoreError> {
    state.core.item_delete_permanent(&id).await?;
    emit_data_changed(&app, true, Vec::new(), vec![id]);
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(())
}

#[tauri::command]
pub async fn item_empty_trash(app: AppHandle, state: State<'_, AppState>) -> Result<usize, CoreError> {
    let count = state.core.item_empty_trash().await?;
    emit_data_changed(&app, true, Vec::new(), Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(count)
}

// --- Vaultwarden Sends ---

#[tauri::command]
pub async fn send_list(state: State<'_, AppState>) -> Result<Vec<SendItem>, CoreError> {
    state.core.send_list().await
}

#[tauri::command]
pub async fn send_create_text(
    state: State<'_, AppState>,
    input: SendCreateTextInput,
) -> Result<SendItem, CoreError> {
    state.core.send_create_text(input).await
}

#[tauri::command]
pub async fn send_create_file(
    state: State<'_, AppState>,
    input: SendCreateFileInput,
) -> Result<SendItem, CoreError> {
    state.core.send_create_file(input).await
}

#[tauri::command]
pub async fn send_update(
    state: State<'_, AppState>,
    id: String,
    input: SendUpdateInput,
) -> Result<SendItem, CoreError> {
    state.core.send_update(&id, input).await
}

#[tauri::command]
pub async fn send_remove_password(
    state: State<'_, AppState>,
    id: String,
) -> Result<SendItem, CoreError> {
    state.core.send_remove_password(&id).await
}

#[tauri::command]
pub async fn send_delete(state: State<'_, AppState>, id: String) -> Result<(), CoreError> {
    state.core.send_delete(&id).await
}

// --- Attachments ---

#[tauri::command]
pub async fn attachment_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    file_name: String,
    data_base64: String,
) -> Result<ItemAttachment, CoreError> {
    let att = state
        .core
        .attachment_upload(&item_id, &file_name, &data_base64)
        .await?;
    emit_data_changed(&app, false, vec![item_id], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(att)
}

#[tauri::command]
pub async fn attachment_download(
    state: State<'_, AppState>,
    item_id: String,
    attachment_id: String,
) -> Result<AttachmentDownloadResult, CoreError> {
    state
        .core
        .attachment_download(&item_id, &attachment_id)
        .await
}

#[tauri::command]
pub async fn attachment_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    attachment_id: String,
) -> Result<(), CoreError> {
    state
        .core
        .attachment_delete(&item_id, &attachment_id)
        .await?;
    emit_data_changed(&app, false, vec![item_id], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(())
}

// --- Sync ---

#[tauri::command]
pub async fn sync_get_status(state: State<'_, AppState>) -> Result<SyncStatus, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.sync_get_status()).await
}

#[tauri::command]
pub async fn sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncStatus, CoreError> {
    let mut syncing = state.core.sync_get_status();
    syncing.state = SyncStateKind::Syncing;
    let _ = app.emit(EVENT_SYNC_STATUS, syncing);

    match state.core.sync_now().await {
        Ok(status) => {
            let _ = app.emit(EVENT_SYNC_STATUS, status.clone());
            emit_data_changed(&app, true, Vec::new(), Vec::new());
            poke_signalr(&state);
            Ok(status)
        }
        Err(err) => {
            let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
            Err(err)
        }
    }
}

// --- TOTP / Generator / Watchtower / SSH / Favicon / Clipboard ---

#[tauri::command]
pub async fn totp_compute(
    state: State<'_, AppState>,
    secret_or_uri: String,
) -> Result<TotpCode, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.totp_compute(&secret_or_uri)).await?
}

#[tauri::command]
pub async fn totp_parse_qr_image(
    state: State<'_, AppState>,
    image_base64: String,
) -> Result<String, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.totp_parse_qr_image(&image_base64)).await?
}

#[tauri::command]
pub async fn generator_generate(
    state: State<'_, AppState>,
    options: GeneratorOptions,
) -> Result<GeneratorResult, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.generator_generate(options)).await
}

#[tauri::command]
pub async fn generator_history_list(
    state: State<'_, AppState>,
) -> Result<Vec<GeneratorHistoryEntry>, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.generator_history_list()).await?
}

#[tauri::command]
pub async fn generator_history_record(
    state: State<'_, AppState>,
    value: String,
    mode: String,
    entropy_bits: u32,
    source: Option<String>,
) -> Result<GeneratorHistoryEntry, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.generator_history_record(&value, &mode, entropy_bits, source.as_deref()))
        .await?
}

#[tauri::command]
pub async fn generator_history_clear(state: State<'_, AppState>) -> Result<(), CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.generator_history_clear()).await?
}

#[tauri::command]
pub async fn watchtower_scan(
    state: State<'_, AppState>,
    check_hibp: Option<bool>,
) -> Result<WatchtowerReport, CoreError> {
    state
        .core
        .watchtower_scan(check_hibp.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn ssh_generate_ed25519(
    state: State<'_, AppState>,
    comment: Option<String>,
) -> Result<SshKeyPair, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.ssh_generate_ed25519(comment.as_deref())).await?
}

#[tauri::command]
pub async fn favicon_fetch(
    state: State<'_, AppState>,
    host: String,
) -> Result<Option<String>, CoreError> {
    state.core.favicon_fetch(&host).await
}

#[tauri::command]
pub async fn clipboard_copy_secret(
    state: State<'_, AppState>,
    text: String,
    label: String,
    is_sensitive: bool,
) -> Result<(), CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.clipboard_copy_secret(&text, &label, is_sensitive)).await?
}

#[tauri::command]
pub async fn clipboard_clear_now(state: State<'_, AppState>) -> Result<(), CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.clipboard_clear_now()).await?
}

#[tauri::command]
pub async fn clipboard_read_image_base64() -> Result<Option<String>, CoreError> {
    run_blocking(macos_read_image_b64).await
}

// --- Account Passkeys & Profile ---

#[tauri::command]
pub async fn account_passkey_list(
    state: State<'_, AppState>,
) -> Result<AccountPasskeyListResponse, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || match core.account_passkey_list() {
        Ok(res) => Ok(res),
        Err(CoreError::InvalidState(_)) => Ok(AccountPasskeyListResponse {
            rp_id: "keysmith.local".to_string(),
            user_id: String::new(),
            credentials: Vec::new(),
        }),
        Err(err) => Err(err),
    })
    .await?
}

#[tauri::command]
pub async fn account_passkey_register(
    state: State<'_, AppState>,
    name: String,
    device_type: String,
) -> Result<AccountPasskey, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.account_passkey_register(&name, &device_type)).await?
}

#[tauri::command]
pub async fn account_passkey_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<AccountPasskey, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.account_passkey_rename(&id, &name)).await?
}

#[tauri::command]
pub async fn account_passkey_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.account_passkey_delete(&id)).await?
}

#[tauri::command]
pub async fn account_update_profile(
    state: State<'_, AppState>,
    display_name: String,
) -> Result<AccountProfileResponse, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.account_update_profile(&display_name)).await?
}

// --- Window, System & Update Commands ---

#[tauri::command]
pub async fn window_main_ready(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> Result<(), CoreError> {
    let core = Arc::clone(&state.core);
    let session = run_blocking(move || core.session_get_state()).await?;
    apply_window_preferences(&app, &session);
    set_main_window_compact(&app, session.status == AuthStatus::Locked);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn window_set_compact_lock(app: AppHandle, compact: bool) -> Result<(), CoreError> {
    set_main_window_compact(&app, compact);
    Ok(())
}

#[tauri::command]
pub async fn window_open_large_type(
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    value: String,
) -> Result<(), CoreError> {
    {
        let mut guard = state
            .large_type_payload
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some((mut old_l, mut old_v)) = guard.take() {
            old_l.zeroize();
            old_v.zeroize();
        }
        *guard = Some((Zeroizing::new(label.clone()), Zeroizing::new(value.clone())));
    }

    let payload = LargeTypePayload { label, value };

    if let Some(win) = app.get_webview_window("large-type") {
        configure_floating_rounded_window(&win);
        activate_app_foreground(&app);
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to("large-type", EVENT_LARGE_TYPE_UPDATED, payload);
        return Ok(());
    }

    let session = state.core.session_get_state();
    let win = WebviewWindowBuilder::new(
        &app,
        "large-type",
        WebviewUrl::App("index.html?window=large-type".into()),
    )
    .title("Keysmith Large Type")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .inner_size(760.0, 340.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| CoreError::Internal(format!("创建 Large Type 窗口失败: {e}")))?;

    configure_floating_rounded_window(&win);
    set_window_screen_capture_protection(&win, session.screen_capture_protected);

    let app_handle = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Some(st) = app_handle.try_state::<AppState>() {
                wipe_large_type_payload(&st);
            }
        }
    });

    activate_app_foreground(&app);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit_to("large-type", EVENT_LARGE_TYPE_UPDATED, payload);
    Ok(())
}

#[tauri::command]
pub async fn window_close_large_type(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CoreError> {
    wipe_large_type_payload(&state);
    if let Some(win) = app.get_webview_window("large-type") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn window_set_large_type_pin(
    app: AppHandle,
    state: State<'_, AppState>,
    pinned: bool,
) -> Result<(), CoreError> {
    state.large_type_pinned.store(pinned, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("large-type") {
        win.set_always_on_top(pinned)
            .map_err(|e| CoreError::Internal(format!("设置窗口置顶失败: {e}")))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn large_type_get_payload(
    state: State<'_, AppState>,
) -> Result<Option<LargeTypePayload>, CoreError> {
    let guard = state
        .large_type_payload
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    Ok(guard.as_ref().map(|(label, value)| LargeTypePayload {
        label: label.to_string(),
        value: value.to_string(),
    }))
}

#[tauri::command]
pub async fn window_toggle_quick_access(app: AppHandle) -> Result<(), CoreError> {
    toggle_quick_access_window(&app)
}

#[tauri::command]
pub async fn window_open_generator(app: AppHandle) -> Result<(), CoreError> {
    show_generator_window(&app)
}

#[tauri::command]
pub async fn window_toggle_generator(app: AppHandle) -> Result<(), CoreError> {
    toggle_generator_window(&app)
}

#[tauri::command]
pub async fn window_close_generator(app: AppHandle) -> Result<(), CoreError> {
    if let Some(win) = app.get_webview_window("generator") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn window_hide_quick_access(app: AppHandle) -> Result<(), CoreError> {
    if let Some(win) = app.get_webview_window("quick-access") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn window_focus_main_item(
    app: AppHandle,
    item_id: String,
) -> Result<(), CoreError> {
    if let Some(win) = app.get_webview_window("quick-access") {
        let _ = win.hide();
    }
    show_main_window(&app);
    let _ = app.emit_to(
        "main",
        EVENT_UI_FOCUS_ITEM,
        UiFocusItemPayload { item_id },
    );
    Ok(())
}

#[tauri::command]
pub async fn system_open_url(app: AppHandle, url: String) -> Result<(), CoreError> {
    let parsed = Url::parse(url.trim())
        .map_err(|e| CoreError::Validation(format!("无效 URL: {e}")))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(CoreError::Validation(format!(
                "出于安全限制，仅允许打开 http/https 链接，拒绝协议: {other}"
            )))
        }
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| CoreError::Internal(format!("打开外部链接失败: {e}")))
}

#[tauri::command]
pub async fn browser_integration_status(
    app: AppHandle,
) -> Result<crate::nmh::BrowserIntegrationStatus, CoreError> {
    let res_dir = app.path().resource_dir().ok();
    run_blocking(move || crate::nmh::auto_install_nmh_for_detected_browsers(res_dir.as_deref(), &[])).await
}

#[tauri::command]
pub async fn browser_integration_configure(
    app: AppHandle,
    extra_extension_id: Option<String>,
) -> Result<crate::nmh::BrowserIntegrationStatus, CoreError> {
    let res_dir = app.path().resource_dir().ok();
    let extras: Vec<String> = extra_extension_id
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    run_blocking(move || {
        crate::nmh::auto_install_nmh_for_detected_browsers(res_dir.as_deref(), &extras)
    })
    .await
}

#[tauri::command]
pub async fn browser_open_extension_folder(app: AppHandle) -> Result<String, CoreError> {
    let res_dir = app.path().resource_dir().ok();
    let dir = run_blocking(move || crate::nmh::sync_bundled_extension_dir(res_dir.as_deref()))
        .await?
        .ok_or_else(|| CoreError::NotFound("未找到浏览器扩展目录".to_string()))?;
    let path_str = dir.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&path_str);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(&path_str);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&path_str);
        c
    };
    cmd.spawn()
        .map_err(|e| CoreError::Internal(format!("无法打开扩展目录: {e}")))?;
    Ok(path_str)
}

#[tauri::command]
pub async fn organization_list(state: State<'_, AppState>) -> Result<Vec<OrganizationInfo>, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.organization_list()).await?
}

#[tauri::command]
pub async fn item_share_to_organization(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    organization_id: String,
    collection_ids: Vec<String>,
) -> Result<ItemDetail, CoreError> {
    let updated = state
        .core
        .item_share_to_organization(&item_id, &organization_id, collection_ids)
        .await?;
    emit_data_changed(&app, true, vec![updated.id.clone()], Vec::new());
    let _ = app.emit(EVENT_SYNC_STATUS, state.core.sync_get_status());
    Ok(updated)
}

#[tauri::command]
pub async fn app_check_update_info() -> Result<AppUpdateInfo, CoreError> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    match check_github_latest_release("chrisyer/Keysmith", &current).await {
        Ok(info) => Ok(info),
        Err(err) => Ok(AppUpdateInfo {
            current_version: current.clone(),
            latest_version: Some(current),
            update_available: false,
            release_url: Some("https://github.com/chrisyer/Keysmith/releases/latest".to_string()),
            notes: Some(err.to_string()),
            checked_at: Some(keysmith_core::passkey::now_rfc3339()),
        }),
    }
}

#[tauri::command]
pub async fn app_settings_get(state: State<'_, AppState>) -> Result<AppSettings, CoreError> {
    let core = Arc::clone(&state.core);
    run_blocking(move || core.app_settings_get()).await?
}

#[tauri::command]
pub async fn app_settings_update(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: AppSettingsPatch,
) -> Result<AppSettings, CoreError> {
    let lang_changed = patch.language.is_some();
    let theme_changed = patch.theme.is_some();
    let core = Arc::clone(&state.core);
    let updated = run_blocking(move || core.app_settings_update(patch)).await??;
    if lang_changed {
        let _ = crate::refresh_localized_menus(&app, &updated.language);
    }
    if theme_changed {
        apply_window_theme(&app, &updated.theme);
        let session = state.core.session_get_state();
        if session.vibrancy_enabled {
            if let Some(main_win) = app.get_webview_window("main") {
                apply_window_vibrancy(&main_win, true);
            }
        }
    }
    let _ = app.emit(EVENT_UI_SETTINGS_CHANGED, &updated);
    Ok(updated)
}
