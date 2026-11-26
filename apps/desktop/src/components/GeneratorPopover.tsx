import { Dices } from 'lucide-react';
import { useId, useRef } from 'react';
import { useI18n } from '../i18n';
import { GeneratorPanel } from './GeneratorPanel';

interface GeneratorPopoverProps {
  onUsePassword: (value: string) => void;
}

export function GeneratorPopover({ onUsePassword }: GeneratorPopoverProps) {
  const { dict } = useI18n();
  const rawId = useId().replace(/:/g, '');
  const popoverId = `gen-pop-${rawId}`;
  const anchorName = `--gen-trigger-${rawId}`;
  const popoverRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        style={{ anchorName } as React.CSSProperties}
        title={dict.generator.title}
        aria-label={dict.generator.title}
        className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors cursor-pointer"
      >
        <Dices size={15} />
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        style={{ positionAnchor: anchorName } as React.CSSProperties}
        className="ks-popover ks-anchored-popover-end w-[368px]"
      >
        <GeneratorPanel
          compact
          onUseValue={onUsePassword}
          onClose={() => popoverRef.current?.hidePopover?.()}
        />
      </div>
    </>
  );
}
