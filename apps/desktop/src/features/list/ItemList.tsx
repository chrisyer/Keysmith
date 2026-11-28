import { useVirtualizer } from '@tanstack/react-virtual';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Archive,
  ArrowUpDown,
  CheckSquare,
  ChevronDown,
  FolderInput,
  HelpCircle,
  ListChecks,
  Plus,
  Search,
  ShieldAlert,
  Square,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { isCustomWindowChrome } from '../../components/WindowChrome';
import { useI18n } from '../../i18n';
import { tauriClient } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { SortBy, WatchtowerIssueType } from '../../types/domain';
import { formatShortcutMac } from '../../utils/shortcuts';

const SORT_OPTION_IDS: SortBy[] = ['title_asc', 'title_desc', 'updated_desc', 'created_desc'];
const HIGH_SEVERITY_ISSUES = new Set<WatchtowerIssueType>(['breached', 'weak', 'reused']);
const MEDIUM_SEVERITY_ISSUES = new Set<WatchtowerIssueType>(['unsecured_url', 'expiring']);

interface ItemListProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function ItemList({ searchInputRef }: ItemListProps) {
  const { dict, fmt } = useI18n();
  const uid = useId().replace(/:/g, '');
  const shortcuts = useUiStore((s) => s.shortcuts);
  const sortPopoverId = `sort-pop-${uid}`;
  const sortAnchor = `--sort-btn-${uid}`;
  const syntaxPopoverId = `syntax-pop-${uid}`;
  const syntaxAnchor = `--syntax-btn-${uid}`;
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  const syntaxPopoverRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);

  const activeView = useUiStore((s) => s.activeView);
  const listWidth = useUiStore((s) => s.listWidth);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const sortBy = useUiStore((s) => s.sortBy);
  const activeWatchtowerFilter = useUiStore((s) => s.activeWatchtowerFilter);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setSortBy = useUiStore((s) => s.setSortBy);
  const setNewItemOpen = useUiStore((s) => s.setNewItemOpen);
  const setWatchtowerIssueFilter = useUiStore((s) => s.setWatchtowerIssueFilter);
  const stopEditing = useUiStore((s) => s.stopEditing);
  const getFilter = useUiStore((s) => s.getFilter);
  const showToast = useUiStore((s) => s.showToast);
  const trashAutoPurgeDays = useSessionStore((s) => s.trashAutoPurgeDays ?? 30);

  const vaults = useVaultStore((s) => s.vaults);
  const items = useVaultStore((s) => s.items);
  const activeItemId = useVaultStore((s) => s.activeItemId);
  const selectItem = useVaultStore((s) => s.selectItem);
  const refreshItems = useVaultStore((s) => s.refreshItems);
  const refreshAll = useVaultStore((s) => s.refreshAll);
  const moveItemsToVault = useVaultStore((s) => s.moveItemsToVault);
  const batchTrashItems = useVaultStore((s) => s.batchTrashItems);
  const batchAddTag = useVaultStore((s) => s.batchAddTag);

  useEffect(() => {
    const validIds = new Set(items.map((i) => i.id));
    setSelectedIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 66,
    overscan: 8,
  });

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (items.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIdx = items.findIndex((i) => i.id === activeItemId);
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(items.length - 1, currentIdx + 1)
          : Math.max(0, currentIdx <= 0 ? 0 : currentIdx - 1);
      const target = items[nextIdx];
      if (target) {
        stopEditing();
        void selectItem(target.id);
        virtualizer.scrollToIndex(nextIdx, { align: 'auto' });
      }
    }
  };

  const toggleIdSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleItemClick = (idx: number, id: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIdx !== null) {
      const start = Math.min(lastClickedIdx, idx);
      const end = Math.max(lastClickedIdx, idx);
      const rangeIds = items.slice(start, end + 1).map((it) => it.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
      setMultiSelectMode(true);
      return;
    }

    if (e.metaKey || e.ctrlKey || multiSelectMode) {
      toggleIdSelection(id);
      setLastClickedIdx(idx);
      setMultiSelectMode(true);
      return;
    }

    setLastClickedIdx(idx);
    stopEditing();
    void selectItem(id);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setMultiSelectMode(false);
    setBatchMoveOpen(false);
    setBatchTagOpen(false);
    setBatchTagInput('');
  };

  useEffect(() => {
    setConfirmEmptyTrash(false);
  }, [activeView]);

  const handleEmptyTrash = async () => {
    setEmptyingTrash(true);
    try {
      const purged = await tauriClient.itemEmptyTrash();
      await refreshAll(getFilter());
      setConfirmEmptyTrash(false);
      showToast({
        label: dict.sidebar.trash,
        text: fmt(dict.list.emptyTrashDone, { count: purged }),
        kind: 'info',
      });
    } finally {
      setEmptyingTrash(false);
    }
  };

  const handleBatchArchive = async () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    await Promise.all(selectedIds.map((id) => tauriClient.itemSetArchived(id, true)));
    await refreshItems(getFilter());
    clearSelection();
    showToast({
      label: dict.list.batchArchiveLabel,
      text: fmt(dict.list.batchArchiveDone, { count }),
      kind: 'info',
    });
  };

  const handleBatchMove = async (targetVaultId: string) => {
    if (selectedIds.length === 0) return;
    const count = await moveItemsToVault(selectedIds, targetVaultId, getFilter());
    const vaultName = vaults.find((v) => v.id === targetVaultId)?.name ?? dict.list.batchMoveDefaultTarget;
    clearSelection();
    showToast({
      label: dict.list.batchMoveLabel,
      text: fmt(dict.list.batchMoveDone, { count, vault: vaultName }),
      kind: 'info',
    });
  };

  const handleBatchTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = batchTagInput.trim().replace(/^#/, '');
    if (!clean || selectedIds.length === 0) return;
    const count = await batchAddTag(selectedIds, clean, getFilter());
    clearSelection();
    showToast({
      label: dict.list.batchTagLabel,
      text: fmt(dict.list.batchTagDone, { count, tag: clean }),
      kind: 'info',
    });
  };

  const handleBatchTrash = async () => {
    if (selectedIds.length === 0) return;
    const count = await batchTrashItems(selectedIds, getFilter());
    clearSelection();
    showToast({
      label: dict.list.batchTrashLabel,
      text: fmt(dict.list.batchTrashDone, { count }),
      kind: 'info',
    });
  };

  const currentSortLabel = dict.list.sort[sortBy] ?? dict.list.sort.title_asc;
  const showBatchBar = multiSelectMode || selectedIds.length > 0;

  return (
    <section
      style={{ width: listWidth }}
      className="h-full shrink-0 bg-[var(--bg-list)] flex flex-col overflow-hidden relative"
      aria-label="Items"
      onKeyDown={handleListKeyDown}
    >
      {/* Search + Action Bar */}
      <div
        data-tauri-drag-region={isCustomWindowChrome() ? true : undefined}
        onDoubleClick={(e) => {
          if (isCustomWindowChrome() && e.target === e.currentTarget) {
            void getCurrentWindow().toggleMaximize();
          }
        }}
        className="p-3 pb-2.5 border-b border-[var(--border-subtle)] flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0 flex items-center">
            <Search size={15} className="absolute left-3 text-[var(--text-muted)] pointer-events-none" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`${dict.list.searchPlaceholder} (${formatShortcutMac(shortcuts.search)})`}
              aria-label={dict.common.search}
              className={`w-full pl-9 ${searchQuery ? 'pr-14' : 'pr-8'} py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]`}
            />
            <div className="absolute right-1.5 flex items-center gap-0.5">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={dict.common.close}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
              <button
                type="button"
                popoverTarget={syntaxPopoverId}
                style={{ anchorName: syntaxAnchor } as React.CSSProperties}
                title={dict.list.syntaxTitle}
                aria-label={dict.list.syntaxTitle}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] cursor-pointer"
              >
                <HelpCircle size={14} />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setNewItemOpen(true)}
            title={`${dict.app.newItemBtn} (${formatShortcutMac(shortcuts.newItem)})`}
            aria-label={dict.app.newItemBtn}
            className="w-[36px] h-[36px] shrink-0 inline-flex items-center justify-center rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white transition-colors cursor-pointer"
          >
            <Plus size={16} />
          </button>
        </div>

        <div
          ref={syntaxPopoverRef}
          id={syntaxPopoverId}
          popover="auto"
          style={{ positionAnchor: syntaxAnchor } as React.CSSProperties}
          className="ks-popover ks-anchored-popover w-[270px]"
        >
          <div className="p-3.5 text-[13px] flex flex-col gap-2">
            <div className="font-semibold text-[var(--text-primary)]">{dict.list.syntaxTitle}</div>
            <p className="text-xs text-[var(--text-secondary)]">
              {dict.list.syntaxHint}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['is:favorite', 'is:passkey', 'is:sso', 'cat:passkey', 'cat:ssh'].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setSearchQuery(chip);
                    syntaxPopoverRef.current?.hidePopover?.();
                    searchInputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] font-mono-tabular text-xs text-[var(--accent-primary)] cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (multiSelectMode) {
                clearSelection();
              } else {
                setMultiSelectMode(true);
              }
            }}
            aria-label={dict.list.selectBtn}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors cursor-pointer ${
              multiSelectMode
                ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)]'
                : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
            }`}
          >
            <ListChecks size={14} />
            <span>{multiSelectMode ? dict.list.doneBtn : dict.list.selectBtn}</span>
          </button>

          <button
            type="button"
            popoverTarget={sortPopoverId}
            style={{ anchorName: sortAnchor } as React.CSSProperties}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[12.5px] font-medium text-[var(--text-secondary)] cursor-pointer"
          >
            <ArrowUpDown size={13} />
            <span className="truncate max-w-[90px]">{currentSortLabel}</span>
            <ChevronDown size={13} />
          </button>

          <div
            ref={sortPopoverRef}
            id={sortPopoverId}
            popover="auto"
            style={{ positionAnchor: sortAnchor } as React.CSSProperties}
            className="ks-popover ks-anchored-popover-end w-[160px]"
          >
            <div className="p-1.5 flex flex-col gap-0.5 text-[13px]">
              {SORT_OPTION_IDS.map((optId) => (
                <button
                  key={optId}
                  type="button"
                  onClick={() => {
                    setSortBy(optId);
                    sortPopoverRef.current?.hidePopover?.();
                  }}
                  className={`px-2.5 py-2 rounded-lg text-left cursor-pointer ${
                    sortBy === optId
                      ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)] font-medium'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {dict.list.sort[optId]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeWatchtowerFilter && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--status-warning)]/12 border border-[var(--status-warning)]/30 text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-[var(--status-warning)] truncate">
              <ShieldAlert size={13} />
              {fmt(dict.list.watchtowerFilter, {
                label: dict.detail.issues[activeWatchtowerFilter] ?? activeWatchtowerFilter,
              })}
            </span>
            <button
              type="button"
              onClick={() => setWatchtowerIssueFilter(null)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline shrink-0 cursor-pointer"
            >
              {dict.list.backOverview}
            </button>
          </div>
        )}

        {activeView === 'trash' && items.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--status-danger)]/8 border border-[var(--status-danger)]/25 text-[11px]">
            <span className="text-[var(--text-secondary)] truncate">
              {dict.sidebar.trash} ({items.length})
              {trashAutoPurgeDays > 0
                ? ` · ${fmt(dict.list.trashAutoPurgeHint, { days: trashAutoPurgeDays })}`
                : ''}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {confirmEmptyTrash ? (
                <>
                  <button
                    type="button"
                    disabled={emptyingTrash}
                    onClick={() => void handleEmptyTrash()}
                    className="px-2 py-0.5 rounded bg-[var(--status-danger)] text-white font-medium cursor-pointer"
                  >
                    {fmt(dict.list.emptyTrashConfirm, { count: items.length })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEmptyTrash(false)}
                    className="px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    {dict.common.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmEmptyTrash(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--status-danger)]/15 hover:bg-[var(--status-danger)]/25 text-[var(--status-danger)] font-medium cursor-pointer"
                >
                  <Trash2 size={11} />
                  {dict.list.emptyTrashBtn}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Virtualized List */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-auto ks-scroll px-2 py-2 ${showBatchBar ? 'pb-24' : ''}`}
        tabIndex={0}
      >
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
            <Search size={26} className="text-[var(--text-muted)] mb-2 opacity-60" />
            <p className="text-xs font-medium text-[var(--text-secondary)]">{dict.list.emptyTitle}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">{dict.list.emptyHint}</p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const item = items[vRow.index];
              const isSelected = item.id === activeItemId;
              const isChecked = selectedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  className="py-0.5"
                >
                  <button
                    type="button"
                    onClick={(e) => handleItemClick(vRow.index, item.id, e)}
                    className={`w-full h-full px-2.5 rounded-xl flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                      isChecked
                        ? 'bg-[var(--bg-selected)] ring-1 ring-[var(--accent-primary)]/50'
                        : isSelected
                          ? 'bg-[var(--bg-selected)] ring-1 ring-[var(--accent-primary)]/35'
                          : 'hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {showBatchBar && (
                      <span className="shrink-0 text-[var(--accent-primary)]">
                        {isChecked ? <CheckSquare size={15} /> : <Square size={15} className="text-[var(--text-muted)]" />}
                      </span>
                    )}
                    <ItemIconBadge icon={item.icon} category={item.category} title={item.title} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">
                          {item.title}
                        </span>
                        {item.favorite && (
                          <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" />
                        )}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.ssoProvider && (
                        <span className="px-1.5 py-0.5 rounded bg-violet-500/12 border border-violet-500/30 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                          {fmt(dict.list.ssoBadgePrefix, { provider: item.ssoProvider })}
                        </span>
                      )}
                      {item.hasPasskey && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/12 border border-sky-500/30 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                          Passkey
                        </span>
                      )}
                      {item.hasTotp && (
                        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[10px] font-mono-tabular font-semibold text-[var(--text-secondary)]">
                          2FA
                        </span>
                      )}
                      {(() => {
                        if (item.issues.length === 0) return null;
                        const hasHigh = item.issues.some((i) => HIGH_SEVERITY_ISSUES.has(i));
                        const hasMedium = !hasHigh && item.issues.some((i) => MEDIUM_SEVERITY_ISSUES.has(i));
                        const showAdvisory = !hasHigh && !hasMedium && activeView === 'watchtower';
                        if (!hasHigh && !hasMedium && !showAdvisory) return null;
                        const dotClass = hasHigh
                          ? 'w-2 h-2 rounded-full bg-[var(--status-danger)]'
                          : hasMedium
                            ? 'w-1.5 h-1.5 rounded-full bg-[var(--status-warning)]/85'
                            : 'w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]/65';
                        return (
                          <span
                            className={dotClass}
                            title={fmt(dict.list.watchtowerDotTitle, { count: item.issues.length })}
                          />
                        );
                      })()}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Batch Toolbar */}
      {showBatchBar && (
        <div className="absolute bottom-2.5 left-2.5 right-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-xl p-2 flex flex-col gap-2 z-10">
          <div className="flex items-center justify-between text-[11px] px-1">
            <span className="font-semibold text-[var(--text-primary)]">
              {fmt(dict.list.selectedCount, { count: selectedIds.length })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds(items.map((i) => i.id))}
                className="text-[var(--accent-primary)] hover:underline cursor-pointer"
              >
                {dict.list.selectAll}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {dict.common.cancel}
              </button>
            </div>
          </div>

          {batchMoveOpen && (
            <div className="flex flex-wrap gap-1 px-1">
              {vaults
                .filter((v) => !v.isOrganization)
                .map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => void handleBatchMove(v.id)}
                    className="px-2 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-primary)] cursor-pointer"
                  >
                    {v.name}
                  </button>
                ))}
            </div>
          )}

          {batchTagOpen && (
            <form onSubmit={(e) => void handleBatchTagSubmit(e)} className="flex items-center gap-1.5 px-1">
              <input
                type="text"
                value={batchTagInput}
                onChange={(e) => setBatchTagInput(e.target.value)}
                placeholder={dict.list.tagPlaceholder}
                autoFocus
                className="flex-1 px-2 py-1 rounded-md bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)]"
              />
              <button
                type="submit"
                className="px-2.5 py-1 rounded-md bg-[var(--accent-primary)] text-white text-[11px] font-medium cursor-pointer"
              >
                {dict.list.apply}
              </button>
            </form>
          )}

          <div className="grid grid-cols-4 gap-1 text-[11px]">
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setBatchMoveOpen((v) => !v);
                setBatchTagOpen(false);
              }}
              className="py-1.5 px-1 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-40 text-[var(--text-primary)] flex items-center justify-center gap-1 cursor-pointer"
            >
              <FolderInput size={12} />
              <span>{dict.list.move}</span>
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setBatchTagOpen((v) => !v);
                setBatchMoveOpen(false);
              }}
              className="py-1.5 px-1 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-40 text-[var(--text-primary)] flex items-center justify-center gap-1 cursor-pointer"
            >
              <Tag size={12} />
              <span>{dict.list.tag}</span>
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchArchive()}
              className="py-1.5 px-1 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-40 text-[var(--text-primary)] flex items-center justify-center gap-1 cursor-pointer"
            >
              <Archive size={12} />
              <span>{dict.list.archive}</span>
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchTrash()}
              className="py-1.5 px-1 rounded-lg bg-[var(--status-danger)]/10 hover:bg-[var(--status-danger)]/20 disabled:opacity-40 text-[var(--status-danger)] flex items-center justify-center gap-1 cursor-pointer"
            >
              <Trash2 size={12} />
              <span>{dict.common.delete}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
