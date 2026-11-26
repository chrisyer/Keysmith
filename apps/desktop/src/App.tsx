import { AlertCircle, KeyRound, Plus, RefreshCw } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { LargeTypeModal } from './components/LargeTypeModal';
import { PaneResizer } from './components/PaneResizer';
import { ToastRegion } from './components/ToastRegion';
import { AuthScreen } from './features/auth/AuthScreen';
import { LockScreen } from './features/auth/LockScreen';
import { ItemDetailPane } from './features/detail/ItemDetailPane';
import { ItemEditorPane } from './features/detail/ItemEditorPane';
import { ItemList } from './features/list/ItemList';
import { GeneratorModal } from './features/modals/GeneratorModal';
import { AboutModal } from './features/modals/AboutModal';
import { NewItemModal } from './features/modals/NewItemModal';
import { QuickAccessModal } from './features/modals/QuickAccessModal';
import { VaultModal } from './features/modals/VaultModal';
import { Sidebar } from './features/sidebar/Sidebar';
import { useActivityTracker } from './hooks/useActivityTracker';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { getDictionary, resolveLocale, useI18n } from './i18n';
import { isTauriRuntime, tauriClient } from './services/tauriClient';
import { createEmptyDraft } from './services/templates';
import { useSessionStore } from './stores/sessionStore';
import { useUiStore } from './stores/uiStore';
import { useVaultStore } from './stores/vaultStore';
import { formatShortcutMac } from './utils/shortcuts';
import { applyThemeMode, subscribeThemeChanges } from './utils/theme';
import { ensurePopoverPolyfill } from './utils/topLayer';

const SettingsModal = lazy(() =>
  import('./features/modals/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const SendWorkspace = lazy(() =>
  import('./features/send/SendWorkspace').then((m) => ({ default: m.SendWorkspace })),
);
const WatchtowerDashboard = lazy(() =>
  import('./features/watchtower/WatchtowerDashboard').then((m) => ({ default: m.WatchtowerDashboard })),
);
const GeneratorWindow = lazy(() =>
  import('./features/windows/GeneratorWindow').then((m) => ({ default: m.GeneratorWindow })),
);
const LargeTypeWindow = lazy(() =>
  import('./features/windows/LargeTypeWindow').then((m) => ({ default: m.LargeTypeWindow })),
);
const QuickAccessWindow = lazy(() =>
  import('./features/windows/QuickAccessWindow').then((m) => ({ default: m.QuickAccessWindow })),
);

function MainWorkspaceApp() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { dict } = useI18n();

  const authStatus = useSessionStore((s) => s.status);
  const addingAccount = useSessionStore((s) => s.addingAccount);
  const initialized = useSessionStore((s) => s.initialized);
  const initError = useSessionStore((s) => s.initError);
  const vibrancyEnabled = useSessionStore((s) => s.vibrancyEnabled);
  const initSession = useSessionStore((s) => s.init);
  const retryInit = useSessionStore((s) => s.retryInit);
  const setAuthStatus = useSessionStore((s) => s.setAuthStatus);

  const isMacDesktop =
    isTauriRuntime() &&
    typeof navigator !== 'undefined' &&
    /Mac/i.test(navigator.platform || navigator.userAgent);

  const vaults = useVaultStore((s) => s.vaults);
  const activeItem = useVaultStore((s) => s.activeItem);
  const refreshAll = useVaultStore((s) => s.refreshAll);
  const refreshItems = useVaultStore((s) => s.refreshItems);
  const selectItem = useVaultStore((s) => s.selectItem);
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
  const shortcuts = useUiStore((s) => s.shortcuts);

  const getFilter = useUiStore((s) => s.getFilter);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const setListWidth = useUiStore((s) => s.setListWidth);
  const setSystemPrefersDark = useUiStore((s) => s.setSystemPrefersDark);
  const setThemeMode = useUiStore((s) => s.setThemeMode);
  const setLanguageMode = useUiStore((s) => s.setLanguageMode);
  const setShortcutsFromStorage = useUiStore((s) => s.setShortcutsFromStorage);
  const setNewItemOpen = useUiStore((s) => s.setNewItemOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const setViewAll = useUiStore((s) => s.setViewAll);
  const stopEditing = useUiStore((s) => s.stopEditing);
  const showToast = useUiStore((s) => s.showToast);
  const setClipboardCountdown = useUiStore((s) => s.setClipboardCountdown);
  const resetSensitiveUiOnLock = useUiStore((s) => s.resetSensitiveUiOnLock);

  useKeyboardShortcuts(searchInputRef);
  useActivityTracker();

  useEffect(() => {
    ensurePopoverPolyfill();
    void initSession().then(() => {
      if (isTauriRuntime()) {
        void tauriClient.windowMainReady();
      }
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
      const currentDict = getDictionary(resolveLocale(useUiStore.getState().languageMode));
      showToast({
        label,
        text: currentDict.app.clipboardClearedToast.replace('{label}', label),
        kind: 'info',
      });
    });

    const unsubQuickAccess = tauriClient.onEvent('ui:toggle_quick_access', () => {
      if (useSessionStore.getState().status !== 'Unlocked') return;
      const ui = useUiStore.getState();
      ui.setQuickAccessOpen(!ui.quickAccessOpen);
    });

    const unsubFocusItem = tauriClient.onEvent('ui:focus_item', (payload) => {
      if (useSessionStore.getState().status !== 'Unlocked') return;
      const itemId = typeof payload === 'string' ? payload : payload?.itemId;
      if (!itemId) return;
      setViewAll();
      stopEditing();
      void selectItem(itemId);
    });

    const unsubDataChanged = tauriClient.onEvent('sync:data_changed', () => {
      if (!isTauriRuntime() || useSessionStore.getState().status !== 'Unlocked') return;
      void refreshAll(useUiStore.getState().getFilter());
    });

    const unsubSettings = tauriClient.onEvent('ui:settings_changed', (settings) => {
      if (settings.language) setLanguageMode(settings.language, false);
      if (settings.theme) setThemeMode(settings.theme, false);
      if (settings.customShortcuts) setShortcutsFromStorage(settings.customShortcuts);
    });

    const unsubOpenAbout = tauriClient.onEvent('ui:open_about', (payload) => {
      setAboutOpen(true, Boolean(payload?.checkUpdates));
    });

    const unsubOpenSettings = tauriClient.onEvent('ui:open_settings', () => {
      if (useSessionStore.getState().status !== 'Unlocked') return;
      setSettingsOpen(true);
    });

    const unsubNewItem = tauriClient.onEvent('ui:new_item', () => {
      if (useSessionStore.getState().status !== 'Unlocked') return;
      setNewItemOpen(true);
    });

    const unsubFocusSearch = tauriClient.onEvent('ui:focus_search', () => {
      if (useSessionStore.getState().status !== 'Unlocked') return;
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    const unsubSyncVault = tauriClient.onEvent('ui:sync_vault', () => {
      if (useSessionStore.getState().status !== 'Unlocked') return;
      const currentDict = getDictionary(resolveLocale(useUiStore.getState().languageMode));
      void useVaultStore.getState().syncNow(useUiStore.getState().getFilter());
      showToast({
        label: currentDict.sidebar.syncing,
        text: currentDict.sidebar.syncing,
        kind: 'info',
      });
    });

    return () => {
      unsubTheme();
      unsubState();
      unsubSync();
      unsubTick();
      unsubCleared();
      unsubQuickAccess();
      unsubFocusItem();
      unsubDataChanged();
      unsubSettings();
      unsubOpenAbout();
      unsubOpenSettings();
      unsubNewItem();
      unsubFocusSearch();
      unsubSyncVault();
    };
  }, [
    clearOnLock,
    initSession,
    refreshAll,
    resetSensitiveUiOnLock,
    selectItem,
    setAboutOpen,
    setAuthStatus,
    setClipboardCountdown,
    setLanguageMode,
    setNewItemOpen,
    setSettingsOpen,
    setShortcutsFromStorage,
    setSyncStatus,
    setSystemPrefersDark,
    setThemeMode,
    setViewAll,
    showToast,
    stopEditing,
  ]);

  useEffect(() => {
    if (!initialized || !isTauriRuntime()) return;
    void tauriClient.windowSetCompactLock(authStatus === 'Locked' && !addingAccount);
  }, [initialized, authStatus, addingAccount]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const enabled = Boolean(vibrancyEnabled && isMacDesktop);
    document.documentElement.classList.toggle('ks-glass-enabled', enabled);
    return () => {
      document.documentElement.classList.remove('ks-glass-enabled');
    };
  }, [vibrancyEnabled, isMacDesktop]);

  useEffect(() => {
    if (!initialized || authStatus !== 'Unlocked') return;
    void refreshItems(getFilter());
  }, [
    initialized,
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
        archived: activeItem.archived,
        reprompt: activeItem.reprompt,
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
        attachments: activeItem.attachments,
      };
    }
    return null;
  }, [isEditing, creatingDraftCategory, activeVaultId, vaults, activeItem]);

  if (!initialized) {
    return (
      <>
        <div className="h-dvh w-full flex items-center justify-center bg-[var(--bg-sidebar)] text-xs text-[var(--text-muted)]">
          {dict.app.initializing}
        </div>
        <ToastRegion />
      </>
    );
  }

  if (initError) {
    return (
      <>
        <div className="h-dvh w-full flex items-center justify-center bg-[var(--bg-sidebar)] p-6">
          <div className="w-full max-w-[380px] rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-xl p-7 text-center flex flex-col items-center">
            <div className="w-11 h-11 rounded-xl bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/25 flex items-center justify-center text-[var(--status-danger)] mb-4">
              <AlertCircle size={20} />
            </div>
            <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">{dict.app.initFailed}</h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5">{initError}</p>
            <button
              type="button"
              onClick={() => void retryInit()}
              className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
            >
              <RefreshCw size={13} />
              {dict.app.retryInit}
            </button>
          </div>
        </div>
        <ToastRegion />
      </>
    );
  }

  if (addingAccount || authStatus === 'Unauthenticated') {
    return (
      <>
        <AuthScreen />
        <AboutModal />
        <ToastRegion />
      </>
    );
  }

  if (authStatus === 'Locked') {
    return (
      <>
        <LockScreen />
        <AboutModal />
        <ToastRegion />
      </>
    );
  }

  const showWatchtowerOverview =
    activeView === 'watchtower' && !activeWatchtowerFilter && !isEditing;

  return (
    <div
      className={`h-dvh w-screen overflow-y-hidden overflow-x-auto flex text-[var(--text-primary)] ${
        vibrancyEnabled && isMacDesktop ? 'bg-transparent' : 'bg-[var(--bg-detail)]'
      }`}
    >
      {/* Pane 1: Sidebar */}
      <Sidebar />

      <PaneResizer
        ariaLabel={dict.app.resizeSidebarAria}
        onResize={(dx) => setSidebarWidth(sidebarWidth + dx)}
      />

      {activeView === 'send' ? (
        <Suspense fallback={<div className="flex-1 bg-[var(--bg-detail)]" />}>
          <SendWorkspace />
        </Suspense>
      ) : (
        <>
          {/* Pane 2: Item List */}
          <ItemList searchInputRef={searchInputRef} />

          <PaneResizer
            ariaLabel={dict.app.resizeListAria}
            onResize={(dx) => setListWidth(listWidth + dx)}
          />

          {/* Pane 3: Detail / Editor / Watchtower Dashboard */}
          <main className="flex-1 min-w-[340px] h-full overflow-hidden">
            {isEditing && editorDraft ? (
              <ItemEditorPane initialDraft={editorDraft} isNew={Boolean(creatingDraftCategory)} />
            ) : showWatchtowerOverview ? (
              <Suspense fallback={<div className="h-full bg-[var(--bg-detail)]" />}>
                <WatchtowerDashboard />
              </Suspense>
            ) : activeItem ? (
              <ItemDetailPane item={activeItem} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-8 bg-[var(--bg-detail)]">
                <div className="w-12 h-12 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent-primary)] mb-3.5">
                  <KeyRound size={22} />
                </div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {dict.app.emptyTitle}
                </h2>
                <p className="text-[13px] text-[var(--text-secondary)] mt-1 max-w-xs leading-relaxed">
                  {dict.app.emptyHint}
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setNewItemOpen(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[13.5px] font-medium text-white cursor-pointer"
                  >
                    <Plus size={15} />
                    {dict.app.newItemBtn}
                    <span className="opacity-75 font-mono-tabular text-xs ml-0.5">
                      {formatShortcutMac(shortcuts.newItem)}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {/* Modals & Top-Layer Overlays */}
      <LargeTypeModal />
      <GeneratorModal />
      <NewItemModal />
      <QuickAccessModal />
      <Suspense fallback={null}>
        <SettingsModal />
      </Suspense>
      <VaultModal />
      <AboutModal />
      <ToastRegion />
    </div>
  );
}

export function App() {
  const windowKind = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('window');
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (windowKind === 'quick-access' || windowKind === 'large-type' || windowKind === 'generator') {
      document.documentElement.classList.add('ks-floating-window');
      const initialUi = useUiStore.getState();
      applyThemeMode(initialUi.themeMode);
      const unsubTheme = subscribeThemeChanges(
        (dark) => useUiStore.getState().setSystemPrefersDark(dark),
        (mode) => useUiStore.getState().setThemeMode(mode, false),
      );
      void tauriClient
        .appSettingsGet()
        .then((s) => {
          const ui = useUiStore.getState();
          if (s.language) ui.setLanguageMode(s.language, false);
          if (s.theme) ui.setThemeMode(s.theme, false);
        })
        .catch(() => {});
      const unsub = tauriClient.onEvent('ui:settings_changed', (s) => {
        const ui = useUiStore.getState();
        if (s.language) ui.setLanguageMode(s.language, false);
        if (s.theme) ui.setThemeMode(s.theme, false);
      });
      return () => {
        document.documentElement.classList.remove('ks-floating-window');
        unsubTheme();
        unsub();
      };
    }
    return undefined;
  }, [windowKind]);

  if (windowKind === 'large-type') {
    return (
      <>
        <Suspense fallback={null}>
          <LargeTypeWindow />
        </Suspense>
        <ToastRegion />
      </>
    );
  }

  if (windowKind === 'quick-access') {
    return (
      <>
        <Suspense fallback={null}>
          <QuickAccessWindow />
        </Suspense>
        <ToastRegion />
      </>
    );
  }

  if (windowKind === 'generator') {
    return (
      <>
        <Suspense fallback={null}>
          <GeneratorWindow />
        </Suspense>
        <ToastRegion />
      </>
    );
  }

  return <MainWorkspaceApp />;
}

export default App;
