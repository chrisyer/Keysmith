import { create } from 'zustand';
import { tauriClient } from '../services/tauriClient';
import type {
  AccountSummary,
  AppSettings,
  AppSettingsPatch,
  AuthStatus,
  SessionPreferencesPatch,
  SessionState,
} from '../types/domain';
import { useUiStore } from './uiStore';

interface SessionStore extends SessionState {
  initialized: boolean;
  initError: string | null;
  addingAccount: boolean;
  savedAccounts: AccountSummary[];
  appSettings: AppSettings;
  init: () => Promise<void>;
  retryInit: () => Promise<void>;
  refreshSavedAccounts: () => Promise<void>;
  startAddingAccount: () => void;
  cancelAddingAccount: () => void;
  setAuthStatus: (status: AuthStatus) => void;
  login: (params: {
    serverUrl: string;
    email: string;
    masterPassword: string;
    twoFactorCode?: string;
    allowInsecureHttp?: boolean;
  }) => Promise<void>;
  register: (params: {
    serverUrl: string;
    email: string;
    name: string;
    masterPassword: string;
    allowInsecureHttp?: boolean;
  }) => Promise<void>;
  logout: (clearLocalCache?: boolean) => Promise<void>;
  unlockWithPassword: (masterPassword: string) => Promise<void>;
  unlockWithBiometric: () => Promise<void>;
  lock: (reason?: string) => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  updateProfile: (displayName: string) => Promise<{ rpId: string; userId: string; name: string; displayName: string }>;
  updatePreferences: (patch: SessionPreferencesPatch) => Promise<void>;
  updateAppSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  setAppSettings: (settings: AppSettings) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  initialized: false,
  initError: null,
  addingAccount: false,
  savedAccounts: [],
  appSettings: { language: 'system', theme: 'system', customShortcuts: {}, syncMode: 'auto' },
  status: 'Unauthenticated',
  accountId: '',
  email: '',
  displayName: '',
  serverUrl: '',
  biometricEnabled: false,
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
  lastSyncAt: new Date().toISOString(),
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
  sshBiometricConfirm: true,

  init: async () => {
    try {
      const [state, accounts, settings] = await Promise.all([
        tauriClient.sessionGetState(),
        tauriClient.accountList().catch(() => [] as AccountSummary[]),
        tauriClient.appSettingsGet().catch(() => ({
          language: 'system' as const,
          theme: 'system' as const,
          customShortcuts: {},
          syncMode: 'auto' as const,
        })),
      ]);
      const ui = useUiStore.getState();
      if (settings.language) {
        ui.setLanguageMode(settings.language, false);
      }
      if (settings.theme) {
        ui.setThemeMode(settings.theme, false);
      }
      if (settings.customShortcuts && Object.keys(settings.customShortcuts).length > 0) {
        ui.setShortcutsFromStorage(settings.customShortcuts);
      }
      set({
        ...state,
        savedAccounts: accounts,
        appSettings: settings,
        initialized: true,
        initError: null,
      });
    } catch (err) {
      set({
        initialized: true,
        initError: err instanceof Error ? err.message : 'Failed to initialize session',
      });
    }
  },

  retryInit: async () => {
    set({ initialized: false, initError: null });
    await get().init();
  },

  refreshSavedAccounts: async () => {
    const accounts = await tauriClient.accountList().catch(() => [] as AccountSummary[]);
    set({ savedAccounts: accounts });
  },

  startAddingAccount: () => set({ addingAccount: true }),

  cancelAddingAccount: () => set({ addingAccount: false }),

  setAuthStatus: (status) => set({ status }),

  login: async (params) => {
    const next = await tauriClient.authLogin(params);
    const [accounts, settings] = await Promise.all([
      tauriClient.accountList().catch(() => [] as AccountSummary[]),
      tauriClient.appSettingsGet().catch(() => get().appSettings),
    ]);
    set({
      ...next,
      savedAccounts: accounts,
      appSettings: settings,
      addingAccount: false,
      initError: null,
    });
  },

  register: async (params) => {
    const next = await tauriClient.authRegister(params);
    const accounts = await tauriClient.accountList().catch(() => [] as AccountSummary[]);
    set({
      ...next,
      savedAccounts: accounts,
      addingAccount: false,
      initError: null,
    });
  },

  logout: async (clearLocalCache = false) => {
    await tauriClient.authLogout(clearLocalCache);
    const [nextState, accounts] = await Promise.all([
      tauriClient.sessionGetState(),
      tauriClient.accountList().catch(() => [] as AccountSummary[]),
    ]);
    set({ ...nextState, savedAccounts: accounts, addingAccount: false });
  },

  unlockWithPassword: async (masterPassword) => {
    const next = await tauriClient.sessionUnlockPassword(masterPassword);
    set({ ...next, addingAccount: false });
  },

  unlockWithBiometric: async () => {
    const next = await tauriClient.sessionUnlockBiometric();
    set({ ...next, addingAccount: false });
  },

  lock: async (reason = 'manual') => {
    await tauriClient.sessionLock(reason);
    set({ status: 'Locked', addingAccount: false });
  },

  switchAccount: async (accountId) => {
    const next = await tauriClient.accountSwitch(accountId);
    const accounts = await tauriClient.accountList().catch(() => [] as AccountSummary[]);
    set({ ...next, savedAccounts: accounts, addingAccount: false });
  },

  updateProfile: async (displayName) => {
    const res = await tauriClient.accountUpdateProfile(displayName);
    set({ displayName: res.displayName });
    return res;
  },

  updatePreferences: async (patch) => {
    const next = await tauriClient.sessionUpdatePreferences(patch);
    set({ ...next });
  },

  updateAppSettings: async (patch) => {
    const next = await tauriClient.appSettingsUpdate(patch);
    set({ appSettings: next });
    return next;
  },

  setAppSettings: (appSettings) => set({ appSettings }),
}));
