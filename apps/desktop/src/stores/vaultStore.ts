import { create } from 'zustand';
import { tauriClient } from '../services/tauriClient';
import type {
  ItemDetail,
  ItemDraft,
  ItemFilter,
  ItemSummary,
  SendItem,
  SyncStatus,
  Vault,
  WatchtowerFlags,
  WatchtowerReport,
} from '../types/domain';

export function countActiveSends(list: SendItem[]): number {
  const now = Date.now();
  return list.filter((item) => {
    if (item.disabled) return false;
    if (item.expirationDate && Date.parse(item.expirationDate) <= now) return false;
    if (item.deletionDate && Date.parse(item.deletionDate) <= now) return false;
    if (item.maxAccessCount !== null && item.accessCount >= item.maxAccessCount) return false;
    return true;
  }).length;
}

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
  archivedCount: number;
  passkeyCount: number;
  trashCount: number;
  sendCount: number;
  categoryCounts: Record<string, number>;
  tagCounts: Array<{ tag: string; count: number }>;

  refreshAll: (filter: ItemFilter) => Promise<void>;
  refreshItems: (filter: ItemFilter) => Promise<void>;
  selectItem: (id: string | null) => Promise<void>;
  createItem: (draft: ItemDraft, filter: ItemFilter) => Promise<ItemDetail>;
  updateItem: (id: string, draft: ItemDraft, filter: ItemFilter) => Promise<ItemDetail>;
  duplicateItem: (id: string, filter: ItemFilter) => Promise<ItemDetail>;
  setItemArchived: (id: string, archived: boolean, filter: ItemFilter) => Promise<ItemDetail>;
  moveItemsToVault: (ids: string[], targetVaultId: string, filter: ItemFilter) => Promise<number>;
  batchTrashItems: (ids: string[], filter: ItemFilter) => Promise<number>;
  batchAddTag: (ids: string[], tag: string, filter: ItemFilter) => Promise<number>;
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
  setSendCount: (count: number) => void;
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
  archivedCount: 0,
  passkeyCount: 0,
  trashCount: 0,
  sendCount: 0,
  categoryCounts: {},
  tagCounts: [],

  refreshAll: async (filter) => {
    const [vaults, items, stats, report, syncStatus, sends] = await Promise.all([
      tauriClient.vaultList(),
      tauriClient.itemList(filter),
      tauriClient.itemGetAllStats(),
      tauriClient.watchtowerScan(false),
      tauriClient.syncGetStatus(),
      tauriClient.sendList().catch(() => []),
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
      archivedCount: stats.archivedCount ?? 0,
      passkeyCount: stats.passkeyCount,
      trashCount: stats.trashCount,
      sendCount: countActiveSends(sends),
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
      archivedCount: stats.archivedCount ?? 0,
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

  duplicateItem: async (id, filter) => {
    const created = await tauriClient.itemDuplicate(id);
    set({ activeItemId: created.id, activeItem: created });
    await get().refreshItems(filter);
    return created;
  },

  setItemArchived: async (id, archived, filter) => {
    const updated = await tauriClient.itemSetArchived(id, archived);
    if (get().activeItemId === id) {
      set({ activeItem: updated });
    }
    await get().refreshItems(filter);
    return updated;
  },

  moveItemsToVault: async (ids, targetVaultId, filter) => {
    const count = await tauriClient.itemMoveVault(ids, targetVaultId);
    await get().refreshItems(filter);
    return count;
  },

  batchTrashItems: async (ids, filter) => {
    const count = await tauriClient.itemBatchTrash(ids);
    const currentId = get().activeItemId;
    if (currentId && ids.includes(currentId)) {
      set({ activeItemId: null, activeItem: null });
    }
    await get().refreshItems(filter);
    return count;
  },

  batchAddTag: async (ids, tag, filter) => {
    const count = await tauriClient.itemBatchAddTag(ids, tag);
    await get().refreshItems(filter);
    return count;
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

  setSendCount: (sendCount) => set({ sendCount }),

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
      archivedCount: 0,
      passkeyCount: 0,
      trashCount: 0,
      sendCount: 0,
      categoryCounts: {},
      tagCounts: [],
    }),
}));
