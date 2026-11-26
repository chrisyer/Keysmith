import { create } from 'zustand';
import { readStoredLanguage, writeStoredLanguage } from '../i18n';
import { isTauriRuntime, tauriClient } from '../services/tauriClient';
import type {
  ItemCategory,
  ItemFilter,
  LanguageMode,
  SortBy,
  WatchtowerIssueType,
} from '../types/domain';
import {
  DEFAULT_SHORTCUTS,
  mergeCustomShortcuts,
  type ShortcutActionId,
  type ShortcutMap,
} from '../utils/shortcuts';
import { applyThemeMode, getSystemPrefersDark, readStoredThemeMode, type ThemeMode } from '../utils/theme';

export type SidebarView =
  | 'all'
  | 'favorites'
  | 'archived'
  | 'passkeys'
  | 'watchtower'
  | 'send'
  | 'category'
  | 'tag'
  | 'trash';

export interface SendPrefillDraft {
  name: string;
  text: string;
}

export interface ToastMessage {
  id: string;
  label: string;
  text: string;
  kind: 'clipboard' | 'info' | 'warning';
}

export interface LargeTypeState {
  label: string;
  value: string;
}

export interface VaultModalState {
  mode: 'create' | 'rename';
  vaultId?: string;
  initialName?: string;
}

interface UiStore {
  activeVaultId: string | null;
  activeView: SidebarView;
  activeCategory: ItemCategory | null;
  activeTag: string | null;
  activeWatchtowerFilter: WatchtowerIssueType | null;
  searchQuery: string;
  sortBy: SortBy;
  isEditing: boolean;
  creatingDraftCategory: ItemCategory | null;

  sidebarWidth: number;
  listWidth: number;
  themeMode: ThemeMode;
  languageMode: LanguageMode;
  shortcuts: ShortcutMap;
  systemPrefersDark: boolean;

  largeType: LargeTypeState | null;
  newItemOpen: boolean;
  settingsOpen: boolean;
  quickAccessOpen: boolean;
  generatorOpen: boolean;
  vaultModal: VaultModalState | null;
  sendPrefill: SendPrefillDraft | null;

  toast: ToastMessage | null;
  clipboardCountdown: { label: string; remainingSeconds: number; totalSeconds: number } | null;
  repromptVerifiedIds: Record<string, boolean>;

  getFilter: () => ItemFilter;
  setActiveVault: (vaultId: string | null) => void;
  setViewAll: () => void;
  setViewFavorites: () => void;
  setViewArchived: () => void;
  setViewPasskeys: () => void;
  setViewWatchtower: () => void;
  setViewSend: () => void;
  setViewCategory: (category: ItemCategory) => void;
  setViewTag: (tag: string) => void;
  setViewTrash: () => void;
  setWatchtowerIssueFilter: (issue: WatchtowerIssueType | null) => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sortBy: SortBy) => void;
  startEditingExisting: () => void;
  startCreatingDraft: (category: ItemCategory) => void;
  stopEditing: () => void;

  setSidebarWidth: (width: number) => void;
  setListWidth: (width: number) => void;
  setThemeMode: (mode: ThemeMode, persistRemote?: boolean) => void;
  setLanguageMode: (mode: LanguageMode, persistRemote?: boolean) => void;
  setShortcutsFromStorage: (custom?: Record<string, string> | null) => void;
  setShortcutAction: (action: ShortcutActionId, combo: string) => void;
  resetAllShortcuts: () => void;
  setSystemPrefersDark: (dark: boolean) => void;

  openLargeType: (label: string, value: string) => void;
  closeLargeType: () => void;
  setNewItemOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setQuickAccessOpen: (open: boolean) => void;
  setGeneratorOpen: (open: boolean) => void;
  setVaultModal: (modal: VaultModalState | null) => void;
  openSendWithPrefill: (prefill: SendPrefillDraft) => void;
  clearSendPrefill: () => void;

  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: () => void;
  setClipboardCountdown: (
    tick: { label: string; remainingSeconds: number; totalSeconds: number } | null,
  ) => void;
  markRepromptVerified: (itemId: string) => void;
  resetSensitiveUiOnLock: () => void;
}

function readNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= min && n <= max) return n;
  } catch {
    // ignore
  }
  return fallback;
}

const SHORTCUTS_STORAGE_KEY = 'keysmith:customShortcuts';

function readStoredShortcuts(): ShortcutMap {
  try {
    const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (raw) {
      return mergeCustomShortcuts(JSON.parse(raw) as Record<string, string>);
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SHORTCUTS };
}

function writeStoredShortcuts(map: ShortcutMap): void {
  try {
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export const useUiStore = create<UiStore>((set, get) => ({
  activeVaultId: null,
  activeView: 'all',
  activeCategory: null,
  activeTag: null,
  activeWatchtowerFilter: null,
  searchQuery: '',
  sortBy: 'title_asc',
  isEditing: false,
  creatingDraftCategory: null,

  sidebarWidth: readNum('keysmith:sidebarWidth', 228, 190, 320),
  listWidth: readNum('keysmith:listWidth', 292, 240, 420),
  themeMode: readStoredThemeMode(),
  languageMode: readStoredLanguage(),
  shortcuts: readStoredShortcuts(),
  systemPrefersDark: getSystemPrefersDark(),

  largeType: null,
  newItemOpen: false,
  settingsOpen: false,
  quickAccessOpen: false,
  generatorOpen: false,
  vaultModal: null,
  sendPrefill: null,

  toast: null,
  clipboardCountdown: null,
  repromptVerifiedIds: {},

  getFilter: () => {
    const s = get();
    return {
      vaultId: s.activeVaultId,
      category: s.activeView === 'category' ? s.activeCategory : null,
      tag: s.activeView === 'tag' ? s.activeTag : null,
      favorite: s.activeView === 'favorites' ? true : undefined,
      archived: s.activeView === 'archived' ? true : undefined,
      passkeyOnly: s.activeView === 'passkeys' ? true : undefined,
      trashed: s.activeView === 'trash',
      watchtowerIssue: s.activeWatchtowerFilter,
      query: s.searchQuery,
      sortBy: s.sortBy,
    };
  },

  setActiveVault: (vaultId) =>
    set({
      activeVaultId: vaultId,
      activeView: get().activeView === 'trash' ? 'all' : get().activeView,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewAll: () =>
    set({
      activeView: 'all',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewFavorites: () =>
    set({
      activeView: 'favorites',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewArchived: () =>
    set({
      activeView: 'archived',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewPasskeys: () =>
    set({
      activeView: 'passkeys',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewWatchtower: () =>
    set({
      activeView: 'watchtower',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewSend: () =>
    set({
      activeView: 'send',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewCategory: (category) =>
    set({
      activeView: 'category',
      activeCategory: category,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewTag: (tag) =>
    set({
      activeView: 'tag',
      activeTag: tag,
      activeCategory: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setViewTrash: () =>
    set({
      activeView: 'trash',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setWatchtowerIssueFilter: (issue) =>
    set({
      activeView: issue ? 'watchtower' : 'watchtower',
      activeWatchtowerFilter: issue,
      isEditing: false,
      creatingDraftCategory: null,
    }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setSortBy: (sortBy) => set({ sortBy }),

  startEditingExisting: () => set({ isEditing: true, creatingDraftCategory: null }),

  startCreatingDraft: (category) =>
    set({
      isEditing: true,
      creatingDraftCategory: category,
      newItemOpen: false,
      activeView: get().activeView === 'watchtower' || get().activeView === 'trash' ? 'all' : get().activeView,
    }),

  stopEditing: () => set({ isEditing: false, creatingDraftCategory: null }),

  setSidebarWidth: (width) => {
    const clamped = Math.min(320, Math.max(190, Math.round(width)));
    try {
      localStorage.setItem('keysmith:sidebarWidth', String(clamped));
    } catch {
      // ignore
    }
    set({ sidebarWidth: clamped });
  },

  setListWidth: (width) => {
    const clamped = Math.min(420, Math.max(240, Math.round(width)));
    try {
      localStorage.setItem('keysmith:listWidth', String(clamped));
    } catch {
      // ignore
    }
    set({ listWidth: clamped });
  },

  setThemeMode: (mode, persistRemote = true) => {
    applyThemeMode(mode);
    set({ themeMode: mode });
    if (persistRemote) {
      void tauriClient.appSettingsUpdate({ theme: mode }).catch(() => {});
    }
  },

  setLanguageMode: (mode, persistRemote = true) => {
    writeStoredLanguage(mode);
    set({ languageMode: mode });
    if (persistRemote) {
      void tauriClient.appSettingsUpdate({ language: mode }).catch(() => {});
    }
  },

  setShortcutsFromStorage: (custom) => {
    const merged = mergeCustomShortcuts(custom);
    writeStoredShortcuts(merged);
    set({ shortcuts: merged });
  },

  setShortcutAction: (action, combo) => {
    const next = { ...get().shortcuts, [action]: combo };
    writeStoredShortcuts(next);
    set({ shortcuts: next });
    void tauriClient.appSettingsUpdate({ customShortcuts: next }).catch(() => {});
  },

  resetAllShortcuts: () => {
    const next = { ...DEFAULT_SHORTCUTS };
    writeStoredShortcuts(next);
    set({ shortcuts: next });
    void tauriClient.appSettingsUpdate({ customShortcuts: {} }).catch(() => {});
  },

  setSystemPrefersDark: (systemPrefersDark) => set({ systemPrefersDark }),

  openLargeType: (label, value) => {
    if (isTauriRuntime()) {
      void tauriClient.windowOpenLargeType(label, value);
      return;
    }
    set({ largeType: { label, value } });
  },
  closeLargeType: () => set({ largeType: null }),
  setNewItemOpen: (newItemOpen) => set({ newItemOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setQuickAccessOpen: (quickAccessOpen) => set({ quickAccessOpen }),
  setGeneratorOpen: (generatorOpen) => set({ generatorOpen }),
  setVaultModal: (vaultModal) => set({ vaultModal }),
  openSendWithPrefill: (sendPrefill) =>
    set({
      activeView: 'send',
      activeCategory: null,
      activeTag: null,
      activeWatchtowerFilter: null,
      isEditing: false,
      creatingDraftCategory: null,
      sendPrefill,
    }),
  clearSendPrefill: () => set({ sendPrefill: null }),

  showToast: (toast) => set({ toast: { ...toast, id: String(Date.now()) } }),
  dismissToast: () => set({ toast: null }),
  setClipboardCountdown: (clipboardCountdown) => set({ clipboardCountdown }),
  markRepromptVerified: (itemId) =>
    set((state) => ({
      repromptVerifiedIds: { ...state.repromptVerifiedIds, [itemId]: true },
    })),

  resetSensitiveUiOnLock: () =>
    set({
      searchQuery: '',
      isEditing: false,
      creatingDraftCategory: null,
      largeType: null,
      newItemOpen: false,
      quickAccessOpen: false,
      generatorOpen: false,
      settingsOpen: false,
      vaultModal: null,
      sendPrefill: null,
      repromptVerifiedIds: {},
    }),
}));
