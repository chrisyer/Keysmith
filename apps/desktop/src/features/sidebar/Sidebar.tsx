import {
  Check,
  ChevronsUpDown,
  Command,
  Fingerprint,
  FolderLock,
  Hash,
  Layers,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import { useId, useRef } from 'react';
import { PHASE1_TEMPLATES } from '../../services/templates';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import { formatRelativeTime } from '../../utils/format';

export function Sidebar() {
  const popoverRawId = useId().replace(/:/g, '');
  const vaultPopoverId = `vault-switcher-${popoverRawId}`;
  const vaultAnchorName = `--vault-btn-${popoverRawId}`;
  const vaultPopoverRef = useRef<HTMLDivElement>(null);

  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const activeVaultId = useUiStore((s) => s.activeVaultId);
  const activeView = useUiStore((s) => s.activeView);
  const activeCategory = useUiStore((s) => s.activeCategory);
  const activeTag = useUiStore((s) => s.activeTag);
  const clipboardCountdown = useUiStore((s) => s.clipboardCountdown);

  const setActiveVault = useUiStore((s) => s.setActiveVault);
  const setViewAll = useUiStore((s) => s.setViewAll);
  const setViewFavorites = useUiStore((s) => s.setViewFavorites);
  const setViewPasskeys = useUiStore((s) => s.setViewPasskeys);
  const setViewWatchtower = useUiStore((s) => s.setViewWatchtower);
  const setViewCategory = useUiStore((s) => s.setViewCategory);
  const setViewTag = useUiStore((s) => s.setViewTag);
  const setViewTrash = useUiStore((s) => s.setViewTrash);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setQuickAccessOpen = useUiStore((s) => s.setQuickAccessOpen);
  const setVaultModal = useUiStore((s) => s.setVaultModal);
  const getFilter = useUiStore((s) => s.getFilter);
  const showToast = useUiStore((s) => s.showToast);

  const vaults = useVaultStore((s) => s.vaults);
  const totalCount = useVaultStore((s) => s.totalCount);
  const favoriteCount = useVaultStore((s) => s.favoriteCount);
  const passkeyCount = useVaultStore((s) => s.passkeyCount);
  const trashCount = useVaultStore((s) => s.trashCount);
  const categoryCounts = useVaultStore((s) => s.categoryCounts);
  const tagCounts = useVaultStore((s) => s.tagCounts);
  const watchtowerReport = useVaultStore((s) => s.watchtowerReport);
  const syncStatus = useVaultStore((s) => s.syncStatus);
  const syncNow = useVaultStore((s) => s.syncNow);
  const deleteVault = useVaultStore((s) => s.deleteVault);

  const lock = useSessionStore((s) => s.lock);

  const currentVault = vaults.find((v) => v.id === activeVaultId);
  const riskCount = watchtowerReport?.totalRiskItems ?? 0;

  const navItemClass = (active: boolean) =>
    `w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
      active
        ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)]'
        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
    }`;

  return (
    <aside
      style={{ width: sidebarWidth }}
      className="h-full shrink-0 bg-[var(--bg-sidebar)] flex flex-col justify-between overflow-hidden"
      aria-label="侧边栏导航"
    >
      {/* Top macOS Traffic Lights + Vault Switcher */}
      <div className="px-3 pt-3 pb-2 flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="w-3 h-3 rounded-full bg-[#FF5F57] border border-black/10" />
            <span className="w-3 h-3 rounded-full bg-[#FEBC2E] border border-black/10" />
            <span className="w-3 h-3 rounded-full bg-[#28C840] border border-black/10" />
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)]">
            KEYSMITH
          </span>
        </div>

        <button
          type="button"
          popoverTarget={vaultPopoverId}
          style={{ anchorName: vaultAnchorName } as React.CSSProperties}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[var(--bg-elevated)]/80 hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-left shadow-2xs transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span
              className="w-5 h-5 rounded-md flex items-center justify-center text-white shrink-0"
              style={{ backgroundColor: currentVault?.color ?? 'var(--accent-primary)' }}
            >
              <FolderLock size={12} />
            </span>
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
              {currentVault ? currentVault.name : '全部保险库'}
            </span>
          </span>
          <ChevronsUpDown size={14} className="text-[var(--text-muted)] shrink-0" />
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
                全部保险库
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
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] ml-2">
                    {vault.itemCount}
                    {activeVaultId === vault.id && (
                      <Check size={13} className="text-[var(--accent-primary)]" />
                    )}
                  </span>
                </button>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`重命名 ${vault.name}`}
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
                      aria-label={`删除 ${vault.name}`}
                      onClick={() => {
                        vaultPopoverRef.current?.hidePopover?.();
                        if (activeVaultId === vault.id) setActiveVault(null);
                        void deleteVault(vault.id, getFilter());
                        showToast({ label: 'Vault', text: `已删除保险库「${vault.name}」，条目已移入个人库`, kind: 'info' });
                      }}
                      className="p-1 rounded hover:bg-[var(--status-danger)]/15 text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
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
              新建保险库...
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Navigation Sections */}
      <div className="flex-1 overflow-y-auto ks-scroll px-2.5 py-1 flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={setViewAll}
            className={navItemClass(activeView === 'all')}
          >
            <span className="flex items-center gap-2">
              <Layers size={15} />
              全部条目
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{totalCount}</span>
          </button>

          <button
            type="button"
            onClick={setViewFavorites}
            className={navItemClass(activeView === 'favorites')}
          >
            <span className="flex items-center gap-2">
              <Star size={15} className="text-amber-500" />
              收藏
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{favoriteCount}</span>
          </button>

          <button
            type="button"
            onClick={setViewPasskeys}
            className={navItemClass(activeView === 'passkeys')}
          >
            <span className="flex items-center gap-2">
              <Fingerprint size={15} className="text-sky-500" />
              通行密钥
            </span>
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{passkeyCount}</span>
          </button>

          <button
            type="button"
            onClick={setViewWatchtower}
            className={navItemClass(activeView === 'watchtower')}
          >
            <span className="flex items-center gap-2">
              <ShieldAlert size={15} className={riskCount > 0 ? 'text-[var(--status-warning)]' : ''} />
              Watchtower
            </span>
            {riskCount > 0 && (
              <span className="font-mono-tabular text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--status-danger)]/15 text-[var(--status-danger)]">
                ! {riskCount}
              </span>
            )}
          </button>
        </div>

        {/* Categories */}
        <div>
          <div className="px-2.5 mb-1 text-[11px] font-semibold text-[var(--text-muted)] tracking-wide">
            类别
          </div>
          <div className="flex flex-col gap-0.5">
            {PHASE1_TEMPLATES.map((tpl) => {
              const count = categoryCounts[tpl.category] ?? 0;
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
                    <span className="truncate">{tpl.label}</span>
                  </span>
                  <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tags */}
        {tagCounts.length > 0 && (
          <div>
            <div className="px-2.5 mb-1.5 text-[11px] font-semibold text-[var(--text-muted)] tracking-wide">
              标签
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

        {/* Trash */}
        <div className="pt-1 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={setViewTrash}
            className={navItemClass(activeView === 'trash')}
          >
            <span className="flex items-center gap-2">
              <Trash2 size={15} />
              废纸篓
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
          title="立即锁定 (⌘L)"
          className="inline-flex items-center gap-1 px-1.5 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Lock size={12} className="shrink-0" />
          <span>锁定</span>
        </button>

        <button
          type="button"
          onClick={() => void syncNow(getFilter())}
          title={`立即同步 (⌘R) · 上次同步 ${formatRelativeTime(syncStatus.lastSyncAt)}`}
          className="inline-flex items-center justify-center gap-1 px-1 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer min-w-0 flex-1"
        >
          <RefreshCw size={11} className={`shrink-0 ${syncStatus.state === 'syncing' ? 'animate-spin text-[var(--accent-primary)]' : ''}`} />
          <span className="truncate">
            {clipboardCountdown
              ? `剪贴板 ${clipboardCountdown.remainingSeconds}s`
              : syncStatus.state === 'syncing'
                ? '同步中...'
                : formatRelativeTime(syncStatus.lastSyncAt)}
          </span>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setQuickAccessOpen(true)}
            title="Quick Access 悬浮窗 (⌘⇧Space / ⌘K)"
            aria-label="打开 Quick Access 悬浮窗"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Command size={13} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="偏好设置 (⌘,)"
            aria-label="打开偏好设置"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
