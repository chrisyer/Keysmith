import { ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tauriClient } from '../services/tauriClient';
import { useUiStore } from '../stores/uiStore';
import { announceAria } from '../utils/topLayer';

export function ToastRegion() {
  const toast = useUiStore((s) => s.toast);
  const dismissToast = useUiStore((s) => s.dismissToast);
  const countdown = useUiStore((s) => s.clipboardCountdown);
  const largeTypeOpen = useUiStore((s) => Boolean(s.largeType));
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const quickAccessOpen = useUiStore((s) => s.quickAccessOpen);
  const newItemOpen = useUiStore((s) => s.newItemOpen);
  const vaultModalOpen = useUiStore((s) => Boolean(s.vaultModal));

  const hasOpenModal =
    largeTypeOpen || settingsOpen || quickAccessOpen || newItemOpen || vaultModalOpen;

  const popoverRef = useRef<HTMLDivElement>(null);
  const [focusInside, setFocusInside] = useState(false);

  const visible = Boolean(toast) && !hasOpenModal;

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    if (visible && toast) {
      announceAria(toast.text);
      try {
        if (!el.matches(':popover-open')) {
          el.showPopover();
        }
      } catch {
        // Fallback when popover is unsupported before polyfill finishes
        el.classList.add(':popover-open');
      }
    } else {
      try {
        if (el.matches(':popover-open')) {
          el.hidePopover();
        }
      } catch {
        el.classList.remove(':popover-open');
      }
    }
  }, [visible, toast]);

  useEffect(() => {
    if (!toast || focusInside || hasOpenModal) return;
    const duration = toast.kind === 'clipboard' ? 5000 : 3200;
    const timer = window.setTimeout(() => {
      dismissToast();
    }, duration);
    return () => window.clearTimeout(timer);
  }, [toast, focusInside, hasOpenModal, dismissToast]);

  const displayText =
    toast?.kind === 'clipboard' && countdown && countdown.label === toast.label
      ? `已复制「${toast.label}」· ${countdown.remainingSeconds} 秒后自动清空剪贴板`
      : toast?.text ?? '';

  return (
    <div role="region" aria-label="通知">
      <p className="inclusively-hidden">屏幕阅读器状态播报</p>
      <div id="ks-live-region" className="inclusively-hidden" aria-live="polite" />

      <div
        ref={popoverRef}
        id="ks-toast-popover"
        popover="manual"
        onFocusCapture={() => setFocusInside(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocusInside(false);
          }
        }}
        className="ks-popover ks-toast-popover"
      >
        {toast && (
          <div className="flex items-center gap-2.5 pl-3.5 pr-2 py-2 text-xs">
            <ShieldCheck size={15} className="text-[var(--accent-primary)] shrink-0" />
            <span className="text-[var(--text-primary)] font-medium whitespace-nowrap">
              {displayText}
            </span>
            {toast.kind === 'clipboard' && (
              <button
                type="button"
                onClick={() => {
                  void tauriClient.clipboardClearNow();
                  dismissToast();
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
              >
                <Trash2 size={11} />
                立即清空
              </button>
            )}
            <button
              type="button"
              popoverTarget="ks-toast-popover"
              popoverTargetAction="hide"
              onClick={dismissToast}
              aria-label="关闭通知"
              className="p-1 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
