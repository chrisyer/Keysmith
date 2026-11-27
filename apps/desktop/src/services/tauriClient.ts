import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AccountPasskey,
  AccountSummary,
  AppSettings,
  AppSettingsPatch,
  AppUpdateInfo,
  AttachmentDownloadResult,
  AuthStatus,
  BrowserIntegrationStatus,
  ExportFormat,
  ExportResult,
  GeneratorHistoryEntry,
  GeneratorMode,
  GeneratorOptions,
  GeneratorResult,
  ImportFormat,
  ImportSummary,
  ItemAttachment,
  ItemDetail,
  ItemDraft,
  ItemFilter,
  ItemStats,
  ItemSummary,
  KdfConfig,
  LocalSnapshotInfo,
  OrganizationInfo,
  SendCreateFileInput,
  SendCreateTextInput,
  SendItem,
  SendUpdateInput,
  SessionPreferencesPatch,
  SessionState,
  SshAgentStatus,
  SshKeyPair,
  SyncStatus,
  TotpCode,
  Vault,
  WatchtowerFlags,
  WatchtowerReport,
} from '../types/domain';
import { deriveSubtitle, makeId } from '../utils/format';
import { generateSecret } from './generator';
import {
  DEMO_ACCOUNT_USER_ID,
  DEMO_RP_ID,
  INITIAL_ACCOUNT_PASSKEYS,
  INITIAL_ITEMS,
  INITIAL_VAULTS,
} from './mockData';
import {
  APPLE_TOUCH_ID_AAGUID,
  YUBIKEY_5_AAGUID,
  generatePasskeyKeypair,
} from './passkey';
import { scoreSearchQuery } from './search';
import { computeTotp } from './totp';
import { runWatchtowerAudit, sha1PrefixHex } from './watchtower';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export class KeysmithIpcError extends Error {
  code?: string;
  twoFactorRequired?: boolean;
  twoFactorProviders?: number[];

  constructor(
    message: string,
    extra?: { code?: string; twoFactorRequired?: boolean; twoFactorProviders?: number[] },
  ) {
    super(message);
    this.name = 'KeysmithIpcError';
    this.code = extra?.code;
    this.twoFactorRequired = extra?.twoFactorRequired;
    this.twoFactorProviders = extra?.twoFactorProviders;
  }
}

export type ServerCheckResult = {
  ok: boolean;
  version: string;
  disableUserRegistration?: boolean;
};

export type LargeTypePayload = {
  label: string;
  value: string;
};

export type TauriEventMap = {
  'session:state_changed': { status: AuthStatus; reason?: string };
  'sync:status': SyncStatus;
  'sync:data_changed': { vaultChanged: boolean; updatedItemIds: string[]; deletedItemIds: string[] };
  'clipboard:cleared': { label: string };
  'clipboard:tick': { label: string; remainingSeconds: number; totalSeconds: number } | null;
  'ui:toggle_quick_access': unknown;
  'large-type:updated': LargeTypePayload;
  'ui:focus_item': { itemId: string } | string;
  'ui:settings_changed': AppSettings;
  'ui:open_about': { checkUpdates?: boolean } | null;
  'ui:open_settings': unknown;
  'ui:new_item': unknown;
  'ui:focus_search': unknown;
  'ui:sync_vault': unknown;
};

type EventListener<K extends keyof TauriEventMap> = (payload: TauriEventMap[K]) => void;

export interface KeysmithClient {
  onEvent<K extends keyof TauriEventMap>(event: K, listener: EventListener<K>): () => void;

  authPrelogin(serverUrl: string, email: string): Promise<KdfConfig>;
  authCheckServer(serverUrl: string): Promise<ServerCheckResult>;
  authLogin(params: {
    serverUrl: string;
    email: string;
    masterPassword: string;
    twoFactorCode?: string;
  }): Promise<SessionState>;
  authRegister(params: {
    serverUrl: string;
    email: string;
    name: string;
    masterPassword: string;
    kdfConfig?: KdfConfig;
  }): Promise<SessionState>;
  authLogout(clearLocalCache?: boolean): Promise<void>;
  sessionGetState(): Promise<SessionState>;
  sessionUpdatePreferences(patch: SessionPreferencesPatch): Promise<SessionState>;
  sessionUnlockPassword(masterPassword: string): Promise<SessionState>;
  sessionUnlockBiometric(): Promise<SessionState>;
  sessionLock(reason?: string): Promise<void>;
  sessionTouchActivity(): Promise<void>;

  authPasskeyLogin(credentialId?: string): Promise<SessionState>;
  accountPasskeyList(): Promise<{
    rpId: string;
    userId: string;
    credentials: AccountPasskey[];
  }>;
  accountPasskeyRegister(
    name: string,
    deviceType: 'multiDevice' | 'singleDevice',
  ): Promise<AccountPasskey>;
  accountPasskeyRename(id: string, name: string): Promise<AccountPasskey>;
  accountPasskeyDelete(id: string): Promise<void>;
  accountUpdateProfile(displayName: string): Promise<{
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }>;
  accountList(): Promise<AccountSummary[]>;
  accountSwitch(accountId: string): Promise<SessionState>;

  vaultList(): Promise<Vault[]>;
  vaultCreate(name: string, color?: string, icon?: string): Promise<Vault>;
  vaultRename(id: string, name: string): Promise<Vault>;
  vaultDelete(id: string): Promise<void>;
  vaultSetTravelSafe(id: string, travelSafe: boolean): Promise<Vault>;
  vaultImport(
    format: ImportFormat,
    data: string,
    isBase64: boolean,
    targetVaultId?: string | null,
    importPassphrase?: string,
  ): Promise<ImportSummary>;
  vaultExport(
    format: ExportFormat,
    masterPassword: string,
    exportPassphrase?: string,
  ): Promise<ExportResult>;
  vaultExportEmergencyKit(): Promise<ExportResult>;
  snapshotList(): Promise<LocalSnapshotInfo[]>;
  snapshotCreate(): Promise<LocalSnapshotInfo>;
  snapshotRestore(snapshotId: string): Promise<ImportSummary>;
  snapshotDelete(snapshotId: string): Promise<void>;
  organizationList(): Promise<OrganizationInfo[]>;
  itemShareToOrganization(
    itemId: string,
    organizationId: string,
    collectionIds: string[],
  ): Promise<ItemDetail>;

  itemList(filter?: ItemFilter): Promise<ItemSummary[]>;
  itemGetAllStats(): Promise<ItemStats>;
  itemGet(id: string): Promise<ItemDetail | null>;
  itemCreate(draft: ItemDraft): Promise<ItemDetail>;
  itemUpdate(id: string, draft: ItemDraft): Promise<ItemDetail>;
  itemUpdateWatchtowerFlags(id: string, flags: Partial<WatchtowerFlags>): Promise<ItemDetail>;
  itemToggleFavorite(id: string, favorite: boolean): Promise<ItemDetail>;
  itemDuplicate(id: string): Promise<ItemDetail>;
  itemSetArchived(id: string, archived: boolean): Promise<ItemDetail>;
  itemMoveVault(ids: string[], targetVaultId: string): Promise<number>;
  itemBatchTrash(ids: string[]): Promise<number>;
  itemBatchAddTag(ids: string[], tag: string): Promise<number>;
  itemTrash(id: string): Promise<void>;
  itemRestore(id: string): Promise<void>;
  itemDeletePermanent(id: string): Promise<void>;
  itemEmptyTrash(): Promise<number>;

  sendList(): Promise<SendItem[]>;
  sendCreateText(input: SendCreateTextInput): Promise<SendItem>;
  sendCreateFile(input: SendCreateFileInput): Promise<SendItem>;
  sendUpdate(id: string, input: SendUpdateInput): Promise<SendItem>;
  sendRemovePassword(id: string): Promise<SendItem>;
  sendDelete(id: string): Promise<void>;

  attachmentUpload(itemId: string, fileName: string, dataBase64: string): Promise<ItemAttachment>;
  attachmentDownload(itemId: string, attachmentId: string): Promise<AttachmentDownloadResult>;
  attachmentDelete(itemId: string, attachmentId: string): Promise<void>;

  syncGetStatus(): Promise<SyncStatus>;
  syncNow(): Promise<SyncStatus>;

  totpCompute(secretOrUri: string): Promise<TotpCode>;
  totpParseQrImage(imageBase64: string): Promise<string>;
  generatorGenerate(options: GeneratorOptions): Promise<GeneratorResult>;
  generatorGenerateMaskedEmail(domainHint?: string): Promise<string>;
  generatorHistoryList(): Promise<GeneratorHistoryEntry[]>;
  generatorHistoryRecord(
    value: string,
    mode: GeneratorMode | 'masked_email' | string,
    entropyBits: number,
    source?: string,
  ): Promise<GeneratorHistoryEntry>;
  generatorHistoryClear(): Promise<void>;
  watchtowerScan(checkHibp?: boolean): Promise<WatchtowerReport>;
  sshGenerateEd25519(comment?: string): Promise<SshKeyPair>;
  sshAgentSocketPath(): Promise<string>;
  sshAgentGetStatus(): Promise<SshAgentStatus>;
  sshAgentConfigureSshConfig(enable: boolean): Promise<SshAgentStatus>;
  autofillAutoType(
    itemId: string,
    mode?: 'credentials' | 'username' | 'password' | 'totp',
    submit?: boolean,
  ): Promise<void>;
  faviconFetch(host: string): Promise<string | null>;

  clipboardCopySecret(text: string, label: string, isSensitive: boolean): Promise<void>;
  clipboardClearNow(): Promise<void>;
  clipboardReadImageBase64(): Promise<string | null>;

  windowMainReady(): Promise<void>;
  windowSetCompactLock(compact: boolean): Promise<void>;
  windowOpenLargeType(label: string, value: string): Promise<void>;
  windowCloseLargeType(): Promise<void>;
  windowSetLargeTypePin(pinned: boolean): Promise<void>;
  largeTypeGetPayload(): Promise<LargeTypePayload | null>;
  windowToggleQuickAccess(): Promise<void>;
  windowHideQuickAccess(): Promise<void>;
  windowFocusMainItem(itemId: string): Promise<void>;
  windowOpenGenerator(): Promise<void>;
  windowToggleGenerator(): Promise<void>;
  windowCloseGenerator(): Promise<void>;
  systemOpenUrl(url: string): Promise<void>;
  browserIntegrationStatus(): Promise<BrowserIntegrationStatus>;
  browserIntegrationConfigure(extraExtensionId?: string): Promise<BrowserIntegrationStatus>;
  browserOpenExtensionFolder(): Promise<string>;
  appCheckUpdateInfo(): Promise<AppUpdateInfo>;
  appSettingsGet(): Promise<AppSettings>;
  appSettingsUpdate(patch: AppSettingsPatch): Promise<AppSettings>;
}

async function invokeCore<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (err instanceof Error) throw err;
    if (typeof err === 'string') throw new KeysmithIpcError(err);
    if (err && typeof err === 'object') {
      const obj = err as {
        code?: string;
        message?: string;
        twoFactorRequired?: boolean;
        twoFactorProviders?: number[];
      };
      throw new KeysmithIpcError(obj.message || 'Operation failed', {
        code: obj.code,
        twoFactorRequired: obj.twoFactorRequired,
        twoFactorProviders: obj.twoFactorProviders,
      });
    }
    throw new KeysmithIpcError(String(err));
  }
}

class KeysmithTauriClient implements KeysmithClient {
  onEvent<K extends keyof TauriEventMap>(event: K, listener: EventListener<K>): () => void {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    void listen<TauriEventMap[K]>(event, (e) => {
      if (!disposed) {
        listener(e.payload);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };
  }

  authPrelogin(serverUrl: string, email: string): Promise<KdfConfig> {
    return invokeCore<KdfConfig>('auth_prelogin', { serverUrl, email });
  }

  authCheckServer(serverUrl: string): Promise<ServerCheckResult> {
    return invokeCore<ServerCheckResult>('auth_check_server', { serverUrl });
  }

  authLogin(params: {
    serverUrl: string;
    email: string;
    masterPassword: string;
    twoFactorCode?: string;
  }): Promise<SessionState> {
    return invokeCore<SessionState>('auth_login', {
      serverUrl: params.serverUrl,
      email: params.email,
      masterPassword: params.masterPassword,
      twoFactorCode: params.twoFactorCode ?? null,
    });
  }

  authRegister(params: {
    serverUrl: string;
    email: string;
    name: string;
    masterPassword: string;
    kdfConfig?: KdfConfig;
  }): Promise<SessionState> {
    return invokeCore<SessionState>('auth_register', {
      serverUrl: params.serverUrl,
      email: params.email,
      name: params.name,
      masterPassword: params.masterPassword,
      kdfConfig: params.kdfConfig ?? null,
    });
  }

  authLogout(clearLocalCache = false): Promise<void> {
    return invokeCore<void>('auth_logout', { clearLocalCache });
  }

  sessionGetState(): Promise<SessionState> {
    return invokeCore<SessionState>('session_get_state');
  }

  sessionUpdatePreferences(patch: SessionPreferencesPatch): Promise<SessionState> {
    return invokeCore<SessionState>('session_update_preferences', { patch });
  }

  sessionUnlockPassword(masterPassword: string): Promise<SessionState> {
    return invokeCore<SessionState>('session_unlock_password', { masterPassword });
  }

  sessionUnlockBiometric(): Promise<SessionState> {
    return invokeCore<SessionState>('session_unlock_biometric');
  }

  sessionLock(reason = 'manual'): Promise<void> {
    return invokeCore<void>('session_lock', { reason });
  }

  sessionTouchActivity(): Promise<void> {
    return invokeCore<void>('session_touch_activity');
  }

  authPasskeyLogin(credentialId?: string): Promise<SessionState> {
    return invokeCore<SessionState>('auth_passkey_login', {
      credentialId: credentialId ?? null,
    });
  }

  accountPasskeyList(): Promise<{
    rpId: string;
    userId: string;
    credentials: AccountPasskey[];
  }> {
    return invokeCore('account_passkey_list');
  }

  accountPasskeyRegister(
    name: string,
    deviceType: 'multiDevice' | 'singleDevice',
  ): Promise<AccountPasskey> {
    return invokeCore<AccountPasskey>('account_passkey_register', { name, deviceType });
  }

  accountPasskeyRename(id: string, name: string): Promise<AccountPasskey> {
    return invokeCore<AccountPasskey>('account_passkey_rename', { id, name });
  }

  accountPasskeyDelete(id: string): Promise<void> {
    return invokeCore<void>('account_passkey_delete', { id });
  }

  accountUpdateProfile(displayName: string): Promise<{
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }> {
    return invokeCore('account_update_profile', { displayName });
  }

  accountList(): Promise<AccountSummary[]> {
    return invokeCore<AccountSummary[]>('account_list');
  }

  accountSwitch(accountId: string): Promise<SessionState> {
    return invokeCore<SessionState>('account_switch', { accountId });
  }

  vaultList(): Promise<Vault[]> {
    return invokeCore<Vault[]>('vault_list');
  }

  vaultCreate(name: string, color = '#0572EC', icon = 'folder'): Promise<Vault> {
    return invokeCore<Vault>('vault_create', { name, color, icon });
  }

  vaultRename(id: string, name: string): Promise<Vault> {
    return invokeCore<Vault>('vault_rename', { id, name });
  }

  vaultDelete(id: string): Promise<void> {
    return invokeCore<void>('vault_delete', { id });
  }

  vaultSetTravelSafe(id: string, travelSafe: boolean): Promise<Vault> {
    return invokeCore<Vault>('vault_set_travel_safe', { id, travelSafe });
  }

  vaultImport(
    format: ImportFormat,
    data: string,
    isBase64: boolean,
    targetVaultId?: string | null,
    importPassphrase?: string,
  ): Promise<ImportSummary> {
    return invokeCore<ImportSummary>('vault_import', {
      format,
      data,
      isBase64,
      targetVaultId: targetVaultId ?? null,
      importPassphrase: importPassphrase?.trim() || null,
    });
  }

  vaultExport(
    format: ExportFormat,
    masterPassword: string,
    exportPassphrase?: string,
  ): Promise<ExportResult> {
    return invokeCore<ExportResult>('vault_export', {
      format,
      masterPassword,
      exportPassphrase: exportPassphrase ?? null,
    });
  }

  vaultExportEmergencyKit(): Promise<ExportResult> {
    return invokeCore<ExportResult>('vault_export_emergency_kit');
  }

  snapshotList(): Promise<LocalSnapshotInfo[]> {
    return invokeCore<LocalSnapshotInfo[]>('snapshot_list');
  }

  snapshotCreate(): Promise<LocalSnapshotInfo> {
    return invokeCore<LocalSnapshotInfo>('snapshot_create');
  }

  snapshotRestore(snapshotId: string): Promise<ImportSummary> {
    return invokeCore<ImportSummary>('snapshot_restore', { snapshotId });
  }

  snapshotDelete(snapshotId: string): Promise<void> {
    return invokeCore<void>('snapshot_delete', { snapshotId });
  }

  organizationList(): Promise<OrganizationInfo[]> {
    return invokeCore<OrganizationInfo[]>('organization_list');
  }

  itemShareToOrganization(
    itemId: string,
    organizationId: string,
    collectionIds: string[],
  ): Promise<ItemDetail> {
    return invokeCore<ItemDetail>('item_share_to_organization', {
      itemId,
      organizationId,
      collectionIds,
    });
  }

  itemList(filter: ItemFilter = {}): Promise<ItemSummary[]> {
    return invokeCore<ItemSummary[]>('item_list', { filter });
  }

  itemGetAllStats(): Promise<ItemStats> {
    return invokeCore<ItemStats>('item_get_all_stats');
  }

  itemGet(id: string): Promise<ItemDetail | null> {
    return invokeCore<ItemDetail | null>('item_get', { id });
  }

  itemCreate(draft: ItemDraft): Promise<ItemDetail> {
    return invokeCore<ItemDetail>('item_create', { draft });
  }

  itemUpdate(id: string, draft: ItemDraft): Promise<ItemDetail> {
    return invokeCore<ItemDetail>('item_update', { id, draft });
  }

  itemUpdateWatchtowerFlags(id: string, flags: Partial<WatchtowerFlags>): Promise<ItemDetail> {
    return invokeCore<ItemDetail>('item_update_watchtower_flags', { id, flags });
  }

  itemToggleFavorite(id: string, favorite: boolean): Promise<ItemDetail> {
    return invokeCore<ItemDetail>('item_toggle_favorite', { id, favorite });
  }

  itemDuplicate(id: string): Promise<ItemDetail> {
    return invokeCore<ItemDetail>('item_duplicate', { id });
  }

  itemSetArchived(id: string, archived: boolean): Promise<ItemDetail> {
    return invokeCore<ItemDetail>('item_set_archived', { id, archived });
  }

  itemMoveVault(ids: string[], targetVaultId: string): Promise<number> {
    return invokeCore<number>('item_move_vault', { ids, targetVaultId });
  }

  itemBatchTrash(ids: string[]): Promise<number> {
    return invokeCore<number>('item_batch_trash', { ids });
  }

  itemBatchAddTag(ids: string[], tag: string): Promise<number> {
    return invokeCore<number>('item_batch_add_tag', { ids, tag });
  }

  itemTrash(id: string): Promise<void> {
    return invokeCore<void>('item_trash', { id });
  }

  itemRestore(id: string): Promise<void> {
    return invokeCore<void>('item_restore', { id });
  }

  itemDeletePermanent(id: string): Promise<void> {
    return invokeCore<void>('item_delete_permanent', { id });
  }

  itemEmptyTrash(): Promise<number> {
    return invokeCore<number>('item_empty_trash');
  }

  sendList(): Promise<SendItem[]> {
    return invokeCore<SendItem[]>('send_list');
  }

  sendCreateText(input: SendCreateTextInput): Promise<SendItem> {
    return invokeCore<SendItem>('send_create_text', { input });
  }

  sendCreateFile(input: SendCreateFileInput): Promise<SendItem> {
    return invokeCore<SendItem>('send_create_file', { input });
  }

  sendUpdate(id: string, input: SendUpdateInput): Promise<SendItem> {
    return invokeCore<SendItem>('send_update', { id, input });
  }

  sendRemovePassword(id: string): Promise<SendItem> {
    return invokeCore<SendItem>('send_remove_password', { id });
  }

  sendDelete(id: string): Promise<void> {
    return invokeCore<void>('send_delete', { id });
  }

  attachmentUpload(itemId: string, fileName: string, dataBase64: string): Promise<ItemAttachment> {
    return invokeCore<ItemAttachment>('attachment_upload', { itemId, fileName, dataBase64 });
  }

  attachmentDownload(itemId: string, attachmentId: string): Promise<AttachmentDownloadResult> {
    return invokeCore<AttachmentDownloadResult>('attachment_download', { itemId, attachmentId });
  }

  attachmentDelete(itemId: string, attachmentId: string): Promise<void> {
    return invokeCore<void>('attachment_delete', { itemId, attachmentId });
  }

  syncGetStatus(): Promise<SyncStatus> {
    return invokeCore<SyncStatus>('sync_get_status');
  }

  syncNow(): Promise<SyncStatus> {
    return invokeCore<SyncStatus>('sync_now');
  }

  totpCompute(secretOrUri: string): Promise<TotpCode> {
    return invokeCore<TotpCode>('totp_compute', { secretOrUri });
  }

  totpParseQrImage(imageBase64: string): Promise<string> {
    return invokeCore<string>('totp_parse_qr_image', { imageBase64 });
  }

  generatorGenerate(options: GeneratorOptions): Promise<GeneratorResult> {
    return invokeCore<GeneratorResult>('generator_generate', { options });
  }

  generatorGenerateMaskedEmail(domainHint?: string): Promise<string> {
    return invokeCore<string>('generator_generate_masked_email', {
      domainHint: domainHint?.trim() || null,
    });
  }

  generatorHistoryList(): Promise<GeneratorHistoryEntry[]> {
    return invokeCore<GeneratorHistoryEntry[]>('generator_history_list');
  }

  generatorHistoryRecord(
    value: string,
    mode: GeneratorMode | 'masked_email' | string,
    entropyBits: number,
    source?: string,
  ): Promise<GeneratorHistoryEntry> {
    return invokeCore<GeneratorHistoryEntry>('generator_history_record', {
      value,
      mode,
      entropyBits,
      source: source ?? null,
    });
  }

  generatorHistoryClear(): Promise<void> {
    return invokeCore<void>('generator_history_clear');
  }

  watchtowerScan(checkHibp = false): Promise<WatchtowerReport> {
    return invokeCore<WatchtowerReport>('watchtower_scan', { checkHibp });
  }

  sshGenerateEd25519(comment?: string): Promise<SshKeyPair> {
    return invokeCore<SshKeyPair>('ssh_generate_ed25519', { comment: comment ?? null });
  }

  sshAgentSocketPath(): Promise<string> {
    return invokeCore<string>('ssh_agent_socket_path');
  }

  sshAgentGetStatus(): Promise<SshAgentStatus> {
    return invokeCore<SshAgentStatus>('ssh_agent_get_status');
  }

  sshAgentConfigureSshConfig(enable: boolean): Promise<SshAgentStatus> {
    return invokeCore<SshAgentStatus>('ssh_agent_configure_ssh_config', { enable });
  }

  autofillAutoType(
    itemId: string,
    mode: 'credentials' | 'username' | 'password' | 'totp' = 'credentials',
    submit = true,
  ): Promise<void> {
    return invokeCore<void>('autofill_auto_type', { itemId, mode, submit });
  }

  faviconFetch(host: string): Promise<string | null> {
    return invokeCore<string | null>('favicon_fetch', { host });
  }

  clipboardCopySecret(text: string, label: string, isSensitive: boolean): Promise<void> {
    return invokeCore<void>('clipboard_copy_secret', { text, label, isSensitive });
  }

  clipboardClearNow(): Promise<void> {
    return invokeCore<void>('clipboard_clear_now');
  }

  clipboardReadImageBase64(): Promise<string | null> {
    return invokeCore<string | null>('clipboard_read_image_base64');
  }

  windowMainReady(): Promise<void> {
    return invokeCore<void>('window_main_ready');
  }

  windowSetCompactLock(compact: boolean): Promise<void> {
    return invokeCore<void>('window_set_compact_lock', { compact });
  }

  windowOpenLargeType(label: string, value: string): Promise<void> {
    return invokeCore<void>('window_open_large_type', { label, value });
  }

  windowCloseLargeType(): Promise<void> {
    return invokeCore<void>('window_close_large_type');
  }

  windowSetLargeTypePin(pinned: boolean): Promise<void> {
    return invokeCore<void>('window_set_large_type_pin', { pinned });
  }

  largeTypeGetPayload(): Promise<LargeTypePayload | null> {
    return invokeCore<LargeTypePayload | null>('large_type_get_payload');
  }

  windowToggleQuickAccess(): Promise<void> {
    return invokeCore<void>('window_toggle_quick_access');
  }

  windowHideQuickAccess(): Promise<void> {
    return invokeCore<void>('window_hide_quick_access');
  }

  windowFocusMainItem(itemId: string): Promise<void> {
    return invokeCore<void>('window_focus_main_item', { itemId });
  }

  windowOpenGenerator(): Promise<void> {
    return invokeCore<void>('window_open_generator');
  }

  windowToggleGenerator(): Promise<void> {
    return invokeCore<void>('window_toggle_generator');
  }

  windowCloseGenerator(): Promise<void> {
    return invokeCore<void>('window_close_generator');
  }

  systemOpenUrl(url: string): Promise<void> {
    return invokeCore<void>('system_open_url', { url });
  }

  browserIntegrationStatus(): Promise<BrowserIntegrationStatus> {
    return invokeCore<BrowserIntegrationStatus>('browser_integration_status');
  }

  browserIntegrationConfigure(extraExtensionId?: string): Promise<BrowserIntegrationStatus> {
    return invokeCore<BrowserIntegrationStatus>('browser_integration_configure', {
      extraExtensionId: extraExtensionId?.trim() || null,
    });
  }

  browserOpenExtensionFolder(): Promise<string> {
    return invokeCore<string>('browser_open_extension_folder');
  }

  appCheckUpdateInfo(): Promise<AppUpdateInfo> {
    return invokeCore<AppUpdateInfo>('app_check_update_info');
  }

  appSettingsGet(): Promise<AppSettings> {
    return invokeCore<AppSettings>('app_settings_get');
  }

  appSettingsUpdate(patch: AppSettingsPatch): Promise<AppSettings> {
    return invokeCore<AppSettings>('app_settings_update', { patch });
  }
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function inferMimeFromName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function estimateBase64Bytes(b64: string): number {
  const clean = b64.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

class KeysmithPrototypeClient implements KeysmithClient {
  private vaults: Omit<Vault, 'itemCount'>[] = INITIAL_VAULTS.map((v) => ({ ...v }));
  private items: ItemDetail[] = structuredClone(INITIAL_ITEMS).map((item) => ({
    ...item,
    archived: Boolean(item.archived),
    attachments: item.attachments ?? [],
  }));
  private accountPasskeys: AccountPasskey[] = structuredClone(INITIAL_ACCOUNT_PASSKEYS);
  private sends: SendItem[] = [
    {
      id: 'send-demo-1',
      accessId: 'demo-send-api-token',
      sendType: 'text',
      name: 'Staging Webhook Temp Key',
      notes: 'For local frontend integration testing only',
      text: 'whsec_demo_9f4b8c2a7d1e6f3a0b5c8d2e',
      hidden: true,
      shareUrl: 'http://localhost:8080/#/send/demo-send-api-token/c2VuZC1kZW1vLXNlZWQxNg',
      maxAccessCount: 3,
      accessCount: 1,
      expirationDate: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
      deletionDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      revisionDate: new Date(Date.now() - 3600_000).toISOString(),
      disabled: false,
      hideEmail: true,
      hasPassword: false,
    },
    {
      id: 'send-demo-2',
      accessId: 'demo-send-backup-doc',
      sendType: 'file',
      name: 'Recovery Codes Bundle',
      fileName: 'recovery-codes.txt',
      fileSize: 2048,
      fileSizeName: '2.0 KB',
      hidden: false,
      shareUrl: 'http://localhost:8080/#/send/demo-send-backup-doc/ZmlsZS1kZW1vLXNlZWQxNg',
      maxAccessCount: 1,
      accessCount: 0,
      deletionDate: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
      revisionDate: new Date(Date.now() - 7200_000).toISOString(),
      disabled: false,
      hideEmail: false,
      hasPassword: true,
    },
  ];
  private generatorHistory: GeneratorHistoryEntry[] = [];
  private attachmentPayloads = new Map<string, AttachmentDownloadResult>();
  private largeTypePayload: LargeTypePayload | null = null;
  private demoMasterPassword = 'keysmith';
  private hibpChecked = false;
  private hibpCheckedAt: string | undefined;
  private demoSshConfigured = false;
  private snapshots: Array<{ info: LocalSnapshotInfo; items: ItemDetail[]; vaults: Omit<Vault, 'itemCount'>[] }> = [];
  private appSettings: AppSettings = {
    language: 'system',
    theme: 'system',
    customShortcuts: {},
    maskedEmail: { provider: 'catch_all', apiKey: '', domain: 'example.com' },
    customEquivalentDomains: [],
    disabledAutofillDomains: [],
    autoCopyTotpOnFill: true,
    sshAgentEnabled: true,
    snapshotIntervalDays: 1,
    snapshotKeepCount: 5,
  };

  private session: SessionState = {
    status: 'Unlocked',
    accountId: 'demo-account-1',
    email: 'cherry@example.com',
    displayName: 'Cherry Wang',
    serverUrl: 'http://localhost:8080',
    biometricEnabled: true,
    autoLockMinutes: 15,
    clipboardClearSeconds: 30,
    lastSyncAt: new Date(Date.now() - 45_000).toISOString(),
    kdfType: 'Argon2id',
    closeToTray: true,
    lockOnSleep: true,
    screenCaptureProtected: false,
    vibrancyEnabled: true,
    faviconEnabled: true,
    quickAccessShortcut: 'CommandOrControl+Shift+Space',
    biometricMaxDays: 7,
    launchAtLogin: false,
    travelMode: false,
    trashAutoPurgeDays: 30,
    sshBiometricConfirm: false,
  };

  private syncStatusState: SyncStatus = {
    state: 'idle',
    pendingCount: 0,
    lastSyncAt: this.session.lastSyncAt,
    signalrConnected: true,
  };

  private listeners = new Map<keyof TauriEventMap, Set<EventListener<never>>>();
  private clipboardTimer: number | null = null;
  private clipboardState: { label: string; remainingSeconds: number; totalSeconds: number } | null = null;

  onEvent<K extends keyof TauriEventMap>(event: K, listener: EventListener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as EventListener<never>);
    return () => {
      set?.delete(listener as EventListener<never>);
    };
  }

  private emit<K extends keyof TauriEventMap>(event: K, payload: TauriEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as EventListener<K>)(payload);
    }
  }

  // --- Auth & Session ---

  async authPrelogin(_serverUrl: string, _email: string): Promise<KdfConfig> {
    await new Promise((r) => setTimeout(r, 180));
    return { kdf: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: 4 };
  }

  async authCheckServer(serverUrl: string): Promise<ServerCheckResult> {
    await new Promise((r) => setTimeout(r, 240));
    const valid = /^https?:\/\/.+/.test(serverUrl.trim());
    return { ok: valid, version: 'Vaultwarden 1.32.5 (Local)', disableUserRegistration: false };
  }

  async authLogin(params: {
    serverUrl: string;
    email: string;
    masterPassword: string;
    twoFactorCode?: string;
  }): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 320));
    if (!params.email.trim() || !params.masterPassword) {
      throw new Error('Please enter email and master password');
    }
    this.demoMasterPassword = params.masterPassword;
    this.session = {
      ...this.session,
      status: 'Unlocked',
      email: params.email.trim().toLowerCase(),
      displayName: params.email.split('@')[0] || 'Keysmith User',
      serverUrl: params.serverUrl.trim(),
      lastSyncAt: new Date().toISOString(),
    };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'login' });
    return { ...this.session };
  }

  async authRegister(params: {
    serverUrl: string;
    email: string;
    name: string;
    masterPassword: string;
    kdfConfig?: KdfConfig;
  }): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 380));
    if (!params.email.trim() || params.masterPassword.length < 6) {
      throw new Error('Please enter a valid email and master password (min 6 characters)');
    }
    this.demoMasterPassword = params.masterPassword;
    this.session = {
      ...this.session,
      status: 'Unlocked',
      email: params.email.trim().toLowerCase(),
      displayName: params.name.trim() || params.email.split('@')[0],
      serverUrl: params.serverUrl.trim(),
      lastSyncAt: new Date().toISOString(),
    };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'register' });
    return { ...this.session };
  }

  async authLogout(clearLocalCache = false): Promise<void> {
    if (clearLocalCache) {
      this.hibpChecked = false;
    }
    this.session = { ...this.session, status: 'Unauthenticated' };
    this.emit('session:state_changed', { status: 'Unauthenticated', reason: 'logout' });
  }

  async sessionGetState(): Promise<SessionState> {
    return { ...this.session };
  }

  async sessionUpdatePreferences(patch: SessionPreferencesPatch): Promise<SessionState> {
    this.session = { ...this.session, ...patch };
    return { ...this.session };
  }

  async sessionUnlockPassword(masterPassword: string): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 140));
    if (masterPassword !== this.demoMasterPassword) {
      throw new Error('Incorrect master password (demo password: keysmith)');
    }
    this.session = { ...this.session, status: 'Unlocked' };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'password' });
    return { ...this.session };
  }

  async sessionUnlockBiometric(): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 420));
    this.session = { ...this.session, status: 'Unlocked' };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'biometric' });
    return { ...this.session };
  }

  async sessionLock(reason = 'manual'): Promise<void> {
    if (this.session.status !== 'Unlocked') return;
    this.largeTypePayload = null;
    this.session = { ...this.session, status: 'Locked' };
    this.emit('session:state_changed', { status: 'Locked', reason });
  }

  async sessionTouchActivity(): Promise<void> {
    // No-op in prototype; resets Rust core inactivity timer in Tauri v2
  }

  // --- Account Passkeys & Multi-Account ---

  async authPasskeyLogin(credentialId?: string): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 360));
    const cred =
      (credentialId ? this.accountPasskeys.find((c) => c.id === credentialId) : undefined) ??
      this.accountPasskeys[0];
    if (!cred) {
      throw new Error('No account passkey found. Please sign in with your master password.');
    }
    cred.counter += 1;
    cred.lastUsedAt = Date.now();
    this.session = {
      ...this.session,
      status: 'Unlocked',
      lastSyncAt: new Date().toISOString(),
    };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'passkey_prf' });
    return { ...this.session };
  }

  async accountPasskeyList(): Promise<{
    rpId: string;
    userId: string;
    credentials: AccountPasskey[];
  }> {
    return {
      rpId: DEMO_RP_ID,
      userId: DEMO_ACCOUNT_USER_ID,
      credentials: structuredClone(this.accountPasskeys),
    };
  }

  async accountPasskeyRegister(
    name: string,
    deviceType: 'multiDevice' | 'singleDevice',
  ): Promise<AccountPasskey> {
    const { credentialId, publicKeySpki } = await generatePasskeyKeypair();
    const created: AccountPasskey = {
      id: credentialId,
      passkeyUserId: DEMO_ACCOUNT_USER_ID,
      credentialPublicKey: publicKeySpki,
      credentialType: 'public-key',
      credentialDeviceType: deviceType,
      credentialBackedUp: deviceType === 'multiDevice',
      aaguid: deviceType === 'multiDevice' ? APPLE_TOUCH_ID_AAGUID : YUBIKEY_5_AAGUID,
      name: name.trim() || (deviceType === 'multiDevice' ? 'New Platform Passkey' : 'Hardware Security Key'),
      transports: deviceType === 'multiDevice' ? ['internal', 'hybrid'] : ['usb', 'nfc'],
      registeredAt: Date.now(),
      counter: 0,
      prfSupported: true,
    };
    this.accountPasskeys.push(created);
    return structuredClone(created);
  }

  async accountPasskeyRename(id: string, name: string): Promise<AccountPasskey> {
    const target = this.accountPasskeys.find((c) => c.id === id);
    if (!target) throw new Error('Passkey not found');
    target.name = name.trim() || target.name;
    return structuredClone(target);
  }

  async accountPasskeyDelete(id: string): Promise<void> {
    this.accountPasskeys = this.accountPasskeys.filter((c) => c.id !== id);
  }

  async accountUpdateProfile(displayName: string): Promise<{
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }> {
    const clean = displayName.trim() || this.session.displayName;
    this.session = { ...this.session, displayName: clean };
    return {
      rpId: DEMO_RP_ID,
      userId: DEMO_ACCOUNT_USER_ID,
      name: this.session.email,
      displayName: clean,
    };
  }

  async accountList(): Promise<AccountSummary[]> {
    return [
      {
        id: this.session.accountId,
        email: this.session.email,
        displayName: this.session.displayName,
        serverUrl: this.session.serverUrl,
        isActive: true,
        kdfType: this.session.kdfType,
        lastSyncAt: this.session.lastSyncAt,
      },
    ];
  }

  async accountSwitch(_accountId: string): Promise<SessionState> {
    this.session = { ...this.session, status: 'Locked' };
    this.emit('session:state_changed', { status: 'Locked', reason: 'account_switch' });
    return { ...this.session };
  }

  // --- Vaults & Import/Export ---

  async vaultList(): Promise<Vault[]> {
    return this.vaults.map((v) => ({
      ...v,
      itemCount: this.items.filter((it) => !it.deletedAt && !it.archived && it.vaultId === v.id).length,
    }));
  }

  async vaultCreate(name: string, color = '#0572EC', icon = 'folder'): Promise<Vault> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Vault name cannot be empty');
    const created: Omit<Vault, 'itemCount'> = {
      id: makeId('vault'),
      name: trimmed,
      color,
      icon,
      isDefault: false,
      isOrganization: false,
    };
    this.vaults.push(created);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
    return { ...created, itemCount: 0 };
  }

  async vaultRename(id: string, name: string): Promise<Vault> {
    const v = this.vaults.find((item) => item.id === id);
    if (!v) throw new Error('Vault not found');
    v.name = name.trim() || v.name;
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
    return {
      ...v,
      itemCount: this.items.filter((it) => !it.deletedAt && !it.archived && it.vaultId === v.id).length,
    };
  }

  async vaultDelete(id: string): Promise<void> {
    const target = this.vaults.find((v) => v.id === id);
    if (!target || target.isDefault) throw new Error('Default vault cannot be deleted');
    const fallback = this.vaults.find((v) => v.isDefault) ?? this.vaults[0];
    this.items = this.items.map((it) => (it.vaultId === id ? { ...it, vaultId: fallback.id } : it));
    this.vaults = this.vaults.filter((v) => v.id !== id);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
  }

  async vaultSetTravelSafe(id: string, travelSafe: boolean): Promise<Vault> {
    const v = this.vaults.find((item) => item.id === id);
    if (!v) throw new Error('Vault not found');
    v.travelSafe = travelSafe;
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
    return {
      ...v,
      itemCount: this.items.filter((it) => !it.deletedAt && !it.archived && it.vaultId === v.id).length,
    };
  }

  async vaultImport(
    format: ImportFormat,
    data: string,
    _isBase64: boolean,
    targetVaultId?: string | null,
    _importPassphrase?: string,
  ): Promise<ImportSummary> {
    const fallbackVault = targetVaultId || this.vaults.find((v) => v.isDefault)?.id || this.vaults[0]?.id || 'vault-personal';
    let importedItems = 0;
    const warnings: string[] = [];

    if (format === 'bitwarden_json' || format === 'keysmith_encrypted_json') {
      try {
        const parsed = JSON.parse(data) as { items?: Array<{ name?: string; notes?: string }> };
        for (const entry of parsed.items ?? []) {
          await this.itemCreate({
            vaultId: fallbackVault,
            title: entry.name?.trim() || 'Imported Item',
            favorite: false,
            category: 'login',
            tags: ['imported'],
            urls: [],
            sections: [{ id: makeId('sec'), title: '', fields: [] }],
            passkeys: [],
            notes: entry.notes ?? '',
            passwordHistory: [],
            watchtower: { ignoreWeak: false, ignoreReused: false, ignoreMissing2fa: false, ignoreUnsecuredUrl: false },
          });
          importedItems += 1;
        }
      } catch {
        warnings.push('Failed to parse JSON. Please verify the file format.');
      }
    } else if (format === 'chrome_csv' || format === 'bitwarden_csv') {
      const lines = data.split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines.slice(1)) {
        const cols = line.split(',');
        if (cols.length < 2) continue;
        await this.itemCreate({
          vaultId: fallbackVault,
          title: cols[0]?.replace(/^"|"$/g, '').trim() || 'Imported Item',
          favorite: false,
          category: 'login',
          tags: ['imported'],
          urls: cols[1] ? [{ id: makeId('u'), uri: cols[1].replace(/^"|"$/g, '').trim(), matchRule: 'domain' }] : [],
          sections: [
            {
              id: makeId('sec'),
              title: '',
              fields: [
                { id: makeId('f'), label: 'Username', fieldType: 'text', value: cols[2]?.replace(/^"|"$/g, '') ?? '', sensitive: false, copyable: true, purpose: 'username' },
                { id: makeId('f'), label: 'Password', fieldType: 'password', value: cols[3]?.replace(/^"|"$/g, '') ?? '', sensitive: true, copyable: true, purpose: 'password' },
              ],
            },
          ],
          passkeys: [],
          notes: '',
          passwordHistory: [],
          watchtower: { ignoreWeak: false, ignoreReused: false, ignoreMissing2fa: false, ignoreUnsecuredUrl: false },
        });
        importedItems += 1;
      }
    } else {
      warnings.push('Binary .1pux extraction is not supported in browser preview mode. Please import in the desktop app.');
    }

    return { importedVaults: 0, importedItems, skippedItems: 0, warnings };
  }

  async vaultExport(
    format: ExportFormat,
    masterPassword: string,
    _exportPassphrase?: string,
  ): Promise<ExportResult> {
    if (masterPassword !== this.demoMasterPassword) {
      throw new Error('Master password verification failed');
    }
    const active = this.items.filter((i) => !i.deletedAt);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const rows = ['name,url,username,password,notes'];
      for (const it of active) {
        const fields = it.sections.flatMap((s) => s.fields);
        const user = fields.find((f) => f.purpose === 'username')?.value ?? '';
        const pw = fields.find((f) => f.purpose === 'password')?.value ?? '';
        const url = it.urls[0]?.uri ?? '';
        rows.push(
          [it.title, url, user, pw, it.notes]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(','),
        );
      }
      return { fileName: `keysmith-export-${stamp}.csv`, content: rows.join('\n') };
    }
    return {
      fileName:
        format === 'keysmith_encrypted_json'
          ? `keysmith-backup-${stamp}.json`
          : `bitwarden-export-${stamp}.json`,
      content: JSON.stringify({ encrypted: format === 'keysmith_encrypted_json', items: active }, null, 2),
    };
  }

  async vaultExportEmergencyKit(): Promise<ExportResult> {
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      fileName: `keysmith-emergency-kit-${stamp}.pdf`,
      content: btoa('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'),
    };
  }

  async snapshotList(): Promise<LocalSnapshotInfo[]> {
    return this.snapshots.map((s) => ({ ...s.info }));
  }

  async snapshotCreate(): Promise<LocalSnapshotInfo> {
    const now = new Date().toISOString();
    const id = makeId('snap');
    const active = this.items.filter((i) => !i.deletedAt);
    const info: LocalSnapshotInfo = {
      id,
      fileName: `keysmith-snapshot-${now.slice(0, 10)}.json`,
      createdAt: now,
      sizeBytes: JSON.stringify(active).length,
      itemCount: active.length,
      vaultCount: this.vaults.length,
    };
    this.snapshots.unshift({
      info,
      items: structuredClone(this.items),
      vaults: structuredClone(this.vaults),
    });
    const keep = this.appSettings.snapshotKeepCount ?? 5;
    if (this.snapshots.length > keep) {
      this.snapshots = this.snapshots.slice(0, keep);
    }
    return { ...info };
  }

  async snapshotRestore(snapshotId: string): Promise<ImportSummary> {
    const found = this.snapshots.find((s) => s.info.id === snapshotId);
    if (!found) throw new Error('Snapshot not found');
    this.items = structuredClone(found.items);
    this.vaults = structuredClone(found.vaults);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
    return {
      importedVaults: found.vaults.length,
      importedItems: found.items.length,
      skippedItems: 0,
      warnings: [],
    };
  }

  async snapshotDelete(snapshotId: string): Promise<void> {
    this.snapshots = this.snapshots.filter((s) => s.info.id !== snapshotId);
  }

  // --- Items ---

  private toSummary(item: ItemDetail, report: WatchtowerReport): ItemSummary {
    const allFields = item.sections.flatMap((s) => s.fields);
    const username = allFields.find((f) => f.purpose === 'username' && f.value.trim())?.value.trim();
    const hasTotp = allFields.some((f) => f.fieldType === 'totp' && f.value.trim().length > 0);
    const hasPassword = allFields.some((f) => f.purpose === 'password' && f.value.trim().length > 0);
    const hasPasskey = (item.passkeys?.length ?? 0) > 0;
    return {
      id: item.id,
      vaultId: item.vaultId,
      title: item.title,
      subtitle: deriveSubtitle(item),
      category: item.category,
      icon: item.icon,
      tags: item.tags,
      favorite: item.favorite,
      archived: Boolean(item.archived),
      reprompt: Boolean(item.reprompt),
      ssoProvider: item.ssoProvider,
      linkedItemCount: item.linkedItemIds?.length ?? 0,
      attachmentCount: item.attachments?.length ?? 0,
      hasTotp,
      hasPasskey,
      primaryUrl: item.urls[0]?.uri,
      username,
      hasPassword,
      deletedAt: item.deletedAt,
      updatedAt: item.updatedAt,
      issues: report.itemIssues[item.id] ?? [],
    };
  }

  async itemList(filter: ItemFilter = {}): Promise<ItemSummary[]> {
    const report = runWatchtowerAudit(this.items, {
      checkHibp: this.hibpChecked,
      hibpCheckedAt: this.hibpCheckedAt,
    });

    const wantArchived = Boolean(filter.archived);

    const query = filter.query?.trim() ?? '';
    const scored: Array<{ item: ItemDetail; score: number }> = [];

    for (const item of this.items) {
      const isTrashed = Boolean(item.deletedAt);
      if (filter.trashed) {
        if (!isTrashed) continue;
      } else {
        if (isTrashed) continue;
        if (Boolean(item.archived) !== wantArchived) continue;
      }

      if (filter.vaultId && item.vaultId !== filter.vaultId) continue;
      if (filter.category && item.category !== filter.category) continue;
      if (filter.favorite && !item.favorite) continue;
      if (filter.passkeyOnly && (item.passkeys?.length ?? 0) === 0 && item.category !== 'passkey') continue;
      if (filter.tag && !item.tags.includes(filter.tag)) continue;
      if (filter.watchtowerIssue) {
        const issues = report.itemIssues[item.id] ?? [];
        if (!issues.includes(filter.watchtowerIssue)) continue;
      }
      let score = 0;
      if (query) {
        const matchedScore = scoreSearchQuery(item, this.vaults as Vault[], query);
        if (matchedScore === null) continue;
        score = matchedScore;
      }
      scored.push({ item, score });
    }

    const sortBy = filter.sortBy ?? 'title_asc';
    scored.sort((left, right) => {
      if (query && right.score !== left.score) {
        return right.score - left.score;
      }
      const a = left.item;
      const b = right.item;
      switch (sortBy) {
        case 'title_desc':
          return b.title.localeCompare(a.title, 'zh-CN');
        case 'updated_desc':
          return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        case 'created_desc':
          return Date.parse(b.createdAt) - Date.parse(a.createdAt);
        case 'title_asc':
        default:
          return a.title.localeCompare(b.title, 'zh-CN');
      }
    });

    return scored.map(({ item }) => this.toSummary(item, report));
  }

  async itemGetAllStats(): Promise<ItemStats> {
    const active = this.items.filter((i) => !i.deletedAt && !i.archived);
    const archived = this.items.filter((i) => !i.deletedAt && Boolean(i.archived));
    const trashed = this.items.filter((i) => Boolean(i.deletedAt));
    const categoryCounts: Record<string, number> = {};
    const tagMap = new Map<string, number>();

    for (const item of active) {
      categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
      for (const tag of item.tags) {
        tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
      }
    }

    const tagCounts = Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));

    return {
      totalCount: active.length,
      favoriteCount: active.filter((i) => i.favorite).length,
      archivedCount: archived.length,
      passkeyCount: active.filter((i) => (i.passkeys?.length ?? 0) > 0 || i.category === 'passkey').length,
      trashCount: trashed.length,
      categoryCounts,
      tagCounts,
    };
  }

  async itemGet(id: string): Promise<ItemDetail | null> {
    const found = this.items.find((i) => i.id === id);
    return found ? structuredClone(found) : null;
  }

  async itemCreate(draft: ItemDraft): Promise<ItemDetail> {
    const now = new Date().toISOString();
    const created: ItemDetail = {
      id: makeId('item'),
      vaultId: draft.vaultId,
      title: draft.title.trim() || 'Untitled Item',
      favorite: draft.favorite,
      archived: Boolean(draft.archived),
      reprompt: Boolean(draft.reprompt),
      ssoProvider: draft.ssoProvider?.trim() || undefined,
      linkedItemIds: draft.linkedItemIds ? [...draft.linkedItemIds] : [],
      schema: 'keysmith.item.v1',
      category: draft.category,
      subtitle: draft.subtitle,
      icon: draft.icon,
      tags: [...draft.tags],
      urls: structuredClone(draft.urls),
      sections: structuredClone(draft.sections),
      passkeys: structuredClone(draft.passkeys ?? []),
      notes: draft.notes,
      passwordHistory: [...draft.passwordHistory],
      watchtower: { ...draft.watchtower },
      attachments: structuredClone(draft.attachments ?? []),
      createdAt: now,
      updatedAt: now,
    };
    this.items.unshift(created);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [created.id], deletedItemIds: [] });
    return structuredClone(created);
  }

  async itemUpdate(id: string, draft: ItemDraft): Promise<ItemDetail> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error('Item not found');
    const prev = this.items[idx];
    const now = new Date().toISOString();

    const nextHistory = [...draft.passwordHistory];
    const prevPasswords = prev.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.purpose === 'password' && f.value.trim())
      .map((f) => ({ id: f.id, value: f.value }));

    for (const prevField of prevPasswords) {
      const nextField = draft.sections.flatMap((s) => s.fields).find((f) => f.id === prevField.id);
      if (nextField && nextField.value.trim() && nextField.value !== prevField.value) {
        if (!nextHistory.some((h) => h.value === prevField.value)) {
          nextHistory.unshift({ value: prevField.value, changedAt: now });
        }
      }
    }

    const updated: ItemDetail = {
      ...prev,
      vaultId: draft.vaultId,
      title: draft.title.trim() || prev.title,
      favorite: draft.favorite,
      archived: draft.archived ?? prev.archived ?? false,
      reprompt: draft.reprompt ?? prev.reprompt ?? false,
      ssoProvider:
        draft.ssoProvider !== undefined
          ? draft.ssoProvider.trim() || undefined
          : prev.ssoProvider,
      linkedItemIds:
        draft.linkedItemIds !== undefined ? [...draft.linkedItemIds] : prev.linkedItemIds ?? [],
      category: draft.category,
      subtitle: draft.subtitle,
      icon: draft.icon,
      tags: [...draft.tags],
      urls: structuredClone(draft.urls),
      sections: structuredClone(draft.sections),
      passkeys: structuredClone(draft.passkeys ?? prev.passkeys ?? []),
      notes: draft.notes,
      passwordHistory: nextHistory.slice(0, 20),
      watchtower: { ...draft.watchtower },
      attachments: structuredClone(draft.attachments ?? prev.attachments ?? []),
      updatedAt: now,
    };

    this.items[idx] = updated;
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [id], deletedItemIds: [] });
    return structuredClone(updated);
  }

  async itemUpdateWatchtowerFlags(id: string, flags: Partial<WatchtowerFlags>): Promise<ItemDetail> {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    item.watchtower = { ...item.watchtower, ...flags };
    item.updatedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [id], deletedItemIds: [] });
    return structuredClone(item);
  }

  async itemToggleFavorite(id: string, favorite: boolean): Promise<ItemDetail> {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    item.favorite = favorite;
    item.updatedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [id], deletedItemIds: [] });
    return structuredClone(item);
  }

  async itemDuplicate(id: string): Promise<ItemDetail> {
    const source = this.items.find((i) => i.id === id);
    if (!source) throw new Error('Item not found');
    const now = new Date().toISOString();
    const copy: ItemDetail = {
      ...structuredClone(source),
      id: makeId('item'),
      title: `${source.title} (Copy)`,
      favorite: false,
      archived: false,
      attachments: [],
      deletedAt: undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.items.unshift(copy);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [copy.id], deletedItemIds: [] });
    return structuredClone(copy);
  }

  async itemSetArchived(id: string, archived: boolean): Promise<ItemDetail> {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    item.archived = archived;
    item.updatedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [id], deletedItemIds: [] });
    return structuredClone(item);
  }

  async itemMoveVault(ids: string[], targetVaultId: string): Promise<number> {
    const set = new Set(ids);
    let count = 0;
    const now = new Date().toISOString();
    for (const item of this.items) {
      if (set.has(item.id)) {
        item.vaultId = targetVaultId;
        item.updatedAt = now;
        count += 1;
      }
    }
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: ids, deletedItemIds: [] });
    return count;
  }

  async itemBatchTrash(ids: string[]): Promise<number> {
    const set = new Set(ids);
    let count = 0;
    const now = new Date().toISOString();
    for (const item of this.items) {
      if (set.has(item.id) && !item.deletedAt) {
        item.deletedAt = now;
        count += 1;
      }
    }
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: ids });
    return count;
  }

  async itemBatchAddTag(ids: string[], tag: string): Promise<number> {
    const clean = tag.trim().replace(/^#/, '');
    if (!clean) return 0;
    const set = new Set(ids);
    let count = 0;
    const now = new Date().toISOString();
    for (const item of this.items) {
      if (set.has(item.id)) {
        if (!item.tags.includes(clean)) {
          item.tags.push(clean);
          item.updatedAt = now;
        }
        count += 1;
      }
    }
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: ids, deletedItemIds: [] });
    return count;
  }

  async itemTrash(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.deletedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [id] });
  }

  async itemRestore(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    delete item.deletedAt;
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [id], deletedItemIds: [] });
  }

  async itemDeletePermanent(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [id] });
  }

  async itemEmptyTrash(): Promise<number> {
    const trashedIds = this.items.filter((i) => Boolean(i.deletedAt)).map((i) => i.id);
    if (trashedIds.length === 0) return 0;
    const set = new Set(trashedIds);
    this.items = this.items.filter((i) => !set.has(i.id));
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: trashedIds });
    return trashedIds.length;
  }

  // --- Vaultwarden Sends ---

  async sendList(): Promise<SendItem[]> {
    return structuredClone(
      [...this.sends].sort((a, b) => Date.parse(b.revisionDate) - Date.parse(a.revisionDate)),
    );
  }

  async sendCreateText(input: SendCreateTextInput): Promise<SendItem> {
    if (!input.name.trim()) throw new Error('Send name cannot be empty');
    if (!input.text) throw new Error('Send text content cannot be empty');
    const now = new Date().toISOString();
    const id = makeId('send');
    const accessId = makeId('acc').replace(/_/g, '');
    const base = this.session.serverUrl.replace(/\/+$/, '');
    const created: SendItem = {
      id,
      accessId,
      sendType: 'text',
      name: input.name.trim(),
      notes: input.notes?.trim() || undefined,
      text: input.text,
      hidden: Boolean(input.hidden),
      shareUrl: `${base}/#/send/${accessId}/ZGVtb19zZWVkXzE2Ynl0ZXM`,
      maxAccessCount: input.maxAccessCount ?? null,
      accessCount: 0,
      expirationDate: input.expirationDate || undefined,
      deletionDate: input.deletionDate,
      revisionDate: now,
      disabled: Boolean(input.disabled),
      hideEmail: Boolean(input.hideEmail),
      hasPassword: Boolean(input.password?.trim()),
    };
    this.sends.unshift(created);
    return structuredClone(created);
  }

  async sendCreateFile(input: SendCreateFileInput): Promise<SendItem> {
    if (!input.name.trim()) throw new Error('Send name cannot be empty');
    if (!input.fileName.trim()) throw new Error('File name cannot be empty');
    const raw = input.dataBase64.includes('base64,') ? input.dataBase64.split('base64,')[1] : input.dataBase64;
    const size = estimateBase64Bytes(raw);
    if (size > 10 * 1024 * 1024) throw new Error('File exceeds the 10 MB limit');
    const now = new Date().toISOString();
    const id = makeId('send');
    const accessId = makeId('acc').replace(/_/g, '');
    const base = this.session.serverUrl.replace(/\/+$/, '');
    const created: SendItem = {
      id,
      accessId,
      sendType: 'file',
      name: input.name.trim(),
      notes: input.notes?.trim() || undefined,
      fileName: input.fileName.trim(),
      fileSize: size,
      fileSizeName: formatByteSize(size),
      hidden: false,
      shareUrl: `${base}/#/send/${accessId}/ZmlsZV9zZWVkXzE2Ynl0ZXM`,
      maxAccessCount: input.maxAccessCount ?? null,
      accessCount: 0,
      expirationDate: input.expirationDate || undefined,
      deletionDate: input.deletionDate,
      revisionDate: now,
      disabled: Boolean(input.disabled),
      hideEmail: Boolean(input.hideEmail),
      hasPassword: Boolean(input.password?.trim()),
    };
    this.sends.unshift(created);
    return structuredClone(created);
  }

  async sendUpdate(id: string, input: SendUpdateInput): Promise<SendItem> {
    const idx = this.sends.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('Send not found');
    const prev = this.sends[idx];
    const updated: SendItem = {
      ...prev,
      name: input.name.trim() || prev.name,
      text: prev.sendType === 'text' ? (input.text ?? prev.text) : undefined,
      hidden: prev.sendType === 'text' ? (input.hidden ?? prev.hidden) : false,
      notes: input.notes !== undefined ? (input.notes.trim() || undefined) : prev.notes,
      maxAccessCount: input.maxAccessCount !== undefined ? input.maxAccessCount : prev.maxAccessCount,
      expirationDate: input.expirationDate || undefined,
      deletionDate: input.deletionDate,
      disabled: input.disabled ?? prev.disabled,
      hideEmail: input.hideEmail ?? prev.hideEmail,
      hasPassword: input.password?.trim() ? true : prev.hasPassword,
      revisionDate: new Date().toISOString(),
    };
    this.sends[idx] = updated;
    return structuredClone(updated);
  }

  async sendRemovePassword(id: string): Promise<SendItem> {
    const target = this.sends.find((s) => s.id === id);
    if (!target) throw new Error('Send not found');
    target.hasPassword = false;
    target.revisionDate = new Date().toISOString();
    return structuredClone(target);
  }

  async sendDelete(id: string): Promise<void> {
    this.sends = this.sends.filter((s) => s.id !== id);
  }

  // --- Attachments ---

  async attachmentUpload(itemId: string, fileName: string, dataBase64: string): Promise<ItemAttachment> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    const id = makeId('att');
    const size = estimateBase64Bytes(dataBase64);
    const att: ItemAttachment = {
      id,
      fileName,
      size,
      sizeName: formatByteSize(size),
      hasLocalData: true,
    };
    this.attachmentPayloads.set(`${itemId}:${id}`, {
      fileName,
      mimeType: inferMimeFromName(fileName),
      dataBase64,
    });
    item.attachments = [...(item.attachments ?? []), att];
    item.updatedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [itemId], deletedItemIds: [] });
    return structuredClone(att);
  }

  async attachmentDownload(itemId: string, attachmentId: string): Promise<AttachmentDownloadResult> {
    const stored = this.attachmentPayloads.get(`${itemId}:${attachmentId}`);
    if (!stored) {
      throw new Error('Local attachment data not found');
    }
    return structuredClone(stored);
  }

  async attachmentDelete(itemId: string, attachmentId: string): Promise<void> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) return;
    this.attachmentPayloads.delete(`${itemId}:${attachmentId}`);
    item.attachments = (item.attachments ?? []).filter((a) => a.id !== attachmentId);
    item.updatedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [itemId], deletedItemIds: [] });
  }

  // --- Sync ---

  async syncGetStatus(): Promise<SyncStatus> {
    return { ...this.syncStatusState };
  }

  async syncNow(): Promise<SyncStatus> {
    this.syncStatusState = { ...this.syncStatusState, state: 'syncing' };
    this.emit('sync:status', { ...this.syncStatusState });
    await new Promise((r) => setTimeout(r, 650));
    const now = new Date().toISOString();
    this.session.lastSyncAt = now;
    this.syncStatusState = {
      state: 'idle',
      pendingCount: 0,
      lastSyncAt: now,
      signalrConnected: true,
    };
    this.emit('sync:status', { ...this.syncStatusState });
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [], deletedItemIds: [] });
    return { ...this.syncStatusState };
  }

  // --- TOTP / Generator / Watchtower / SSH / Favicon ---

  async totpCompute(secretOrUri: string): Promise<TotpCode> {
    return computeTotp(secretOrUri);
  }

  async totpParseQrImage(_imageBase64: string): Promise<string> {
    throw new Error('Offline QR code recognition is not supported in browser preview mode. Please use the desktop app.');
  }

  async generatorGenerate(options: GeneratorOptions): Promise<GeneratorResult> {
    return generateSecret(options);
  }

  async generatorGenerateMaskedEmail(domainHint?: string): Promise<string> {
    const cleanDomain =
      this.appSettings.maskedEmail?.domain?.trim() || 'example.com';
    const prefix =
      domainHint
        ?.trim()
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .split('.')[0]
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase() || 'alias';
    const token = Math.random().toString(36).slice(2, 8);
    return `${prefix}.${token}@${cleanDomain}`;
  }

  async generatorHistoryList(): Promise<GeneratorHistoryEntry[]> {
    return structuredClone(this.generatorHistory);
  }

  async generatorHistoryRecord(
    value: string,
    mode: GeneratorMode | 'masked_email' | string,
    entropyBits: number,
    source?: string,
  ): Promise<GeneratorHistoryEntry> {
    const entry: GeneratorHistoryEntry = {
      id: makeId('genh'),
      value,
      mode,
      entropyBits,
      source,
      createdAt: new Date().toISOString(),
    };
    this.generatorHistory = [entry, ...this.generatorHistory.filter((e) => e.value !== value)].slice(0, 50);
    return structuredClone(entry);
  }

  async generatorHistoryClear(): Promise<void> {
    this.generatorHistory = [];
  }

  async watchtowerScan(checkHibp = false): Promise<WatchtowerReport> {
    if (checkHibp) {
      const samplePw = this.items[0]?.sections[0]?.fields[1]?.value ?? 'Keysmith';
      await sha1PrefixHex(samplePw);
      await new Promise((r) => setTimeout(r, 520));
      this.hibpChecked = true;
      this.hibpCheckedAt = new Date().toISOString();
    }
    return runWatchtowerAudit(this.items, {
      checkHibp: this.hibpChecked,
      hibpCheckedAt: this.hibpCheckedAt,
    });
  }

  async sshGenerateEd25519(comment = 'keysmith@local'): Promise<SshKeyPair> {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const pubB64 = btoa(String.fromCharCode(...raw)).replace(/=+$/, '');
    const privBody = encodeBase64Utf8(`openssh-key-v1-demo:${pubB64}:${comment}`);
    const digest = await crypto.subtle.digest('SHA-256', raw);
    const fpB64 = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=+$/, '');
    return {
      publicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${pubB64.slice(0, 32)} ${comment}`,
      privateKeyOpenssh: `-----BEGIN OPENSSH PRIVATE KEY-----\n${privBody}\n-----END OPENSSH PRIVATE KEY-----`,
      fingerprintSha256: `SHA256:${fpB64}`,
    };
  }

  async sshAgentSocketPath(): Promise<string> {
    return '~/Library/Application Support/dev.keysmith.desktop/ssh-agent.sock';
  }

  async sshAgentGetStatus(): Promise<SshAgentStatus> {
    const enabled = this.appSettings.sshAgentEnabled !== false;
    const loadedKeyCount = enabled
      ? this.items.filter((i) => !i.deletedAt && !i.archived && i.category === 'ssh_key').length
      : 0;
    return {
      enabled,
      biometricConfirm: Boolean(this.session.sshBiometricConfirm),
      socketListening: enabled,
      socketPath: '~/Library/Application Support/dev.keysmith.desktop/ssh-agent.sock',
      sshConfigPath: '~/.ssh/config',
      sshConfigConfigured: this.demoSshConfigured,
      loadedKeyCount,
    };
  }

  async sshAgentConfigureSshConfig(enable: boolean): Promise<SshAgentStatus> {
    this.demoSshConfigured = enable;
    return this.sshAgentGetStatus();
  }

  async autofillAutoType(
    _itemId: string,
    _mode: 'credentials' | 'username' | 'password' | 'totp' = 'credentials',
    _submit = true,
  ): Promise<void> {}

  async faviconFetch(_host: string): Promise<string | null> {
    return null;
  }

  // --- Clipboard Guard ---

  async clipboardCopySecret(text: string, label: string, isSensitive: boolean): Promise<void> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Fallback for non-focused or permission-restricted webviews
    }

    if (this.clipboardTimer !== null) {
      window.clearInterval(this.clipboardTimer);
      this.clipboardTimer = null;
    }

    if (!isSensitive) {
      this.clipboardState = null;
      this.emit('clipboard:tick', null);
      return;
    }

    const total = this.session.clipboardClearSeconds;
    if (total <= 0) {
      this.clipboardState = null;
      this.emit('clipboard:tick', null);
      return;
    }

    this.clipboardState = { label, remainingSeconds: total, totalSeconds: total };
    this.emit('clipboard:tick', { ...this.clipboardState });

    this.clipboardTimer = window.setInterval(() => {
      if (!this.clipboardState) return;
      this.clipboardState.remainingSeconds -= 1;
      if (this.clipboardState.remainingSeconds <= 0) {
        void this.clipboardClearNow();
      } else {
        this.emit('clipboard:tick', { ...this.clipboardState });
      }
    }, 1000);
  }

  async clipboardClearNow(): Promise<void> {
    const label = this.clipboardState?.label ?? 'Sensitive data';
    if (this.clipboardTimer !== null) {
      window.clearInterval(this.clipboardTimer);
      this.clipboardTimer = null;
    }
    this.clipboardState = null;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText('');
      }
    } catch {
      // ignore
    }
    this.emit('clipboard:tick', null);
    this.emit('clipboard:cleared', { label });
  }

  async clipboardReadImageBase64(): Promise<string | null> {
    return null;
  }

  // --- Window / System Helpers ---

  async windowMainReady(): Promise<void> {}

  async windowSetCompactLock(_compact: boolean): Promise<void> {}

  async windowOpenLargeType(label: string, value: string): Promise<void> {
    this.largeTypePayload = { label, value };
    this.emit('large-type:updated', { label, value });
  }

  async windowCloseLargeType(): Promise<void> {
    this.largeTypePayload = null;
  }

  async windowSetLargeTypePin(_pinned: boolean): Promise<void> {}

  async largeTypeGetPayload(): Promise<LargeTypePayload | null> {
    return this.largeTypePayload ? { ...this.largeTypePayload } : null;
  }

  async windowToggleQuickAccess(): Promise<void> {
    this.emit('ui:toggle_quick_access', {});
  }

  async windowHideQuickAccess(): Promise<void> {}

  async windowFocusMainItem(itemId: string): Promise<void> {
    this.emit('ui:focus_item', { itemId });
  }

  async windowOpenGenerator(): Promise<void> {}

  async windowToggleGenerator(): Promise<void> {}

  async windowCloseGenerator(): Promise<void> {}

  async systemOpenUrl(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async browserIntegrationStatus(): Promise<BrowserIntegrationStatus> {
    return {
      extensionId: 'ianpdijhflnmmhbmjdhiombdghhpfkmg',
      hostPath: '/Applications/Keysmith.app/Contents/MacOS/keysmith-desktop',
      extensionDir: '~/Library/Application Support/dev.keysmith.desktop/browser-extension',
      browsers: [
        {
          id: 'chrome',
          label: 'Google Chrome',
          detected: true,
          configured: true,
          manifestPath:
            '~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.keysmith.desktop.json',
        },
        {
          id: 'edge',
          label: 'Microsoft Edge',
          detected: false,
          configured: false,
          manifestPath:
            '~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/dev.keysmith.desktop.json',
        },
        {
          id: 'arc',
          label: 'Arc',
          detected: false,
          configured: false,
          manifestPath:
            '~/Library/Application Support/Arc/User Data/NativeMessagingHosts/dev.keysmith.desktop.json',
        },
        {
          id: 'brave',
          label: 'Brave',
          detected: false,
          configured: false,
          manifestPath:
            '~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/dev.keysmith.desktop.json',
        },
      ],
    };
  }

  async browserIntegrationConfigure(_extraExtensionId?: string): Promise<BrowserIntegrationStatus> {
    return this.browserIntegrationStatus();
  }

  async browserOpenExtensionFolder(): Promise<string> {
    return '~/Library/Application Support/dev.keysmith.desktop/browser-extension';
  }

  async organizationList(): Promise<OrganizationInfo[]> {
    return [];
  }

  async itemShareToOrganization(
    itemId: string,
    _organizationId: string,
    _collectionIds: string[],
  ): Promise<ItemDetail> {
    const existing = await this.itemGet(itemId);
    if (!existing) throw new Error('Item not found');
    return existing;
  }

  async appCheckUpdateInfo(): Promise<AppUpdateInfo> {
    return {
      currentVersion: '0.1.0',
      channel: 'stable',
      signed: false,
      status: 'v0.1.0',
      latestVersion: '0.1.0',
      updateAvailable: false,
      notes: 'v0.1.0',
      checkedAt: new Date().toISOString(),
    };
  }

  async appSettingsGet(): Promise<AppSettings> {
    return { ...this.appSettings, customShortcuts: { ...this.appSettings.customShortcuts } };
  }

  async appSettingsUpdate(patch: AppSettingsPatch): Promise<AppSettings> {
    this.appSettings = {
      ...this.appSettings,
      ...patch,
      customShortcuts: patch.customShortcuts
        ? { ...patch.customShortcuts }
        : { ...this.appSettings.customShortcuts },
    };
    this.emit('ui:settings_changed', { ...this.appSettings });
    return this.appSettingsGet();
  }
}

export const tauriClient: KeysmithClient = isTauriRuntime()
  ? new KeysmithTauriClient()
  : new KeysmithPrototypeClient();
