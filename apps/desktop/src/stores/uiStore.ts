import { create } from 'zustand';
import type {
  ItemCategory,
  ItemFilter,
  SortBy,
  WatchtowerIssueType,
} from '../types/domain';
import { applyThemeMode, getSystemPrefersDark, readStoredThemeMode, type ThemeMode } from '../utils/theme';

export type SidebarView = 'all' | 'favorites' | 'passkeys' | 'watchtower' | 'category' | 'tag' | 'trash';

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
  systemPrefersDark: boolean;

  largeType: LargeTypeState | null;
  newItemOpen: boolean;
  settingsOpen: boolean;
  quickAccessOpen: boolean;
  vaultModal: VaultModalState | null;

  toast: ToastMessage | null;
  clipboardCountdown: { label: string; remainingSeconds: number; totalSeconds: number } | null;

  getFilter: () => ItemFilter;
  setActiveVault: (vaultId: string | null) => void;
  setViewAll: () => void;
  setViewFavorites: () => void;
  setViewPasskeys: () => void;
  setViewWatchtower: () => void;
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
  setThemeMode: (mode: ThemeMode) => void;
  setSystemPrefersDark: (dark: boolean) => void;

  openLargeType: (label: string, value: string) => void;
  closeLargeType: () => void;
  setNewItemOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setQuickAccessOpen: (open: boolean) => void;
  setVaultModal: (modal: VaultModalState | null) => void;

  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: () => void;
  setClipboardCountdown: (
    tick: { label: string; remainingSeconds: number; totalSeconds: number } | null,
  ) => void;
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
  systemPrefersDark: getSystemPrefersDark(),

  largeType: null,
  newItemOpen: false,
  settingsOpen: false,
  quickAccessOpen: false,
  vaultModal: null,

  toast: null,
  clipboardCountdown: null,

  getFilter: () => {
    const s = get();
    return {
      vaultId: s.activeVaultId,
      category: s.activeView === 'category' ? s.activeCategory : null,
      tag: s.activeView === 'tag' ? s.activeTag : null,
      favorite: s.activeView === 'favorites' ? true : undefined,
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

  setThemeMode: (mode) => {
    applyThemeMode(mode);
    set({ themeMode: mode });
  },

  setSystemPrefersDark: (systemPrefersDark) => set({ systemPrefersDark }),

  openLargeType: (label, value) => set({ largeType: { label, value } }),
  closeLargeType: () => set({ largeType: null }),
  setNewItemOpen: (newItemOpen) => set({ newItemOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setQuickAccessOpen: (quickAccessOpen) => set({ quickAccessOpen }),
  setVaultModal: (vaultModal) => set({ vaultModal }),

  showToast: (toast) => set({ toast: { ...toast, id: String(Date.now()) } }),
  dismissToast: () => set({ toast: null }),
  setClipboardCountdown: (clipboardCountdown) => set({ clipboardCountdown }),

  resetSensitiveUiOnLock: () =>
    set({
      searchQuery: '',
      isEditing: false,
      creatingDraftCategory: null,
      largeType: null,
      newItemOpen: false,
      quickAccessOpen: false,
      settingsOpen: false,
      vaultModal: null,
    }),
}));
