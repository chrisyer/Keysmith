import { AtSign, Check, Copy, Dices, History, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { DEFAULT_GENERATOR_OPTIONS } from '../services/generator';
import { tauriClient } from '../services/tauriClient';
import { useSessionStore } from '../stores/sessionStore';
import type {
  GeneratorHistoryEntry,
  GeneratorMode,
  GeneratorOptions,
  GeneratorResult,
} from '../types/domain';
import { formatRelativeTime } from '../utils/format';
import { ColoredPassword } from './ColoredPassword';

const USERNAME_ADJECTIVES = [
  'amber', 'brisk', 'cedar', 'cobalt', 'crimson', 'dawn', 'echo', 'ember',
  'frost', 'harbor', 'ivory', 'jade', 'lunar', 'maple', 'nimbus', 'olive',
  'prism', 'quartz', 'silver', 'solar', 'swift', 'velvet', 'willow', 'zenith',
];

const USERNAME_NOUNS = [
  'anchor', 'atlas', 'beacon', 'breeze', 'canyon', 'compass', 'coral', 'cypress',
  'delta', 'dolphin', 'falcon', 'fjord', 'glacier', 'horizon', 'island', 'kestrel',
  'lagoon', 'meadow', 'nebula', 'oasis', 'orbit', 'phoenix', 'river', 'summit',
];

type PanelMode = GeneratorMode | 'username';
type UsernameStyle = 'plus_alias' | 'catchall' | 'random_word';

function randomToken(len: number): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars[buf[i] % chars.length];
  }
  return out;
}

function randomPick<T>(list: readonly T[]): T {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return list[buf[0] % list.length];
}

function buildUsername(style: UsernameStyle, baseEmail: string, catchallDomain: string): string {
  if (style === 'plus_alias') {
    const trimmed = baseEmail.trim();
    const at = trimmed.indexOf('@');
    const local = at > 0 ? trimmed.slice(0, at) : 'user';
    const domain = at > 0 && at < trimmed.length - 1 ? trimmed.slice(at + 1) : 'example.com';
    const cleanLocal = local.split('+')[0] || 'user';
    return `${cleanLocal}+${randomToken(6)}@${domain}`;
  }
  if (style === 'catchall') {
    const cleanDomain =
      catchallDomain
        .trim()
        .replace(/^https?:\/\//i, '')
        .split('/')[0] || 'example.com';
    const word = randomPick(USERNAME_NOUNS);
    return `${word}.${randomToken(4)}@${cleanDomain}`;
  }
  const adj = randomPick(USERNAME_ADJECTIVES);
  const noun = randomPick(USERNAME_NOUNS);
  const num = 10 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90);
  return `${adj}_${noun}${num}`;
}

export interface GeneratorPanelProps {
  onUseValue?: (value: string) => void;
  onClose?: () => void;
  compact?: boolean;
}

export function GeneratorPanel({ onUseValue, onClose, compact = false }: GeneratorPanelProps) {
  const { dict, fmt } = useI18n();
  const accountEmail = useSessionStore((s) => s.email);

  const [panelTab, setPanelTab] = useState<'generator' | 'history'>('generator');
  const [mode, setMode] = useState<PanelMode>('password');
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS);
  const [result, setResult] = useState<GeneratorResult>({
    value: '',
    strength: { score: 4, label: dict.generator.strengthVeryStrong, entropyBits: 92 },
  });

  const [usernameStyle, setUsernameStyle] = useState<UsernameStyle>('plus_alias');
  const [baseEmail, setBaseEmail] = useState(() => accountEmail || 'name@example.com');
  const [catchallDomain, setCatchallDomain] = useState('example.com');
  const [usernameValue, setUsernameValue] = useState(() =>
    buildUsername('plus_alias', accountEmail || 'name@example.com', 'example.com'),
  );

  const [history, setHistory] = useState<GeneratorHistoryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedHistId, setCopiedHistId] = useState<string | null>(null);

  useEffect(() => {
    if (accountEmail && baseEmail === 'name@example.com') {
      setBaseEmail(accountEmail);
    }
  }, [accountEmail, baseEmail]);

  const regenerateSecret = useCallback(async (nextOpts: GeneratorOptions) => {
    const res = await tauriClient.generatorGenerate(nextOpts);
    setResult(res);
  }, []);

  const regenerateUsername = useCallback(() => {
    setUsernameValue(buildUsername(usernameStyle, baseEmail, catchallDomain));
  }, [usernameStyle, baseEmail, catchallDomain]);

  const loadHistory = useCallback(async () => {
    try {
      const list = await tauriClient.generatorHistoryList();
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void regenerateSecret(options);
  }, [options, regenerateSecret]);

  useEffect(() => {
    if (mode === 'username') {
      regenerateUsername();
    }
  }, [mode, regenerateUsername]);

  useEffect(() => {
    if (panelTab === 'history') {
      void loadHistory();
    }
  }, [panelTab, loadHistory]);

  const handleModeSwitch = (next: PanelMode) => {
    setMode(next);
    if (next !== 'username') {
      setOptions((prev) => ({ ...prev, mode: next }));
    }
  };

  const recordCurrent = async (source: string) => {
    if (mode === 'username' || !result.value) return;
    try {
      await tauriClient.generatorHistoryRecord(
        result.value,
        options.mode,
        result.strength.entropyBits,
        source,
      );
      if (panelTab === 'history') {
        await loadHistory();
      }
    } catch {
      // Ignore if session locked or unsupported
    }
  };

  const currentValue = mode === 'username' ? usernameValue : result.value;

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
    <div className={`${compact ? 'p-3.5' : 'p-4'} flex flex-col gap-3`}>
      {/* Top Switcher: Generator vs History */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px]">
          <button
            type="button"
            onClick={() => setPanelTab('generator')}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              panelTab === 'generator'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Dices size={12} />
            {dict.generator.tabGenerator}
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('history')}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              panelTab === 'history'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <History size={12} />
            {dict.generator.tabHistory}
          </button>
        </div>

        {panelTab === 'generator' ? (
          <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px]">
            {(
              [
                { id: 'password', label: dict.generator.modePassword },
                { id: 'passphrase', label: dict.generator.modePassphrase },
                { id: 'pin', label: dict.generator.modePin },
                { id: 'username', label: dict.generator.modeUsername },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleModeSwitch(tab.id)}
                className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  mode === tab.id
                    ? 'bg-[var(--accent-primary)] text-white shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          history.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                await tauriClient.generatorHistoryClear();
                setHistory([]);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--status-danger)] hover:underline cursor-pointer"
            >
              <Trash2 size={11} />
              {dict.generator.clearHistory}
            </button>
          )
        )}
      </div>

      {panelTab === 'generator' ? (
        <>
          <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[14px] leading-relaxed min-h-[24px] flex-1 min-w-0 break-all">
                {mode === 'username' ? (
                  <span className="font-mono-tabular text-[var(--text-primary)] select-all">
                    {usernameValue}
                  </span>
                ) : (
                  <ColoredPassword value={result.value} revealed />
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  mode === 'username' ? regenerateUsername() : void regenerateSecret(options)
                }
                title={dict.generator.regenerate}
                aria-label={dict.generator.regenerate}
                className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {mode !== 'username' && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{ width: strengthWidth, backgroundColor: strengthColor }}
                  />
                </div>
                <span className="text-[10px] font-medium text-[var(--text-secondary)] shrink-0">
                  {(
                    [
                      dict.generator.strength0,
                      dict.generator.strength1,
                      dict.generator.strength2,
                      dict.generator.strength3,
                      dict.generator.strength4,
                    ] as const
                  )[result.strength.score] ?? result.strength.label}{' '}
                  · {result.strength.entropyBits} bits
                </span>
              </div>
            )}
          </div>

          {mode === 'password' && (
            <div className="flex flex-col gap-2.5 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-secondary)]">
                  {fmt(dict.generator.lengthLabel, { len: options.length })}
                </span>
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
                <span className="text-[var(--text-secondary)]">{dict.generator.includeDigits}</span>
                <input
                  type="checkbox"
                  checked={options.includeDigits}
                  onChange={(e) => setOptions((p) => ({ ...p, includeDigits: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">{dict.generator.includeSymbols}</span>
                <input
                  type="checkbox"
                  checked={options.includeSymbols}
                  onChange={(e) => setOptions((p) => ({ ...p, includeSymbols: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">{dict.generator.excludeAmbiguous}</span>
                <input
                  type="checkbox"
                  checked={options.excludeAmbiguous}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, excludeAmbiguous: e.target.checked }))
                  }
                  className="ks-checkbox"
                />
              </label>
            </div>
          )}

          {mode === 'passphrase' && (
            <div className="flex flex-col gap-2.5 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-secondary)]">
                  {fmt(dict.generator.wordCountLabel, { count: options.wordCount })}
                </span>
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
                <span className="text-[var(--text-secondary)]">{dict.generator.separatorLabel}</span>
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
                <span className="text-[var(--text-secondary)]">{dict.generator.capitalizeLabel}</span>
                <input
                  type="checkbox"
                  checked={options.capitalize}
                  onChange={(e) => setOptions((p) => ({ ...p, capitalize: e.target.checked }))}
                  className="ks-checkbox"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[var(--text-secondary)]">
                  {dict.generator.includeNumberInPhrase}
                </span>
                <input
                  type="checkbox"
                  checked={options.includeNumberInPhrase}
                  onChange={(e) =>
                    setOptions((p) => ({ ...p, includeNumberInPhrase: e.target.checked }))
                  }
                  className="ks-checkbox"
                />
              </label>
            </div>
          )}

          {mode === 'pin' && (
            <div className="flex flex-col gap-2.5 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-secondary)]">
                  {fmt(dict.generator.pinLengthLabel, { len: options.pinLength })}
                </span>
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

          {mode === 'username' && (
            <div className="flex flex-col gap-2.5 text-xs">
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'plus_alias', label: dict.generator.usernameStylePlus },
                    { id: 'catchall', label: dict.generator.usernameStyleCatchall },
                    { id: 'random_word', label: dict.generator.usernameStyleRandom },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setUsernameStyle(s.id)}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium truncate cursor-pointer ${
                      usernameStyle === s.id
                        ? 'bg-[var(--bg-selected)] border-[var(--accent-primary)] text-[var(--accent-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {usernameStyle === 'plus_alias' && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    {dict.generator.baseEmailLabel}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <AtSign size={13} className="text-[var(--text-muted)] shrink-0" />
                    <input
                      type="email"
                      value={baseEmail}
                      onChange={(e) => setBaseEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs font-mono-tabular text-[var(--text-primary)]"
                    />
                  </div>
                </label>
              )}
              {usernameStyle === 'catchall' && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    {dict.generator.domainLabel}
                  </span>
                  <input
                    type="text"
                    value={catchallDomain}
                    onChange={(e) => setCatchallDomain(e.target.value)}
                    placeholder="example.com"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs font-mono-tabular text-[var(--text-primary)]"
                  />
                </label>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={async () => {
                await tauriClient.clipboardCopySecret(
                  currentValue,
                  mode === 'username' ? dict.generator.modeUsername : dict.generator.title,
                  mode !== 'username',
                );
                await recordCurrent('copied');
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                onUseValue
                  ? 'border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  : 'bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white'
              }`}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? dict.generator.copiedBtn : dict.generator.copyBtn}
            </button>
            {onUseValue && (
              <button
                type="button"
                onClick={() => {
                  void recordCurrent('used');
                  onUseValue(currentValue);
                  onClose?.();
                }}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
              >
                {mode === 'username' ? dict.generator.useValueBtn : dict.generator.useBtn}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto ks-scroll">
          {history.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              {dict.generator.emptyHistory}
            </div>
          ) : (
            history.map((entry) => (
              <div
                key={entry.id}
                className="p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs truncate">
                    <ColoredPassword value={entry.value} revealed />
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {entry.mode} · {entry.entropyBits} bits · {formatRelativeTime(entry.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await tauriClient.clipboardCopySecret(entry.value, dict.generator.tabHistory, true);
                      setCopiedHistId(entry.id);
                      setTimeout(() => setCopiedHistId(null), 1400);
                    }}
                    aria-label={dict.generator.copyBtn}
                    className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                  >
                    {copiedHistId === entry.id ? (
                      <Check size={12} className="text-[var(--status-success)]" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                  {onUseValue && (
                    <button
                      type="button"
                      onClick={() => {
                        onUseValue(entry.value);
                        onClose?.();
                      }}
                      className="px-2 py-1 rounded-md bg-[var(--accent-primary)] text-white text-[10px] font-medium cursor-pointer"
                    >
                      {dict.generator.useValueBtn}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
