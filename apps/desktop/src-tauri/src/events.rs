use serde::Serialize;

pub const EVENT_SESSION_STATE_CHANGED: &str = "session:state_changed";
pub const EVENT_SYNC_STATUS: &str = "sync:status";
pub const EVENT_SYNC_DATA_CHANGED: &str = "sync:data_changed";
pub const EVENT_CLIPBOARD_TICK: &str = "clipboard:tick";
pub const EVENT_CLIPBOARD_CLEARED: &str = "clipboard:cleared";
pub const EVENT_UI_TOGGLE_QUICK_ACCESS: &str = "ui:toggle_quick_access";
pub const EVENT_LARGE_TYPE_UPDATED: &str = "large-type:updated";
pub const EVENT_UI_FOCUS_ITEM: &str = "ui:focus_item";
pub const EVENT_UI_SETTINGS_CHANGED: &str = "ui:settings_changed";
pub const EVENT_UI_OPEN_ABOUT: &str = "ui:open_about";
pub const EVENT_UI_OPEN_SETTINGS: &str = "ui:open_settings";
pub const EVENT_UI_NEW_ITEM: &str = "ui:new_item";
pub const EVENT_UI_FOCUS_SEARCH: &str = "ui:focus_search";
pub const EVENT_UI_SYNC_VAULT: &str = "ui:sync_vault";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateChangedPayload {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDataChangedPayload {
    pub vault_changed: bool,
    pub updated_item_ids: Vec<String>,
    pub deleted_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardTickPayload {
    pub label: String,
    pub remaining_seconds: u64,
    pub total_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardClearedPayload {
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeTypePayload {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiFocusItemPayload {
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiOpenAboutPayload {
    pub check_updates: bool,
}
