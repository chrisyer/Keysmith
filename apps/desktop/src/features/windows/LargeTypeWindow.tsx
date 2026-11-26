import { Check, Copy, Pin, PinOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCharColorVar } from '../../components/ColoredPassword';
import { useI18n } from '../../i18n';
import { tauriClient, type LargeTypePayload } from '../../services/tauriClient';

export function LargeTypeWindow() {
  const { dict, fmt } = useI18n();
  const [payload, setPayload] = useState<LargeTypePayload | null>(null);
  const [pinned, setPinned] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void tauriClient
      .largeTypeGetPayload()
      .then((res) => {
        if (active) setPayload(res);
      })
      .catch(() => {
        if (active) setPayload(null);
      });

    const unsubUpdate = tauriClient.onEvent('large-type:updated', (next) => {
      setPayload(next);
    });

    const unsubSession = tauriClient.onEvent('session:state_changed', ({ status }) => {
      if (status !== 'Unlocked') {
        setPayload(null);
        void tauriClient.windowCloseLargeType();
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void tauriClient.windowCloseLargeType();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      active = false;
      unsubUpdate();
      unsubSession();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const chars = payload ? Array.from(payload.value) : [];

  const handleTogglePin = async () => {
    const next = !pinned;
    setPinned(next);
    try {
      await tauriClient.windowSetLargeTypePin(next);
    } catch {
      setPinned(!next);
    }
  };

  const handleCopy = async () => {
    if (!payload) return;
    await tauriClient.clipboardCopySecret(payload.value, payload.label, true);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="h-dvh w-screen rounded-[14px] bg-[#161618] text-[#f5f5f7] flex flex-col overflow-hidden select-none border border-white/12 shadow-2xl">
      {/* Draggable Header */}
      <header
        data-tauri-drag-region
        className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4 shrink-0"
      >
        <div data-tauri-drag-region className="min-w-0">
          <h1 data-tauri-drag-region className="text-sm font-medium text-white/90 truncate">
            {dict.largeType.title}{payload ? ` · ${payload.label}` : ''}
          </h1>
          <p data-tauri-drag-region className="text-[11px] text-white/45 mt-0.5">
            {payload
              ? fmt(dict.largeType.charCount, { count: chars.length })
              : dict.largeType.loading}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleTogglePin()}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              pinned
                ? 'bg-[#0a84ff]/25 text-[#60a5fa] border border-[#0a84ff]/40'
                : 'bg-white/10 hover:bg-white/15 text-white/75'
            }`}
          >
            {pinned ? <Pin size={13} /> : <PinOff size={13} />}
            {pinned ? dict.largeType.pinned : dict.largeType.unpinned}
          </button>

          {payload && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition-colors cursor-pointer"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              {copied ? dict.common.copied : dict.common.copy}
            </button>
          )}

          <button
            type="button"
            onClick={() => void tauriClient.windowCloseLargeType()}
            aria-label={dict.common.close}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Character Grid */}
      <div className="flex-1 min-h-0 p-5 flex flex-col justify-between gap-3 overflow-hidden">
        {payload ? (
          <div
            className="grid gap-2.5 p-4 rounded-xl bg-black/35 border border-white/10 flex-1 min-h-0 overflow-y-auto ks-scroll content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))' }}
            data-selectable="true"
          >
            {chars.map((ch, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center justify-center py-2 px-1 rounded-lg bg-white/[0.04] border border-white/[0.06]"
              >
                <span
                  className="font-mono-tabular text-2xl sm:text-3xl font-semibold leading-none"
                  style={{ color: getCharColorVar(ch) }}
                >
                  {ch === ' ' ? '␣' : ch}
                </span>
                <span className="font-mono-tabular text-[10px] text-white/40 mt-1.5">
                  {idx + 1}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-white/50">
            {dict.largeType.empty}
          </div>
        )}

        <div className="flex items-center justify-end text-[11px] text-white/45 shrink-0">
          <span>{dict.largeType.escHint}</span>
        </div>
      </div>
    </div>
  );
}
