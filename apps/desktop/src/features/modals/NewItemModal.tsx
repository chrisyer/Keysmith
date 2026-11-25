import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { ModalDialog } from '../../components/ModalDialog';
import { PHASE1_TEMPLATES } from '../../services/templates';
import { useUiStore } from '../../stores/uiStore';

export function NewItemModal() {
  const open = useUiStore((s) => s.newItemOpen);
  const setNewItemOpen = useUiStore((s) => s.setNewItemOpen);
  const startCreatingDraft = useUiStore((s) => s.startCreatingDraft);
  const [filter, setFilter] = useState('');

  const filtered = PHASE1_TEMPLATES.filter((t) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.includes(q);
  });

  const handleClose = () => {
    setFilter('');
    setNewItemOpen(false);
  };

  return (
    <ModalDialog
      open={open}
      onClose={handleClose}
      ariaLabelledBy="new-item-title"
      closedBy="any"
      className="rounded-2xl w-[min(640px,92vw)] shadow-2xl"
    >
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 id="new-item-title" className="text-base font-semibold text-[var(--text-primary)]">
              新建条目模板
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              选择 Phase 1 内置模板，右侧将原地展开可定制表单
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="关闭模板选择器"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative flex items-center">
          <Search size={14} className="absolute left-3 text-[var(--text-muted)]" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
            placeholder="筛选模板名称或用途..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-strong)] focus:border-[var(--accent-primary)] focus:outline-none text-xs text-[var(--text-primary)]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[55dvh] overflow-y-auto ks-scroll pr-1">
          {filtered.map((tpl) => (
            <button
              key={tpl.category}
              type="button"
              onClick={() => {
                setFilter('');
                startCreatingDraft(tpl.category);
              }}
              className="p-3 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 flex items-start gap-3 text-left transition-colors cursor-pointer"
            >
              <ItemIconBadge category={tpl.category} title={tpl.label} size="md" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">{tpl.label}</div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                  {tpl.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </ModalDialog>
  );
}
