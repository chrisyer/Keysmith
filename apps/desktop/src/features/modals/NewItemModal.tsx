import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { ModalDialog } from '../../components/ModalDialog';
import { useI18n } from '../../i18n';
import { ALL_TEMPLATES } from '../../services/templates';
import { useUiStore } from '../../stores/uiStore';

export function NewItemModal() {
  const { dict } = useI18n();
  const open = useUiStore((s) => s.newItemOpen);
  const setNewItemOpen = useUiStore((s) => s.setNewItemOpen);
  const startCreatingDraft = useUiStore((s) => s.startCreatingDraft);
  const [filter, setFilter] = useState('');

  const filtered = ALL_TEMPLATES.filter((t) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    const label = dict.categories[t.category] ?? t.label;
    return label.toLowerCase().includes(q) || t.label.toLowerCase().includes(q) || t.category.includes(q);
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
      className="rounded-xl w-[min(620px,92vw)] shadow-2xl"
    >
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 id="new-item-title" className="text-base font-semibold text-[var(--text-primary)]">
              {dict.newItem.title}
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
              {dict.newItem.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={dict.common.close}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X size={17} />
          </button>
        </div>

        <div className="relative flex items-center">
          <Search size={15} className="absolute left-3.5 text-[var(--text-muted)]" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
            placeholder={dict.newItem.searchPlaceholder}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] focus:border-[var(--accent-primary)] focus:outline-none text-[13px] text-[var(--text-primary)]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[55dvh] overflow-y-auto ks-scroll pr-1">
          {filtered.map((tpl) => {
            const label = dict.categories[tpl.category] ?? tpl.label;
            return (
              <button
                key={tpl.category}
                type="button"
                onClick={() => {
                  setFilter('');
                  startCreatingDraft(tpl.category);
                }}
                className="p-3.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 flex items-center gap-3 text-left transition-colors cursor-pointer"
              >
                <ItemIconBadge category={tpl.category} title={label} size="md" />
                <span className="text-[13.5px] font-medium text-[var(--text-primary)]">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </ModalDialog>
  );
}
