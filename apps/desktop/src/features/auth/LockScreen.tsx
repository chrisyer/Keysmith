import { ArrowRight, Fingerprint, Globe, Loader2, Lock, LogOut, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SUPPORTED_LOCALES, useI18n, type LanguageMode } from '../../i18n';
import { isTauriRuntime } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';

export function LockScreen() {
  const inTauri = isTauriRuntime();
  const { dict, languageMode, setLanguageMode, fmt } = useI18n();

  const accountId = useSessionStore((s) => s.accountId);
  const email = useSessionStore((s) => s.email);
  const displayName = useSessionStore((s) => s.displayName);
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const biometricEnabled = useSessionStore((s) => s.biometricEnabled);
  const savedAccounts = useSessionStore((s) => s.savedAccounts);
  const unlockWithPassword = useSessionStore((s) => s.unlockWithPassword);
  const unlockWithBiometric = useSessionStore((s) => s.unlockWithBiometric);
  const switchAccount = useSessionStore((s) => s.switchAccount);
  const startAddingAccount = useSessionStore((s) => s.startAddingAccount);
  const logout = useSessionStore((s) => s.logout);

  const getFilter = useUiStore((s) => s.getFilter);
  const refreshAll = useVaultStore((s) => s.refreshAll);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [touchScanning, setTouchScanning] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const hasAutoPromptedRef = useRef(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const triggerShake = () => {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
  };

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setUnlocking(true);
    setError(null);
    try {
      await unlockWithPassword(password);
      await refreshAll(getFilter());
    } catch (err) {
      setPassword('');
      setError(err instanceof Error ? err.message : 'Incorrect master password');
      triggerShake();
    } finally {
      setUnlocking(false);
    }
  };

  const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent);

  const handleTouchId = useCallback(
    async (isAuto = false) => {
      setTouchScanning(true);
      setError(null);
      try {
        await unlockWithBiometric();
        await refreshAll(getFilter());
      } catch (err) {
        if (isAuto) {
          setError(dict.lock.biometricFailedFallback);
        } else {
          setError(err instanceof Error ? err.message : 'Biometric authentication failed');
        }
        window.setTimeout(() => passwordInputRef.current?.focus(), 60);
      } finally {
        setTouchScanning(false);
      }
    },
    [dict.lock.biometricFailedFallback, getFilter, refreshAll, unlockWithBiometric],
  );

  useEffect(() => {
    if (!inTauri || !biometricEnabled || hasAutoPromptedRef.current) return;

    const triggerOnce = () => {
      if (hasAutoPromptedRef.current) return;
      hasAutoPromptedRef.current = true;
      void handleTouchId(true);
    };

    if (document.visibilityState === 'visible' && document.hasFocus()) {
      const timer = window.setTimeout(triggerOnce, 220);
      return () => window.clearTimeout(timer);
    }

    const onWindowFocus = () => {
      window.removeEventListener('focus', onWindowFocus);
      triggerOnce();
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [inTauri, biometricEnabled, handleTouchId]);

  const initials = (displayName || email || 'K').slice(0, 2).toUpperCase();
  const hasQuickUnlock = biometricEnabled;

  const content = (
    <div
      className={
        inTauri
          ? 'h-dvh w-full flex flex-col bg-[var(--bg-elevated)] backdrop-blur-2xl overflow-hidden'
          : 'w-full max-w-[390px] rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-2xl overflow-hidden flex flex-col'
      }
    >
      {/* Top Bar (with drag region on desktop & clean compact language pill) */}
      <div className="relative h-11 px-3.5 flex items-center justify-end shrink-0">
        {inTauri && <div data-tauri-drag-region className="absolute inset-0" />}
        <label className="relative z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-card)]/70 hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] cursor-pointer">
          <Globe size={12} className="shrink-0" />
          <select
            aria-label={dict.settings.languageLabel}
            value={languageMode}
            onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
            className="ks-select-inline text-[var(--text-secondary)]"
          >
            <option value="system">{dict.settings.languageSystem}</option>
            {SUPPORTED_LOCALES.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Main Centered Lock Content */}
      <div className="flex-1 overflow-y-auto ks-scroll px-7 pb-5 pt-2 flex flex-col items-center justify-center text-center">
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-[var(--accent-primary)] text-white text-xl font-semibold flex items-center justify-center shadow-sm">
            {initials}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-secondary)]">
            <Lock size={11} />
          </div>
        </div>

        <h1 className="mt-3 text-[17px] font-semibold text-[var(--text-primary)] tracking-tight">
          {displayName || email}
        </h1>
        <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">{email}</p>
        {serverUrl && (
          <p className="mt-0.5 text-xs font-mono-tabular text-[var(--text-muted)] truncate max-w-full">
            {serverUrl}
          </p>
        )}

        {savedAccounts.length > 1 && (
          <div className="mt-3 w-full">
            <select
              aria-label={dict.lock.switchAccount}
              value={accountId}
              onChange={(e) => {
                if (e.target.value !== accountId) {
                  setPassword('');
                  setError(null);
                  void switchAccount(e.target.value);
                }
              }}
              className="ks-select w-full"
            >
              {savedAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.email} ({acc.serverUrl})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Default Primary Unlock: Touch ID / Windows Hello */}
        {biometricEnabled && (
          <button
            type="button"
            onClick={() => void handleTouchId(false)}
            disabled={touchScanning}
            className="mt-5 w-full h-11 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-70 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {touchScanning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Fingerprint size={17} />
            )}
            {touchScanning
              ? (isWindows ? dict.lock.windowsHelloVerifying : dict.lock.touchIdVerifying)
              : (isWindows ? dict.lock.windowsHelloBtn : dict.lock.touchIdBtn)}
          </button>
        )}

        {hasQuickUnlock && (
          <div className="w-full flex items-center gap-2.5 mt-4 mb-2">
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
            <span className="text-xs text-[var(--text-muted)]">{dict.lock.orMasterPassword}</span>
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          </div>
        )}

        {/* Master Password Fallback */}
        <form
          onSubmit={(e) => void handlePasswordUnlock(e)}
          className={`w-full ${hasQuickUnlock ? 'mt-1' : 'mt-5'} flex flex-col gap-2`}
        >
          <div className={`relative flex items-center ${shaking ? 'ks-shake' : ''}`}>
            <input
              ref={passwordInputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={!hasQuickUnlock}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={
                inTauri
                  ? dict.lock.unlockPlaceholder
                  : fmt(dict.lock.demoUnlockPlaceholder, { pw: 'keysmith' })
              }
              aria-label={dict.auth.masterPassword}
              className="w-full h-11 pl-3.5 pr-11 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[13.5px] font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={unlocking || !password}
              aria-label={dict.lock.unlockBtn}
              className="absolute right-1.5 p-1.5 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-40 text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors cursor-pointer"
            >
              {unlocking ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-[var(--status-danger)] text-left px-0.5 leading-snug">{error}</p>
          )}
        </form>
      </div>

      {/* Pinned Bottom Bar */}
      <div className="px-6 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/40 flex items-center justify-between text-xs text-[var(--text-muted)] shrink-0">
        <button
          type="button"
          onClick={startAddingAccount}
          className="inline-flex items-center gap-1.5 text-[var(--accent-primary)] hover:underline cursor-pointer"
        >
          <UserPlus size={13} />
          {dict.lock.addAccount}
        </button>

        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {dict.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(false);
                void logout(false);
              }}
              className="text-[var(--status-danger)] font-medium cursor-pointer"
            >
              {dict.common.confirm}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--status-danger)] cursor-pointer"
          >
            <LogOut size={13} />
            {dict.lock.removeAccount}
          </button>
        )}
      </div>
    </div>
  );

  if (inTauri) {
    return content;
  }

  return (
    <div className="h-dvh w-full flex items-center justify-center bg-[var(--bg-sidebar)] p-6">
      {content}
    </div>
  );
}
