import { Check, Copy, Maximize2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { tauriClient } from '../services/tauriClient';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';
import type { TotpCode } from '../types/domain';

interface TotpRowProps {
  label: string;
  secretOrUri: string;
}

export function TotpRow({ label, secretOrUri }: TotpRowProps) {
  const [totp, setTotp] = useState<TotpCode>({
    code: '000000',
    formattedCode: '000 000',
    remainingSeconds: 30,
    period: 30,
  });
  const [copied, setCopied] = useState(false);

  const openLargeType = useUiStore((s) => s.openLargeType);
  const showToast = useUiStore((s) => s.showToast);
  const clearSec = useSessionStore((s) => s.clipboardClearSeconds);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void tauriClient.totpCompute(secretOrUri).then((res) => {
        if (active) setTotp(res);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [secretOrUri]);

  const isExpiring = totp.remainingSeconds <= 5;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, totp.remainingSeconds / totp.period));
  const strokeDashoffset = circumference * (1 - progress);

  const handleCopy = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    await tauriClient.clipboardCopySecret(totp.code, label, true);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    showToast({
      label,
      text: `已复制「${label}」· ${clearSec} 秒后自动清空剪贴板`,
      kind: 'clipboard',
    });
  };

  return (
    <div
      onClick={() => void handleCopy()}
      className="group relative flex items-center justify-between gap-3 px-4 py-3 rounded-lg hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)] transition-colors cursor-pointer"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-[var(--text-secondary)]">{label}</div>
        <div
          className={`font-mono-tabular text-[19px] font-semibold tracking-wider mt-0.5 ${
            isExpiring ? 'text-[var(--status-danger)] ks-pulse-danger' : 'text-[var(--text-primary)]'
          }`}
        >
          {totp.formattedCode}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openLargeType(label, totp.code);
            }}
            title="大字展示 (Large Type)"
            aria-label="大字展示验证码"
            className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors cursor-pointer"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            onClick={(e) => void handleCopy(e)}
            title="复制验证码"
            aria-label="复制验证码"
            className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors cursor-pointer"
          >
            {copied ? <Check size={14} className="text-[var(--status-success)]" /> : <Copy size={14} />}
          </button>
        </div>

        <div
          className={`flex items-center gap-1.5 pl-2 ${
            isExpiring ? 'text-[var(--status-danger)] ks-pulse-danger' : 'text-[var(--text-secondary)]'
          }`}
          title={`剩余 ${totp.remainingSeconds} 秒`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90">
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="2.5"
            />
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke={isExpiring ? 'var(--status-danger)' : 'var(--accent-primary)'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: 'stroke-dashoffset 0.35s linear' }}
            />
          </svg>
          <span className="font-mono-tabular text-xs font-medium w-6 text-right">
            {totp.remainingSeconds}s
          </span>
        </div>
      </div>
    </div>
  );
}
