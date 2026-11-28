import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { isTauriRuntime } from '../services/tauriClient';
import { isMacPlatform } from '../utils/shortcuts';

export function isCustomWindowChrome(): boolean {
  return isTauriRuntime() && !isMacPlatform();
}

export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isCustomWindowChrome()) return;
    let mounted = true;
    const win = getCurrentWindow();
    const sync = () => {
      void win
        .isMaximized()
        .then((val) => {
          if (mounted) setMaximized(val);
        })
        .catch(() => {});
    };
    sync();

    let unlisten: (() => void) | null = null;
    void win
      .onResized(() => {
        sync();
      })
      .then((fn) => {
        if (mounted) {
          unlisten = fn;
        } else {
          fn();
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  return maximized;
}

export function WindowControls({
  compact = false,
  showMaximize = true,
  maximized: maximizedProp,
  className = '',
}: {
  compact?: boolean;
  showMaximize?: boolean;
  maximized?: boolean;
  className?: string;
}) {
  const { dict } = useI18n();
  const hookMaximized = useWindowMaximized();
  const maximized = maximizedProp ?? hookMaximized;
  const win = getCurrentWindow();

  const btnSize = compact ? 'h-7 w-7 rounded-md' : 'h-8 w-8 rounded-lg';
  const iconSize = compact ? 13 : 14;

  return (
    <div className={`flex items-center gap-0.5 shrink-0 select-none ${className}`}>
      <button
        type="button"
        onClick={() => void win.minimize()}
        title={dict.app.windowMinimize}
        aria-label={dict.app.windowMinimize}
        className={`${btnSize} inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer`}
      >
        <Minus size={iconSize} />
      </button>
      {showMaximize && (
        <button
          type="button"
          onClick={() => void win.toggleMaximize()}
          title={maximized ? dict.app.windowRestore : dict.app.windowMaximize}
          aria-label={maximized ? dict.app.windowRestore : dict.app.windowMaximize}
          className={`${btnSize} inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer`}
        >
          {maximized ? <Copy size={iconSize - 2} /> : <Square size={iconSize - 2} />}
        </button>
      )}
      <button
        type="button"
        onClick={() => void win.close()}
        title={dict.app.windowClose}
        aria-label={dict.app.windowClose}
        className={`${btnSize} inline-flex items-center justify-center text-[var(--text-secondary)] hover:bg-red-500 hover:text-white transition-colors cursor-pointer`}
      >
        <X size={iconSize} />
      </button>
    </div>
  );
}

type ResizeDirection =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';

export function WindowResizeHandles({ disabled = false }: { disabled?: boolean }) {
  if (disabled || !isCustomWindowChrome()) return null;

  const startResize = (dir: ResizeDirection) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    void getCurrentWindow().startResizeDragging(dir);
  };

  return (
    <>
      <div
        aria-hidden="true"
        onMouseDown={startResize('North')}
        className="fixed top-0 left-[12px] right-[12px] h-[7px] cursor-ns-resize z-40"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('South')}
        className="fixed bottom-0 left-[12px] right-[12px] h-[7px] cursor-ns-resize z-40"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('West')}
        className="fixed top-[12px] bottom-[12px] left-0 w-[7px] cursor-ew-resize z-40"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('East')}
        className="fixed top-[12px] bottom-[12px] right-0 w-[6px] cursor-ew-resize z-40"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('NorthWest')}
        className="fixed top-0 left-0 w-3 h-3 cursor-nwse-resize z-40"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('NorthEast')}
        className="fixed top-0 right-0 w-3 h-3 cursor-nesw-resize z-40"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('SouthWest')}
        className="fixed bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-40"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('SouthEast')}
        className="fixed bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-40"
      />
    </>
  );
}
