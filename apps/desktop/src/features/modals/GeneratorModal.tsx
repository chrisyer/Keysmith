import { Dices, X } from 'lucide-react';
import { GeneratorPanel } from '../../components/GeneratorPanel';
import { ModalDialog } from '../../components/ModalDialog';
import { useI18n } from '../../i18n';
import { useUiStore } from '../../stores/uiStore';

export function GeneratorModal() {
  const { dict } = useI18n();
  const open = useUiStore((s) => s.generatorOpen);
  const setOpen = useUiStore((s) => s.setGeneratorOpen);

  return (
    <ModalDialog
      open={open}
      onClose={() => setOpen(false)}
      ariaLabel={dict.generator.title}
      className="w-[420px] max-w-[94vw] rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-2xl overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] flex items-center justify-center">
            <Dices size={14} />
          </span>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {dict.generator.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={dict.common.close}
          className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
      <GeneratorPanel onClose={() => setOpen(false)} />
    </ModalDialog>
  );
}
