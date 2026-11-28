import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  FileText,
  Fingerprint,
  FolderOpen,
  Globe,
  History,
  Info,
  Keyboard,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Palette,
  Plane,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  Sun,
  Terminal,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { SUPPORTED_LOCALES, useI18n, type LanguageMode } from '../../i18n';
import { AboutContent } from './AboutModal';
import { syncCurrentUserDetails } from '../../services/passkey';
import { tauriClient } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type {
  AccountSummary,
  AppUpdateInfo,
  BrowserIntegrationStatus,
  ExportFormat,
  ImportFormat,
  ImportSummary,
  LocalSnapshotInfo,
  MaskedEmailProvider,
  SshAgentStatus,
  SyncMode,
} from '../../types/domain';
import { formatDateTime } from '../../utils/format';
import { openExternalUrl } from '../../utils/opener';
import {
  DEFAULT_GLOBAL_QUICK_ACCESS_SHORTCUT,
  DEFAULT_SHORTCUTS,
  formatShortcutMac,
  keyboardEventToCombo,
  SHORTCUT_ACTION_ORDER,
  type ShortcutActionId,
} from '../../utils/shortcuts';
import type { ThemeMode } from '../../utils/theme';

const QUICK_ACCESS_SHORTCUT_PRESETS = [
  'CommandOrControl+Shift+Space',
  'Alt+Space',
  'CommandOrControl+Alt+K',
  'CommandOrControl+Shift+K',
];

export function SettingsModal() {
  const { dict, languageMode, setLanguageMode, fmt } = useI18n();
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const themeMode = useUiStore((s) => s.themeMode);
  const systemPrefersDark = useUiStore((s) => s.systemPrefersDark);
  const setThemeMode = useUiStore((s) => s.setThemeMode);
  const shortcuts = useUiStore((s) => s.shortcuts);
  const setShortcutAction = useUiStore((s) => s.setShortcutAction);
  const resetAllShortcuts = useUiStore((s) => s.resetAllShortcuts);
  const getFilter = useUiStore((s) => s.getFilter);
  const showToast = useUiStore((s) => s.showToast);

  const email = useSessionStore((s) => s.email);
  const displayName = useSessionStore((s) => s.displayName);
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const biometricEnabled = useSessionStore((s) => s.biometricEnabled);
  const autoLockMinutes = useSessionStore((s) => s.autoLockMinutes);
  const clipboardClearSeconds = useSessionStore((s) => s.clipboardClearSeconds);
  const kdfType = useSessionStore((s) => s.kdfType);
  const closeToTray = useSessionStore((s) => s.closeToTray);
  const lockOnSleep = useSessionStore((s) => s.lockOnSleep);
  const screenCaptureProtected = useSessionStore((s) => s.screenCaptureProtected);
  const vibrancyEnabled = useSessionStore((s) => s.vibrancyEnabled);
  const faviconEnabled = useSessionStore((s) => s.faviconEnabled);
  const quickAccessShortcut = useSessionStore((s) => s.quickAccessShortcut);
  const biometricMaxDays = useSessionStore((s) => s.biometricMaxDays);
  const launchAtLogin = useSessionStore((s) => s.launchAtLogin);
  const travelMode = useSessionStore((s) => Boolean(s.travelMode));
  const trashAutoPurgeDays = useSessionStore((s) => s.trashAutoPurgeDays ?? 30);
  const sshBiometricConfirm = useSessionStore((s) => Boolean(s.sshBiometricConfirm));
  const appSettings = useSessionStore((s) => s.appSettings);

  const updatePreferences = useSessionStore((s) => s.updatePreferences);
  const updateAppSettings = useSessionStore((s) => s.updateAppSettings);
  const updateProfile = useSessionStore((s) => s.updateProfile);
  const switchAccount = useSessionStore((s) => s.switchAccount);
  const startAddingAccount = useSessionStore((s) => s.startAddingAccount);
  const logout = useSessionStore((s) => s.logout);

  const vaults = useVaultStore((s) => s.vaults);
  const syncStatus = useVaultStore((s) => s.syncStatus);
  const syncNow = useVaultStore((s) => s.syncNow);
  const refreshAll = useVaultStore((s) => s.refreshAll);
  const setVaultTravelSafe = useVaultStore((s) => s.setVaultTravelSafe);

  const [tab, setTab] = useState<
    'appearance' | 'security' | 'ssh' | 'browser' | 'import_export' | 'sync' | 'shortcuts' | 'about'
  >('appearance');
  const [browserStatus, setBrowserStatus] = useState<BrowserIntegrationStatus | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [extraExtId, setExtraExtId] = useState('');
  const [copiedExtId, setCopiedExtId] = useState(false);
  const [sshStatus, setSshStatus] = useState<SshAgentStatus | null>(null);
  const [sshBusy, setSshBusy] = useState(false);
  const [copiedSshSocket, setCopiedSshSocket] = useState(false);
  const [copiedSshSnippet, setCopiedSshSnippet] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(displayName);

  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // 'global' | ShortcutActionId | null
  const [recordingTarget, setRecordingTarget] = useState<'global' | ShortcutActionId | null>(null);
  const [shortcutFeedback, setShortcutFeedback] = useState<string | null>(null);

  const [importFormat, setImportFormat] = useState<ImportFormat>('bitwarden_json');
  const [importTargetVaultId, setImportTargetVaultId] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);

  const [exportFormat, setExportFormat] = useState<ExportFormat>('keysmith_encrypted_json');
  const [exportMasterPw, setExportMasterPw] = useState('');
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exporting, setExporting] = useState(false);

  const [snapshots, setSnapshots] = useState<LocalSnapshotInfo[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [emergencyBusy, setEmergencyBusy] = useState(false);

  const [maskedProvider, setMaskedProvider] = useState<MaskedEmailProvider>('catch_all');
  const [maskedDomain, setMaskedDomain] = useState('');
  const [maskedApiKey, setMaskedApiKey] = useState('');
  const [maskedBusy, setMaskedBusy] = useState(false);
  const [equivDomainsDraft, setEquivDomainsDraft] = useState('');
  const [disabledDomainsDraft, setDisabledDomainsDraft] = useState('');

  useEffect(() => {
    setMaskedProvider(appSettings.maskedEmail?.provider ?? 'catch_all');
    setMaskedDomain(appSettings.maskedEmail?.domain ?? '');
    setMaskedApiKey(appSettings.maskedEmail?.apiKey ?? '');
    setEquivDomainsDraft(
      (appSettings.customEquivalentDomains ?? []).map((g) => g.join(', ')).join('\n'),
    );
    setDisabledDomainsDraft((appSettings.disabledAutofillDomains ?? []).join('\n'));
  }, [open, appSettings]);

  useEffect(() => {
    if (!open || tab !== 'import_export') return;
    let active = true;
    void tauriClient
      .snapshotList()
      .then((list) => {
        if (active) setSnapshots(list);
      })
      .catch(() => {
        if (active) setSnapshots([]);
      });
    return () => {
      active = false;
    };
  }, [open, tab]);

  useEffect(() => {
    setProfileNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!open) {
      setRecordingTarget(null);
      setShortcutFeedback(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'ssh') return;
    let active = true;
    void tauriClient
      .sshAgentGetStatus()
      .then((res) => {
        if (active) setSshStatus(res);
      })
      .catch(() => {
        if (active) setSshStatus(null);
      });
    return () => {
      active = false;
    };
  }, [open, tab, appSettings.sshAgentEnabled, sshBiometricConfirm]);

  useEffect(() => {
    if (!open || tab !== 'browser') return;
    let active = true;
    void tauriClient
      .browserIntegrationStatus()
      .then((res) => {
        if (active) setBrowserStatus(res);
      })
      .catch(() => {
        if (active) setBrowserStatus(null);
      });
    return () => {
      active = false;
    };
  }, [open, tab]);

  useEffect(() => {
    if (!open || tab !== 'sync') return;
    let active = true;
    void tauriClient
      .accountList()
      .then((list) => {
        if (active) setAccounts(list);
      })
      .catch(() => {
        if (active) setAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [open, tab]);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await updateProfile(profileNameDraft);
    await syncCurrentUserDetails(res.rpId, res.userId, res.name, res.displayName);
    showToast({ label: dict.auth.displayName, text: res.displayName, kind: 'info' });
  };

  const applyGlobalShortcut = async (combo: string) => {
    setShortcutFeedback(null);
    try {
      await updatePreferences({ quickAccessShortcut: combo });
      showToast({
        label: dict.settings.shortcutsGlobalTitle,
        text: `${dict.settings.shortcutsUpdated}: ${formatShortcutMac(combo)}`,
        kind: 'info',
      });
    } catch (err) {
      setShortcutFeedback(err instanceof Error ? err.message : 'Failed to register shortcut');
    }
  };

  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
    if (!recordingTarget) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecordingTarget(null);
      return;
    }

    const combo = keyboardEventToCombo(e);
    if (!combo) return;

    const target = recordingTarget;
    setRecordingTarget(null);
    setShortcutFeedback(null);

    if (target === 'global') {
      void applyGlobalShortcut(combo);
      return;
    }

    const conflictAction = SHORTCUT_ACTION_ORDER.find(
      (act) => act !== target && shortcuts[act].toLowerCase() === combo.toLowerCase(),
    );
    if (conflictAction) {
      setShortcutFeedback(
        fmt(dict.settings.shortcutsConflict, {
          other: dict.settings.shortcutsActions[conflictAction],
        }),
      );
      return;
    }

    setShortcutAction(target, combo);
    showToast({
      label: dict.settings.tabs.shortcuts,
      text: `${dict.settings.shortcutsActions[target]}: ${formatShortcutMac(combo)}`,
      kind: 'info',
    });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const isBinary = importFormat === '1pux';
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        if (isBinary) {
          reader.onload = () => {
            const raw = String(reader.result ?? '');
            const idx = raw.indexOf(',');
            resolve(idx >= 0 ? raw.slice(idx + 1) : raw);
          };
          reader.readAsDataURL(file);
        } else {
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.readAsText(file);
        }
        reader.onerror = () => reject(new Error('Read failed'));
      });
      const summary = await tauriClient.vaultImport(
        importFormat,
        data,
        isBinary,
        importTargetVaultId || null,
        importFormat === 'keysmith_encrypted_json' ? importPassphrase : undefined,
      );
      setImportResult(summary);
      setImportPassphrase('');
      await refreshAll(getFilter());
      showToast({
        label: dict.settings.tabs.import_export,
        text: `${summary.importedItems} items imported`,
        kind: 'info',
      });
    } catch (err) {
      showToast({
        label: dict.settings.tabs.import_export,
        text: err instanceof Error ? err.message : 'Import failed',
        kind: 'warning',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleExportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportMasterPw) return;
    setExporting(true);
    try {
      const result = await tauriClient.vaultExport(
        exportFormat,
        exportMasterPw,
        exportFormat === 'keysmith_encrypted_json' ? exportPassphrase.trim() || undefined : undefined,
      );
      const blob = new Blob([result.content], {
        type: exportFormat === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
      setExportMasterPw('');
      setExportPassphrase('');
      showToast({ label: dict.settings.tabs.import_export, text: result.fileName, kind: 'info' });
    } catch (err) {
      showToast({
        label: dict.settings.tabs.import_export,
        text: err instanceof Error ? err.message : 'Export failed',
        kind: 'warning',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const info = await tauriClient.appCheckUpdateInfo();
      setUpdateInfo(info);
    } catch (err) {
      showToast({
        label: dict.settings.appVersion,
        text: err instanceof Error ? err.message : 'Failed',
        kind: 'warning',
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const themeOptions: Array<{ id: ThemeMode; label: string; icon: typeof Monitor }> = [
    {
      id: 'system',
      label: fmt(dict.settings.themeSystem, {
        mode: systemPrefersDark ? dict.settings.themeSystemDark : dict.settings.themeSystemLight,
      }),
      icon: Monitor,
    },
    { id: 'light', label: dict.settings.themeLight, icon: Sun },
    { id: 'dark', label: dict.settings.themeDark, icon: Moon },
  ];

  const langOptions: Array<{ id: LanguageMode; label: string }> = [
    { id: 'system', label: dict.settings.languageSystem },
    ...SUPPORTED_LOCALES.map((loc) => ({ id: loc.id, label: loc.label })),
  ];

  return (
    <ModalDialog
      open={open}
      onClose={() => setSettingsOpen(false)}
      ariaLabelledBy="settings-title"
      closedBy="any"
      className="rounded-xl w-[min(740px,94vw)] shadow-2xl"
    >
      <div className="flex flex-col max-h-[85dvh]">
        <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h1 id="settings-title" className="text-base font-semibold text-[var(--text-primary)]">
            {dict.settings.title}
          </h1>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label={dict.common.close}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex flex-1 min-h-[420px] overflow-hidden">
          <nav className="w-48 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] p-2.5 flex flex-col gap-0.5">
            {(
              [
                { id: 'appearance', label: dict.settings.tabs.appearance, icon: Palette },
                { id: 'security', label: dict.settings.tabs.security, icon: Shield },
                { id: 'ssh', label: dict.settings.tabs.ssh, icon: Terminal },
                { id: 'browser', label: dict.settings.tabs.browser, icon: Globe },
                { id: 'import_export', label: dict.settings.tabs.import_export, icon: ArrowDownToLine },
                { id: 'sync', label: dict.settings.tabs.sync, icon: RefreshCw },
                { id: 'shortcuts', label: dict.settings.tabs.shortcuts, icon: Keyboard },
                { id: 'about', label: dict.settings.tabs.about, icon: Info },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium text-left cursor-pointer ${
                    tab === item.id
                      ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto ks-scroll p-5">
            {tab === 'appearance' && (
              <div className="flex flex-col gap-5 text-[13px]">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                    {dict.settings.languageLabel}
                  </h2>
                  <div className="relative flex items-center">
                    <Globe size={15} className="absolute left-3 text-[var(--text-muted)] pointer-events-none" />
                    <select
                      aria-label={dict.settings.languageLabel}
                      value={languageMode}
                      onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] focus:border-[var(--accent-primary)] focus:outline-none text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
                    >
                      {langOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                    {dict.settings.themeTitle}
                  </h2>
                  <div className="grid grid-cols-3 gap-2">
                    {themeOptions.map((opt) => {
                      const Icon = opt.icon;
                      const active = themeMode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setThemeMode(opt.id)}
                          className={`p-3 rounded-lg border text-center flex flex-col items-center gap-1.5 cursor-pointer transition-colors ${
                            active
                              ? 'bg-[var(--bg-selected)] border-[var(--accent-primary)] text-[var(--accent-primary)]'
                              : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                          }`}
                        >
                          <Icon size={17} />
                          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate max-w-full">
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-2.5">
                  <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                    <div>
                      <div className="font-medium text-[var(--text-primary)]">{dict.settings.vibrancy}</div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.vibrancyDesc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={vibrancyEnabled}
                      onChange={(e) => void updatePreferences({ vibrancyEnabled: e.target.checked })}
                      className="ks-checkbox"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                    <div>
                      <div className="font-medium text-[var(--text-primary)]">{dict.settings.favicon}</div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.faviconDesc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={faviconEnabled}
                      onChange={(e) => void updatePreferences({ faviconEnabled: e.target.checked })}
                      className="ks-checkbox"
                    />
                  </label>
                </div>
              </div>
            )}

            {tab === 'security' && (() => {
              const plat = typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : '';
              const isWindows = /Win/i.test(plat);
              const isLinux = !isWindows && /Linux/i.test(plat);
              const bioTitle = isWindows
                ? dict.settings.windowsHello
                : isLinux
                  ? dict.settings.linuxBio
                  : dict.settings.touchId;
              const bioDesc = isWindows
                ? dict.settings.windowsHelloDesc
                : isLinux
                  ? dict.settings.linuxBioDesc
                  : dict.settings.touchIdDesc;
              return (
              <div className="flex flex-col gap-2.5 text-[13px]">
                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{bioTitle}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{bioDesc}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">{dict.settings.biometricBindingNote}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={biometricEnabled}
                    onChange={(e) => void updatePreferences({ biometricEnabled: e.target.checked })}
                    className="ks-checkbox"
                    aria-label={bioTitle}
                  />
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.biometricMaxDays}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.biometricMaxDaysDesc}</div>
                  </div>
                  <select
                    value={biometricMaxDays}
                    onChange={(e) => void updatePreferences({ biometricMaxDays: Number(e.target.value) })}
                    className="ks-select min-w-[128px] shrink-0"
                  >
                    <option value={0}>{dict.settings.daysNever}</option>
                    <option value={1}>{dict.settings.days1}</option>
                    <option value={7}>{dict.settings.days7}</option>
                    <option value={30}>{dict.settings.days30}</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.autoLock}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.autoLockDesc}</div>
                  </div>
                  <select
                    value={autoLockMinutes}
                    onChange={(e) => void updatePreferences({ autoLockMinutes: Number(e.target.value) })}
                    className="ks-select min-w-[128px] shrink-0"
                  >
                    <option value={1}>{dict.settings.mins1}</option>
                    <option value={5}>{dict.settings.mins5}</option>
                    <option value={15}>{dict.settings.mins15}</option>
                    <option value={30}>{dict.settings.mins30}</option>
                    <option value={60}>{dict.settings.mins60}</option>
                    <option value={0}>{dict.settings.never}</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.clipboardClear}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.clipboardClearDesc}</div>
                  </div>
                  <select
                    value={clipboardClearSeconds}
                    onChange={(e) => void updatePreferences({ clipboardClearSeconds: Number(e.target.value) })}
                    className="ks-select min-w-[128px] shrink-0"
                  >
                    <option value={10}>{dict.settings.secs10}</option>
                    <option value={20}>{dict.settings.secs20}</option>
                    <option value={30}>{dict.settings.secs30}</option>
                    <option value={60}>{dict.settings.secs60}</option>
                    <option value={0}>{dict.settings.never}</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.lockOnSleep}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.lockOnSleepDesc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={lockOnSleep}
                    onChange={(e) => void updatePreferences({ lockOnSleep: e.target.checked })}
                    className="ks-checkbox"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.closeToTray}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.closeToTrayDesc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={closeToTray}
                    onChange={(e) => void updatePreferences({ closeToTray: e.target.checked })}
                    className="ks-checkbox"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.captureProtect}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.captureProtectDesc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={screenCaptureProtected}
                    onChange={(e) => void updatePreferences({ screenCaptureProtected: e.target.checked })}
                    className="ks-checkbox"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.launchAtLogin}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.launchAtLoginDesc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={launchAtLogin}
                    onChange={(e) => void updatePreferences({ launchAtLogin: e.target.checked })}
                    className="ks-checkbox"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.trashPurgeTitle}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.trashPurgeDesc}</div>
                  </div>
                  <select
                    value={trashAutoPurgeDays}
                    onChange={(e) => void updatePreferences({ trashAutoPurgeDays: Number(e.target.value) })}
                    className="ks-select min-w-[128px] shrink-0"
                  >
                    <option value={0}>{dict.settings.never}</option>
                    <option value={7}>{dict.settings.days7}</option>
                    <option value={30}>{dict.settings.days30}</option>
                    <option value={90}>{dict.settings.days90}</option>
                  </select>
                </label>

                {/* Travel Mode */}
                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                  <label className="flex items-center justify-between gap-4 cursor-pointer">
                    <div className="flex items-start gap-2.5">
                      <Plane size={16} className="text-[var(--accent-primary)] shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium text-[var(--text-primary)]">{dict.settings.travelModeTitle}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                          {dict.settings.travelModeDesc}
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={travelMode}
                      onChange={async (e) => {
                        const nextVal = e.target.checked;
                        await updatePreferences({ travelMode: nextVal });
                        await refreshAll(getFilter());
                        showToast({
                          label: dict.settings.travelModeTitle,
                          text: nextVal ? dict.sidebar.travelModeActive : dict.common.restore,
                          kind: nextVal ? 'warning' : 'info',
                        });
                      }}
                      className="ks-checkbox"
                    />
                  </label>

                  {vaults.filter((v) => !v.isOrganization).length > 0 && (
                    <div className="pt-2.5 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
                      <div className="text-xs font-medium text-[var(--text-secondary)]">
                        {dict.settings.travelSafeVaultsTitle}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {vaults
                          .filter((v) => !v.isOrganization)
                          .map((v) => (
                            <label
                              key={v.id}
                              className="px-2.5 py-1.5 rounded-md bg-[var(--bg-detail)] border border-[var(--border-subtle)] flex items-center justify-between gap-2 text-xs cursor-pointer"
                            >
                              <span className="inline-flex items-center gap-1.5 truncate text-[var(--text-primary)]">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: v.color }}
                                />
                                <span className="truncate">{v.name}</span>
                              </span>
                              <input
                                type="checkbox"
                                checked={Boolean(v.travelSafe)}
                                onChange={(e) =>
                                  void setVaultTravelSafe(v.id, e.target.checked, getFilter())
                                }
                                title={dict.settings.travelSafeToggle}
                                className="ks-checkbox"
                              />
                            </label>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Emergency Kit PDF */}
                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <FileText size={16} className="text-[var(--accent-primary)] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-[var(--text-primary)]">{dict.settings.emergencyKitTitle}</div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                        {dict.settings.emergencyKitDesc}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={emergencyBusy}
                    onClick={async () => {
                      setEmergencyBusy(true);
                      try {
                        const res = await tauriClient.vaultExportEmergencyKit();
                        const binary = atob(res.content);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                        const blob = new Blob([bytes], { type: 'application/pdf' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = res.fileName;
                        a.click();
                        URL.revokeObjectURL(url);
                        showToast({
                          label: dict.settings.emergencyKitTitle,
                          text: res.fileName,
                          kind: 'info',
                        });
                      } catch (err) {
                        showToast({
                          label: dict.settings.emergencyKitTitle,
                          text: err instanceof Error ? err.message : String(err),
                          kind: 'warning',
                        });
                      } finally {
                        setEmergencyBusy(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                  >
                    <ArrowUpFromLine size={13} />
                    {dict.settings.emergencyKitBtn}
                  </button>
                </div>
              </div>
              );
            })()}

            {tab === 'ssh' && (
              <div className="flex flex-col gap-3.5 text-[13px]">
                {/* 1. SSH Agent Service Toggle + Live Status + Socket Path */}
                <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                  <label className="flex items-start justify-between gap-4 cursor-pointer">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Terminal size={16} className="text-[var(--accent-primary)] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {dict.settings.sshSection.serviceTitle}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              (appSettings.sshAgentEnabled ?? false)
                                ? 'bg-[var(--status-success)]/12 text-[var(--status-success)]'
                                : 'bg-[var(--bg-detail)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                (appSettings.sshAgentEnabled ?? false)
                                  ? 'bg-[var(--status-success)]'
                                  : 'bg-[var(--text-muted)]'
                              }`}
                            />
                            {(appSettings.sshAgentEnabled ?? false)
                              ? fmt(dict.settings.sshSection.statusActive, {
                                  count: sshStatus?.loadedKeyCount ?? 0,
                                })
                              : dict.settings.sshSection.statusDisabled}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                          {dict.settings.sshSection.serviceDesc}
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={appSettings.sshAgentEnabled ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        await updateAppSettings({ sshAgentEnabled: next });
                        const fresh = await tauriClient.sshAgentGetStatus().catch(() => null);
                        if (fresh) setSshStatus(fresh);
                      }}
                      className="ks-checkbox shrink-0 mt-0.5"
                      aria-label={dict.settings.sshSection.serviceTitle}
                    />
                  </label>

                  <div className="pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
                    <span className="text-xs text-[var(--text-secondary)] shrink-0">
                      {dict.settings.sshSection.socketLabel}
                    </span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <code className="font-mono-tabular text-[11px] px-2 py-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[var(--text-primary)] truncate">
                        {sshStatus?.socketPath ??
                          '~/Library/Application Support/dev.keysmith.desktop/ssh-agent.sock'}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          const sock =
                            sshStatus?.socketPath ??
                            '~/Library/Application Support/dev.keysmith.desktop/ssh-agent.sock';
                          void tauriClient.clipboardCopySecret(
                            sock,
                            dict.settings.sshSection.socketLabel,
                            false,
                          );
                          setCopiedSshSocket(true);
                          setTimeout(() => setCopiedSshSocket(false), 1500);
                        }}
                        aria-label={dict.common.copy}
                        className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer shrink-0"
                      >
                        {copiedSshSocket ? (
                          <Check size={13} className="text-[var(--status-success)]" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. Biometric Sign Approval + Live Status */}
                <label className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-start justify-between gap-4 cursor-pointer">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Fingerprint size={16} className="text-[var(--accent-primary)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          {dict.settings.sshSection.bioTitle}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            sshBiometricConfirm
                              ? 'bg-[var(--status-success)]/12 text-[var(--status-success)]'
                              : 'bg-[var(--bg-detail)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              sshBiometricConfirm ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'
                            }`}
                          />
                          {sshBiometricConfirm
                            ? dict.settings.sshSection.bioStatusOn
                            : dict.settings.sshSection.bioStatusOff}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                        {dict.settings.sshSection.bioDesc}
                      </p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={sshBiometricConfirm}
                    onChange={(e) => void updatePreferences({ sshBiometricConfirm: e.target.checked })}
                    className="ks-checkbox shrink-0 mt-0.5"
                    aria-label={dict.settings.sshSection.bioTitle}
                  />
                </label>

                {/* 3. One-Click ~/.ssh/config Setup */}
                <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                          {dict.settings.sshSection.configTitle}
                        </h2>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            sshStatus?.sshConfigConfigured
                              ? 'bg-[var(--status-success)]/12 text-[var(--status-success)]'
                              : 'bg-[var(--status-warning)]/12 text-[var(--status-warning)]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              sshStatus?.sshConfigConfigured
                                ? 'bg-[var(--status-success)]'
                                : 'bg-[var(--status-warning)]'
                            }`}
                          />
                          {sshStatus?.sshConfigConfigured
                            ? dict.settings.sshSection.configStatusConfigured
                            : dict.settings.sshSection.configStatusUnconfigured}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                        {dict.settings.sshSection.configDesc}
                      </p>
                    </div>
                  </div>

                  <pre className="p-3 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] font-mono-tabular text-[11.5px] leading-relaxed text-[var(--text-primary)] overflow-x-auto select-all">{`Host *\n  IdentityAgent "${sshStatus?.socketPath ?? '~/Library/Application Support/dev.keysmith.desktop/ssh-agent.sock'}"`}</pre>

                  <div className="flex flex-wrap items-center gap-2">
                    {!sshStatus?.sshConfigConfigured ? (
                      <button
                        type="button"
                        disabled={sshBusy}
                        onClick={async () => {
                          setSshBusy(true);
                          try {
                            if (!appSettings.sshAgentEnabled) {
                              await updateAppSettings({ sshAgentEnabled: true });
                            }
                            const next = await tauriClient.sshAgentConfigureSshConfig(true);
                            setSshStatus(next);
                            showToast({
                              label: dict.settings.tabs.ssh,
                              text: dict.settings.sshSection.configuredToast,
                              kind: 'info',
                            });
                          } catch (err) {
                            showToast({
                              label: dict.settings.tabs.ssh,
                              text: err instanceof Error ? err.message : String(err),
                              kind: 'warning',
                            });
                          } finally {
                            setSshBusy(false);
                          }
                        }}
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-[13px] font-medium cursor-pointer"
                      >
                        <Terminal size={14} />
                        {dict.settings.sshSection.configureBtn}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={sshBusy}
                        onClick={async () => {
                          setSshBusy(true);
                          try {
                            const next = await tauriClient.sshAgentConfigureSshConfig(false);
                            setSshStatus(next);
                            showToast({
                              label: dict.settings.tabs.ssh,
                              text: dict.settings.sshSection.removedConfigToast,
                              kind: 'info',
                            });
                          } catch (err) {
                            showToast({
                              label: dict.settings.tabs.ssh,
                              text: err instanceof Error ? err.message : String(err),
                              kind: 'warning',
                            });
                          } finally {
                            setSshBusy(false);
                          }
                        }}
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--status-danger)]/10 border border-[var(--border-strong)] hover:border-[var(--status-danger)]/40 text-[13px] font-medium text-[var(--text-primary)] hover:text-[var(--status-danger)] cursor-pointer"
                      >
                        <Trash2 size={14} />
                        {dict.settings.sshSection.removeConfigBtn}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const sock =
                          sshStatus?.socketPath ??
                          '~/Library/Application Support/dev.keysmith.desktop/ssh-agent.sock';
                        const snippet = `Host *\n  IdentityAgent "${sock}"\n`;
                        void tauriClient.clipboardCopySecret(
                          snippet,
                          dict.settings.sshSection.copySnippetBtn,
                          false,
                        );
                        setCopiedSshSnippet(true);
                        setTimeout(() => setCopiedSshSnippet(false), 1500);
                        showToast({
                          label: dict.settings.tabs.ssh,
                          text: dict.settings.sshSection.copySnippetBtn,
                          kind: 'info',
                        });
                      }}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
                    >
                      {copiedSshSnippet ? (
                        <Check size={14} className="text-[var(--status-success)]" />
                      ) : (
                        <Copy size={14} />
                      )}
                      {dict.settings.sshSection.copySnippetBtn}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'browser' && (
              <div className="flex flex-col gap-4 text-[13px]">
                <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                        {dict.settings.browserSection.title}
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                        {dict.settings.browserSection.desc}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await tauriClient.browserOpenExtensionFolder();
                          showToast({
                            label: dict.settings.tabs.browser,
                            text: dict.settings.browserSection.openedFolderToast,
                            kind: 'info',
                          });
                        } catch (err) {
                          showToast({
                            label: dict.settings.tabs.browser,
                            text: err instanceof Error ? err.message : String(err),
                            kind: 'warning',
                          });
                        }
                      }}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-[13px] font-medium cursor-pointer"
                    >
                      <FolderOpen size={14} />
                      {dict.settings.browserSection.openFolderBtn}
                    </button>
                    <button
                      type="button"
                      disabled={browserBusy}
                      onClick={async () => {
                        setBrowserBusy(true);
                        try {
                          const res = await tauriClient.browserIntegrationConfigure(extraExtId);
                          setBrowserStatus(res);
                          showToast({
                            label: dict.settings.tabs.browser,
                            text: dict.settings.browserSection.configuredToast,
                            kind: 'info',
                          });
                        } finally {
                          setBrowserBusy(false);
                        }
                      }}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
                    >
                      <RefreshCw size={13} className={browserBusy ? 'animate-spin' : ''} />
                      {dict.settings.browserSection.reconfigureBtn}
                    </button>
                  </div>
                </div>

                {browserStatus && (
                  <>
                    <div className="rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                      {browserStatus.browsers.map((b) => (
                        <div key={b.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-[var(--text-primary)]">{b.label}</div>
                            {b.detected && (
                              <div className="text-[10.5px] text-[var(--text-muted)] font-mono-tabular truncate mt-0.5">
                                {b.manifestPath}
                              </div>
                            )}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 ${
                              b.configured
                                ? 'bg-[var(--status-success)]/12 text-[var(--status-success)]'
                                : b.detected
                                  ? 'bg-[var(--status-warning)]/12 text-[var(--status-warning)]'
                                  : 'bg-[var(--bg-detail)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
                            }`}
                          >
                            {b.configured
                              ? dict.settings.browserSection.configuredBadge
                              : b.detected
                                ? dict.settings.browserSection.detectedUnconfiguredBadge
                                : dict.settings.browserSection.notDetectedBadge}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[var(--text-secondary)]">
                          {dict.settings.browserSection.extensionIdLabel}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <code className="font-mono-tabular text-[11px] px-2 py-0.5 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                            {browserStatus.extensionId}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              void tauriClient.clipboardCopySecret(
                                browserStatus.extensionId,
                                dict.settings.browserSection.extensionIdLabel,
                                false,
                              );
                              setCopiedExtId(true);
                              setTimeout(() => setCopiedExtId(false), 1500);
                            }}
                            aria-label={dict.common.copy}
                            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                          >
                            {copiedExtId ? (
                              <Check size={12} className="text-[var(--status-success)]" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </div>
                      {browserStatus.extensionDir && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] text-[var(--text-secondary)] shrink-0">
                            {dict.settings.browserSection.extensionDirLabel}
                          </span>
                          <span className="font-mono-tabular text-[10.5px] text-[var(--text-muted)] truncate">
                            {browserStatus.extensionDir}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-1.5">
                  <div className="font-semibold text-[var(--text-primary)]">
                    {dict.settings.browserSection.stepsTitle}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {dict.settings.browserSection.step1}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {dict.settings.browserSection.step2}
                  </div>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBrowserBusy(true);
                    try {
                      const res = await tauriClient.browserIntegrationConfigure(extraExtId);
                      setBrowserStatus(res);
                      showToast({
                        label: dict.settings.tabs.browser,
                        text: dict.settings.browserSection.configuredToast,
                        kind: 'info',
                      });
                    } finally {
                      setBrowserBusy(false);
                    }
                  }}
                  className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2"
                >
                  <label
                    htmlFor="extra-browser-ext-id"
                    className="text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    {dict.settings.browserSection.customIdTitle}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="extra-browser-ext-id"
                      type="text"
                      value={extraExtId}
                      onChange={(e) => setExtraExtId(e.target.value)}
                      placeholder={dict.settings.browserSection.customIdPlaceholder}
                      className="ks-input flex-1 font-mono-tabular border-[var(--border-strong)]"
                    />
                    <button
                      type="submit"
                      disabled={browserBusy || !extraExtId.trim()}
                      className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] disabled:opacity-45 border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                    >
                      {dict.settings.browserSection.applyExtraBtn}
                    </button>
                  </div>
                </form>

                {/* Auto-copy 2FA on autofill */}
                <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{dict.settings.autoCopyTotpTitle}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.autoCopyTotpDesc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={appSettings.autoCopyTotpOnFill ?? true}
                    onChange={(e) => void updateAppSettings({ autoCopyTotpOnFill: e.target.checked })}
                    className="ks-checkbox"
                  />
                </label>

                {/* Masked Email Generator Settings */}
                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2.5">
                  <div className="flex items-start gap-2">
                    <Mail size={15} className="text-[var(--accent-primary)] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">{dict.settings.maskedEmailTitle}</div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.maskedEmailDesc}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      aria-label={dict.settings.maskedEmailProviderLabel}
                      value={maskedProvider}
                      onChange={(e) => setMaskedProvider(e.target.value as MaskedEmailProvider)}
                      className="ks-select w-full"
                    >
                      <option value="catch_all">Catch-All (@domain)</option>
                      <option value="simple_login">SimpleLogin</option>
                      <option value="addy_io">addy.io (AnonAddy)</option>
                      <option value="fastmail">Fastmail Masked Email</option>
                      <option value="duck_duck_go">DuckDuckGo (@duck.com)</option>
                    </select>
                    <input
                      type="text"
                      value={maskedDomain}
                      onChange={(e) => setMaskedDomain(e.target.value)}
                      placeholder={dict.settings.maskedEmailDomainPlaceholder}
                      className="ks-input w-full border-[var(--border-strong)] font-mono-tabular"
                    />
                  </div>
                  {maskedProvider !== 'catch_all' && (
                    <input
                      type="password"
                      value={maskedApiKey}
                      onChange={(e) => setMaskedApiKey(e.target.value)}
                      placeholder={dict.settings.maskedEmailApiKeyPlaceholder}
                      className="ks-input w-full border-[var(--border-strong)] font-mono-tabular"
                    />
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={maskedBusy}
                      onClick={async () => {
                        setMaskedBusy(true);
                        try {
                          await updateAppSettings({
                            maskedEmail: {
                              provider: maskedProvider,
                              domain: maskedDomain.trim(),
                              apiKey: maskedApiKey.trim(),
                            },
                          });
                          const alias = await tauriClient.generatorGenerateMaskedEmail('example.com');
                          await tauriClient.clipboardCopySecret(alias, 'Masked Email', false);
                          showToast({
                            label: dict.settings.maskedEmailTitle,
                            text: alias,
                            kind: 'info',
                          });
                        } catch (err) {
                          showToast({
                            label: dict.settings.maskedEmailTitle,
                            text: err instanceof Error ? err.message : String(err),
                            kind: 'warning',
                          });
                        } finally {
                          setMaskedBusy(false);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] cursor-pointer"
                    >
                      {dict.settings.maskedEmailTestBtn}
                    </button>
                    <button
                      type="button"
                      disabled={maskedBusy}
                      onClick={async () => {
                        await updateAppSettings({
                          maskedEmail: {
                            provider: maskedProvider,
                            domain: maskedDomain.trim(),
                            apiKey: maskedApiKey.trim(),
                          },
                        });
                        showToast({
                          label: dict.settings.maskedEmailTitle,
                          text: dict.common.save,
                          kind: 'info',
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium cursor-pointer"
                    >
                      {dict.settings.maskedEmailSaveBtn}
                    </button>
                  </div>
                </div>

                {/* Equivalent Domains & Disabled Autofill Domains */}
                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">{dict.settings.equivDomainsTitle}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.equivDomainsDesc}</div>
                    <textarea
                      rows={3}
                      value={equivDomainsDraft}
                      onChange={(e) => setEquivDomainsDraft(e.target.value)}
                      placeholder="example.com, example.net&#10;mycorp.io, mycorp-internal.com"
                      className="mt-1.5 w-full rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] px-2.5 py-2 font-mono-tabular text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">{dict.settings.disabledDomainsTitle}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{dict.settings.disabledDomainsDesc}</div>
                    <textarea
                      rows={2}
                      value={disabledDomainsDraft}
                      onChange={(e) => setDisabledDomainsDraft(e.target.value)}
                      placeholder="localhost&#10;internal.admin.local"
                      className="mt-1.5 w-full rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] px-2.5 py-2 font-mono-tabular text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        const customEquivalentDomains = equivDomainsDraft
                          .split('\n')
                          .map((line) =>
                            line
                              .split(',')
                              .map((d) => d.trim().toLowerCase())
                              .filter(Boolean),
                          )
                          .filter((group) => group.length >= 2);
                        const disabledAutofillDomains = disabledDomainsDraft
                          .split(/[\n,]+/)
                          .map((d) => d.trim().toLowerCase())
                          .filter(Boolean);
                        await updateAppSettings({
                          customEquivalentDomains,
                          disabledAutofillDomains,
                        });
                        showToast({
                          label: dict.settings.tabs.browser,
                          text: dict.common.save,
                          kind: 'info',
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium cursor-pointer"
                    >
                      {dict.settings.saveRulesBtn}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'import_export' && (
              <div className="flex flex-col gap-4 text-[13px]">
                <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <ArrowDownToLine size={15} className="text-[var(--accent-primary)]" />
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">{dict.settings.importTitle}</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <select
                      value={importFormat}
                      onChange={(e) => setImportFormat(e.target.value as ImportFormat)}
                      className="ks-select w-full"
                    >
                      <option value="keysmith_encrypted_json">{dict.settings.encryptedJson}</option>
                      <option value="1pux">1Password (.1pux)</option>
                      <option value="bitwarden_json">Bitwarden / Vaultwarden JSON</option>
                      <option value="bitwarden_csv">Bitwarden CSV</option>
                      <option value="chrome_csv">Chrome / Safari CSV</option>
                    </select>

                    <select
                      value={importTargetVaultId}
                      onChange={(e) => setImportTargetVaultId(e.target.value)}
                      className="ks-select w-full"
                    >
                      <option value="">{dict.common.defaultTag}</option>
                      {vaults
                        .filter((v) => !v.isOrganization)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  {importFormat === 'keysmith_encrypted_json' && (
                    <input
                      type="password"
                      value={importPassphrase}
                      onChange={(e) => setImportPassphrase(e.target.value)}
                      placeholder={dict.settings.importPassphrasePlaceholder}
                      className="ks-input w-full border-[var(--border-strong)] font-mono-tabular"
                    />
                  )}

                  <div className="flex justify-end">
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-[13px] font-medium cursor-pointer shrink-0">
                      <ArrowDownToLine size={14} />
                      <span>{importing ? dict.settings.importing : dict.settings.selectFile}</span>
                      <input
                        type="file"
                        accept=".1pux,.json,.csv"
                        disabled={importing}
                        onChange={(e) => void handleImportFile(e)}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {importResult && (
                    <div className="p-2.5 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-xs">
                      {fmt(dict.settings.importSummary, {
                        vaults: importResult.importedVaults,
                        items: importResult.importedItems,
                        skipped: importResult.skippedItems,
                      })}
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(e) => void handleExportSubmit(e)}
                  className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3"
                >
                  <div className="flex items-center gap-2">
                    <ArrowUpFromLine size={15} className="text-[var(--accent-primary)]" />
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">{dict.settings.exportTitle}</h2>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <select
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                      className="ks-select w-full"
                    >
                      <option value="keysmith_encrypted_json">{dict.settings.encryptedJson}</option>
                      <option value="bitwarden_json">{dict.settings.bwJson}</option>
                      <option value="csv">{dict.settings.csvPlain}</option>
                    </select>

                    <input
                      type="password"
                      required
                      value={exportMasterPw}
                      onChange={(e) => setExportMasterPw(e.target.value)}
                      placeholder={dict.auth.masterPassword}
                      className="ks-input w-full border-[var(--border-strong)] font-mono-tabular"
                    />
                  </div>

                  {exportFormat === 'keysmith_encrypted_json' && (
                    <input
                      type="password"
                      value={exportPassphrase}
                      onChange={(e) => setExportPassphrase(e.target.value)}
                      placeholder={dict.settings.optionalPassphrase}
                      className="ks-input w-full border-[var(--border-strong)] font-mono-tabular"
                    />
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={exporting || !exportMasterPw}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] disabled:opacity-50 border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                    >
                      <ArrowUpFromLine size={14} />
                      {exporting ? dict.settings.exporting : dict.settings.exportBtn}
                    </button>
                  </div>
                </form>

                {/* Local Encrypted Snapshots */}
                <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <History size={15} className="text-[var(--accent-primary)] shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                          {dict.settings.snapshotsTitle}
                        </h2>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                          {dict.settings.snapshotsDesc}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={snapshotBusy}
                      onClick={async () => {
                        setSnapshotBusy(true);
                        try {
                          await tauriClient.snapshotCreate();
                          const list = await tauriClient.snapshotList();
                          setSnapshots(list);
                          showToast({
                            label: dict.settings.snapshotsTitle,
                            text: dict.settings.snapshotCreateBtn,
                            kind: 'info',
                          });
                        } catch (err) {
                          showToast({
                            label: dict.settings.snapshotsTitle,
                            text: err instanceof Error ? err.message : String(err),
                            kind: 'warning',
                          });
                        } finally {
                          setSnapshotBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-xs font-medium cursor-pointer shrink-0"
                    >
                      <Plus size={13} />
                      {dict.settings.snapshotCreateBtn}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-[var(--text-secondary)]">
                      {dict.settings.snapshotIntervalLabel}
                    </span>
                    <select
                      value={appSettings.snapshotIntervalDays ?? 1}
                      onChange={(e) =>
                        void updateAppSettings({ snapshotIntervalDays: Number(e.target.value) })
                      }
                      className="ks-select min-w-[140px]"
                    >
                      <option value={0}>{dict.settings.never}</option>
                      <option value={1}>{dict.settings.days1}</option>
                      <option value={7}>{dict.settings.days7}</option>
                    </select>
                  </div>

                  {snapshots.length === 0 ? (
                    <div className="p-3 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-xs text-center text-[var(--text-muted)]">
                      {dict.settings.snapshotEmpty}
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--border-subtle)] rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)]">
                      {snapshots.map((snap) => (
                        <div
                          key={snap.id}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[var(--text-primary)] truncate">
                              {formatDateTime(snap.createdAt)}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular">
                              {snap.vaultCount} vaults · {snap.itemCount} items ·{' '}
                              {Math.max(1, Math.round(snap.sizeBytes / 1024))} KB
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={snapshotBusy}
                              onClick={async () => {
                                setSnapshotBusy(true);
                                try {
                                  const res = await tauriClient.snapshotRestore(snap.id);
                                  await refreshAll(getFilter());
                                  showToast({
                                    label: dict.settings.snapshotsTitle,
                                    text: fmt(dict.settings.importSummary, {
                                      vaults: res.importedVaults,
                                      items: res.importedItems,
                                      skipped: res.skippedItems,
                                    }),
                                    kind: 'info',
                                  });
                                } catch (err) {
                                  showToast({
                                    label: dict.settings.snapshotsTitle,
                                    text: err instanceof Error ? err.message : String(err),
                                    kind: 'warning',
                                  });
                                } finally {
                                  setSnapshotBusy(false);
                                }
                              }}
                              className="px-2.5 py-1 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[11px] font-medium text-[var(--text-primary)] cursor-pointer"
                            >
                              {dict.settings.snapshotRestoreBtn}
                            </button>
                            <button
                              type="button"
                              disabled={snapshotBusy}
                              onClick={async () => {
                                await tauriClient.snapshotDelete(snap.id);
                                setSnapshots((prev) => prev.filter((x) => x.id !== snap.id));
                              }}
                              aria-label={dict.common.delete}
                              className="p-1.5 rounded-md hover:bg-[var(--status-danger)]/10 text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'sync' && (() => {
              const syncMode: SyncMode = appSettings.syncMode ?? 'auto';
              const channelLabel =
                syncMode === 'manual'
                  ? dict.settings.syncChannelPaused
                  : syncStatus.signalrConnected
                    ? dict.settings.syncChannelLive
                    : dict.settings.syncChannelPolling;
              const channelHealthy = syncMode !== 'manual';

              return (
              <div className="flex flex-col gap-3.5 text-[13px]">
                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">{dict.settings.currentAccount}</span>
                    <span className="font-medium text-[var(--text-primary)]">{email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">{dict.settings.serverAddress}</span>
                    <span className="font-mono-tabular text-[var(--text-primary)]">{serverUrl}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">{dict.settings.kdfLabel}</span>
                    <span className="font-mono-tabular text-[var(--text-primary)]">{kdfType}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">{dict.settings.pendingChanges}</span>
                    <span
                      className={`font-mono-tabular ${
                        syncStatus.pendingCount > 0
                          ? 'text-[var(--status-warning)] font-medium'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {fmt(dict.settings.pendingCount, { count: syncStatus.pendingCount })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">{dict.settings.realtimeSync}</span>
                    <span
                      className={`inline-flex items-center gap-1.5 font-medium ${
                        channelHealthy ? 'text-[var(--status-success)]' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          channelHealthy ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'
                        }`}
                      />
                      {channelLabel}
                    </span>
                  </div>
                  {syncStatus.message ? (
                    <div
                      className={`mt-1 rounded-lg px-2.5 py-2 text-[11.5px] leading-relaxed break-all ${
                        syncStatus.state === 'error'
                          ? 'bg-[var(--status-danger)]/10 text-[var(--status-danger)] border border-[var(--status-danger)]/25'
                          : 'bg-[var(--status-warning)]/10 text-[var(--status-warning)] border border-[var(--status-warning)]/25'
                      }`}
                    >
                      {syncStatus.message}
                    </div>
                  ) : null}
                </div>

                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--text-primary)]">{dict.settings.syncModeLabel}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                      {syncMode === 'auto' ? dict.settings.syncModeAutoDesc : dict.settings.syncModeManualDesc}
                    </div>
                  </div>
                  <select
                    value={syncMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as SyncMode;
                      void updateAppSettings({ syncMode: nextMode });
                    }}
                    className="ks-input border-[var(--border-strong)] text-xs shrink-0"
                  >
                    <option value="auto">{dict.settings.syncModeAuto}</option>
                    <option value="manual">{dict.settings.syncModeManual}</option>
                  </select>
                </div>

                <form
                  onSubmit={(e) => void handleProfileSave(e)}
                  className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-end justify-between gap-3"
                >
                  <div className="flex-1">
                    <label htmlFor="sync-profile-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      {dict.auth.displayName}
                    </label>
                    <input
                      id="sync-profile-name"
                      type="text"
                      value={profileNameDraft}
                      onChange={(e) => setProfileNameDraft(e.target.value)}
                      className="ks-input w-full border-[var(--border-strong)]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="min-h-[34px] px-3.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                  >
                    {dict.common.save}
                  </button>
                </form>

                {accounts.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {fmt(dict.settings.cachedAccounts, { count: accounts.length })}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          startAddingAccount();
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
                      >
                        <UserPlus size={13} />
                        {dict.settings.addAccountBtn}
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {accounts.map((acct) => (
                        <div
                          key={acct.id}
                          className="px-3 py-2 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[var(--text-primary)] truncate">{acct.email}</div>
                            <div className="text-xs text-[var(--text-muted)] truncate">{acct.serverUrl}</div>
                          </div>
                          {acct.isActive ? (
                            <span className="px-2.5 py-0.5 rounded-full bg-[var(--bg-selected)] text-[var(--accent-primary)] text-xs font-medium shrink-0">
                              {dict.settings.currentActive}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSettingsOpen(false);
                                void switchAccount(acct.id);
                              }}
                              className="px-3 py-1.5 rounded-md border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                            >
                              {dict.settings.switchBtn}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--text-primary)]">{dict.settings.appVersion}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5 flex flex-wrap items-center gap-2">
                      <span>{updateInfo ? `v${updateInfo.currentVersion}` : 'v0.1.4'}</span>
                      {updateInfo?.updateAvailable && updateInfo.latestVersion && (
                        <span className="px-2 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent-primary)] font-medium">
                          {fmt(dict.settings.newVersionAvailable, { version: updateInfo.latestVersion })}
                        </span>
                      )}
                    </div>
                    {updateInfo?.updateAvailable && updateInfo.notes && (
                      <div className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                        {updateInfo.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {updateInfo?.updateAvailable && updateInfo.releaseUrl && (
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(updateInfo.releaseUrl!)}
                        className="px-3 py-2 rounded-lg bg-[var(--accent-primary)] text-white text-xs font-medium cursor-pointer"
                      >
                        {dict.settings.download}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={checkingUpdate}
                      onClick={() => void handleCheckUpdate()}
                      className="px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
                    >
                      {checkingUpdate ? dict.settings.checkingUpdate : dict.settings.checkUpdate}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      await syncNow(getFilter());
                      showToast({ label: dict.settings.syncNowBtn, text: dict.sidebar.syncing, kind: 'info' });
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[13px] font-medium text-white cursor-pointer"
                  >
                    <RefreshCw size={14} />
                    {dict.settings.syncNowBtn} ({formatShortcutMac(shortcuts.syncVault)})
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      void logout(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--status-danger)]/40 text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 text-[13px] font-medium cursor-pointer"
                  >
                    <LogOut size={14} />
                    {dict.settings.logoutRemoveBtn}
                  </button>
                </div>
              </div>
              );
            })()}

            {tab === 'shortcuts' && (
              <div className="flex flex-col gap-3 text-xs" onKeyDown={handleShortcutKeyDown}>
                <div className="p-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">
                        {dict.settings.shortcutsGlobalTitle}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                        {dict.settings.shortcutsGlobalDesc}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShortcutFeedback(null);
                        setRecordingTarget((cur) => (cur === 'global' ? null : 'global'));
                      }}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono-tabular cursor-pointer shrink-0 ${
                        recordingTarget === 'global'
                          ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                          : 'bg-[var(--bg-input)] border-[var(--border-strong)] text-[var(--text-primary)]'
                      }`}
                    >
                      {recordingTarget === 'global'
                        ? dict.settings.shortcutsPressKeys
                        : formatShortcutMac(quickAccessShortcut)}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_ACCESS_SHORTCUT_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setRecordingTarget(null);
                          void applyGlobalShortcut(preset);
                        }}
                        className={`px-2 py-1 rounded-md text-[11px] border font-mono-tabular cursor-pointer ${
                          quickAccessShortcut === preset
                            ? 'bg-[var(--bg-selected)] border-[var(--accent-primary)] text-[var(--accent-primary)] font-medium'
                            : 'bg-[var(--bg-detail)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {formatShortcutMac(preset)}
                        {preset === DEFAULT_GLOBAL_QUICK_ACCESS_SHORTCUT ? ` (${dict.common.defaultTag})` : ''}
                      </button>
                    ))}
                  </div>
                </div>

                {shortcutFeedback && (
                  <div className="px-3 py-2 rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/25 text-[11px] text-[var(--status-danger)]">
                    {shortcutFeedback}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {dict.settings.shortcutsInAppTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRecordingTarget(null);
                      setShortcutFeedback(null);
                      resetAllShortcuts();
                      if (quickAccessShortcut !== DEFAULT_GLOBAL_QUICK_ACCESS_SHORTCUT) {
                        void applyGlobalShortcut(DEFAULT_GLOBAL_QUICK_ACCESS_SHORTCUT);
                      }
                      showToast({
                        label: dict.settings.tabs.shortcuts,
                        text: dict.settings.shortcutsResetAll,
                        kind: 'info',
                      });
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <RotateCcw size={11} />
                    {dict.settings.shortcutsResetAll}
                  </button>
                </div>

                <div className="rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {SHORTCUT_ACTION_ORDER.map((action) => {
                    const isRec = recordingTarget === action;
                    const currentCombo = shortcuts[action];
                    const isCustom = currentCombo !== DEFAULT_SHORTCUTS[action];
                    return (
                      <div key={action} className="px-3.5 py-2 flex items-center justify-between gap-2">
                        <span className="text-[var(--text-primary)]">
                          {dict.settings.shortcutsActions[action]}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isCustom && (
                            <button
                              type="button"
                              title={dict.common.resetDefault}
                              aria-label={dict.common.resetDefault}
                              onClick={() => {
                                setShortcutFeedback(null);
                                setShortcutAction(action, DEFAULT_SHORTCUTS[action]);
                              }}
                              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                              <RotateCcw size={11} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setShortcutFeedback(null);
                              setRecordingTarget((cur) => (cur === action ? null : action));
                            }}
                            className={`px-2 py-1 rounded-md border font-mono-tabular text-[11px] min-w-[76px] text-center cursor-pointer transition-colors ${
                              isRec
                                ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                                : 'bg-[var(--bg-detail)] hover:bg-[var(--bg-hover)] border-[var(--border-strong)] text-[var(--text-primary)]'
                            }`}
                          >
                            {isRec ? dict.settings.shortcutsPressKeys : formatShortcutMac(currentCombo)}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === 'about' && <AboutContent />}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
