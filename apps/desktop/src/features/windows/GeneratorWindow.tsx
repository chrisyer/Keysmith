import { Dices, X } from 'lucide-react';
import { useEffect } from 'react';
import { GeneratorPanel } from '../../components/GeneratorPanel';
import { useI18n } from '../../i18n';
import { tauriClient } from '../../services/tauriClient';

export function GeneratorWindow() {
  const { dict } = useI18n();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void tauriClient.windowCloseGenerator();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="h-dvh w-screen rounded-[14px] bg-[var(--bg-elevated)] text-[var(--text-primary)] flex flex-col overflow-hidden border border-[var(--border-strong)] shadow-2xl">
      <header
        data-tauri-drag-region
        className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3 shrink-0 select-none"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-lg bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] flex items-center justify-center shrink-0">
            <Dices size={14} />
          </span>
          <span data-tauri-drag-region className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
            {dict.generator.title}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void tauriClient.windowCloseGenerator()}
          aria-label={dict.common.close}
          className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-pointer shrink-0"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto ks-scroll">
        <GeneratorPanel onClose={() => void tauriClient.windowCloseGenerator()} />
      </div>

      <footer className="px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex items-center justify-end text-[10.5px] text-[var(--text-muted)] shrink-0">
        <span>{dict.generator.escHint}</span>
      </footer>
    </div>
  );
}
