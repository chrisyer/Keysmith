import {
  Archive,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Fingerprint,
  FolderLock,
  Hash,
  Layers,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { isTauriRuntime } from '../../services/tauriClient';
import { PHASE1_TEMPLATES, PHASE2_TEMPLATES } from '../../services/templates';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import { formatRelativeTime } from '../../utils/format';
import { formatShortcutMac } from '../../utils/shortcuts';

export function Sidebar() {
  const { dict, fmt } = useI18n();
  const popoverRawId = useId().replace(/:/g, '');
  const vaultPopoverId = `vault-switcher-${popoverRawId}`;
  const vaultAnchorName = `--vault-btn-${popoverRawId}`;
  const vaultPopoverRef = useRef<HTMLDivElement>(null);

  const accountPopoverId = `acct-switcher-${popoverRawId}`;
  const accountAnchorName = `--acct-btn-${popoverRawId}`;
  const accountPopoverRef = useRef<HTMLDivElement>(null);

  const [moreCategoriesOpen, setMoreCategoriesOpen] = useState(false);

  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const activeVaultId = useUiStore((s) => s.activeVaultId);
  const activeView = useUiStore((s) => s.activeView);
  const activeCategory = useUiStore((s) => s.activeCategory);
  const activeTag = useUiStore((s) => s.activeTag);
  const clipboardCountdown = useUiStore((s) => s.clipboardCountdown);
  const shortcuts = useUiStore((s) => s.shortcuts);

  const setActiveVault = useUiStore((s) => s.setActiveVault);
  const setViewAll = useUiStore((s) => s.setViewAll);
  const setViewFavorites = useUiStore((s) => s.setViewFavorites);
  const setViewArchived = useUiStore((s) => s.setViewArchived);
  const setViewPasskeys = useUiStore((s) => s.setViewPasskeys);
  const setViewWatchtower = useUiStore((s) => s.setViewWatchtower);
  const setViewSend = useUiStore((s) => s.setViewSend);
  const setViewCategory = useUiStore((s) => s.setViewCategory);
  const setViewTag = useUiStore((s) => s.setViewTag);
  const setViewTrash = useUiStore((s) => s.setViewTrash);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setVaultModal = useUiStore((s) => s.setVaultModal);
  const getFilter = useUiStore((s) => s.getFilter);
  const showToast = useUiStore((s) => s.showToast);

  const vaults = useVaultStore((s) => s.vaults);
  const totalCount = useVaultStore((s) => s.totalCount);
  const favoriteCount = useVaultStore((s) => s.favoriteCount);
  const archivedCount = useVaultStore((s) => s.archivedCount);
  const passkeyCount = useVaultStore((s) => s.passkeyCount);
  const trashCount = useVaultStore((s) => s.trashCount);
  const sendCount = useVaultStore((s) => s.sendCount);
  const categoryCounts = useVaultStore((s) => s.categoryCounts);
  const tagCounts = useVaultStore((s) => s.tagCounts);
  const watchtowerReport = useVaultStore((s) => s.watchtowerReport);
  const syncStatus = useVaultStore((s) => s.syncStatus);
  const syncNow = useVaultStore((s) => s.syncNow);
  const deleteVault = useVaultStore((s) => s.deleteVault);

  const email = useSessionStore((s) => s.email);
  const displayName = useSessionStore((s) => s.displayName);
  const accountId = useSessionStore((s) => s.accountId);
  const savedAccounts = useSessionStore((s) => s.savedAccounts);
  const vibrancyEnabled = useSessionStore((s) => s.vibrancyEnabled);
  const lock = useSessionStore((s) => s.lock);
  const switchAccount = useSessionStore((s) => s.switchAccount);
  const startAddingAccount = useSessionStore((s) => s.startAddingAccount);
  const refreshSavedAccounts = useSessionStore((s) => s.refreshSavedAccounts);

  const currentVault = vaults.find((v) => v.id === activeVaultId);
  const riskCount = watchtowerReport?.totalRiskItems ?? 0;
  const inTauri = isTauriRuntime();

  useEffect(() => {
    void refreshSavedAccounts();
  }, [accountId, email, refreshSavedAccounts]);

  const avatarInitial = ((displayName || email || 'K').trim()[0] || 'K').toUpperCase();

  const navItemClass = (active: boolean) =>
    `w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
      active
        ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)]'
        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
    }`;

  const renderCategoryRow = (tpl: (typeof PHASE1_TEMPLATES)[number]) => {
    const count = categoryCounts[tpl.category] ?? 0;
    const catLabel = dict.categories[tpl.category] ?? tpl.label;
    return (
      <button
        key={tpl.category}
        type="button"
        onClick={() => setViewCategory(tpl.category)}
        className={navItemClass(activeView === 'category' && activeCategory === tpl.category)}
      >
        <span className="flex items-center gap-2 truncate">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: tpl.color }}
          />
          <span className="truncate">{catLabel}</span>
        </span>
        <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{count}</span>
      </button>
    );
  };

  return (
    <aside
      style={{ width: sidebarWidth }}
      className={`h-full shrink-0 flex flex-col justify-between overflow-hidden ${
        vibrancyEnabled && inTauri
          ? 'bg-[var(--bg-sidebar)]/85 backdrop-blur-xl'
          : 'bg-[var(--bg-sidebar)]'
      }`}
      aria-label="Sidebar"
    >
      {/* Top macOS Titlebar Spacer + Account & Vault Switchers */}
      <div className="flex flex-col">
        {inTauri ? (
          <div data-tauri-drag-region className="h-[38px] w-full shrink-0 select-none" />
        ) : (
          <div className="px-3.5 pt-3 pb-1 flex items-center gap-2 select-none" aria-hidden="true">
            <span className="w-3 h-3 rounded-full bg-[#FF5F57] border border-black/10" />
            <span className="w-3 h-3 rounded-full bg-[#FEBC2E] border border-black/10" />
            <span className="w-3 h-3 rounded-full bg-[#28C840] border border-black/10" />
          </div>
        )}

        <div className="px-2.5 pb-2 flex flex-col gap-1.5">
          {/* Account Switcher Row (Below traffic lights, cleanly proportioned) */}
          <button
            type="button"
            popoverTarget={accountPopoverId}
            style={{ anchorName: accountAnchorName } as React.CSSProperties}
            onClick={() => void refreshSavedAccounts()}
            title={email}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] text-[11px] font-semibold flex items-center justify-center shrink-0">
                {avatarInitial}
              </span>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate leading-tight">
                  {displayName || email}
                </div>
                <div className="text-[10.5px] text-[var(--text-muted)] truncate leading-tight">
                  {email}
                </div>
              </div>
            </div>
            <ChevronsUpDown size={13} className="text-[var(--text-muted)] shrink-0" />
          </button>

          {/* Account Switcher Popover */}
          <div
            ref={accountPopoverRef}
            id={accountPopoverId}
            popover="auto"
            style={{ positionAnchor: accountAnchorName } as React.CSSProperties}
            className="ks-popover ks-anchored-popover w-[240px]"
          >
            <div className="p-1.5 flex flex-col gap-0.5 text-xs">
              <div className="px-2.5 py-1 text-[10px] font-semibold text-[var(--text-muted)]">
                {fmt(dict.sidebar.accountSection, { count: savedAccounts.length || 1 })}
              </div>
              {savedAccounts.map((acct) => (
                <button
                  key={acct.id}
                  type="button"
                  onClick={() => {
                    accountPopoverRef.current?.hidePopover?.();
                    if (!acct.isActive) {
                      void switchAccount(acct.id);
                    }
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--text-primary)] truncate">{acct.email}</div>
                    <div className="text-[10px] text-[var(--text-muted)] truncate">{acct.serverUrl}</div>
                  </div>
                  {acct.isActive && <Check size={13} className="text-[var(--accent-primary)] shrink-0" />}
                </button>
              ))}
              <div className="my-1 border-t border-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  accountPopoverRef.current?.hidePopover?.();
                  startAddingAccount();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--accent-primary)] font-medium cursor-pointer"
              >
                <UserPlus size={13} />
                {dict.sidebar.addAccount}
              </button>
            </div>
          </div>

          {/* Vault Switcher */}
          <button
            type="button"
            popoverTarget={vaultPopoverId}
            style={{ anchorName: vaultAnchorName } as React.CSSProperties}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)]/80 hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-left transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center text-white shrink-0"
                style={{ backgroundColor: currentVault?.color ?? 'var(--accent-primary)' }}
              >
                {currentVault?.isOrganization ? <Building2 size={11} /> : <FolderLock size={11} />}
              </span>
              <span className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                {currentVault ? currentVault.name : dict.sidebar.allVaults}
              </span>
            </span>
            <ChevronsUpDown size={13} className="text-[var(--text-muted)] shrink-0" />
          </button>

          <div
            ref={vaultPopoverRef}
            id={vaultPopoverId}
            popover="auto"
            style={{ positionAnchor: vaultAnchorName } as React.CSSProperties}
            className="ks-popover ks-anchored-popover w-[248px]"
          >
            <div className="p-1.5 flex flex-col gap-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setActiveVault(null);
                  vaultPopoverRef.current?.hidePopover?.();
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Layers size={14} className="text-[var(--accent-primary)]" />
                  {dict.sidebar.allVaults}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  {totalCount}
                  {activeVaultId === null && <Check size={13} className="text-[var(--accent-primary)]" />}
                </span>
              </button>

              <div className="my-1 border-t border-[var(--border-subtle)]" />

              {vaults.map((vault) => (
                <div
                  key={vault.id}
                  className="group flex items-center justify-between rounded-lg hover:bg-[var(--bg-hover)] pr-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveVault(vault.id);
                      vaultPopoverRef.current?.hidePopover?.();
                    }}
                    className="flex-1 flex items-center justify-between px-2.5 py-2 text-left cursor-pointer min-w-0"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: vault.color }}
                      />
                      <span className="truncate font-medium text-[var(--text-primary)]">{vault.name}</span>
                      {vault.isOrganization && (
                        <span className="px-1.5 py-0.2 rounded bg-sky-500/12 text-sky-600 dark:text-sky-400 text-[9px] font-medium shrink-0">
                          {dict.sidebar.orgCollection}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] ml-2">
                      {vault.itemCount}
                      {activeVaultId === vault.id && (
                        <Check size={13} className="text-[var(--accent-primary)]" />
                      )}
                    </span>
                  </button>
                  {!vault.isOrganization && (
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={vault.name}
                        onClick={() => {
                          vaultPopoverRef.current?.hidePopover?.();
                          setVaultModal({ mode: 'rename', vaultId: vault.id, initialName: vault.name });
                        }}
                        className="p-1 rounded hover:bg-[var(--bg-selected)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        <Pencil size={11} />
                      </button>
                      {!vault.isDefault && (
                        <button
                          type="button"
                          aria-label={vault.name}
                          onClick={() => {
                            vaultPopoverRef.current?.hidePopover?.();
                            if (activeVaultId === vault.id) setActiveVault(null);
                            void deleteVault(vault.id, getFilter());
                            showToast({
                              label: 'Vault',
                              text: fmt(dict.sidebar.vaultDeletedToast, { name: vault.name }),
                              kind: 'info',
                            });
                          }}
                          className="p-1 rounded hover:bg-[var(--status-danger)]/15 text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              <div className="my-1 border-t border-[var(--border-subtle)]" />

              <button
                type="button"
                onClick={() => {
                  vaultPopoverRef.current?.hidePopover?.();
                  setVaultModal({ mode: 'create' });
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--accent-primary)] font-medium cursor-pointer"
              >
                <Plus size={14} />
                {dict.sidebar.newVault}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Navigation Sections */}
      <div className="flex-1 overflow-y-auto ks-scroll px-2.5 py-1 flex flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={setViewAll}
            className={navItemClass(activeView === 'all')}
          >
            <span className="flex items-center gap-2">
              <Layers size={14} />
              {dict.sidebar.allItems}
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{totalCount}</span>
          </button>

          <button
            type="button"
            onClick={setViewFavorites}
            className={navItemClass(activeView === 'favorites')}
          >
            <span className="flex items-center gap-2">
              <Star size={14} className="text-amber-500" />
              {dict.sidebar.favorites}
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{favoriteCount}</span>
          </button>

          <button
            type="button"
            onClick={setViewPasskeys}
            className={navItemClass(activeView === 'passkeys')}
          >
            <span className="flex items-center gap-2">
              <Fingerprint size={14} className="text-sky-500" />
              {dict.sidebar.passkeys}
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{passkeyCount}</span>
          </button>

          <button
            type="button"
            onClick={setViewWatchtower}
            className={navItemClass(activeView === 'watchtower')}
          >
            <span className="flex items-center gap-2">
              <ShieldAlert size={14} className={riskCount > 0 ? 'text-[var(--status-warning)]' : ''} />
              {dict.sidebar.watchtower}
            </span>
            {riskCount > 0 && (
              <span className="font-mono-tabular text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--status-danger)]/15 text-[var(--status-danger)]">
                {riskCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={setViewSend}
            className={navItemClass(activeView === 'send')}
          >
            <span className="flex items-center gap-2">
              <Send size={14} className="text-[var(--accent-primary)]" />
              {dict.sidebar.send}
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{sendCount}</span>
          </button>
        </div>

        {/* Categories */}
        <div>
          <div className="px-2.5 mb-1 text-[10.5px] font-semibold text-[var(--text-muted)]">
            {dict.sidebar.categories}
          </div>
          <div className="flex flex-col gap-0.5">
            {PHASE1_TEMPLATES.map(renderCategoryRow)}
          </div>

          <button
            type="button"
            onClick={() => setMoreCategoriesOpen((v) => !v)}
            className="mt-1 w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <span className="flex items-center gap-1">
              {moreCategoriesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {fmt(dict.sidebar.moreCategories, { count: PHASE2_TEMPLATES.length })}
            </span>
          </button>

          {moreCategoriesOpen && (
            <div className="mt-0.5 flex flex-col gap-0.5">
              {PHASE2_TEMPLATES.map(renderCategoryRow)}
            </div>
          )}
        </div>

        {/* Tags */}
        {tagCounts.length > 0 && (
          <div>
            <div className="px-2.5 mb-1.5 text-[10.5px] font-semibold text-[var(--text-muted)]">
              {dict.sidebar.tags}
            </div>
            <div className="px-1.5 flex flex-wrap gap-1.5">
              {tagCounts.map(({ tag, count }) => {
                const isSelected = activeView === 'tag' && activeTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setViewTag(tag)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                        : 'bg-[var(--bg-elevated)]/75 text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Hash size={10} />
                    {tag}
                    <span className={`font-mono-tabular text-[10px] ${isSelected ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Archive & Trash */}
        <div className="pt-1 border-t border-[var(--border-subtle)] flex flex-col gap-0.5">
          <button
            type="button"
            onClick={setViewArchived}
            className={navItemClass(activeView === 'archived')}
          >
            <span className="flex items-center gap-2">
              <Archive size={14} />
              {dict.sidebar.archived}
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{archivedCount}</span>
          </button>

          <button
            type="button"
            onClick={setViewTrash}
            className={navItemClass(activeView === 'trash')}
          >
            <span className="flex items-center gap-2">
              <Trash2 size={14} />
              {dict.sidebar.trash}
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{trashCount}</span>
          </button>
        </div>
      </div>

      {/* Footer Status Bar */}
      <div className="px-2 py-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-0.5 bg-[var(--bg-sidebar)] shrink-0">
        <button
          type="button"
          onClick={() => void lock('manual')}
          title={`${dict.sidebar.lock} (${formatShortcutMac(shortcuts.lockVault)})`}
          className="inline-flex items-center gap-1 px-1.5 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Lock size={12} className="shrink-0" />
          <span>{dict.sidebar.lock}</span>
        </button>

        <button
          type="button"
          onClick={() => void syncNow(getFilter())}
          title={`${dict.settings.syncNowBtn} (${formatShortcutMac(shortcuts.syncVault)})`}
          className="inline-flex items-center justify-center gap-1 px-1 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer min-w-0 flex-1"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              syncStatus.signalrConnected ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]/60'
            }`}
          />
          <RefreshCw size={11} className={`shrink-0 ${syncStatus.state === 'syncing' ? 'animate-spin text-[var(--accent-primary)]' : ''}`} />
          <span className="truncate">
            {clipboardCountdown
              ? fmt(dict.sidebar.clipboardCountdown, { secs: clipboardCountdown.remainingSeconds })
              : syncStatus.state === 'syncing'
                ? dict.sidebar.syncing
                : formatRelativeTime(syncStatus.lastSyncAt)}
          </span>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={`${dict.sidebar.settingsTooltip} (${formatShortcutMac(shortcuts.openSettings)})`}
            aria-label={dict.sidebar.settingsTooltip}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
