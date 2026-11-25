import { Check, Copy, Dices, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_GENERATOR_OPTIONS } from '../services/generator';
import { tauriClient } from '../services/tauriClient';
import type { GeneratorMode, GeneratorOptions, GeneratorResult } from '../types/domain';
import { ColoredPassword } from './ColoredPassword';

interface GeneratorPopoverProps {
  onUsePassword: (value: string) => void;
}

export function GeneratorPopover({ onUsePassword }: GeneratorPopoverProps) {
  const rawId = useId().replace(/:/g, '');
  const popoverId = `gen-pop-${rawId}`;
  const anchorName = `--gen-trigger-${rawId}`;
  const popoverRef = useRef<HTMLDivElement>(null);

  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS);
  const [result, setResult] = useState<GeneratorResult>({
    value: '',
    strength: { score: 4, label: '极强', entropyBits: 92 },
  });
  const [copied, setCopied] = useState(false);

  const regenerate = async (nextOpts: GeneratorOptions) => {
    const res = await tauriClient.generatorGenerate(nextOpts);
    setResult(res);
  };

  useEffect(() => {
    void regenerate(options);
  }, [options]);

  const setMode = (mode: GeneratorMode) => {
    setOptions((prev) => ({ ...prev, mode }));
  };

  const strengthColor =
    result.strength.score >= 4
      ? 'var(--status-success)'
      : result.strength.score === 3
        ? 'var(--accent-primary)'
        : result.strength.score === 2
          ? 'var(--status-warning)'
          : 'var(--status-danger)';

  const strengthWidth = `${Math.max(15, (result.strength.score + 1) * 20)}%`;

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        style={{ anchorName } as React.CSSProperties}
        title="打开密码生成器"
        aria-label="打开密码生成器"
        className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors cursor-pointer"
      >
        <Dices size={15} />
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        style={{ positionAnchor: anchorName } as React.CSSProperties}
        className="ks-popover ks-anchored-popover-end w-[340px]"
      >
        <div className="p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">密码生成器</span>
            <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px]">
              {(
                [
                  { id: 'password', label: '随机密码' },
                  { id: 'passphrase', label: '助记词' },
                  { id: 'pin', label: 'PIN 码' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMode(tab.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    options.mode === tab.id
                      ? 'bg-[var(--accent-primary)] text-white shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[14px] leading-relaxed min-h-[24px] flex-1">
                <ColoredPassword value={result.value} revealed />
              </div>
              <button
                type="button"
                onClick={() => void regenerate(options)}
                title="重新生成"
                aria-label="重新生成"
                className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{ width: strengthWidth, backgroundColor: strengthColor }}
                />
              </div>
              <span className="text-[10px] font-medium text-[var(--text-secondary)] shrink-0">
                {result.strength.label} · {result.strength.entropyBits} bits
              </span>
            </div>
          </div>

          {options.mode === 'password' && (
            <div className="flex flex-col gap-2.5 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-secondary)]">长度：{options.length}</span>
                <input
                  type="range"
                  min={8}
                  max={64}
                  value={options.length}
                  onChange={(e) => setOptions((p) => ({ ...p, length: Number(e.target.value) }))}
                  className="ks-range w-44"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">包含数字 (0-9)</span>
                <input
                  type="checkbox"
                  checked={options.includeDigits}
                  onChange={(e) => setOptions((p) => ({ ...p, includeDigits: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">包含符号 (!@#$...)</span>
                <input
                  type="checkbox"
                  checked={options.includeSymbols}
                  onChange={(e) => setOptions((p) => ({ ...p, includeSymbols: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">避免易混淆字符 (0/O/1/l/I)</span>
                <input
                  type="checkbox"
                  checked={options.excludeAmbiguous}
                  onChange={(e) => setOptions((p) => ({ ...p, excludeAmbiguous: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
            </div>
          )}

          {options.mode === 'passphrase' && (
            <div className="flex flex-col gap-2.5 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-secondary)]">单词数：{options.wordCount}</span>
                <input
                  type="range"
                  min={3}
                  max={8}
                  value={options.wordCount}
                  onChange={(e) => setOptions((p) => ({ ...p, wordCount: Number(e.target.value) }))}
                  className="ks-range w-44"
                />
              </label>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">分隔符</span>
                <div className="flex items-center gap-1">
                  {(['-', '.', '_', ' '] as const).map((sep) => (
                    <button
                      key={sep}
                      type="button"
                      onClick={() => setOptions((p) => ({ ...p, separator: sep }))}
                      className={`w-7 h-6 rounded border text-[11px] font-mono-tabular cursor-pointer ${
                        options.separator === sep
                          ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                          : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {sep === ' ' ? '␣' : sep}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">首字母大写</span>
                <input
                  type="checkbox"
                  checked={options.capitalize}
                  onChange={(e) => setOptions((p) => ({ ...p, capitalize: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">附加随机数字</span>
                <input
                  type="checkbox"
                  checked={options.includeNumberInPhrase}
                  onChange={(e) => setOptions((p) => ({ ...p, includeNumberInPhrase: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
            </div>
          )}

          {options.mode === 'pin' && (
            <div className="flex flex-col gap-2.5 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-secondary)]">PIN 位数：{options.pinLength}</span>
                <input
                  type="range"
                  min={4}
                  max={12}
                  value={options.pinLength}
                  onChange={(e) => setOptions((p) => ({ ...p, pinLength: Number(e.target.value) }))}
                  className="ks-range w-44"
                />
              </label>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={async () => {
                await tauriClient.clipboardCopySecret(result.value, '生成的密码', true);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              {copied ? <Check size={13} className="text-[var(--status-success)]" /> : <Copy size={13} />}
              {copied ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              onClick={() => {
                onUsePassword(result.value);
                popoverRef.current?.hidePopover?.();
              }}
              className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
            >
              使用密码
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
