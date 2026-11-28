import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
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
  maximized: maximizedProp,
  className = '',
}: {
  compact?: boolean;
  maximized?: boolean;
  className?: string;
}) {
  const { dict } = useI18n();
  const hookMaximized = useWindowMaximized();
  const maximized = maximizedProp ?? hookMaximized;
  const win = getCurrentWindow();

  const btnSize = compact ? 'h-7 w-8' : 'h-8 w-10';
  const iconSize = compact ? 13 : 14;

  return (
    <div className={`flex items-center shrink-0 select-none ${className}`}>
      <button
        type="button"
        onClick={() => void win.minimize()}
        title={dict.app.windowMinimize}
        aria-label={dict.app.windowMinimize}
        className={`${btnSize} inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer`}
      >
        <Minus size={iconSize} />
      </button>
      <button
        type="button"
        onClick={() => void win.toggleMaximize()}
        title={maximized ? dict.app.windowRestore : dict.app.windowMaximize}
        aria-label={maximized ? dict.app.windowRestore : dict.app.windowMaximize}
        className={`${btnSize} inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer`}
      >
        {maximized ? <Copy size={iconSize - 2} /> : <Square size={iconSize - 2} />}
      </button>
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

export function WindowTitleBar({
  title = 'Keysmith',
  maximized,
  rightSlot,
}: {
  title?: string;
  maximized?: boolean;
  rightSlot?: ReactNode;
}) {
  const win = getCurrentWindow();

  return (
    <div className="h-8 w-full bg-[var(--bg-sidebar)] border-b border-[var(--border-subtle)] flex items-center justify-between select-none shrink-0 z-30">
      <div
        data-tauri-drag-region
        onDoubleClick={() => void win.toggleMaximize()}
        className="flex items-center gap-2 pl-3 pr-2 h-full min-w-0"
      >
        <img
          src="/logo.png"
          alt="Keysmith"
          className="w-4 h-4 rounded object-cover pointer-events-none shrink-0"
        />
        <span className="text-xs font-medium text-[var(--text-secondary)] truncate pointer-events-none">
          {title}
        </span>
      </div>

      <div
        data-tauri-drag-region
        onDoubleClick={() => void win.toggleMaximize()}
        className="flex-1 h-full min-w-[32px]"
      />

      <div className="flex items-center h-full shrink-0">
        {rightSlot}
        <WindowControls maximized={maximized} />
      </div>
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
        className="fixed top-0 left-[6px] right-[6px] h-[3px] cursor-ns-resize z-50"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('South')}
        className="fixed bottom-0 left-[6px] right-[6px] h-[4px] cursor-ns-resize z-50"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('West')}
        className="fixed top-[6px] bottom-[6px] left-0 w-[4px] cursor-ew-resize z-50"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('East')}
        className="fixed top-[6px] bottom-[6px] right-0 w-[4px] cursor-ew-resize z-50"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('NorthWest')}
        className="fixed top-0 left-0 w-[6px] h-[6px] cursor-nwse-resize z-50"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('NorthEast')}
        className="fixed top-0 right-0 w-[6px] h-[6px] cursor-nesw-resize z-50"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('SouthWest')}
        className="fixed bottom-0 left-0 w-[6px] h-[6px] cursor-nesw-resize z-50"
      />
      <div
        aria-hidden="true"
        onMouseDown={startResize('SouthEast')}
        className="fixed bottom-0 right-0 w-[6px] h-[6px] cursor-nwse-resize z-50"
      />
    </>
  );
}
