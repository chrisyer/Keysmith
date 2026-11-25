import { create } from 'zustand';
import { tauriClient } from '../services/tauriClient';
import type {
  ItemDetail,
  ItemDraft,
  ItemFilter,
  ItemSummary,
  SyncStatus,
  Vault,
  WatchtowerFlags,
  WatchtowerReport,
} from '../types/domain';

interface VaultStore {
  vaults: Vault[];
  items: ItemSummary[];
  activeItemId: string | null;
  activeItem: ItemDetail | null;
  syncStatus: SyncStatus;
  watchtowerReport: WatchtowerReport | null;
  hibpScanning: boolean;
  totalCount: number;
  favoriteCount: number;
  passkeyCount: number;
  trashCount: number;
  categoryCounts: Record<string, number>;
  tagCounts: Array<{ tag: string; count: number }>;

  refreshAll: (filter: ItemFilter) => Promise<void>;
  refreshItems: (filter: ItemFilter) => Promise<void>;
  selectItem: (id: string | null) => Promise<void>;
  createItem: (draft: ItemDraft, filter: ItemFilter) => Promise<ItemDetail>;
  updateItem: (id: string, draft: ItemDraft, filter: ItemFilter) => Promise<ItemDetail>;
  trashItem: (id: string, filter: ItemFilter) => Promise<void>;
  restoreItem: (id: string, filter: ItemFilter) => Promise<void>;
  deletePermanent: (id: string, filter: ItemFilter) => Promise<void>;
  toggleFavorite: (id: string, favorite: boolean, filter: ItemFilter) => Promise<void>;
  updateWatchtowerFlags: (id: string, flags: Partial<WatchtowerFlags>, filter: ItemFilter) => Promise<void>;
  syncNow: (filter: ItemFilter) => Promise<void>;
  runHibpScan: (filter: ItemFilter) => Promise<void>;
  createVault: (name: string, color: string) => Promise<Vault>;
  renameVault: (id: string, name: string) => Promise<void>;
  deleteVault: (id: string, filter: ItemFilter) => Promise<void>;
  setSyncStatus: (status: SyncStatus) => void;
  clearOnLock: () => void;
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaults: [],
  items: [],
  activeItemId: null,
  activeItem: null,
  syncStatus: {
    state: 'idle',
    pendingCount: 0,
    lastSyncAt: new Date().toISOString(),
    signalrConnected: true,
  },
  watchtowerReport: null,
  hibpScanning: false,
  totalCount: 0,
  favoriteCount: 0,
  passkeyCount: 0,
  trashCount: 0,
  categoryCounts: {},
  tagCounts: [],

  refreshAll: async (filter) => {
    const [vaults, items, stats, report, syncStatus] = await Promise.all([
      tauriClient.vaultList(),
      tauriClient.itemList(filter),
      tauriClient.itemGetAllStats(),
      tauriClient.watchtowerScan(false),
      tauriClient.syncGetStatus(),
    ]);

    const currentActiveId = get().activeItemId;
    const stillExists = currentActiveId && items.some((i) => i.id === currentActiveId);
    const nextId = stillExists ? currentActiveId : (items[0]?.id ?? null);
    const nextDetail = nextId ? await tauriClient.itemGet(nextId) : null;

    set({
      vaults,
      items,
      activeItemId: nextId,
      activeItem: nextDetail,
      watchtowerReport: report,
      syncStatus,
      totalCount: stats.totalCount,
      favoriteCount: stats.favoriteCount,
      passkeyCount: stats.passkeyCount,
      trashCount: stats.trashCount,
      categoryCounts: stats.categoryCounts,
      tagCounts: stats.tagCounts,
    });
  },

  refreshItems: async (filter) => {
    const [items, stats, report, vaults] = await Promise.all([
      tauriClient.itemList(filter),
      tauriClient.itemGetAllStats(),
      tauriClient.watchtowerScan(false),
      tauriClient.vaultList(),
    ]);
    const currentActiveId = get().activeItemId;
    const stillExists = currentActiveId && items.some((i) => i.id === currentActiveId);
    const nextId = stillExists ? currentActiveId : (items[0]?.id ?? null);
    const nextDetail = nextId ? await tauriClient.itemGet(nextId) : null;

    set({
      vaults,
      items,
      activeItemId: nextId,
      activeItem: nextDetail,
      watchtowerReport: report,
      totalCount: stats.totalCount,
      favoriteCount: stats.favoriteCount,
      passkeyCount: stats.passkeyCount,
      trashCount: stats.trashCount,
      categoryCounts: stats.categoryCounts,
      tagCounts: stats.tagCounts,
    });
  },

  selectItem: async (id) => {
    if (!id) {
      set({ activeItemId: null, activeItem: null });
      return;
    }
    const detail = await tauriClient.itemGet(id);
    set({ activeItemId: id, activeItem: detail });
  },

  createItem: async (draft, filter) => {
    const created = await tauriClient.itemCreate(draft);
    set({ activeItemId: created.id, activeItem: created });
    await get().refreshItems(filter);
    return created;
  },

  updateItem: async (id, draft, filter) => {
    const updated = await tauriClient.itemUpdate(id, draft);
    set({ activeItemId: updated.id, activeItem: updated });
    await get().refreshItems(filter);
    return updated;
  },

  trashItem: async (id, filter) => {
    await tauriClient.itemTrash(id);
    if (get().activeItemId === id) {
      set({ activeItemId: null, activeItem: null });
    }
    await get().refreshItems(filter);
  },

  restoreItem: async (id, filter) => {
    await tauriClient.itemRestore(id);
    await get().refreshItems(filter);
  },

  deletePermanent: async (id, filter) => {
    await tauriClient.itemDeletePermanent(id);
    if (get().activeItemId === id) {
      set({ activeItemId: null, activeItem: null });
    }
    await get().refreshItems(filter);
  },

  toggleFavorite: async (id, favorite, filter) => {
    const updated = await tauriClient.itemToggleFavorite(id, favorite);
    if (get().activeItemId === id) {
      set({ activeItem: updated });
    }
    await get().refreshItems(filter);
  },

  updateWatchtowerFlags: async (id, flags, filter) => {
    const updated = await tauriClient.itemUpdateWatchtowerFlags(id, flags);
    if (get().activeItemId === id) {
      set({ activeItem: updated });
    }
    await get().refreshItems(filter);
  },

  syncNow: async (filter) => {
    await tauriClient.syncNow();
    await get().refreshAll(filter);
  },

  runHibpScan: async (filter) => {
    set({ hibpScanning: true });
    try {
      const report = await tauriClient.watchtowerScan(true);
      const items = await tauriClient.itemList(filter);
      set({ watchtowerReport: report, items, hibpScanning: false });
    } catch {
      set({ hibpScanning: false });
    }
  },

  createVault: async (name, color) => {
    const created = await tauriClient.vaultCreate(name, color);
    const vaults = await tauriClient.vaultList();
    set({ vaults });
    return created;
  },

  renameVault: async (id, name) => {
    await tauriClient.vaultRename(id, name);
    const vaults = await tauriClient.vaultList();
    set({ vaults });
  },

  deleteVault: async (id, filter) => {
    await tauriClient.vaultDelete(id);
    await get().refreshAll(filter);
  },

  setSyncStatus: (syncStatus) => set({ syncStatus }),

  clearOnLock: () =>
    set({
      vaults: [],
      items: [],
      activeItemId: null,
      activeItem: null,
      watchtowerReport: null,
      totalCount: 0,
      favoriteCount: 0,
      passkeyCount: 0,
      trashCount: 0,
      categoryCounts: {},
      tagCounts: [],
    }),
}));
