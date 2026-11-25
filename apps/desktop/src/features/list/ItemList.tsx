import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowUpDown,
  ChevronDown,
  HelpCircle,
  Plus,
  Search,
  ShieldAlert,
  Star,
  X,
} from 'lucide-react';
import { useId, useRef } from 'react';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { SortBy, WatchtowerIssueType } from '../../types/domain';

const SORT_OPTIONS: Array<{ id: SortBy; label: string }> = [
  { id: 'title_asc', label: '名称 A → Z' },
  { id: 'title_desc', label: '名称 Z → A' },
  { id: 'updated_desc', label: '最近修改' },
  { id: 'created_desc', label: '最新创建' },
];

const ISSUE_LABELS: Record<WatchtowerIssueType, string> = {
  weak: '弱密码',
  reused: '重复使用的密码',
  missing_2fa: '未开启 2FA',
  unsecured_url: '不安全 HTTP',
  expiring: '即将过期 / 已过期',
  breached: '已泄露密码',
};

interface ItemListProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function ItemList({ searchInputRef }: ItemListProps) {
  const uid = useId().replace(/:/g, '');
  const sortPopoverId = `sort-pop-${uid}`;
  const sortAnchor = `--sort-btn-${uid}`;
  const syntaxPopoverId = `syntax-pop-${uid}`;
  const syntaxAnchor = `--syntax-btn-${uid}`;
  const sortPopoverRef = useRef<HTMLDivElement>(null);
  const syntaxPopoverRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const listWidth = useUiStore((s) => s.listWidth);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const sortBy = useUiStore((s) => s.sortBy);
  const activeWatchtowerFilter = useUiStore((s) => s.activeWatchtowerFilter);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setSortBy = useUiStore((s) => s.setSortBy);
  const setNewItemOpen = useUiStore((s) => s.setNewItemOpen);
  const setWatchtowerIssueFilter = useUiStore((s) => s.setWatchtowerIssueFilter);
  const stopEditing = useUiStore((s) => s.stopEditing);

  const items = useVaultStore((s) => s.items);
  const activeItemId = useVaultStore((s) => s.activeItemId);
  const selectItem = useVaultStore((s) => s.selectItem);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 62,
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

  const currentSortLabel = SORT_OPTIONS.find((s) => s.id === sortBy)?.label ?? '名称 A → Z';

  return (
    <section
      style={{ width: listWidth }}
      className="h-full shrink-0 bg-[var(--bg-list)] flex flex-col overflow-hidden"
      aria-label="条目列表"
      onKeyDown={handleListKeyDown}
    >
      {/* Search + Action Bar */}
      <div className="p-3 pb-2.5 border-b border-[var(--border-subtle)] flex flex-col gap-2">
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-3 text-[var(--text-muted)] pointer-events-none" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索条目、拼音或 tag:开发  ⌘F"
            aria-label="搜索条目"
            className="w-full pl-8 pr-14 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <div className="absolute right-1.5 flex items-center gap-0.5">
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="清空搜索"
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
            <button
              type="button"
              popoverTarget={syntaxPopoverId}
              style={{ anchorName: syntaxAnchor } as React.CSSProperties}
              title="检索语法提示"
              aria-label="检索语法提示"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] cursor-pointer"
            >
              <HelpCircle size={13} />
            </button>
          </div>
        </div>

        <div
          ref={syntaxPopoverRef}
          id={syntaxPopoverId}
          popover="auto"
          style={{ positionAnchor: syntaxAnchor } as React.CSSProperties}
          className="ks-popover ks-anchored-popover w-[270px]"
        >
          <div className="p-3 text-xs flex flex-col gap-2">
            <div className="font-semibold text-[var(--text-primary)]">高级检索与拼音首字母</div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              支持输入中文拼音首字母（如 <code className="font-mono-tabular">sjk</code>、<code className="font-mono-tabular">yhk</code>）及以下过滤语法：
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['tag:开发', 'vault:工作', 'is:favorite', 'is:passkey', 'cat:passkey', 'cat:ssh'].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setSearchQuery(chip);
                    syntaxPopoverRef.current?.hidePopover?.();
                    searchInputRef.current?.focus();
                  }}
                  className="px-2 py-0.5 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] font-mono-tabular text-[11px] text-[var(--accent-primary)] cursor-pointer"
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
            onClick={() => setNewItemOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white shadow-2xs transition-colors cursor-pointer"
          >
            <Plus size={13} />
            新建
          </button>

          <button
            type="button"
            popoverTarget={sortPopoverId}
            style={{ anchorName: sortAnchor } as React.CSSProperties}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] text-[11px] font-medium text-[var(--text-secondary)] cursor-pointer"
          >
            <ArrowUpDown size={12} />
            <span>{currentSortLabel}</span>
            <ChevronDown size={12} />
          </button>

          <div
            ref={sortPopoverRef}
            id={sortPopoverId}
            popover="auto"
            style={{ positionAnchor: sortAnchor } as React.CSSProperties}
            className="ks-popover ks-anchored-popover-end w-[150px]"
          >
            <div className="p-1 flex flex-col gap-0.5 text-xs">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSortBy(opt.id);
                    sortPopoverRef.current?.hidePopover?.();
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-left cursor-pointer ${
                    sortBy === opt.id
                      ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)] font-medium'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeWatchtowerFilter && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--status-warning)]/12 border border-[var(--status-warning)]/30 text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-[var(--status-warning)] truncate">
              <ShieldAlert size={13} />
              体检筛选：{ISSUE_LABELS[activeWatchtowerFilter]}
            </span>
            <button
              type="button"
              onClick={() => setWatchtowerIssueFilter(null)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline shrink-0 cursor-pointer"
            >
              返回总览
            </button>
          </div>
        )}
      </div>

      {/* Virtualized List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto ks-scroll px-2 py-2"
        tabIndex={0}
      >
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
            <Search size={28} className="text-[var(--text-muted)] mb-2 opacity-60" />
            <p className="text-xs font-medium text-[var(--text-secondary)]">没有匹配的条目</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              试试调整筛选条件，或点击上方「+ 新建」创建条目
            </p>
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
                    onClick={() => {
                      stopEditing();
                      void selectItem(item.id);
                    }}
                    className={`w-full h-full px-2.5 rounded-xl flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--bg-selected)] ring-1 ring-[var(--accent-primary)]/35'
                        : 'hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <ItemIconBadge icon={item.icon} category={item.category} title={item.title} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                          {item.title}
                        </span>
                        {item.favorite && (
                          <Star size={11} className="text-amber-500 fill-amber-500 shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.hasPasskey && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/12 border border-sky-500/30 text-[9px] font-semibold text-sky-600 dark:text-sky-400">
                          Passkey
                        </span>
                      )}
                      {item.hasTotp && (
                        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[9px] font-mono-tabular font-semibold text-[var(--text-secondary)]">
                          2FA
                        </span>
                      )}
                      {item.issues.length > 0 && (
                        <span
                          className="w-2 h-2 rounded-full bg-[var(--status-danger)]"
                          title={`存在 ${item.issues.length} 项 Watchtower 安全提醒`}
                        />
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
