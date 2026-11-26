import { useRef } from 'react';

interface PaneResizerProps {
  onResize: (deltaX: number) => void;
  ariaLabel: string;
}

export function PaneResizer({ onResize, ariaLabel }: PaneResizerProps) {
  const lastXRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    lastXRef.current = e.clientX;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - lastXRef.current;
      lastXRef.current = ev.clientX;
      if (dx !== 0) onResize(dx);
    };

    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(-10);
        if (e.key === 'ArrowRight') onResize(10);
      }}
      className="w-[6px] -mx-[3px] z-10 cursor-col-resize relative group shrink-0 focus-visible:outline-none"
    >
      <div className="w-[1px] h-full mx-auto bg-[var(--border-subtle)] group-hover:w-[2px] group-hover:bg-[var(--accent-primary)] group-focus-visible:bg-[var(--accent-primary)] transition-colors" />
    </div>
  );
}
