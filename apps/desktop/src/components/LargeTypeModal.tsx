import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { tauriClient } from '../services/tauriClient';
import { useUiStore } from '../stores/uiStore';
import { getCharColorVar } from './ColoredPassword';
import { ModalDialog } from './ModalDialog';

export function LargeTypeModal() {
  const { dict, fmt } = useI18n();
  const largeType = useUiStore((s) => s.largeType);
  const closeLargeType = useUiStore((s) => s.closeLargeType);
  const showToast = useUiStore((s) => s.showToast);
  const [copiedInline, setCopiedInline] = useState(false);

  const chars = largeType ? Array.from(largeType.value) : [];

  const handleCopy = async () => {
    if (!largeType) return;
    await tauriClient.clipboardCopySecret(largeType.value, largeType.label, true);
    setCopiedInline(true);
    setTimeout(() => setCopiedInline(false), 1800);
    showToast({
      label: largeType.label,
      text: `${dict.common.copied}「${largeType.label}」`,
      kind: 'clipboard',
    });
  };

  return (
    <ModalDialog
      open={Boolean(largeType)}
      onClose={closeLargeType}
      ariaLabelledBy="large-type-title"
      closedBy="any"
      className="rounded-xl w-[min(780px,92vw)] shadow-2xl"
    >
      {largeType && (
        <div className="p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 id="large-type-title" className="text-sm font-medium text-[var(--text-primary)]">
                {dict.largeType.title} · {largeType.label}
              </h1>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {fmt(dict.largeType.charCount, { count: chars.length })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                {copiedInline ? (
                  <Check size={14} className="text-[var(--status-success)]" />
                ) : (
                  <Copy size={14} />
                )}
                {copiedInline ? dict.common.copied : dict.common.copy}
              </button>
              <button
                type="button"
                onClick={closeLargeType}
                autoFocus
                aria-label={dict.common.close}
                className="p-1.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div
            className="grid gap-2.5 p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] max-h-[55dvh] overflow-y-auto ks-scroll"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))' }}
            data-selectable="true"
          >
            {chars.map((ch, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center justify-center py-2 px-1 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)]"
              >
                <span
                  className="font-mono-tabular text-2xl sm:text-3xl font-semibold leading-none"
                  style={{ color: getCharColorVar(ch) }}
                >
                  {ch === ' ' ? '␣' : ch}
                </span>
                <span className="font-mono-tabular text-[10px] text-[var(--text-secondary)] mt-1.5">
                  {idx + 1}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end text-[11px] text-[var(--text-secondary)]">
            <span>{dict.largeType.escHint}</span>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
