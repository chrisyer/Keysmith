import { KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { LargeTypeModal } from './components/LargeTypeModal';
import { PaneResizer } from './components/PaneResizer';
import { ToastRegion } from './components/ToastRegion';
import { AuthScreen } from './features/auth/AuthScreen';
import { LockScreen } from './features/auth/LockScreen';
import { ItemDetailPane } from './features/detail/ItemDetailPane';
import { ItemEditorPane } from './features/detail/ItemEditorPane';
import { ItemList } from './features/list/ItemList';
import { NewItemModal } from './features/modals/NewItemModal';
import { QuickAccessModal } from './features/modals/QuickAccessModal';
import { SettingsModal } from './features/modals/SettingsModal';
import { VaultModal } from './features/modals/VaultModal';
import { Sidebar } from './features/sidebar/Sidebar';
import { WatchtowerDashboard } from './features/watchtower/WatchtowerDashboard';
import { useActivityTracker } from './hooks/useActivityTracker';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { tauriClient } from './services/tauriClient';
import { createEmptyDraft } from './services/templates';
import { useSessionStore } from './stores/sessionStore';
import { useUiStore } from './stores/uiStore';
import { useVaultStore } from './stores/vaultStore';
import { subscribeThemeChanges } from './utils/theme';
import { ensurePopoverPolyfill } from './utils/topLayer';

export function App() {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const authStatus = useSessionStore((s) => s.status);
  const initSession = useSessionStore((s) => s.init);
  const setAuthStatus = useSessionStore((s) => s.setAuthStatus);

  const vaults = useVaultStore((s) => s.vaults);
  const activeItem = useVaultStore((s) => s.activeItem);
  const refreshAll = useVaultStore((s) => s.refreshAll);
  const refreshItems = useVaultStore((s) => s.refreshItems);
  const setSyncStatus = useVaultStore((s) => s.setSyncStatus);
  const clearOnLock = useVaultStore((s) => s.clearOnLock);

  const activeVaultId = useUiStore((s) => s.activeVaultId);
  const activeView = useUiStore((s) => s.activeView);
  const activeCategory = useUiStore((s) => s.activeCategory);
  const activeTag = useUiStore((s) => s.activeTag);
  const activeWatchtowerFilter = useUiStore((s) => s.activeWatchtowerFilter);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const sortBy = useUiStore((s) => s.sortBy);
  const isEditing = useUiStore((s) => s.isEditing);
  const creatingDraftCategory = useUiStore((s) => s.creatingDraftCategory);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const listWidth = useUiStore((s) => s.listWidth);

  const getFilter = useUiStore((s) => s.getFilter);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const setListWidth = useUiStore((s) => s.setListWidth);
  const setSystemPrefersDark = useUiStore((s) => s.setSystemPrefersDark);
  const setThemeMode = useUiStore((s) => s.setThemeMode);
  const setNewItemOpen = useUiStore((s) => s.setNewItemOpen);
  const showToast = useUiStore((s) => s.showToast);
  const setClipboardCountdown = useUiStore((s) => s.setClipboardCountdown);
  const resetSensitiveUiOnLock = useUiStore((s) => s.resetSensitiveUiOnLock);

  useKeyboardShortcuts(searchInputRef);
  useActivityTracker();

  useEffect(() => {
    ensurePopoverPolyfill();
    void initSession().then(() => {
      if (useSessionStore.getState().status === 'Unlocked') {
        void refreshAll(useUiStore.getState().getFilter());
      }
    });

    const unsubTheme = subscribeThemeChanges(
      (dark) => setSystemPrefersDark(dark),
      (mode) => setThemeMode(mode),
    );

    const unsubState = tauriClient.onEvent('session:state_changed', ({ status }) => {
      setAuthStatus(status);
      if (status !== 'Unlocked') {
        resetSensitiveUiOnLock();
        clearOnLock();
      }
    });

    const unsubSync = tauriClient.onEvent('sync:status', (sync) => {
      setSyncStatus(sync);
    });

    const unsubTick = tauriClient.onEvent('clipboard:tick', (tick) => {
      setClipboardCountdown(tick);
    });

    const unsubCleared = tauriClient.onEvent('clipboard:cleared', ({ label }) => {
      setClipboardCountdown(null);
      showToast({
        label,
        text: `已安全清空剪贴板中的「${label}」`,
        kind: 'info',
      });
    });

    return () => {
      unsubTheme();
      unsubState();
      unsubSync();
      unsubTick();
      unsubCleared();
    };
  }, [
    clearOnLock,
    initSession,
    refreshAll,
    resetSensitiveUiOnLock,
    setAuthStatus,
    setClipboardCountdown,
    setSyncStatus,
    setSystemPrefersDark,
    setThemeMode,
    showToast,
  ]);

  useEffect(() => {
    if (authStatus !== 'Unlocked') return;
    void refreshItems(getFilter());
  }, [
    authStatus,
    activeVaultId,
    activeView,
    activeCategory,
    activeTag,
    activeWatchtowerFilter,
    searchQuery,
    sortBy,
    getFilter,
    refreshItems,
  ]);

  const editorDraft = useMemo(() => {
    if (!isEditing) return null;
    if (creatingDraftCategory) {
      const targetVault = activeVaultId ?? vaults.find((v) => v.isDefault)?.id ?? vaults[0]?.id ?? 'vault-personal';
      return createEmptyDraft(creatingDraftCategory, targetVault);
    }
    if (activeItem) {
      return {
        id: activeItem.id,
        vaultId: activeItem.vaultId,
        title: activeItem.title,
        favorite: activeItem.favorite,
        category: activeItem.category,
        subtitle: activeItem.subtitle,
        icon: activeItem.icon,
        tags: activeItem.tags,
        urls: activeItem.urls,
        sections: activeItem.sections,
        passkeys: activeItem.passkeys,
        notes: activeItem.notes,
        passwordHistory: activeItem.passwordHistory,
        watchtower: activeItem.watchtower,
      };
    }
    return null;
  }, [isEditing, creatingDraftCategory, activeVaultId, vaults, activeItem]);

  if (authStatus === 'Unauthenticated') {
    return (
      <>
        <AuthScreen />
        <ToastRegion />
      </>
    );
  }

  if (authStatus === 'Locked') {
    return (
      <>
        <LockScreen />
        <ToastRegion />
      </>
    );
  }

  const showWatchtowerOverview =
    activeView === 'watchtower' && !activeWatchtowerFilter && !isEditing;

  return (
    <div className="h-dvh w-screen overflow-y-hidden overflow-x-auto flex bg-[var(--bg-detail)] text-[var(--text-primary)]">
      {/* Pane 1: Sidebar */}
      <Sidebar />

      <PaneResizer
        ariaLabel="调整侧边栏宽度"
        onResize={(dx) => setSidebarWidth(sidebarWidth + dx)}
      />

      {/* Pane 2: Item List */}
      <ItemList searchInputRef={searchInputRef} />

      <PaneResizer
        ariaLabel="调整条目列表宽度"
        onResize={(dx) => setListWidth(listWidth + dx)}
      />

      {/* Pane 3: Detail / Editor / Watchtower Dashboard */}
      <main className="flex-1 min-w-[340px] h-full overflow-hidden">
        {isEditing && editorDraft ? (
          <ItemEditorPane initialDraft={editorDraft} isNew={Boolean(creatingDraftCategory)} />
        ) : showWatchtowerOverview ? (
          <WatchtowerDashboard />
        ) : activeItem ? (
          <ItemDetailPane item={activeItem} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 bg-[var(--bg-detail)]">
            <div className="w-14 h-14 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent-primary)] mb-4">
              <KeyRound size={26} />
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              选择或新建一个条目
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-sm leading-relaxed">
              所有条目在内存中零知识解密展示，离开或锁屏立即执行 <code className="font-mono-tabular">zeroize</code> 密钥擦除。
            </p>
            <div className="mt-5 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setNewItemOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
              >
                <Plus size={14} />
                新建条目  ⌘N
              </button>
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <ShieldCheck size={13} className="text-[var(--status-success)]" />
                零知识端到端加密
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Modals & Top-Layer Overlays */}
      <LargeTypeModal />
      <NewItemModal />
      <QuickAccessModal />
      <SettingsModal />
      <VaultModal />
      <ToastRegion />
    </div>
  );
}
export default App;
